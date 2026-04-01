import type { ConvexHttpClient } from "convex/browser";
import type { SubscriptionStatus, SubscriptionTier } from "@keppo/shared/domain";
import type { BillingSource } from "@keppo/shared/contracts/billing";
import { refs, type ApiDedupeScope, type ApiDedupeStatus } from "./refs.js";

export type ApiDedupeRecord = {
  status: ApiDedupeStatus;
  payload: Record<string, unknown> | null;
  expiresAtMs: number;
};

export async function claimApiDedupeKey(
  client: ConvexHttpClient,
  params: {
    scope: ApiDedupeScope;
    dedupeKey: string;
    ttlMs: number;
    initialStatus?: ApiDedupeStatus;
  },
): Promise<ApiDedupeRecord & { claimed: boolean }> {
  return (await client.mutation(refs.claimApiDedupeKey, {
    scope: params.scope,
    dedupeKey: params.dedupeKey,
    ttlMs: Math.max(1, Math.floor(params.ttlMs)),
    ...(params.initialStatus ? { initialStatus: params.initialStatus } : {}),
  })) as ApiDedupeRecord & { claimed: boolean };
}

export async function getApiDedupeKey(
  client: ConvexHttpClient,
  params: { scope: ApiDedupeScope; dedupeKey: string },
): Promise<ApiDedupeRecord | null> {
  return (await client.query(refs.getApiDedupeKey, {
    scope: params.scope,
    dedupeKey: params.dedupeKey,
  })) as ApiDedupeRecord | null;
}

export async function setApiDedupePayload(
  client: ConvexHttpClient,
  params: {
    scope: ApiDedupeScope;
    dedupeKey: string;
    payload: Record<string, unknown>;
  },
): Promise<boolean> {
  return (await client.mutation(refs.setApiDedupePayload, {
    scope: params.scope,
    dedupeKey: params.dedupeKey,
    payload: params.payload,
  })) as boolean;
}

export async function completeApiDedupeKey(
  client: ConvexHttpClient,
  params: {
    scope: ApiDedupeScope;
    dedupeKey: string;
  },
): Promise<boolean> {
  return (await client.mutation(refs.completeApiDedupeKey, {
    scope: params.scope,
    dedupeKey: params.dedupeKey,
  })) as boolean;
}

export async function releaseApiDedupeKey(
  client: ConvexHttpClient,
  params: {
    scope: ApiDedupeScope;
    dedupeKey: string;
  },
): Promise<boolean> {
  return (await client.mutation(refs.releaseApiDedupeKey, {
    scope: params.scope,
    dedupeKey: params.dedupeKey,
  })) as boolean;
}

export type BillingUsage = {
  org_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  billing_source: BillingSource;
  invite_promo: {
    code: string;
    grant_tier: SubscriptionTier;
    redeemed_at: string;
    expires_at: string;
  } | null;
  period_start: string;
  period_end: string;
  usage: {
    id: string;
    org_id: string;
    period_start: string;
    period_end: string;
    tool_call_count: number;
    total_tool_call_time_ms: number;
    updated_at: string;
  };
  limits: {
    price_cents_monthly: number;
    max_workspaces: number;
    max_members: number;
    max_tool_calls_per_month: number;
    tool_call_timeout_ms: number;
    max_total_tool_call_time_ms: number;
    included_ai_credits: {
      total: number;
      bundled_runtime_enabled: boolean;
      reset_period: "monthly" | "one_time";
    };
  };
};

export async function getBillingUsageForOrg(
  client: ConvexHttpClient,
  orgId: string,
): Promise<BillingUsage> {
  return (await client.query(refs.getBillingUsageForOrg, { orgId })) as BillingUsage;
}

export type OrgSubscription = {
  id: string;
  org_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string;
  current_period_end: string;
  created_at: string;
  updated_at: string;
};

export async function getSubscriptionForOrg(
  client: ConvexHttpClient,
  orgId: string,
): Promise<OrgSubscription | null> {
  return (await client.query(refs.getSubscriptionForOrg, { orgId })) as OrgSubscription | null;
}

export async function convertActiveInvitePromo(
  client: ConvexHttpClient,
  params: {
    orgId: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  },
): Promise<number> {
  const result = await client.mutation(refs.convertActiveInvitePromo, {
    orgId: params.orgId,
    stripeCustomerId: params.stripeCustomerId,
    stripeSubscriptionId: params.stripeSubscriptionId,
  });
  return result.converted;
}

export async function getSubscriptionByStripeCustomer(
  client: ConvexHttpClient,
  stripeCustomerId: string,
): Promise<OrgSubscription | null> {
  return (await client.query(refs.getSubscriptionByStripeCustomer, {
    stripeCustomerId,
  })) as OrgSubscription | null;
}

export async function getSubscriptionByStripeSubscription(
  client: ConvexHttpClient,
  stripeSubscriptionId: string,
): Promise<OrgSubscription | null> {
  return (await client.query(refs.getSubscriptionByStripeSubscription, {
    stripeSubscriptionId,
  })) as OrgSubscription | null;
}

export async function upsertSubscriptionForOrg(
  client: ConvexHttpClient,
  params: {
    orgId: string;
    tier: SubscriptionTier;
    status: SubscriptionStatus;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  },
): Promise<void> {
  await client.mutation(refs.upsertSubscriptionForOrg, {
    orgId: params.orgId,
    tier: params.tier,
    status: params.status,
    stripeCustomerId: params.stripeCustomerId,
    stripeSubscriptionId: params.stripeSubscriptionId,
    currentPeriodStart: params.currentPeriodStart,
    currentPeriodEnd: params.currentPeriodEnd,
  });
}

export async function downgradeOrgToFree(client: ConvexHttpClient, orgId: string): Promise<void> {
  await client.mutation(refs.downgradeOrgToFree, { orgId });
}

export async function setSubscriptionStatusByCustomer(
  client: ConvexHttpClient,
  params: {
    stripeCustomerId: string;
    status: SubscriptionStatus;
  },
): Promise<void> {
  await client.mutation(refs.setSubscriptionStatusByCustomer, {
    stripeCustomerId: params.stripeCustomerId,
    status: params.status,
  });
}

export async function setSubscriptionStatusByStripeSubscription(
  client: ConvexHttpClient,
  params: {
    stripeSubscriptionId: string;
    status: SubscriptionStatus;
    tier?: SubscriptionTier;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
  },
): Promise<void> {
  await client.mutation(refs.setSubscriptionStatusByStripeSubscription, {
    stripeSubscriptionId: params.stripeSubscriptionId,
    status: params.status,
    ...(params.tier ? { tier: params.tier } : {}),
    ...(params.currentPeriodStart ? { currentPeriodStart: params.currentPeriodStart } : {}),
    ...(params.currentPeriodEnd ? { currentPeriodEnd: params.currentPeriodEnd } : {}),
  });
}
