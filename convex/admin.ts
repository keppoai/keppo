import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { hasFeatureAccess, nowIso, randomIdFor, requireIdentity, requireOrgMember } from "./_auth";
import {
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  RUN_STATUS,
  SUBSCRIPTION_TIER,
  USER_ROLE,
  type AuditEventType,
} from "./domain_constants";
import { pickFields } from "./field_mapper";
import { isLocalAdminBypassEnabled } from "../packages/shared/src/runtime.js";
import {
  getAiCreditAllowanceForTier,
  getDefaultBillingPeriod,
  getTierConfig,
} from "../packages/shared/src/subscriptions.js";
import { resolveInviteGrantTier } from "@keppo/shared/billing-contracts";
import { requireBoundedString, subscriptionTierValidator } from "./validators";
import { hardDeleteOrganizationCascade, hardDeleteUserCascade } from "./admin_delete";

type AdminCtx = Parameters<typeof requireIdentity>[0];
const PLATFORM_ADMIN_AUDIT_ORG_ID = "platform_admin";
const LOCAL_ADMIN_BYPASS_ACTOR_ID = "local_admin_bypass";
const INVITE_CODE_LABEL_MAX_LENGTH = 80;

const featureFlagValidator = v.object({
  id: v.string(),
  key: v.string(),
  label: v.string(),
  description: v.string(),
  enabled: v.boolean(),
  created_at: v.string(),
  updated_at: v.string(),
});

const dogfoodOrgValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  added_by: v.string(),
  created_at: v.string(),
});

const inviteCodeAdminValidator = v.object({
  id: v.string(),
  code: v.string(),
  label: v.string(),
  grant_tier: subscriptionTierValidator,
  active: v.boolean(),
  use_count: v.number(),
  created_by: v.string(),
  created_at: v.string(),
});

const adminAccessValidator = v.object({
  canAccessAdminPage: v.boolean(),
  canAccessAdminHealth: v.boolean(),
  isPlatformAdmin: v.boolean(),
});

const platformOverviewValidator = v.object({
  totalOrganizations: v.number(),
  totalUsers: v.number(),
  activeAutomationRuns: v.number(),
  suspendedOrganizations: v.number(),
});

const usageSummaryValidator = v.object({
  orgId: v.string(),
  orgName: v.string(),
  orgSlug: v.string(),
  tier: v.string(),
  subscriptionStatus: v.string(),
  toolCalls: v.number(),
  totalToolCallTimeMs: v.number(),
  aiCreditsUsed: v.number(),
  aiCreditsTotal: v.number(),
  automationRuns: v.number(),
  activeAutomationRuns: v.number(),
  isSuspended: v.boolean(),
});

const usagePeriodSummaryValidator = v.object({
  periodStart: v.string(),
  periodEnd: v.string(),
  toolCalls: v.number(),
  totalToolCallTimeMs: v.number(),
  aiCreditsUsed: v.number(),
  aiCreditsTotal: v.number(),
  purchasedAiCreditsRemaining: v.number(),
});

const activeRunSummaryValidator = v.object({
  id: v.string(),
  workspaceId: v.string(),
  workspaceName: v.string(),
  status: v.string(),
  startedAt: v.string(),
});

const suspensionSummaryValidator = v.object({
  id: v.string(),
  orgId: v.string(),
  orgName: v.string(),
  reason: v.string(),
  suspendedBy: v.string(),
  suspendedAt: v.string(),
  liftedAt: v.union(v.string(), v.null()),
  liftedBy: v.union(v.string(), v.null()),
});

const adminDeletionOrgPreviewValidator = v.object({
  orgId: v.string(),
  orgName: v.string(),
  orgSlug: v.string(),
  memberCount: v.number(),
  workspaceCount: v.number(),
  automationCount: v.number(),
  notificationEndpointCount: v.number(),
});

const adminDeletionUserMembershipValidator = v.object({
  orgId: v.string(),
  orgName: v.string(),
  orgSlug: v.string(),
  role: v.string(),
  memberCount: v.number(),
  ownerCount: v.number(),
  action: v.union(
    v.literal("delete_org"),
    v.literal("remove_membership"),
    v.literal("blocked_transfer_required"),
  ),
});

const adminDeletionUserPreviewValidator = v.object({
  userId: v.string(),
  name: v.string(),
  email: v.string(),
  organizationMemberships: v.array(adminDeletionUserMembershipValidator),
});

const adminDeletionOrgResultValidator = v.object({
  orgId: v.string(),
  orgName: v.string(),
  orgSlug: v.string(),
});

const adminDeletionUserResultValidator = v.object({
  userId: v.string(),
  email: v.string(),
  deletedOrgIds: v.array(v.string()),
});

type UserDeletionMembershipPreview = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: string;
  memberCount: number;
  ownerCount: number;
  action: "delete_org" | "remove_membership" | "blocked_transfer_required";
};

const orgUsageDetailValidator = v.object({
  orgId: v.string(),
  orgName: v.string(),
  orgSlug: v.string(),
  subscription: v.object({
    tier: v.string(),
    status: v.string(),
    currentPeriodStart: v.string(),
    currentPeriodEnd: v.string(),
  }),
  usageHistory: v.array(usagePeriodSummaryValidator),
  aiCredits: v.object({
    allowanceUsed: v.number(),
    allowanceTotal: v.number(),
    purchasedRemaining: v.number(),
    totalAvailable: v.number(),
  }),
  activeRuns: v.array(activeRunSummaryValidator),
  memberCount: v.number(),
  workspaceCount: v.number(),
  suspensionHistory: v.array(suspensionSummaryValidator),
});

const orgAbuseRowValidator = v.object({
  orgId: v.string(),
  orgName: v.string(),
  orgSlug: v.string(),
  tier: v.string(),
  isSuspended: v.boolean(),
  activeSuspension: v.union(
    v.object({
      id: v.string(),
      reason: v.string(),
      suspendedBy: v.string(),
      suspendedAt: v.string(),
    }),
    v.null(),
  ),
  suspensionHistoryCount: v.number(),
});

const readAdminUserIds = (): Set<string> => {
  const raw = process.env.KEPPO_ADMIN_USER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
};

const isAdminUserId = (userId: string): boolean => {
  return readAdminUserIds().has(userId);
};

const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const generateInviteCode = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(
    bytes,
    (byte) => INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length] ?? "A",
  )
    .join("")
    .slice(0, 6);
};

const readLocalAdminBypassEnv = () => ({
  KEPPO_LOCAL_ADMIN_BYPASS: process.env.KEPPO_LOCAL_ADMIN_BYPASS,
  NODE_ENV: process.env.NODE_ENV,
  KEPPO_URL: process.env.KEPPO_URL,
  CONVEX_DEPLOYMENT: process.env.CONVEX_DEPLOYMENT,
  CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
  CONVEX_CLOUD_URL: process.env.CONVEX_CLOUD_URL,
  CONVEX_URL: process.env.CONVEX_URL,
  CONVEX_SELF_HOSTED_URL: process.env.CONVEX_SELF_HOSTED_URL,
});

const resolveAdminAccess = (userId: string | null) => {
  const isPlatformAdmin = userId ? isAdminUserId(userId) : false;
  const localAdminBypassEnabled = isLocalAdminBypassEnabled(readLocalAdminBypassEnv());
  return {
    canAccessAdminPage: isPlatformAdmin || localAdminBypassEnabled,
    canAccessAdminHealth: isPlatformAdmin || localAdminBypassEnabled,
    isPlatformAdmin,
  };
};

const requireAdmin = async (ctx: AdminCtx): Promise<{ userId: string }> => {
  const identity = await ctx.auth.getUserIdentity();
  if (identity && resolveAdminAccess(identity.subject).canAccessAdminPage) {
    return { userId: identity.subject };
  }
  if (isLocalAdminBypassEnabled(readLocalAdminBypassEnv())) {
    return { userId: LOCAL_ADMIN_BYPASS_ACTOR_ID };
  }
  if (!identity) {
    throw new Error("Forbidden");
  }
  if (!resolveAdminAccess(identity.subject).canAccessAdminPage) {
    throw new Error("Forbidden");
  }
  return { userId: identity.subject };
};

type FeatureFlagView = {
  id: string;
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type DogfoodOrgView = {
  id: string;
  org_id: string;
  added_by: string;
  created_at: string;
};

const featureFlagViewFields = [
  "id",
  "key",
  "label",
  "description",
  "enabled",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof FeatureFlagView)[];

const dogfoodOrgViewFields = [
  "id",
  "org_id",
  "added_by",
  "created_at",
] as const satisfies readonly (keyof DogfoodOrgView)[];

const toFeatureFlag = (row: FeatureFlagView) => pickFields(row, featureFlagViewFields);

const toDogfoodOrg = (row: DogfoodOrgView) => pickFields(row, dogfoodOrgViewFields);

type AdminDbCtx = QueryCtx | MutationCtx;
type BetterAuthOrganization = {
  id: string;
  name: string;
  slug: string;
  metadata: string | null;
  createdAt: number;
};

type BetterAuthUser = {
  id: string;
  name: string;
  email: string;
};
const BETTER_AUTH_PAGE_SIZE = 200;

const normalizeBetterAuthOrganization = (
  organization: Partial<BetterAuthOrganization> & { _id?: string | null },
): BetterAuthOrganization | null => {
  const id =
    typeof organization.id === "string" && organization.id.trim().length > 0
      ? organization.id
      : typeof organization._id === "string" && organization._id.trim().length > 0
        ? organization._id
        : null;
  const name = typeof organization.name === "string" ? organization.name : null;
  const slug = typeof organization.slug === "string" ? organization.slug : null;
  const createdAt =
    typeof organization.createdAt === "number" && Number.isFinite(organization.createdAt)
      ? organization.createdAt
      : null;

  if (!id || !name || !slug || createdAt === null) {
    return null;
  }

  return {
    id,
    name,
    slug,
    metadata:
      typeof organization.metadata === "string"
        ? organization.metadata
        : (organization.metadata ?? null),
    createdAt,
  };
};

const resolveCurrentBillingPeriod = (
  subscription:
    | Pick<Doc<"subscriptions">, "current_period_start" | "current_period_end">
    | null
    | undefined,
) => {
  if (
    subscription?.current_period_start &&
    subscription.current_period_start.length > 0 &&
    subscription.current_period_end &&
    subscription.current_period_end.length > 0
  ) {
    return {
      periodStart: subscription.current_period_start,
      periodEnd: subscription.current_period_end,
    };
  }
  return getDefaultBillingPeriod(new Date());
};

const listOrganizations = async (ctx: AdminDbCtx): Promise<BetterAuthOrganization[]> => {
  const organizations: BetterAuthOrganization[] = [];
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const page = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "organization",
      paginationOpts: {
        numItems: BETTER_AUTH_PAGE_SIZE,
        cursor,
      },
    })) as {
      page: Array<Partial<BetterAuthOrganization> & { _id?: string | null }>;
      isDone: boolean;
      continueCursor?: string;
    };
    organizations.push(
      ...page.page
        .map((organization) => normalizeBetterAuthOrganization(organization))
        .filter((organization): organization is BetterAuthOrganization => organization !== null),
    );
    isDone = page.isDone;
    cursor = page.continueCursor ?? null;
  }

  return organizations;
};

const countUsers = async (ctx: AdminDbCtx): Promise<number> => {
  let total = 0;
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const page = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      paginationOpts: {
        numItems: BETTER_AUTH_PAGE_SIZE,
        cursor,
      },
    })) as { page: Array<{ _id: string }>; isDone: boolean; continueCursor?: string };
    total += page.page.length;
    isDone = page.isDone;
    cursor = page.continueCursor ?? null;
  }

  return total;
};

const getOrganizationRecord = async (ctx: AdminDbCtx, orgId: string) => {
  return (await ctx.runQuery(components.betterAuth.queries.getOrgById, {
    orgId,
  })) as BetterAuthOrganization | null;
};

const normalizeBetterAuthUser = (
  user: Partial<BetterAuthUser> & { _id?: string | null },
): BetterAuthUser | null => {
  const id =
    typeof user.id === "string" && user.id.trim().length > 0
      ? user.id
      : typeof user._id === "string" && user._id.trim().length > 0
        ? user._id
        : null;
  const name = typeof user.name === "string" ? user.name : null;
  const email = typeof user.email === "string" ? user.email : null;
  if (!id || !name || !email) {
    return null;
  }
  return { id, name, email };
};

const resolveOrganizationByLookup = async (
  ctx: AdminDbCtx,
  lookup: string,
): Promise<BetterAuthOrganization | null> => {
  const trimmed = lookup.trim();
  if (!trimmed) {
    return null;
  }
  const direct = await getOrganizationRecord(ctx, trimmed);
  if (direct) {
    return direct;
  }
  const bySlug = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "organization",
    where: [{ field: "slug", value: trimmed }],
  })) as (Partial<BetterAuthOrganization> & { _id?: string | null }) | null;
  return bySlug ? normalizeBetterAuthOrganization(bySlug) : null;
};

const getUserRecord = async (ctx: AdminDbCtx, userId: string) => {
  return (await ctx.runQuery(components.betterAuth.queries.getUserById, {
    userId,
  })) as BetterAuthUser | null;
};

const resolveUserByLookup = async (
  ctx: AdminDbCtx,
  lookup: string,
): Promise<BetterAuthUser | null> => {
  const trimmed = lookup.trim();
  if (!trimmed) {
    return null;
  }
  const direct = await getUserRecord(ctx, trimmed);
  if (direct) {
    return direct;
  }
  const byEmail = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "email", value: trimmed.toLowerCase() }],
  })) as (Partial<BetterAuthUser> & { _id?: string | null }) | null;
  return byEmail ? normalizeBetterAuthUser(byEmail) : null;
};

const listUserMemberships = async (
  ctx: AdminDbCtx,
  userId: string,
): Promise<Array<{ orgId: string; role: string }>> => {
  let cursor: string | null = null;
  let isDone = false;
  const memberships: Array<{ orgId: string; role: string }> = [];

  while (!isDone) {
    const page = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "member",
      where: [{ field: "userId", value: userId }],
      paginationOpts: {
        numItems: BETTER_AUTH_PAGE_SIZE,
        cursor,
      },
    })) as {
      page: Array<{ organizationId?: string; role?: string }>;
      isDone: boolean;
      continueCursor?: string;
    };
    for (const row of page.page) {
      if (typeof row.organizationId !== "string" || typeof row.role !== "string") {
        continue;
      }
      memberships.push({
        orgId: row.organizationId,
        role: row.role,
      });
    }
    isDone = page.isDone;
    cursor = page.continueCursor ?? null;
  }

  return memberships;
};

const listOrganizationMembers = async (
  ctx: AdminDbCtx,
  orgId: string,
): Promise<Array<{ id: string; userId: string; role: string }>> => {
  const members = await ctx.runQuery(components.betterAuth.queries.listOrgMembers, { orgId });
  return members
    .map((member) => {
      if (
        typeof member.id !== "string" ||
        typeof member.userId !== "string" ||
        typeof member.role !== "string"
      ) {
        return null;
      }
      return {
        id: member.id,
        userId: member.userId,
        role: member.role,
      };
    })
    .filter((member): member is { id: string; userId: string; role: string } => member !== null);
};

const buildUserDeletionMembershipPreview = async (
  ctx: AdminDbCtx,
  membership: { orgId: string; role: string },
  targetUserId: string,
): Promise<UserDeletionMembershipPreview> => {
  const [organization, members] = await Promise.all([
    getOrganizationRecord(ctx, membership.orgId),
    listOrganizationMembers(ctx, membership.orgId),
  ]);
  const ownerCount = members.filter((member) => member.role === USER_ROLE.owner).length;
  const memberCount = members.length;
  const isTargetOwner = members.some(
    (member) => member.userId === targetUserId && member.role === USER_ROLE.owner,
  );

  let action: UserDeletionMembershipPreview["action"] = "remove_membership";
  if (memberCount <= 1) {
    action = "delete_org";
  } else if (isTargetOwner && ownerCount <= 1) {
    action = "blocked_transfer_required";
  }

  return {
    orgId: membership.orgId,
    orgName: organization?.name ?? `Unknown organization (${membership.orgId})`,
    orgSlug: organization?.slug ?? membership.orgId,
    role: membership.role,
    memberCount,
    ownerCount,
    action,
  };
};

const countAutomationsForOrg = async (ctx: AdminDbCtx, orgId: string) => {
  let cursor: string | null = null;
  let total = 0;
  for (;;) {
    const page = await ctx.db
      .query("automations")
      .withIndex("by_org", (q) => q.eq("org_id", orgId))
      .paginate({ cursor, numItems: BETTER_AUTH_PAGE_SIZE });
    total += page.page.length;
    if (page.isDone) {
      return total;
    }
    cursor = page.continueCursor;
  }
};

const countNotificationEndpointsForOrg = async (ctx: AdminDbCtx, orgId: string) => {
  let cursor: string | null = null;
  let total = 0;
  for (;;) {
    const page = await ctx.db
      .query("notification_endpoints")
      .withIndex("by_org", (q) => q.eq("org_id", orgId))
      .paginate({ cursor, numItems: BETTER_AUTH_PAGE_SIZE });
    total += page.page.length;
    if (page.isDone) {
      return total;
    }
    cursor = page.continueCursor;
  }
};

const getCurrentSubscriptionForOrg = async (ctx: AdminDbCtx, orgId: string) => {
  const rows = await ctx.db
    .query("subscriptions")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .collect();
  return rows.sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ?? null;
};

const getUsageMeterForOrgPeriod = async (ctx: AdminDbCtx, orgId: string, periodStart: string) => {
  return await ctx.db
    .query("usage_meters")
    .withIndex("by_org_period", (q) => q.eq("org_id", orgId).eq("period_start", periodStart))
    .first();
};

const getAiCreditsForOrgPeriod = async (ctx: AdminDbCtx, orgId: string, periodStart: string) => {
  return await ctx.db
    .query("ai_credits")
    .withIndex("by_org_period", (q) => q.eq("org_id", orgId).eq("period_start", periodStart))
    .first();
};

const getPurchasedAiCreditsRemaining = async (ctx: AdminDbCtx, orgId: string) => {
  const purchases = await ctx.db
    .query("ai_credit_purchases")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .collect();
  return purchases.reduce((sum, purchase) => {
    if (purchase.status !== "active") {
      return sum;
    }
    if (purchase.expires_at <= nowIso()) {
      return sum;
    }
    return sum + purchase.credits_remaining;
  }, 0);
};

const getAutomationRunsForOrgInPeriod = async (
  ctx: AdminDbCtx,
  orgId: string,
  periodStart: string,
  periodEnd: string,
) => {
  const buckets = [RUN_STATUS.active, RUN_STATUS.ended, RUN_STATUS.timedOut] as const;
  const rows = await Promise.all(
    buckets.map(
      async (status) =>
        await ctx.db
          .query("automation_runs")
          .withIndex("by_org_status", (q) => q.eq("org_id", orgId).eq("status", status))
          .collect(),
    ),
  );
  return rows
    .flat()
    .filter(
      (row) =>
        typeof row.created_at === "string" &&
        row.created_at >= periodStart &&
        row.created_at < periodEnd &&
        typeof row.workspace_id === "string",
    );
};

const getActiveAutomationRunsForOrg = async (ctx: AdminDbCtx, orgId: string) => {
  return await ctx.db
    .query("automation_runs")
    .withIndex("by_org_status", (q) => q.eq("org_id", orgId).eq("status", RUN_STATUS.active))
    .collect();
};

const getSuspensionHistoryForOrg = async (ctx: AdminDbCtx, orgId: string) => {
  const rows = await ctx.db
    .query("org_suspensions")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .collect();
  return rows.sort((left, right) => right.suspended_at.localeCompare(left.suspended_at));
};

const getActiveSuspensionForOrg = async (ctx: AdminDbCtx, orgId: string) => {
  return await ctx.db
    .query("org_suspensions")
    .withIndex("by_org_lifted", (q) => q.eq("org_id", orgId).eq("lifted_at", null))
    .first();
};

const countMembersForOrg = async (ctx: AdminDbCtx, orgId: string) => {
  return await ctx.runQuery(components.betterAuth.queries.countOrgMembers, { orgId });
};

const countWorkspacesForOrg = async (ctx: AdminDbCtx, orgId: string) => {
  const rows = await ctx.db
    .query("workspaces")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .collect();
  return rows.length;
};

const buildUsageSummary = async (ctx: AdminDbCtx, organization: BetterAuthOrganization) => {
  const orgId = organization.id;
  const subscription = await getCurrentSubscriptionForOrg(ctx, orgId);
  const tier = subscription?.tier ?? SUBSCRIPTION_TIER.free;
  const period = resolveCurrentBillingPeriod(subscription);
  const [usageMeter, aiCreditsRow, periodRuns, activeRuns, activeSuspension] = await Promise.all([
    getUsageMeterForOrgPeriod(ctx, orgId, period.periodStart),
    getAiCreditsForOrgPeriod(ctx, orgId, period.periodStart),
    getAutomationRunsForOrgInPeriod(ctx, orgId, period.periodStart, period.periodEnd),
    getActiveAutomationRunsForOrg(ctx, orgId),
    getActiveSuspensionForOrg(ctx, orgId),
  ]);

  return {
    orgId,
    orgName: organization.name,
    orgSlug: organization.slug,
    tier,
    subscriptionStatus: subscription?.status ?? "inactive",
    toolCalls: usageMeter?.tool_call_count ?? 0,
    totalToolCallTimeMs: usageMeter?.total_tool_call_time_ms ?? 0,
    aiCreditsUsed: aiCreditsRow?.allowance_used ?? 0,
    aiCreditsTotal: aiCreditsRow?.allowance_total ?? getAiCreditAllowanceForTier(tier),
    automationRuns: periodRuns.length,
    activeAutomationRuns: activeRuns.length,
    isSuspended: activeSuspension !== null,
  };
};

const toSuspensionSummary = (
  suspension: Doc<"org_suspensions">,
  orgName: string,
): {
  id: string;
  orgId: string;
  orgName: string;
  reason: string;
  suspendedBy: string;
  suspendedAt: string;
  liftedAt: string | null;
  liftedBy: string | null;
} => ({
  id: suspension.id,
  orgId: suspension.org_id,
  orgName,
  reason: suspension.reason,
  suspendedBy: suspension.suspended_by,
  suspendedAt: suspension.suspended_at,
  liftedAt: suspension.lifted_at,
  liftedBy: suspension.lifted_by,
});

const insertAdminAuditEvent = async (
  ctx: MutationCtx,
  params: {
    actorId: string;
    eventType: AuditEventType;
    payload: Record<string, unknown>;
    orgId?: string;
  },
): Promise<void> => {
  await ctx.db.insert("audit_events", {
    id: randomIdFor("audit"),
    org_id: params.orgId ?? PLATFORM_ADMIN_AUDIT_ORG_ID,
    actor_type: AUDIT_ACTOR_TYPE.user,
    actor_id: params.actorId,
    event_type: params.eventType,
    payload: params.payload,
    created_at: nowIso(),
  });
};

export const isAdmin = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return resolveAdminAccess(identity?.subject ?? null).canAccessAdminPage;
  },
});

export const getAccess = query({
  args: {},
  returns: adminAccessValidator,
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return resolveAdminAccess(identity?.subject ?? null);
  },
});

export const listFeatureFlags = query({
  args: {},
  returns: v.array(featureFlagValidator),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("feature_flags").collect();
    return rows.map(toFeatureFlag);
  },
});

export const listDogfoodOrgs = query({
  args: {},
  returns: v.array(dogfoodOrgValidator),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("dogfood_orgs").collect();
    return rows.map(toDogfoodOrg);
  },
});

export const listInviteCodes = query({
  args: {},
  returns: v.array(inviteCodeAdminValidator),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("invite_codes").collect();
    return rows
      .map((row) => ({
        id: row.id,
        code: row.code,
        label: row.label,
        grant_tier: resolveInviteGrantTier(row.grant_tier),
        active: row.active,
        use_count: row.use_count,
        created_by: row.created_by,
        created_at: row.created_at,
      }))
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  },
});

export const platformOverview = query({
  args: {},
  returns: platformOverviewValidator,
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [organizations, users, activeRuns, suspensions] = await Promise.all([
      listOrganizations(ctx),
      countUsers(ctx),
      ctx.db
        .query("automation_runs")
        .withIndex("by_status", (q) => q.eq("status", RUN_STATUS.active))
        .collect(),
      ctx.db.query("org_suspensions").collect(),
    ]);

    return {
      totalOrganizations: organizations.length,
      totalUsers: users,
      activeAutomationRuns: activeRuns.length,
      suspendedOrganizations: suspensions.filter((row) => row.lifted_at === null).length,
    };
  },
});

export const listOrgsWithUsage = query({
  args: {},
  returns: v.array(usageSummaryValidator),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const organizations = await listOrganizations(ctx);
    const rows = await Promise.all(
      organizations.map(async (organization) => await buildUsageSummary(ctx, organization)),
    );
    return rows.sort((left, right) => {
      if (left.isSuspended !== right.isSuspended) {
        return left.isSuspended ? -1 : 1;
      }
      return left.orgName.localeCompare(right.orgName);
    });
  },
});

export const getOrgUsageDetail = query({
  args: {
    orgId: v.string(),
  },
  returns: orgUsageDetailValidator,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const organization = await getOrganizationRecord(ctx, args.orgId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    const subscription = await getCurrentSubscriptionForOrg(ctx, args.orgId);
    const tier = subscription?.tier ?? SUBSCRIPTION_TIER.free;
    const period = resolveCurrentBillingPeriod(subscription);
    const [
      usageRows,
      aiCreditsRows,
      purchasedRemaining,
      activeRuns,
      memberCount,
      workspaceCount,
      suspensions,
    ] = await Promise.all([
      ctx.db
        .query("usage_meters")
        .withIndex("by_org_period", (q) => q.eq("org_id", args.orgId))
        .order("desc")
        .take(3),
      ctx.db
        .query("ai_credits")
        .withIndex("by_org_period", (q) => q.eq("org_id", args.orgId))
        .order("desc")
        .take(3),
      getPurchasedAiCreditsRemaining(ctx, args.orgId),
      getActiveAutomationRunsForOrg(ctx, args.orgId),
      countMembersForOrg(ctx, args.orgId),
      countWorkspacesForOrg(ctx, args.orgId),
      getSuspensionHistoryForOrg(ctx, args.orgId),
    ]);

    const usageHistory = usageRows.map((usageRow) => {
      const aiCreditsRow = aiCreditsRows.find((row) => row.period_start === usageRow.period_start);
      return {
        periodStart: usageRow.period_start,
        periodEnd: usageRow.period_end,
        toolCalls: usageRow.tool_call_count,
        totalToolCallTimeMs: usageRow.total_tool_call_time_ms,
        aiCreditsUsed: aiCreditsRow?.allowance_used ?? 0,
        aiCreditsTotal:
          aiCreditsRow?.allowance_total ??
          (usageRow.period_start === period.periodStart ? getAiCreditAllowanceForTier(tier) : 0),
        purchasedAiCreditsRemaining:
          usageRow.period_start === period.periodStart ? purchasedRemaining : 0,
      };
    });
    const currentAiCredits =
      aiCreditsRows.find((row) => row.period_start === period.periodStart) ??
      aiCreditsRows[0] ??
      null;
    const workspaceRows = await ctx.db
      .query("workspaces")
      .withIndex("by_org", (q) => q.eq("org_id", args.orgId))
      .collect();
    const workspaceNames = new Map(
      workspaceRows.map((workspace) => [workspace.id, workspace.name]),
    );

    const activeRunSummaries = await Promise.all(
      activeRuns
        .filter(
          (run): run is typeof run & { workspace_id: string } =>
            typeof run.workspace_id === "string",
        )
        .map(async (run) => ({
          id: run.id,
          workspaceId: run.workspace_id,
          workspaceName: workspaceNames.get(run.workspace_id) ?? run.workspace_id,
          status: run.status,
          startedAt: run.started_at,
        })),
    );

    return {
      orgId: args.orgId,
      orgName: organization.name,
      orgSlug: organization.slug,
      subscription: {
        tier,
        status: subscription?.status ?? "inactive",
        currentPeriodStart: period.periodStart,
        currentPeriodEnd: period.periodEnd,
      },
      usageHistory,
      aiCredits: {
        allowanceUsed: currentAiCredits?.allowance_used ?? 0,
        allowanceTotal: currentAiCredits?.allowance_total ?? getAiCreditAllowanceForTier(tier),
        purchasedRemaining,
        totalAvailable:
          Math.max(
            0,
            (currentAiCredits?.allowance_total ?? getAiCreditAllowanceForTier(tier)) -
              (currentAiCredits?.allowance_used ?? 0),
          ) + purchasedRemaining,
      },
      activeRuns: activeRunSummaries.sort((left, right) =>
        right.startedAt.localeCompare(left.startedAt),
      ),
      memberCount,
      workspaceCount,
      suspensionHistory: suspensions.map((row) => toSuspensionSummary(row, organization.name)),
    };
  },
});

export const listOrgsForAbuse = query({
  args: {},
  returns: v.array(orgAbuseRowValidator),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const organizations = await listOrganizations(ctx);
    const rows = await Promise.all(
      organizations.map(async (organization) => {
        const orgId = organization.id;
        const [subscription, activeSuspension, suspensions] = await Promise.all([
          getCurrentSubscriptionForOrg(ctx, orgId),
          getActiveSuspensionForOrg(ctx, orgId),
          getSuspensionHistoryForOrg(ctx, orgId),
        ]);
        return {
          orgId,
          orgName: organization.name,
          orgSlug: organization.slug,
          tier: subscription?.tier ?? SUBSCRIPTION_TIER.free,
          isSuspended: activeSuspension !== null,
          activeSuspension: activeSuspension
            ? {
                id: activeSuspension.id,
                reason: activeSuspension.reason,
                suspendedBy: activeSuspension.suspended_by,
                suspendedAt: activeSuspension.suspended_at,
              }
            : null,
          suspensionHistoryCount: suspensions.length,
        };
      }),
    );
    return rows.sort((left, right) => {
      if (left.isSuspended !== right.isSuspended) {
        return left.isSuspended ? -1 : 1;
      }
      return left.orgName.localeCompare(right.orgName);
    });
  },
});

export const listAllSuspensions = query({
  args: {},
  returns: v.array(suspensionSummaryValidator),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [organizations, suspensions] = await Promise.all([
      listOrganizations(ctx),
      ctx.db.query("org_suspensions").collect(),
    ]);
    const orgNames = new Map(organizations.map((org) => [org.id, org.name]));
    return suspensions
      .sort((left, right) => right.suspended_at.localeCompare(left.suspended_at))
      .slice(0, 100)
      .map((row) => toSuspensionSummary(row, orgNames.get(row.org_id) ?? row.org_id));
  },
});

export const getOrgDeletionPreview = query({
  args: {
    orgLookup: v.string(),
  },
  returns: adminDeletionOrgPreviewValidator,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const organization = await resolveOrganizationByLookup(ctx, args.orgLookup);
    if (!organization) {
      throw new Error("Organization not found");
    }
    const [memberCount, workspaceCount, automationCount, notificationEndpointCount] =
      await Promise.all([
        countMembersForOrg(ctx, organization.id),
        countWorkspacesForOrg(ctx, organization.id),
        countAutomationsForOrg(ctx, organization.id),
        countNotificationEndpointsForOrg(ctx, organization.id),
      ]);
    return {
      orgId: organization.id,
      orgName: organization.name,
      orgSlug: organization.slug,
      memberCount,
      workspaceCount,
      automationCount,
      notificationEndpointCount,
    };
  },
});

export const getUserDeletionPreview = query({
  args: {
    userLookup: v.string(),
  },
  returns: adminDeletionUserPreviewValidator,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const user = await resolveUserByLookup(ctx, args.userLookup);
    if (!user) {
      throw new Error("User not found");
    }
    const memberships = await listUserMemberships(ctx, user.id);
    const organizations = await Promise.all(
      memberships.map((membership) => buildUserDeletionMembershipPreview(ctx, membership, user.id)),
    );

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      organizationMemberships: organizations,
    };
  },
});

export const setFeatureFlagEnabled = mutation({
  args: {
    key: v.string(),
    enabled: v.boolean(),
  },
  returns: featureFlagValidator,
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const existing = await ctx.db
      .query("feature_flags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (!existing) {
      throw new Error("Feature flag not found");
    }

    const updatedAt = nowIso();
    await ctx.db.patch(existing._id, {
      enabled: args.enabled,
      updated_at: updatedAt,
    });
    await insertAdminAuditEvent(ctx, {
      actorId: userId,
      eventType: AUDIT_EVENT_TYPES.adminFeatureFlagUpdated,
      payload: {
        key: args.key,
        enabled: args.enabled,
      },
    });

    return {
      id: existing.id,
      key: existing.key,
      label: existing.label,
      description: existing.description,
      enabled: args.enabled,
      created_at: existing.created_at,
      updated_at: updatedAt,
    };
  },
});

export const hardDeleteOrganization = mutation({
  args: {
    orgId: v.string(),
    confirm: v.literal("DELETE_ORG"),
  },
  returns: adminDeletionOrgResultValidator,
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const organization = await getOrganizationRecord(ctx, args.orgId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    await hardDeleteOrganizationCascade(ctx, organization.id);

    await insertAdminAuditEvent(ctx, {
      actorId: userId,
      eventType: AUDIT_EVENT_TYPES.adminOrgHardDeleted,
      payload: {
        org_id: organization.id,
        org_slug: organization.slug,
        org_name: organization.name,
      },
    });

    return {
      orgId: organization.id,
      orgName: organization.name,
      orgSlug: organization.slug,
    };
  },
});

export const hardDeleteUser = mutation({
  args: {
    userId: v.string(),
    confirm: v.literal("DELETE_USER"),
  },
  returns: adminDeletionUserResultValidator,
  handler: async (ctx, args) => {
    const { userId: actorId } = await requireAdmin(ctx);
    if (args.userId === actorId) {
      throw new Error("You cannot delete the currently authenticated admin user.");
    }

    const user = await getUserRecord(ctx, args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const membershipPreviews = await Promise.all(
      (await listUserMemberships(ctx, user.id)).map((membership) =>
        buildUserDeletionMembershipPreview(ctx, membership, user.id),
      ),
    );
    const blockedMemberships = membershipPreviews.filter(
      (membership) => membership.action === "blocked_transfer_required",
    );
    if (blockedMemberships.length > 0) {
      throw new Error(
        `Transfer ownership or manually delete these organizations before deleting ${user.email}: ${blockedMemberships
          .map((membership) => membership.orgName)
          .join(", ")}`,
      );
    }
    const organizationIds = membershipPreviews
      .filter((membership) => membership.action === "delete_org")
      .map((membership) => membership.orgId);

    await hardDeleteUserCascade(ctx, {
      userId: user.id,
      organizationIds,
      email: user.email,
    });

    await insertAdminAuditEvent(ctx, {
      actorId,
      eventType: AUDIT_EVENT_TYPES.adminUserHardDeleted,
      payload: {
        user_id: user.id,
        email: user.email,
        deleted_org_ids: organizationIds,
      },
    });

    return {
      userId: user.id,
      email: user.email,
      deletedOrgIds: organizationIds,
    };
  },
});

export const seedDefaultFlags = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { userId } = await requireAdmin(ctx);
    const defaults = [
      {
        key: "cel_rules",
        label: "CEL Rules",
        description: "Enable CEL rules for dogfood organizations",
      },
      {
        key: "trigger_cel",
        label: "Trigger CEL",
        description: "Enable CEL-like event trigger predicates for automations",
      },
    ] as const;

    const insertedKeys: string[] = [];
    for (const flag of defaults) {
      const existing = await ctx.db
        .query("feature_flags")
        .withIndex("by_key", (q) => q.eq("key", flag.key))
        .unique();
      if (existing) {
        continue;
      }
      const now = nowIso();
      await ctx.db.insert("feature_flags", {
        id: randomIdFor("flag"),
        key: flag.key,
        label: flag.label,
        description: flag.description,
        enabled: false,
        created_at: now,
        updated_at: now,
      });
      insertedKeys.push(flag.key);
    }
    await insertAdminAuditEvent(ctx, {
      actorId: userId,
      eventType: AUDIT_EVENT_TYPES.adminFeatureFlagsSeeded,
      payload: {
        inserted_keys: insertedKeys,
        inserted_count: insertedKeys.length,
      },
    });

    return null;
  },
});

export const addDogfoodOrg = mutation({
  args: {
    orgId: v.string(),
  },
  returns: dogfoodOrgValidator,
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const orgId = args.orgId.trim();
    if (!orgId) {
      throw new Error("Organization ID is required");
    }

    const existing = await ctx.db
      .query("dogfood_orgs")
      .withIndex("by_org", (q) => q.eq("org_id", orgId))
      .unique();

    if (existing) {
      await insertAdminAuditEvent(ctx, {
        actorId: userId,
        eventType: AUDIT_EVENT_TYPES.adminDogfoodOrgUpserted,
        payload: {
          org_id: orgId,
          created: false,
        },
        orgId,
      });
      return toDogfoodOrg(existing);
    }

    const created = {
      id: randomIdFor("dogfood"),
      org_id: orgId,
      added_by: userId,
      created_at: nowIso(),
    } as const;

    await ctx.db.insert("dogfood_orgs", created);
    await insertAdminAuditEvent(ctx, {
      actorId: userId,
      eventType: AUDIT_EVENT_TYPES.adminDogfoodOrgUpserted,
      payload: {
        org_id: orgId,
        created: true,
      },
      orgId,
    });
    return created;
  },
});

export const removeDogfoodOrg = mutation({
  args: {
    orgId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const orgId = args.orgId.trim();
    if (!orgId) {
      return null;
    }

    const existing = await ctx.db
      .query("dogfood_orgs")
      .withIndex("by_org", (q) => q.eq("org_id", orgId))
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
    await insertAdminAuditEvent(ctx, {
      actorId: userId,
      eventType: AUDIT_EVENT_TYPES.adminDogfoodOrgRemoved,
      payload: {
        org_id: orgId,
        removed: Boolean(existing),
      },
      orgId,
    });

    return null;
  },
});

export const createInviteCode = mutation({
  args: {
    label: v.string(),
    grantTier: subscriptionTierValidator,
  },
  returns: inviteCodeAdminValidator,
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const label = requireBoundedString(args.label, {
      field: "Label",
      maxLength: INVITE_CODE_LABEL_MAX_LENGTH,
    });

    let code: string | null = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = generateInviteCode();
      const existing = await ctx.db
        .query("invite_codes")
        .withIndex("by_code", (q) => q.eq("code", candidate))
        .unique();
      if (!existing) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      throw new Error("Failed to generate a unique invite code");
    }

    const created = {
      id: randomIdFor("icode"),
      code,
      label,
      grant_tier: args.grantTier,
      active: true,
      use_count: 0,
      created_by: userId,
      created_at: nowIso(),
    } as const;

    await ctx.db.insert("invite_codes", created);
    return created;
  },
});

export const setInviteCodeActive = mutation({
  args: {
    inviteCodeId: v.string(),
    active: v.boolean(),
  },
  returns: inviteCodeAdminValidator,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const inviteCode = await ctx.db
      .query("invite_codes")
      .withIndex("by_custom_id", (q) => q.eq("id", args.inviteCodeId))
      .unique();
    if (!inviteCode) {
      throw new Error("Invite code not found");
    }

    await ctx.db.patch(inviteCode._id, {
      active: args.active,
    });

    return {
      id: inviteCode.id,
      code: inviteCode.code,
      label: inviteCode.label,
      grant_tier: resolveInviteGrantTier(inviteCode.grant_tier),
      active: args.active,
      use_count: inviteCode.use_count,
      created_by: inviteCode.created_by,
      created_at: inviteCode.created_at,
    };
  },
});

export const orgFeatureAccess = query({
  args: {
    featureKey: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx);
    return hasFeatureAccess(ctx, auth.orgId, args.featureKey);
  },
});
