import { useEffect, useMemo, useRef, useState } from "react";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { rootRoute } from "./__root";
import { ApiError } from "@/lib/api-errors";
import { getRuntimeBetterAuthCookieHeader } from "@/lib/better-auth-cookie";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import { acceptInvite } from "@/lib/server-functions/internal-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type AcceptState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; orgName: string }
  | { status: "error"; error: UserFacingError };

type AcceptAttemptResult = {
  orgName: string;
};

const pendingInviteAcceptAttempts = new Map<string, Promise<AcceptAttemptResult>>();
const AUTH_RETRY_COUNT = 60;
const AUTH_RETRY_DELAY_MS = 250;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const getOrgNameFromAcceptPayload = (payload: unknown): string => {
  return payload && typeof payload === "object" && "orgName" in payload
    ? String((payload as { orgName?: unknown }).orgName ?? "your organization")
    : "your organization";
};

const startInviteAcceptAttempt = (params: {
  attemptKey: string;
  token: string;
  userId: string;
  hasSessionUser: boolean;
}): Promise<AcceptAttemptResult> => {
  const existingAttempt = pendingInviteAcceptAttempts.get(params.attemptKey);
  if (existingAttempt) {
    return existingAttempt;
  }

  const attempt = (async () => {
    let retryCount = 0;
    while (true) {
      try {
        const payload = await acceptInvite({
          token: params.token,
          userId: params.userId,
          betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
        });
        return {
          orgName: getOrgNameFromAcceptPayload(payload),
        };
      } catch (error) {
        const shouldRetryAuth =
          error instanceof ApiError &&
          error.status === 401 &&
          retryCount < AUTH_RETRY_COUNT &&
          params.hasSessionUser;
        if (!shouldRetryAuth) {
          throw error;
        }
        retryCount += 1;
        await wait(AUTH_RETRY_DELAY_MS);
      }
    }
  })();

  pendingInviteAcceptAttempts.set(params.attemptKey, attempt);
  void attempt.finally(() => {
    if (pendingInviteAcceptAttempts.get(params.attemptKey) === attempt) {
      pendingInviteAcceptAttempts.delete(params.attemptKey);
    }
  });
  return attempt;
};

export const inviteAcceptRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invites/accept",
  component: InviteAcceptPage,
});

export function InviteAcceptPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const runtime = useDashboardRuntime();
  const betterAuthSession = runtime.authClient.useSession();
  const [state, setState] = useState<AcceptState>({ status: "idle" });
  const completedAttemptRef = useRef<string | null>(null);

  const token = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("token");
    return value?.trim() ?? "";
  }, []);

  const returnTo = useMemo(() => {
    return `/invites/accept${window.location.search}`;
  }, []);
  const sessionUserId = betterAuthSession.data?.user?.id?.trim() ?? auth.session?.user?.id ?? "";
  const hasSessionUser = sessionUserId.length > 0;

  useEffect(() => {
    if (!token || betterAuthSession.isPending || !hasSessionUser) {
      return;
    }
    const attemptKey = `${sessionUserId}:${token}`;
    if (completedAttemptRef.current === attemptKey) {
      return;
    }

    setState({ status: "loading" });
    let cancelled = false;
    const attempt = startInviteAcceptAttempt({
      attemptKey,
      token,
      userId: sessionUserId,
      hasSessionUser,
    });

    void attempt.then(
      ({ orgName }) => {
        if (cancelled) {
          return;
        }
        completedAttemptRef.current = attemptKey;
        setState({ status: "success", orgName });
      },
      (error) => {
        if (cancelled) {
          return;
        }
        setState({
          status: "error",
          error: toUserFacingError(error, {
            fallback: "Unable to accept invitation.",
            audience: "public",
          }),
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [betterAuthSession.isPending, hasSessionUser, runtime, sessionUserId, token]);

  if (!token) {
    return (
      <InviteWrapper>
        <InviteCard
          imageSrc="/illustrations/404.png"
          imageAlt="Illustration of a missing invitation link"
          title="Invalid invitation link"
          description="This invitation link is incomplete or expired."
          action={
            <Button
              variant="outline"
              onClick={() => {
                void navigate({ to: "/login" });
              }}
            >
              Go to sign in
            </Button>
          }
        />
      </InviteWrapper>
    );
  }

  if (betterAuthSession.isPending && !hasSessionUser) {
    return (
      <InviteWrapper>
        <InviteCard
          imageSrc="/illustrations/login-hero.png"
          imageAlt="Illustration of sign-in state being restored"
          title="Checking your sign-in..."
          description="Please wait while we restore your session to continue with this invitation."
        />
      </InviteWrapper>
    );
  }

  if (!hasSessionUser) {
    return (
      <InviteWrapper>
        <InviteCard
          imageSrc="/illustrations/login-hero.png"
          imageAlt="Illustration of signing in to accept an invitation"
          title="Accept invitation"
          description="Sign in or create an account to accept this invitation."
          action={
            <Button
              onClick={() => {
                void navigate({
                  to: "/login",
                  search: {
                    returnTo,
                  },
                });
              }}
            >
              Continue to sign in
            </Button>
          }
        />
      </InviteWrapper>
    );
  }

  if (state.status === "loading" || state.status === "idle") {
    return (
      <InviteWrapper>
        <InviteCard
          imageSrc="/illustrations/login-hero.png"
          imageAlt="Illustration of invitation acceptance in progress"
          title="Accepting invitation..."
          description="Please wait while we add you to the organization."
        />
      </InviteWrapper>
    );
  }

  if (state.status === "error") {
    return (
      <InviteWrapper>
        <InviteCard
          imageSrc="/illustrations/error.png"
          imageAlt="Illustration of an invalid invitation"
          title={state.error.title}
          description={state.error.summary}
          error={
            state.error.nextSteps.length > 0 ? (
              <div className="rounded-xl border border-border/70 bg-muted/25 px-4 py-3 text-left text-sm text-muted-foreground">
                <p className="font-medium text-foreground">What to do next</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {state.error.nextSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            ) : null
          }
          action={
            <Button
              variant="outline"
              onClick={() => {
                void navigate({ to: "/" });
              }}
            >
              Go to dashboard
            </Button>
          }
        />
      </InviteWrapper>
    );
  }

  return (
    <InviteWrapper>
      <InviteCard
        imageSrc="/illustrations/empty-approvals.png"
        imageAlt="Illustration confirming invitation acceptance"
        title="Invitation accepted"
        description={`You've joined ${state.orgName}.`}
        action={
          <Button
            onClick={() => {
              void navigate({ to: "/" });
            }}
          >
            Go to dashboard
          </Button>
        }
      />
    </InviteWrapper>
  );
}

function InviteWrapper({ children }: { children: React.ReactNode }) {
  const prefersReducedMotion = useReducedMotion();
  const motionProps = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 10 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, ease: "easeOut" as const },
      };

  return (
    <div className="min-h-svh flex items-center justify-center bg-gradient-to-b from-primary/5 via-background to-muted/30 p-4">
      <motion.div className="w-full max-w-lg" {...motionProps}>
        {children}
      </motion.div>
    </div>
  );
}

function InviteCard({
  imageSrc,
  imageAlt,
  title,
  description,
  error,
  action,
}: {
  imageSrc: string;
  imageAlt: string;
  title: string;
  description: string;
  error?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card className="rounded-[20px] shadow-lg">
      <CardHeader className="items-center text-center">
        <img
          src={imageSrc}
          alt={imageAlt}
          className="mb-2 h-auto w-[180px] max-w-full object-contain"
          loading="lazy"
        />
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error}
        {action ? <div className="flex justify-center">{action}</div> : null}
      </CardContent>
    </Card>
  );
}
