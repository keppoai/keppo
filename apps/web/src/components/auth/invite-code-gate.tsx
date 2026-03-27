import { type FormEvent, useState } from "react";
import { makeFunctionReference } from "convex/server";
import { Loader2Icon, LogOutIcon, TicketIcon } from "lucide-react";

import { KeppoMark } from "@/components/landing/keppo-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";

const redeemInviteCodeRef = makeFunctionReference<"mutation">("invite_codes:redeemInviteCode");

type InviteCodeGateProps = {
  onRedeemed?: () => void;
};

export function InviteCodeGate({ onRedeemed }: InviteCodeGateProps) {
  const runtime = useDashboardRuntime();
  const { logout } = useAuth();
  const redeemInviteCode = runtime.useMutation(redeemInviteCodeRef);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const normalizedCode = code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (normalizedCode.length !== 6 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = (await redeemInviteCode({ code: normalizedCode })) as
        | {
            ok: true;
            code: string;
            grantTier: "free" | "starter" | "pro";
            expiresAt: string | null;
          }
        | { ok: false; message: string };
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(
        result.expiresAt
          ? `Invite code ${result.code} unlocked ${result.grantTier === "starter" ? "Starter" : "Pro"} access until ${new Date(result.expiresAt).toLocaleDateString()}. Opening your workspace...`
          : `Invite code ${result.code} accepted. Permanent launch access is unlocked. Opening your workspace...`,
      );
      onRedeemed?.();
    } catch {
      setError("We couldn't verify that invite code. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-svh overflow-hidden bg-[linear-gradient(180deg,rgba(240,236,225,0.94)_0%,rgba(250,247,241,0.98)_40%,rgba(233,240,228,0.98)_100%)] px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(92,150,112,0.16),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(214,161,68,0.14),transparent_30%)]" />
      <div className="relative mx-auto flex min-h-[calc(100svh-5rem)] max-w-5xl items-center justify-center">
        <Card className="w-full max-w-[520px] rounded-[30px] border border-foreground/10 bg-background/96 p-6 shadow-[0_24px_80px_rgba(52,61,46,0.16)] backdrop-blur sm:p-8">
          <CardContent className="space-y-6 px-0">
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <KeppoMark className="size-14 rounded-2xl shadow-[0_12px_30px_rgba(92,150,112,0.28)]" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/80">
                    Launch Access
                  </p>
                  <h1 className="text-3xl font-semibold tracking-[-0.03em] text-foreground">
                    Enter your invite code
                  </h1>
                </div>
              </div>
              <p className="max-w-md text-sm leading-6 text-foreground/72">
                Keppo is currently invite-only. Enter the 6-character code you received to unlock
                your workspace.
              </p>
            </div>

            <div className="rounded-[24px] border border-border/80 bg-muted/35 p-5">
              <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
                <div className="space-y-2">
                  <label
                    className="block text-sm font-medium text-foreground"
                    htmlFor="invite-code"
                  >
                    Invite code
                  </label>
                  <div className="relative">
                    <TicketIcon className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="invite-code"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="ABC123"
                      className="h-12 border-foreground/12 bg-background pl-11 font-mono text-base tracking-[0.32em] uppercase placeholder:tracking-[0.22em] placeholder:text-foreground/35"
                      maxLength={6}
                      value={normalizedCode}
                      onChange={(event) => {
                        setCode(event.currentTarget.value);
                      }}
                    />
                  </div>
                </div>

                {error ? (
                  <div
                    role="alert"
                    className="rounded-[18px] border border-destructive/18 bg-destructive/8 px-4 py-3 text-sm text-destructive"
                  >
                    {error}
                  </div>
                ) : null}

                {success ? (
                  <div
                    role="status"
                    className="rounded-[18px] border border-primary/20 bg-primary/8 px-4 py-3 text-sm text-primary"
                  >
                    {success}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  className="h-11 w-full text-sm font-semibold shadow-[0_14px_30px_rgba(92,150,112,0.24)]"
                  disabled={isSubmitting || normalizedCode.length !== 6}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2Icon className="mr-2 size-4 animate-spin" />
                      Verifying code
                    </>
                  ) : (
                    "Unlock workspace"
                  )}
                </Button>
              </form>
            </div>

            <div className="flex flex-col gap-3 rounded-[22px] border border-dashed border-border/85 bg-background/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Need a different account?</p>
                <p className="text-sm text-muted-foreground">
                  Sign out to switch to another invited email address.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                onClick={() => {
                  void logout();
                }}
              >
                <LogOutIcon className="mr-2 size-4" />
                Sign out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
