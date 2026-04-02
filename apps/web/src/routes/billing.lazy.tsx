import { billingRoute } from "./billing";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createLazyRoute } from "@tanstack/react-router";
import { makeFunctionReference } from "convex/server";
import { BILLING_SOURCE } from "@keppo/shared/contracts/billing";
import { SUBSCRIPTION_TIERS } from "@keppo/shared/subscriptions";
import { getAutomationRunPackagesForTier } from "@keppo/shared/automations";
import { toast } from "sonner";
import {
  getBillingUsageView,
  parseRedirectUrl,
  toPercent,
  toTierLabel,
} from "@/lib/billing-view-model";
import {
  buildBillingPortalReturnUrl,
  buildBillingReturnUrl,
  clearBillingReturnState,
  readBillingReturnState,
} from "@/lib/billing-redirects";
import { getRuntimeBetterAuthCookieHeader } from "@/lib/better-auth-cookie";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import {
  changeBillingSubscription,
  getBillingSubscriptionPending,
  openBillingPortal,
  startBillingAutomationRunCheckout,
  startBillingCheckout,
  startBillingCreditsCheckout,
  undoBillingCancelAtPeriodEnd,
} from "@/lib/server-functions/internal-api";
import { parseAiCreditBalance } from "@/lib/automations-view-model";
import { ErrorBoundary } from "@/components/error-boundary";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Progress,
  ProgressLabel,
  ProgressTrack,
  ProgressIndicator,
} from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { cn } from "@/lib/utils";

export const billingRouteLazy = createLazyRoute(billingRoute.id)({
  component: BillingPage,
});

const redeemInviteCodeRef = makeFunctionReference<"mutation">("invite_codes:redeemInviteCode");
const billingQueryRef = makeFunctionReference<"query">("billing:getCurrentOrgBilling");

type OptimisticInvitePromo = {
  orgId: string;
  code: string;
  grantTier: "starter" | "pro";
  redeemedAt: string;
  expiresAt: string;
};

const BILLING_ADMIN_NOTE =
  "Billing is managed by organization owners and admins. Ask them to handle plan changes, checkout, top-ups, or billing portal access.";

type BillingTierId = "free" | "starter" | "pro";

type PlanCardAction =
  | {
      kind: "checkout";
      label: string;
      testId: "billing-upgrade-starter" | "billing-upgrade-pro";
      busyAction: "checkout_starter" | "checkout_pro";
      tier: "starter" | "pro";
      variant?: "default" | "outline";
    }
  | {
      kind: "change_plan";
      label: string;
      testId: "billing-change-plan";
      tier: "starter" | "pro";
      disabledHint?: string;
    }
  | {
      kind: "manage";
      label: string;
      testId: "billing-manage-subscription";
    };

type TierComparisonCard = {
  id: BillingTierId;
  label: string;
  priceCentsMonthly: number;
  workspaces: number;
  aiCredits: number;
  aiCreditsLabel: string;
  aiCreditsDescription: string;
  toolCalls: number;
};

function BillingCapacityTopups({
  canManageBilling,
  currentBilling,
  busyAction,
  onCreditPackCheckout,
  onAutomationRunPackCheckout,
}: {
  canManageBilling: boolean;
  currentBilling: {
    org_id: string;
    tier: "free" | "starter" | "pro";
  };
  busyAction:
    | "checkout_starter"
    | "checkout_pro"
    | "credit_pack_0"
    | "credit_pack_1"
    | `run_pack_${number}`
    | "portal"
    | "change_plan"
    | "undo_cancel"
    | null;
  onCreditPackCheckout: (packageIndex: 0 | 1) => void;
  onAutomationRunPackCheckout: (packageIndex: number) => void;
}) {
  const runtime = useDashboardRuntime();
  const aiCreditBalanceRaw = runtime.useQuery(
    makeFunctionReference<"query">("ai_credits:getAiCreditBalance"),
    { org_id: currentBilling.org_id },
  );
  const automationRunUsage = runtime.useQuery(
    makeFunctionReference<"query">("automation_runs:getCurrentOrgAutomationRunUsage"),
    {},
  );
  const automationRunTopupBalance = runtime.useQuery(
    makeFunctionReference<"query">("automation_run_topups:getAutomationRunTopupBalance"),
    { org_id: currentBilling.org_id },
  );
  const aiCreditBalance = useMemo(
    () => parseAiCreditBalance(aiCreditBalanceRaw),
    [aiCreditBalanceRaw],
  );
  const automationRunPackages = useMemo(
    () => getAutomationRunPackagesForTier(currentBilling.tier),
    [currentBilling.tier],
  );
  const baseRunAllowance =
    SUBSCRIPTION_TIERS[currentBilling.tier as keyof typeof SUBSCRIPTION_TIERS].automation_limits
      .max_runs_per_period;

  const formatCurrency = (priceCents: number): string => {
    return `$${(priceCents / 100).toFixed(0)}`;
  };

  return (
    <>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Capacity Top-Ups</h2>
        <p className="text-sm text-muted-foreground">
          Review what is included, what this period has consumed, and which one-time purchases can
          extend capacity.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>AI Credits</CardTitle>
            <CardDescription>
              Monthly allowance plus any purchased credit packs still available.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress
              value={
                aiCreditBalance
                  ? toPercent(aiCreditBalance.allowance_used, aiCreditBalance.allowance_total)
                  : 0
              }
              aria-label="AI credits used"
            >
              <ProgressLabel>Monthly allowance</ProgressLabel>
              <div className="ml-auto text-sm tabular-nums text-muted-foreground">
                {aiCreditBalance
                  ? `${aiCreditBalance.allowance_used}/${aiCreditBalance.allowance_total}`
                  : "-"}
              </div>
              <ProgressTrack>
                <ProgressIndicator />
              </ProgressTrack>
            </Progress>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border bg-primary/5 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">
                  Included allowance
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {aiCreditBalance ? aiCreditBalance.allowance_total : "-"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Monthly bundled credits before purchases
                </p>
              </div>
              <div className="rounded-2xl border px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Used this period
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {aiCreditBalance ? aiCreditBalance.allowance_used : "-"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Credits consumed from the monthly allowance
                </p>
              </div>
              <div className="rounded-2xl border px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Purchased balance
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {aiCreditBalance ? aiCreditBalance.purchased_remaining : "-"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Paid credits that have not been used yet
                </p>
              </div>
              <div className="rounded-2xl border px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Total remaining
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {aiCreditBalance ? aiCreditBalance.total_available : "-"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Included allowance plus purchased credits
                </p>
              </div>
            </div>

            {canManageBilling ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    onCreditPackCheckout(0);
                  }}
                  disabled={busyAction !== null}
                >
                  {busyAction === "credit_pack_0" ? "Opening..." : "Buy 100 credits ($10)"}
                </Button>
                <Button
                  onClick={() => {
                    onCreditPackCheckout(1);
                  }}
                  disabled={busyAction !== null}
                >
                  {busyAction === "credit_pack_1" ? "Opening..." : "Buy 250 credits ($25)"}
                </Button>
              </div>
            ) : (
              <div
                data-testid="billing-topups-note"
                role="status"
                className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
              >
                Ask an owner or admin to purchase AI credit packs for this organization.
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Purchased AI credits stay available for 90 days after checkout completion.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Automation Runs</CardTitle>
            <CardDescription>
              Included monthly allowance plus any purchased run capacity still available this
              period.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress
              value={
                automationRunUsage
                  ? toPercent(automationRunUsage.run_count, automationRunUsage.max_runs_per_period)
                  : 0
              }
              aria-label="Automation runs used"
            >
              <ProgressLabel>Current period</ProgressLabel>
              <div className="ml-auto text-sm tabular-nums text-muted-foreground">
                {automationRunUsage
                  ? `${automationRunUsage.run_count}/${automationRunUsage.max_runs_per_period}`
                  : "-"}
              </div>
              <ProgressTrack>
                <ProgressIndicator />
              </ProgressTrack>
            </Progress>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border bg-primary/5 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">
                  Included allowance
                </p>
                <p className="mt-2 text-2xl font-semibold">{baseRunAllowance.toLocaleString()}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Runs included with the current plan before top-ups
                </p>
              </div>
              <div className="rounded-2xl border px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Purchased runs remaining
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {automationRunTopupBalance
                    ? automationRunTopupBalance.purchased_runs_balance.toLocaleString()
                    : "-"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Active top-up capacity that has not been consumed yet
                </p>
              </div>
              <div className="rounded-2xl border px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Used this period
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {automationRunUsage ? automationRunUsage.run_count.toLocaleString() : "-"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Runs created since the current billing period started
                </p>
              </div>
              <div className="rounded-2xl border px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Remaining
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {automationRunUsage
                    ? Math.max(
                        0,
                        automationRunUsage.max_runs_per_period - automationRunUsage.run_count,
                      ).toLocaleString()
                    : "-"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Included allowance plus purchased runs still available now
                </p>
              </div>
            </div>

            {currentBilling.tier === "free" ? (
              <div className="rounded-2xl border bg-secondary/10 px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  Upgrade when your team needs more monthly automation capacity.
                </p>
              </div>
            ) : null}

            {currentBilling.tier === "free" ? null : (
              <>
                {canManageBilling ? (
                  <div className="flex flex-wrap gap-2">
                    {automationRunPackages.map((pkg, index) => (
                      <Button
                        key={`${pkg.multiplier}-${pkg.runs}`}
                        onClick={() => {
                          onAutomationRunPackCheckout(index);
                        }}
                        disabled={busyAction !== null}
                      >
                        {busyAction === `run_pack_${index}`
                          ? "Opening..."
                          : `Buy ${pkg.runs.toLocaleString()} runs (${formatCurrency(pkg.price_cents)})`}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div
                    role="status"
                    data-testid="billing-automation-topups-note"
                    className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
                  >
                    Ask an owner or admin to purchase automation run top-ups for this organization.
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Each top-up also adds proportional tool calls and total tool runtime for 90 days
                  after checkout completion.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function BillingCapacityTopupsFallback() {
  return (
    <>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Capacity Top-Ups</h2>
        <p className="text-sm text-muted-foreground">
          Review what is included, what this period has consumed, and which one-time purchases can
          extend capacity.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Capacity details temporarily unavailable</CardTitle>
          <CardDescription>
            Plan controls and invite promo actions remain available while this secondary usage data
            reloads.
          </CardDescription>
        </CardHeader>
      </Card>
    </>
  );
}

function BillingPage() {
  const { canManage } = useAuth();
  const runtime = useDashboardRuntime();
  const billing = runtime.useQuery(billingQueryRef, {});
  let aiCreditBalanceRaw: unknown;
  try {
    aiCreditBalanceRaw = runtime.useQuery(
      makeFunctionReference<"query">("ai_credits:getAiCreditBalance"),
      billing ? { org_id: billing.org_id } : "skip",
    );
  } catch {
    aiCreditBalanceRaw = null;
  }
  const redeemInviteCode = runtime.useMutation(redeemInviteCodeRef);
  const [busyAction, setBusyAction] = useState<
    | "checkout_starter"
    | "checkout_pro"
    | "credit_pack_0"
    | "credit_pack_1"
    | `run_pack_${number}`
    | "portal"
    | "change_plan"
    | "undo_cancel"
    | null
  >(null);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [changePlanError, setChangePlanError] = useState<UserFacingError | null>(null);
  const [changePlanOpen, setChangePlanOpen] = useState(false);
  const [pendingRefresh, setPendingRefresh] = useState(0);
  const [pendingSubscription, setPendingSubscription] = useState<{
    cancel_at_period_end: boolean;
    pending_tier: "starter" | "pro" | "free" | null;
    pending_effective_at: string | null;
  } | null>(null);
  const [planTarget, setPlanTarget] = useState<"starter" | "pro" | "free">("pro");
  const [billingName, setBillingName] = useState("");
  const [billingCompany, setBillingCompany] = useState("");
  const [addrLine1, setAddrLine1] = useState("");
  const [addrLine2, setAddrLine2] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrPostal, setAddrPostal] = useState("");
  const [addrCountry, setAddrCountry] = useState("US");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteCodeBusy, setInviteCodeBusy] = useState(false);
  const [inviteCodeError, setInviteCodeError] = useState<string | null>(null);
  const [inviteCodeSuccess, setInviteCodeSuccess] = useState<string | null>(null);
  const [optimisticInvitePromo, setOptimisticInvitePromo] = useState<OptimisticInvitePromo | null>(
    null,
  );

  useEffect(() => {
    if (!billing) {
      setOptimisticInvitePromo(null);
      return;
    }
    if (
      billing.billing_source === BILLING_SOURCE.invitePromo ||
      billing.org_id !== optimisticInvitePromo?.orgId
    ) {
      setOptimisticInvitePromo(null);
    }
  }, [billing, optimisticInvitePromo?.orgId]);

  const displayBilling = useMemo(() => {
    if (
      !billing ||
      !optimisticInvitePromo ||
      billing.billing_source !== BILLING_SOURCE.free ||
      billing.org_id !== optimisticInvitePromo.orgId
    ) {
      return billing;
    }
    return {
      ...billing,
      tier: optimisticInvitePromo.grantTier,
      status: "trialing",
      billing_source: BILLING_SOURCE.invitePromo,
      invite_promo: {
        code: optimisticInvitePromo.code,
        grant_tier: optimisticInvitePromo.grantTier,
        redeemed_at: optimisticInvitePromo.redeemedAt,
        expires_at: optimisticInvitePromo.expiresAt,
      },
      period_start: optimisticInvitePromo.redeemedAt,
      period_end: optimisticInvitePromo.expiresAt,
    };
  }, [billing, optimisticInvitePromo]);
  const aiCreditBalance = useMemo(
    () => parseAiCreditBalance(aiCreditBalanceRaw),
    [aiCreditBalanceRaw],
  );

  const billingOrgId = displayBilling?.org_id ?? null;
  const billingTier = displayBilling?.tier ?? null;
  const billingSource = displayBilling?.billing_source ?? null;
  const invitePromo = displayBilling?.invite_promo ?? null;
  const pendingSubscriptionFetchKey = displayBilling
    ? `${displayBilling.org_id}:${displayBilling.tier}:${displayBilling.billing_source}:${String((displayBilling as { stripe_subscription_id?: string | null }).stripe_subscription_id ?? "")}`
    : null;

  useEffect(() => {
    const state = readBillingReturnState(window.location.href);
    if (!state) {
      return;
    }
    window.history.replaceState({}, "", clearBillingReturnState(window.location.href));
    if (state.kind === "checkout") {
      if (state.status === "success") {
        toast.success("Stripe checkout complete.", {
          description: "Keppo will refresh your plan as soon as Stripe confirms the subscription.",
        });
      } else {
        toast.message("Stripe checkout canceled.");
      }
      return;
    }
    if (state.kind === "runCheckout") {
      if (state.status === "success") {
        toast.success("Automation run purchase complete.", {
          description:
            "Keppo will add the purchased automation run capacity as soon as Stripe confirms the payment.",
        });
      } else {
        toast.message("Automation run checkout canceled.");
      }
      return;
    }
    if (state.status === "success") {
      toast.success("Credit checkout complete.", {
        description: "Keppo will add purchased credits as soon as Stripe confirms the payment.",
      });
    } else {
      toast.message("Credit checkout canceled.");
    }
  }, []);

  useEffect(() => {
    if (
      !billingOrgId ||
      !billingTier ||
      !pendingSubscriptionFetchKey ||
      billingSource !== BILLING_SOURCE.stripe
    ) {
      setPendingSubscription(null);
      return;
    }
    if (billingTier === "free") {
      setPendingSubscription(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await getBillingSubscriptionPending({
          orgId: billingOrgId,
          betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
        });
        if (cancelled || !r || typeof r !== "object" || Array.isArray(r)) {
          return;
        }
        const rec = r as Record<string, unknown>;
        const pt = rec.pending_tier;
        const pendingTier = pt === "starter" || pt === "pro" || pt === "free" ? pt : null;
        setPendingSubscription({
          cancel_at_period_end: rec.cancel_at_period_end === true,
          pending_tier: pendingTier,
          pending_effective_at:
            typeof rec.pending_effective_at === "string" ? rec.pending_effective_at : null,
        });
      } catch {
        if (!cancelled) {
          setPendingSubscription(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    billingOrgId,
    billingSource,
    billingTier,
    pendingRefresh,
    pendingSubscriptionFetchKey,
    runtime.authClient,
  ]);

  const usageView = useMemo(() => {
    if (!displayBilling) {
      return null;
    }
    return getBillingUsageView(displayBilling);
  }, [displayBilling]);
  const bundledRuntimeAvailableForDeployment = aiCreditBalance?.bundled_runtime_enabled ?? false;
  const tierComparison = useMemo<TierComparisonCard[]>(
    () =>
      (["free", "starter", "pro"] as const).map((tierId) => {
        const tier = SUBSCRIPTION_TIERS[tierId];
        return {
          id: tierId,
          label: tier.label,
          priceCentsMonthly: tier.price_cents_monthly,
          workspaces: tier.max_workspaces,
          aiCredits: tier.included_ai_credits.total,
          aiCreditsLabel: bundledRuntimeAvailableForDeployment
            ? tier.included_ai_credits.reset_period === "one_time"
              ? "Bundled trial credits"
              : "Bundled AI credits / mo"
            : tier.included_ai_credits.reset_period === "one_time"
              ? "Included trial credits"
              : "Included AI credits / mo",
          aiCreditsDescription: bundledRuntimeAvailableForDeployment
            ? tier.included_ai_credits.reset_period === "one_time"
              ? "One-time trial credits cover prompt generation and bundled runtime."
              : "Includes Keppo-managed runtime credits."
            : "Supports prompt generation on self-managed deployments.",
          toolCalls: tier.max_tool_calls_per_month,
        } satisfies TierComparisonCard;
      }),
    [bundledRuntimeAvailableForDeployment],
  );
  const promoExpiryLabel = invitePromo
    ? new Date(invitePromo.expires_at).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const promoTierLabel = invitePromo ? toTierLabel(invitePromo.grant_tier) : null;
  const usageSummary = useMemo(() => {
    if (!displayBilling || !usageView) {
      return null;
    }
    const callRatio = displayBilling.limits.max_tool_calls_per_month
      ? displayBilling.usage.tool_call_count / displayBilling.limits.max_tool_calls_per_month
      : 0;
    const timeRatio = displayBilling.limits.max_total_tool_call_time_ms
      ? displayBilling.usage.total_tool_call_time_ms /
        displayBilling.limits.max_total_tool_call_time_ms
      : 0;
    const maxRatio = Math.max(callRatio, timeRatio);
    if (maxRatio >= 1) {
      return "You are at or beyond one of this period's usage limits.";
    }
    if (maxRatio >= 0.8) {
      return "Usage is approaching the current period limit. Review remaining capacity before the next billing reset.";
    }
    if (maxRatio >= 0.4) {
      return "Usage is active but still within the current period budget.";
    }
    return "Usage is comfortably within this period's budget so far.";
  }, [displayBilling, usageView]);
  const formatMonthlyPrice = (priceCents: number): string => {
    if (priceCents <= 0) {
      return "$0/mo";
    }
    return `$${(priceCents / 100).toFixed(0)}/mo`;
  };

  const handleCheckout = async (tier: "starter" | "pro"): Promise<void> => {
    if (!billing) {
      return;
    }
    setError(null);
    setBusyAction(tier === "starter" ? "checkout_starter" : "checkout_pro");
    try {
      const successUrl = buildBillingReturnUrl(window.location.href, "checkout", "success");
      const cancelUrl = buildBillingReturnUrl(window.location.href, "checkout", "cancel");
      const payload = await startBillingCheckout({
        orgId: billing.org_id,
        tier,
        successUrl,
        cancelUrl,
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      const url = parseRedirectUrl(payload);
      if (!url) {
        throw new Error("Checkout URL missing from API response.");
      }
      window.location.assign(url);
    } catch (error) {
      setError(toUserFacingError(error, { fallback: "Checkout failed." }));
    } finally {
      setBusyAction(null);
    }
  };

  const handlePortal = async (): Promise<void> => {
    if (!billing) {
      return;
    }
    setError(null);
    setBusyAction("portal");
    try {
      const returnUrl = buildBillingPortalReturnUrl(window.location.href);
      const payload = await openBillingPortal({
        orgId: billing.org_id,
        returnUrl,
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      const url = parseRedirectUrl(payload);
      if (!url) {
        throw new Error("Billing portal URL missing from API response.");
      }
      window.location.assign(url);
    } catch (error) {
      setError(toUserFacingError(error, { fallback: "Portal launch failed." }));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRedeemInviteCode = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!billing || billing.billing_source !== "free" || inviteCodeBusy) {
      return;
    }
    const normalizedCode = inviteCode
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    if (normalizedCode.length !== 6) {
      setInviteCodeError("Enter a valid 6-character invite code.");
      return;
    }

    setInviteCodeBusy(true);
    setInviteCodeError(null);
    setInviteCodeSuccess(null);
    try {
      const result = (await redeemInviteCode({ code: normalizedCode })) as
        | {
            ok: true;
            grantTier: "free" | "starter" | "pro";
            expiresAt: string | null;
          }
        | {
            ok: false;
            message: string;
          };
      if (!result.ok) {
        setInviteCodeError(result.message);
        return;
      }
      const redeemedAt = new Date().toISOString();
      setInviteCode("");
      setInviteCodeSuccess(
        result.expiresAt
          ? `${toTierLabel(result.grantTier)} promo access is active until ${new Date(
              result.expiresAt,
            ).toLocaleDateString()}.`
          : "Invite code accepted. Permanent launch access is already unlocked for this org.",
      );
      if (result.expiresAt && (result.grantTier === "starter" || result.grantTier === "pro")) {
        setOptimisticInvitePromo({
          orgId: billing.org_id,
          code: normalizedCode,
          grantTier: result.grantTier,
          redeemedAt,
          expiresAt: result.expiresAt,
        });
      }
    } catch (caught) {
      setInviteCodeError(
        toUserFacingError(caught, {
          fallback: "Invite code redemption failed.",
        }).summary,
      );
    } finally {
      setInviteCodeBusy(false);
    }
  };

  const handleCreditPackCheckout = async (packageIndex: 0 | 1): Promise<void> => {
    if (!billing) {
      return;
    }
    setError(null);
    setBusyAction(packageIndex === 0 ? "credit_pack_0" : "credit_pack_1");
    try {
      const successUrl = buildBillingReturnUrl(window.location.href, "creditCheckout", "success");
      const cancelUrl = buildBillingReturnUrl(window.location.href, "creditCheckout", "cancel");
      const payload = await startBillingCreditsCheckout({
        orgId: billing.org_id,
        packageIndex,
        successUrl,
        cancelUrl,
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      const url = parseRedirectUrl(payload);
      if (!url) {
        throw new Error("Credit checkout URL missing from API response.");
      }
      window.location.assign(url);
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "Credit checkout failed." }));
    } finally {
      setBusyAction(null);
    }
  };

  const handleAutomationRunPackCheckout = async (packageIndex: number): Promise<void> => {
    if (!billing) {
      return;
    }
    setError(null);
    setBusyAction(`run_pack_${packageIndex}`);
    try {
      const successUrl = buildBillingReturnUrl(window.location.href, "runCheckout", "success");
      const cancelUrl = buildBillingReturnUrl(window.location.href, "runCheckout", "cancel");
      const payload = await startBillingAutomationRunCheckout({
        orgId: billing.org_id,
        packageIndex,
        successUrl,
        cancelUrl,
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      const url = parseRedirectUrl(payload);
      if (!url) {
        throw new Error("Automation run checkout URL missing from API response.");
      }
      window.location.assign(url);
    } catch (caught) {
      setError(
        toUserFacingError(caught, {
          fallback: "Automation run checkout failed.",
        }),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const tierRank: Record<"free" | "starter" | "pro", number> = {
    free: 0,
    starter: 1,
    pro: 2,
  };

  const formatEffectiveDate = (iso: string | null): string => {
    if (!iso) {
      return "the end of this billing period";
    }
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "the end of this billing period";
    }
  };

  const openChangePlanDialog = (targetTier?: "starter" | "pro"): void => {
    if (!billing) {
      return;
    }
    setChangePlanError(null);
    setPlanTarget(targetTier ?? (billing.tier === "starter" ? "pro" : "starter"));
    setBillingName("");
    setBillingCompany("");
    setAddrLine1("");
    setAddrLine2("");
    setAddrCity("");
    setAddrState("");
    setAddrPostal("");
    setAddrCountry("US");
    setChangePlanOpen(true);
  };

  const openChangePlanDialogForTier = (targetTier: "starter" | "pro"): void => {
    if (!billing) {
      return;
    }
    openChangePlanDialog(targetTier);
  };

  const handleUndoCancel = async (): Promise<void> => {
    if (!billing) {
      return;
    }
    setError(null);
    setBusyAction("undo_cancel");
    try {
      await undoBillingCancelAtPeriodEnd({
        orgId: billing.org_id,
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      toast.success("Cancellation removed", {
        description: "Your subscription will renew as usual.",
      });
      setPendingRefresh((n) => n + 1);
    } catch (caught) {
      setError(
        toUserFacingError(caught, {
          fallback: "Could not update subscription.",
        }),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleChangePlanSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!billing) {
      return;
    }
    setError(null);
    setChangePlanError(null);
    setBusyAction("change_plan");
    try {
      await changeBillingSubscription(
        planTarget === "free"
          ? {
              orgId: billing.org_id,
              targetTier: planTarget,
              betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
            }
          : {
              orgId: billing.org_id,
              targetTier: planTarget,
              billing: {
                name: billingName.trim(),
                companyName: billingCompany.trim(),
                address: {
                  line1: addrLine1.trim(),
                  line2: addrLine2.trim(),
                  city: addrCity.trim(),
                  state: addrState.trim(),
                  postalCode: addrPostal.trim(),
                  country: addrCountry.trim(),
                },
              },
              betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
            },
      );
      if (planTarget === "free") {
        toast.success("Cancellation scheduled", {
          description: "You'll keep paid features until the end of this billing period.",
        });
      } else if (tierRank[planTarget] > tierRank[billing.tier as "free" | "starter" | "pro"]) {
        toast.success("Plan updated", {
          description: "Stripe may take a moment to refresh your invoice.",
        });
      } else {
        toast.success("Downgrade scheduled", {
          description: "Your current plan stays active until the period ends.",
        });
      }
      setChangePlanOpen(false);
      setPendingRefresh((n) => n + 1);
    } catch (caught) {
      setChangePlanError(toUserFacingError(caught, { fallback: "Plan change failed." }));
    } finally {
      setBusyAction(null);
    }
  };

  const currentBilling = displayBilling;
  const canManageBilling = canManage();
  const unifiedPlanCards = useMemo(
    () =>
      currentBilling
        ? tierComparison.map((tier) => {
            const tierId: BillingTierId = tier.id;
            const currentTierId: BillingTierId = currentBilling.tier;
            const isCurrentTier = tier.id === currentBilling.tier;
            const isInvitePromoTier =
              billingSource === BILLING_SOURCE.invitePromo && invitePromo?.grant_tier === tier.id;
            const highlightCurrent = isCurrentTier || isInvitePromoTier;
            let action: PlanCardAction | null = null;

            if (canManageBilling) {
              if (billingSource === BILLING_SOURCE.invitePromo) {
                if (
                  tierId !== "free" &&
                  (tierId === currentTierId || tierRank[tierId] > tierRank[currentTierId])
                ) {
                  action = {
                    kind: "checkout",
                    label: `Start ${tier.label} subscription`,
                    testId:
                      tierId === "starter" ? "billing-upgrade-starter" : "billing-upgrade-pro",
                    busyAction: tierId === "starter" ? "checkout_starter" : "checkout_pro",
                    tier: tierId,
                    variant: tierId === currentTierId ? "default" : "outline",
                  };
                }
              } else if (currentBilling.tier === "free") {
                if (tierId !== "free") {
                  action = {
                    kind: "checkout",
                    label: `Upgrade to ${tier.label}`,
                    testId:
                      tierId === "starter" ? "billing-upgrade-starter" : "billing-upgrade-pro",
                    busyAction: tierId === "starter" ? "checkout_starter" : "checkout_pro",
                    tier: tierId,
                  };
                }
              } else if (isCurrentTier) {
                action = {
                  kind: "manage",
                  label: "Manage Subscription",
                  testId: "billing-manage-subscription",
                };
              } else if (
                tierId !== "free" &&
                (tierRank[tierId] > tierRank[currentTierId] ||
                  (currentTierId === "pro" && tierId === "starter"))
              ) {
                action = {
                  kind: "change_plan",
                  label:
                    tierRank[tierId] > tierRank[currentTierId]
                      ? `Upgrade to ${tier.label}`
                      : `Downgrade to ${tier.label}`,
                  testId: "billing-change-plan",
                  tier: tierId,
                  ...(pendingSubscription?.cancel_at_period_end === true
                    ? {
                        disabledHint: "Undo the pending cancellation first to change plans.",
                      }
                    : {}),
                };
              }
            }

            return {
              ...tier,
              isCurrentTier,
              highlightCurrent,
              isInvitePromoTier,
              action,
            };
          })
        : [],
    [
      billingSource,
      canManageBilling,
      currentBilling,
      invitePromo?.grant_tier,
      pendingSubscription,
      tierComparison,
    ],
  );

  if (!displayBilling) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  if (!usageView) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">Manage your plan, limits, and current usage.</p>
      </div>

      {!canManageBilling ? (
        <div
          data-testid="billing-management-note"
          role="status"
          className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          {BILLING_ADMIN_NOTE}
        </div>
      ) : null}

      {error ? <UserFacingErrorView error={error} /> : null}

      {pendingSubscription?.cancel_at_period_end ? (
        <div
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
          data-testid="billing-pending-cancel-banner"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>
              <span className="font-medium text-foreground">
                Subscription ends {formatEffectiveDate(pendingSubscription.pending_effective_at)}.
              </span>{" "}
              <span className="text-muted-foreground">
                You will move to the Free tier afterward. Trial credits are not re-granted.
              </span>
            </p>
            {canManageBilling ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0 sm:min-h-10"
                onClick={() => void handleUndoCancel()}
                disabled={busyAction !== null}
                data-testid="billing-undo-cancel"
              >
                {busyAction === "undo_cancel" ? "Updating..." : "Keep subscription"}
              </Button>
            ) : (
              <p
                role="status"
                className="text-sm text-muted-foreground sm:max-w-xs sm:text-right"
                data-testid="billing-undo-cancel-note"
              >
                Ask an owner or admin to keep this subscription active.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {pendingSubscription &&
      !pendingSubscription.cancel_at_period_end &&
      pendingSubscription.pending_tier &&
      pendingSubscription.pending_tier !== currentBilling.tier ? (
        <div
          className="rounded-xl border bg-muted/40 px-4 py-3 text-sm"
          data-testid="billing-pending-downgrade-banner"
        >
          <p>
            <span className="font-medium text-foreground">
              Plan changes to {toTierLabel(pendingSubscription.pending_tier)} on{" "}
              {formatEffectiveDate(pendingSubscription.pending_effective_at)}.
            </span>{" "}
            <span className="text-muted-foreground">Until then, you keep your current limits.</span>
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
          <CardDescription>
            Compare plans, review your current tier, and take the next billing action from the
            relevant card.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <span className="font-medium text-foreground">Current plan:</span>{" "}
            <span
              data-testid="billing-tier-label"
              className="font-medium capitalize text-foreground"
            >
              {toTierLabel(currentBilling.tier)}
            </span>{" "}
            <span className="text-muted-foreground">({currentBilling.status})</span>
          </div>

          {invitePromo && promoExpiryLabel ? (
            <div
              data-testid="billing-invite-promo-banner"
              className="rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/12 via-primary/8 to-background px-4 py-4 text-sm text-primary shadow-sm"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <div className="inline-flex w-fit rounded-full border border-primary/25 bg-background/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                    Invite promo active
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {promoTierLabel} access is unlocked until {promoExpiryLabel}.
                  </p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Code{" "}
                    <span className="rounded bg-background px-1.5 py-0.5 font-mono text-xs text-foreground">
                      {invitePromo.code}
                    </span>{" "}
                    is covering this workspace today. Start Stripe checkout any time before the
                    promo ends to keep paid access without interruption.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            {currentBilling.limits.included_ai_credits.bundled_runtime_enabled
              ? `This plan includes ${currentBilling.limits.included_ai_credits.total} bundled AI credits each billing cycle for prompt generation and bundled automation runtime.`
              : currentBilling.limits.included_ai_credits.reset_period === "one_time"
                ? `This tier includes a one-time grant of ${currentBilling.limits.included_ai_credits.total} credits for prompt generation.`
                : `This plan includes ${currentBilling.limits.included_ai_credits.total} credits each billing cycle for prompt generation only. Automation runtime still requires Bring your own key.`}
          </div>

          <div data-testid="billing-plan-card-grid" className="grid gap-3 md:grid-cols-3">
            {unifiedPlanCards.map((tier) => {
              const action = tier.action;
              return (
                <div
                  key={tier.id}
                  data-testid={`billing-plan-card-${tier.id}`}
                  className={
                    tier.highlightCurrent
                      ? "flex h-full flex-col rounded-xl border border-primary bg-primary/5 p-4"
                      : "flex h-full flex-col rounded-xl border p-4"
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{tier.label}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatMonthlyPrice(tier.priceCentsMonthly)}
                      </p>
                    </div>
                    {tier.isCurrentTier ? (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                        Current
                      </span>
                    ) : tier.isInvitePromoTier ? (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                        Promo active
                      </span>
                    ) : null}
                  </div>

                  <dl className="mt-4 space-y-2 text-sm text-muted-foreground">
                    <div className="flex justify-between gap-3">
                      <dt>Workspaces</dt>
                      <dd className="font-medium text-foreground">{tier.workspaces}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>{tier.aiCreditsLabel}</dt>
                      <dd className="font-medium text-foreground">{tier.aiCredits}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Tool calls / mo</dt>
                      <dd className="font-medium text-foreground">
                        {tier.toolCalls.toLocaleString()}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    {tier.aiCreditsDescription}
                  </p>

                  <div className="mt-4 flex-1" />

                  {action ? (
                    <div className="space-y-2">
                      {action.kind === "checkout" ? (
                        <Button
                          data-testid={action.testId}
                          variant={action.variant ?? "default"}
                          onClick={() => void handleCheckout(action.tier)}
                          disabled={busyAction !== null}
                          className="min-h-11 w-full"
                        >
                          {busyAction === action.busyAction ? "Opening..." : action.label}
                        </Button>
                      ) : null}
                      {action.kind === "change_plan"
                        ? (() => {
                            const hintId = `billing-change-plan-hint-${tier.id}`;
                            return (
                              <>
                                <Button
                                  data-testid={action.testId}
                                  variant="outline"
                                  onClick={() => openChangePlanDialogForTier(action.tier)}
                                  disabled={
                                    busyAction !== null ||
                                    pendingSubscription?.cancel_at_period_end === true
                                  }
                                  aria-describedby={action.disabledHint ? hintId : undefined}
                                  className="min-h-11 w-full"
                                >
                                  {action.label}
                                </Button>
                                {action.disabledHint ? (
                                  <p
                                    id={hintId}
                                    className="text-xs text-muted-foreground"
                                    data-testid="billing-change-plan-hint"
                                  >
                                    {action.disabledHint}
                                  </p>
                                ) : null}
                              </>
                            );
                          })()
                        : null}
                      {action.kind === "manage" ? (
                        <Button
                          data-testid={action.testId}
                          variant="outline"
                          onClick={() => void handlePortal()}
                          disabled={busyAction !== null}
                          className="min-h-11 w-full"
                        >
                          {busyAction === "portal" ? "Opening..." : action.label}
                        </Button>
                      ) : null}
                    </div>
                  ) : canManageBilling && tier.id === "free" ? (
                    <div className="rounded-lg border border-dashed border-border/70 px-3 py-3 text-sm text-muted-foreground">
                      No subscription to manage on the free trial.
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/70 px-3 py-3 text-sm text-muted-foreground">
                      {tier.isCurrentTier
                        ? "This is your current plan."
                        : "Ask an owner or admin to change plans."}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <ErrorBoundary boundary="layout" fallback={<BillingCapacityTopupsFallback />}>
        <BillingCapacityTopups
          canManageBilling={canManageBilling}
          currentBilling={{
            org_id: currentBilling.org_id,
            tier: currentBilling.tier,
          }}
          busyAction={busyAction}
          onCreditPackCheckout={(packageIndex) => {
            void handleCreditPackCheckout(packageIndex);
          }}
          onAutomationRunPackCheckout={(packageIndex) => {
            void handleAutomationRunPackCheckout(packageIndex);
          }}
        />
      </ErrorBoundary>

      {billingSource === "free" ? (
        <Card>
          <CardHeader>
            <CardTitle>Redeem Invite Code</CardTitle>
            <CardDescription>
              Apply a starter or pro promo code here while the org is on the Free trial tier. Paid
              promo codes work even when the invite gate is off.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
              onSubmit={(event) => void handleRedeemInviteCode(event)}
            >
              <div className="space-y-2">
                <Label htmlFor="billing-invite-code">Invite code</Label>
                <Input
                  id="billing-invite-code"
                  data-testid="billing-redeem-invite-code-input"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={6}
                  placeholder="ABC123"
                  value={inviteCode}
                  onChange={(event) => {
                    setInviteCode(event.currentTarget.value);
                  }}
                />
              </div>
              <Button
                type="submit"
                data-testid="billing-redeem-invite-code-submit"
                disabled={inviteCodeBusy || inviteCode.trim().length === 0}
              >
                {inviteCodeBusy ? "Redeeming..." : "Redeem invite code"}
              </Button>
            </form>
            {inviteCodeError ? (
              <div
                role="alert"
                className="rounded-xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive"
              >
                {inviteCodeError}
              </div>
            ) : null}
            {inviteCodeSuccess ? (
              <div
                role="status"
                className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 text-sm text-primary"
              >
                {inviteCodeSuccess}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Current Plan</CardTitle>
          <CardDescription>
            Tier: <span className="font-medium capitalize">{toTierLabel(currentBilling.tier)}</span>{" "}
            ({currentBilling.status})
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {invitePromo && promoExpiryLabel ? (
            <div className="rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/12 via-primary/8 to-background px-4 py-4 text-sm text-primary shadow-sm md:col-span-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <div className="inline-flex w-fit rounded-full border border-primary/25 bg-background/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                    Invite promo active
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {promoTierLabel} access is unlocked until {promoExpiryLabel}.
                  </p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Code{" "}
                    <span className="rounded bg-background px-1.5 py-0.5 font-mono text-xs text-foreground">
                      {invitePromo.code}
                    </span>{" "}
                    is covering this workspace today. Start Stripe checkout any time before the
                    promo ends to keep paid access without interruption.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
          <div className="rounded-lg border bg-muted/40 p-3 text-sm md:col-span-3">
            {bundledRuntimeAvailableForDeployment
              ? currentBilling.limits.included_ai_credits.reset_period === "one_time"
                ? `This tier includes a one-time grant of ${currentBilling.limits.included_ai_credits.total} bundled AI credits for prompt generation and automation runtime.`
                : `This plan includes ${currentBilling.limits.included_ai_credits.total} bundled AI credits each billing cycle for prompt generation and bundled automation runtime.`
              : currentBilling.limits.included_ai_credits.reset_period === "one_time"
                ? `This tier includes a one-time grant of ${currentBilling.limits.included_ai_credits.total} credits for prompt generation on self-managed deployments.`
                : `This plan includes ${currentBilling.limits.included_ai_credits.total} credits each billing cycle for prompt generation on self-managed deployments. Automation runtime still requires a self-managed provider key.`}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Usage This Period</CardTitle>
          <CardDescription data-testid="billing-period-range">
            {usageView.showPeriodRange ? usageView.periodRangeValue : "Current billing period"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {usageSummary ? (
            <div className="rounded-2xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              {usageSummary}
            </div>
          ) : null}

          <Progress value={usageView.callsProgress} aria-label="Tool calls used">
            <ProgressLabel>Tool Calls</ProgressLabel>
            <div
              data-testid="billing-tool-calls-value"
              className="text-muted-foreground ml-auto text-sm tabular-nums"
            >
              {usageView.callsValue}
            </div>
            <ProgressTrack>
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>

          <Progress value={usageView.timeProgress} aria-label="Tool call time used">
            <ProgressLabel>Total Tool Time</ProgressLabel>
            <div
              data-testid="billing-tool-time-value"
              className="text-muted-foreground ml-auto text-sm tabular-nums"
            >
              {usageView.timeValue}
            </div>
            <ProgressTrack>
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>
        </CardContent>
      </Card>

      {usageView.showNextInvoicePreview ? (
        <Card>
          <CardHeader>
            <CardTitle>Next Invoice Preview</CardTitle>
            <CardDescription data-testid="billing-next-invoice-preview">
              {usageView.nextInvoicePreview}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Dialog
        open={changePlanOpen}
        onOpenChange={(open) => {
          setChangePlanOpen(open);
          if (!open) {
            setChangePlanError(null);
          }
        }}
      >
        <DialogContent
          className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-lg"
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle>Change plan</DialogTitle>
            <DialogDescription>
              {planTarget === "free"
                ? "Choose your next plan. Cancellation keeps the current subscription active until the period ends."
                : "Choose your next plan and confirm billing details. This matches the information Stripe collects at checkout."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleChangePlanSubmit(e)} className="grid gap-4">
            <fieldset className="grid gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium text-foreground">New plan</legend>
              {currentBilling.tier === "starter" ? (
                <>
                  <label
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-xl border p-3 text-left text-sm",
                      planTarget === "pro" ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name="keppo-plan-target"
                      className="mt-1 size-4 shrink-0"
                      checked={planTarget === "pro"}
                      onChange={() => setPlanTarget("pro")}
                    />
                    <span>
                      <span className="font-medium text-foreground">Upgrade to Pro</span>
                      <span className="text-muted-foreground block text-xs">
                        Higher limits and more included AI credits. Takes effect immediately; Stripe
                        prorates the difference.
                      </span>
                    </span>
                  </label>
                  <label
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-xl border p-3 text-left text-sm",
                      planTarget === "free"
                        ? "border-destructive/60 bg-destructive/5"
                        : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name="keppo-plan-target"
                      className="mt-1 size-4 shrink-0"
                      checked={planTarget === "free"}
                      onChange={() => setPlanTarget("free")}
                    />
                    <span>
                      <span className="font-medium text-foreground">Cancel at end of period</span>
                      <span className="text-muted-foreground block text-xs">
                        Move to the Free tier when the current billing period ends. Trial credits
                        are not re-granted, and you keep Starter until then.
                      </span>
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <label
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-xl border p-3 text-left text-sm",
                      planTarget === "starter" ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name="keppo-plan-target"
                      className="mt-1 size-4 shrink-0"
                      checked={planTarget === "starter"}
                      onChange={() => setPlanTarget("starter")}
                    />
                    <span>
                      <span className="font-medium text-foreground">Downgrade to Starter</span>
                      <span className="text-muted-foreground block text-xs">
                        Lower price starting next renewal. No immediate downgrade of limits.
                      </span>
                    </span>
                  </label>
                  <label
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-xl border p-3 text-left text-sm",
                      planTarget === "free"
                        ? "border-destructive/60 bg-destructive/5"
                        : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name="keppo-plan-target"
                      className="mt-1 size-4 shrink-0"
                      checked={planTarget === "free"}
                      onChange={() => setPlanTarget("free")}
                    />
                    <span>
                      <span className="font-medium text-foreground">Cancel at end of period</span>
                      <span className="text-muted-foreground block text-xs">
                        End the subscription after this period and return to the Free tier.
                      </span>
                    </span>
                  </label>
                </>
              )}
            </fieldset>

            {planTarget === "free" ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                Stripe keeps your current subscription active until the end of the billing period.
                No billing details are required to schedule cancellation.
              </div>
            ) : (
              <div className="grid gap-3">
                <p className="text-sm font-medium text-foreground">Billing details</p>
                <div className="grid gap-2">
                  <Label htmlFor="billing-full-name">Full name</Label>
                  <Input
                    id="billing-full-name"
                    autoComplete="name"
                    value={billingName}
                    onChange={(e) => setBillingName(e.target.value)}
                    required
                    maxLength={256}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="billing-company">Company (optional)</Label>
                  <Input
                    id="billing-company"
                    autoComplete="organization"
                    value={billingCompany}
                    onChange={(e) => setBillingCompany(e.target.value)}
                    maxLength={256}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="billing-line1">Address line 1</Label>
                  <Input
                    id="billing-line1"
                    autoComplete="address-line1"
                    value={addrLine1}
                    onChange={(e) => setAddrLine1(e.target.value)}
                    required
                    maxLength={256}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="billing-line2">Address line 2 (optional)</Label>
                  <Input
                    id="billing-line2"
                    autoComplete="address-line2"
                    value={addrLine2}
                    onChange={(e) => setAddrLine2(e.target.value)}
                    maxLength={256}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="billing-city">City</Label>
                    <Input
                      id="billing-city"
                      autoComplete="address-level2"
                      value={addrCity}
                      onChange={(e) => setAddrCity(e.target.value)}
                      maxLength={256}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="billing-state">State / region</Label>
                    <Input
                      id="billing-state"
                      autoComplete="address-level1"
                      value={addrState}
                      onChange={(e) => setAddrState(e.target.value)}
                      maxLength={256}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="billing-postal">Postal code</Label>
                    <Input
                      id="billing-postal"
                      autoComplete="postal-code"
                      value={addrPostal}
                      onChange={(e) => setAddrPostal(e.target.value)}
                      required
                      maxLength={32}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="billing-country">Country</Label>
                    <Input
                      id="billing-country"
                      autoComplete="country"
                      value={addrCountry}
                      onChange={(e) => setAddrCountry(e.target.value)}
                      required
                      maxLength={2}
                      className="uppercase"
                      aria-describedby="billing-country-hint"
                    />
                    <p id="billing-country-hint" className="text-muted-foreground text-xs">
                      Two-letter ISO code (e.g. US).
                    </p>
                  </div>
                </div>
              </div>
            )}

            {changePlanError ? <UserFacingErrorView error={changePlanError} /> : null}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setChangePlanOpen(false);
                  setChangePlanError(null);
                }}
                disabled={busyAction !== null}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busyAction !== null}>
                {busyAction === "change_plan" ? "Applying..." : "Confirm change"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { BillingPage };
