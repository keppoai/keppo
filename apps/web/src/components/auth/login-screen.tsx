import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { KeppoMark } from "@/components/landing/keppo-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import type { UserFacingError } from "@/lib/user-facing-errors";

const TEST_EMAIL = "test@test.com";
const TEST_PASSWORD = "test1234";

type LoginScreenProps = {
  onMagicLink: (email: string) => void;
  onEmailPassword: (email: string, password: string) => void;
  onGoogle: () => void;
  onGitHub: () => void;
  onDismissSessionRestore?: () => void;
  isAuthenticating?: boolean;
  isRestoringSession?: boolean;
  error?: UserFacingError | null;
  magicLinkSent?: boolean;
  showEmailPassword?: boolean;
};

export function LoginScreen({
  error,
  magicLinkSent,
  onEmailPassword,
  onMagicLink,
  onGoogle,
  onGitHub: _onGitHub,
  onDismissSessionRestore,
  isAuthenticating,
  isRestoringSession = false,
  showEmailPassword = false,
}: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(true);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!showEmailPassword) {
      return;
    }
    setEmail((current) => current || TEST_EMAIL);
    setPassword((current) => current || TEST_PASSWORD);
  }, [showEmailPassword]);

  const cardAnimation = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.4, ease: "easeOut" as const },
      };
  const fadeMotionProps = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.2 },
      };
  const detailsAnimation = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: "auto" },
        exit: { opacity: 0, height: 0 },
        transition: { duration: 0.24, ease: "easeOut" as const },
      };
  const sessionRestoreProgressAnimation = prefersReducedMotion
    ? {}
    : {
        animate: { x: ["-10%", "160%"] },
        transition: {
          duration: 1.2,
          ease: "easeInOut" as const,
          repeat: Number.POSITIVE_INFINITY,
          repeatDelay: 0.1,
        },
      };
  const subtitle = isRestoringSession
    ? "Keppo found an existing session and is restoring your workspace."
    : "Sign in or create an account";

  return (
    <div className="relative min-h-svh overflow-hidden bg-[linear-gradient(180deg,rgba(221,240,228,0.85)_0%,rgba(250,247,241,0.96)_42%,rgba(244,239,229,0.98)_100%)] pt-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(92,150,112,0.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(214,161,68,0.12),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:linear-gradient(rgba(39,57,45,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(39,57,45,0.16)_1px,transparent_1px)] [background-size:30px_30px]" />

      <motion.div
        className="relative mx-auto flex min-h-[calc(100svh-5rem)] w-full max-w-6xl items-center justify-center"
        {...cardAnimation}
      >
        <Card className="mx-auto w-full max-w-[460px] rounded-[30px] border border-foreground/10 bg-background/94 p-6 shadow-[0_24px_80px_rgba(52,61,46,0.18)] ring-0 backdrop-blur sm:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <KeppoMark className="size-12 rounded-2xl shadow-[0_12px_30px_rgba(92,150,112,0.34)]" />
              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-foreground">
                Keppo
              </h1>
              <p className="mt-2 max-w-sm text-sm leading-6 text-foreground/72">{subtitle}</p>
            </div>
          </div>

          <CardContent className="space-y-5 px-0">
            <AnimatePresence mode="wait" initial={false}>
              {isRestoringSession ? (
                <motion.div key="session-restore" {...fadeMotionProps}>
                  <div
                    className="rounded-[24px] border border-primary/20 bg-primary/8 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary/78">
                      Restoring session
                    </p>
                    <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-foreground">
                      Signing you in...
                    </h2>
                    <p className="mt-3 max-w-sm text-sm leading-6 text-foreground/72">
                      This can take a moment while we reconnect your workspace.
                    </p>
                    <div className="mt-5 h-2 overflow-hidden rounded-full bg-primary/12">
                      <motion.div
                        className="h-full w-2/5 rounded-full bg-primary"
                        role="progressbar"
                        aria-label="Restoring session"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        {...sessionRestoreProgressAnimation}
                      />
                    </div>
                    {onDismissSessionRestore ? (
                      <Button
                        className="mt-5"
                        variant="ghost"
                        onClick={onDismissSessionRestore}
                        type="button"
                      >
                        Sign in manually
                      </Button>
                    ) : null}
                  </div>
                </motion.div>
              ) : (
                <motion.div key="login-form" className="space-y-5" {...fadeMotionProps}>
                  {error ? <UserFacingErrorView error={error} /> : null}

                  <AnimatePresence mode="wait">
                    {magicLinkSent ? (
                      <motion.div key="magic-link-sent" {...fadeMotionProps}>
                        <div className="rounded-[18px] border border-primary/22 bg-primary/8 px-4 py-3 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
                          <p className="font-medium">Check your email</p>
                          <p className="text-sm text-primary/86">
                            We sent a secure sign-in link to{" "}
                            <span className="font-semibold">{email}</span>.
                          </p>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  <div className="space-y-4 rounded-[24px] border border-border/82 bg-muted/38 p-4 sm:p-5">
                    <div className="space-y-2">
                      <label
                        className="block pb-0.5 text-sm font-medium text-foreground"
                        htmlFor="login-email"
                      >
                        Email
                      </label>
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="Enter your email"
                        className="border-foreground/12 bg-background shadow-none placeholder:text-foreground/42"
                        value={email}
                        onChange={(event) => {
                          setEmail(event.target.value);
                        }}
                      />
                    </div>
                    {showEmailPassword ? (
                      <div className="rounded-[22px] border border-dashed border-border/90 bg-background/78 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              Local test sign-in
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowPasswordForm((current) => !current);
                            }}
                          >
                            {showPasswordForm ? "Hide" : "Use test credentials"}
                          </Button>
                        </div>
                        <AnimatePresence initial={false}>
                          {showPasswordForm ? (
                            <motion.div className="overflow-hidden" {...detailsAnimation}>
                              <div className="mt-4 space-y-3 border-t border-border/80 pt-4">
                                <div className="space-y-2">
                                  <label
                                    className="text-sm font-medium text-foreground"
                                    htmlFor="login-password"
                                  >
                                    Password
                                  </label>
                                  <Input
                                    id="login-password"
                                    type="password"
                                    placeholder="Password"
                                    className="border-foreground/12 bg-background shadow-none placeholder:text-foreground/42"
                                    value={password}
                                    onChange={(event) => {
                                      setPassword(event.target.value);
                                    }}
                                  />
                                </div>
                                <Button
                                  className="w-full"
                                  disabled={
                                    !email.trim() || !password.trim() || Boolean(isAuthenticating)
                                  }
                                  onClick={() => {
                                    onEmailPassword(email.trim(), password);
                                  }}
                                >
                                  Sign in with email and password
                                </Button>
                              </div>
                            </motion.div>
                          ) : null}
                        </AnimatePresence>
                      </div>
                    ) : null}
                    <Button
                      className="h-11 w-full text-sm font-semibold shadow-[0_14px_30px_rgba(92,150,112,0.26)]"
                      disabled={Boolean(isAuthenticating)}
                      onClick={() => {
                        const trimmedEmail = email.trim();
                        if (!trimmedEmail) {
                          return;
                        }
                        onMagicLink(trimmedEmail);
                      }}
                    >
                      Send magic link
                    </Button>
                  </div>

                  <div className="flex items-center gap-3">
                    <Separator className="flex-1 bg-border/90" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      or continue with
                    </span>
                    <Separator className="flex-1 bg-border/90" />
                  </div>

                  <div className="space-y-2">
                    <Button
                      className="h-11 w-full justify-center border-foreground/12 bg-background/92 font-medium text-foreground hover:bg-muted"
                      variant="outline"
                      onClick={onGoogle}
                      disabled={Boolean(isAuthenticating)}
                    >
                      Continue with Google
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
