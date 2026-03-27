import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { components } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  nowIso,
  randomIdFor,
  requireIdentity,
  requireOrgMember,
  requireWorkspaceRole,
} from "./_auth";
import { getTierConfig } from "../packages/shared/src/subscriptions.js";
import {
  ABUSE_FLAG_SEVERITY,
  ABUSE_FLAG_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  SECURITY_AUDIT_EVENT_TYPES,
  SUBSCRIPTION_TIER,
  USER_ROLE,
  type AbuseFlagSeverity,
  type AbuseFlagStatus,
  type AuditActorType,
  type AuditEventType,
} from "./domain_constants";
import {
  abuseFlagReviewStatusValidator,
  abuseFlagSeverityValidator,
  jsonRecordValidator,
} from "./validators";

type DbCtx = QueryCtx | MutationCtx;

type FlagRecord = {
  id: string;
  org_id: string;
  flag_type: string;
  severity: AbuseFlagSeverity;
  details: string;
  status: AbuseFlagStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const WORKSPACE_SCAN_BUDGET = 2_000;
const USAGE_METER_SCAN_BUDGET = 2_000;
const CREDENTIAL_FAILURE_CLEANUP_BUDGET = 100;
const CREDENTIAL_FAILURE_SCAN_BUDGET = 500;
const RATE_LIMIT_AUDIT_SCAN_BUDGET = 2_000;
const ABUSE_FLAG_SCAN_BUDGET = 200;
const shouldScheduleAbuseContinuation = process.env.NODE_ENV !== "test";
const ABUSE_MANAGER_ROLES = [USER_ROLE.owner, USER_ROLE.admin] as const;
const ABUSE_REVIEWER_ROLES = [
  USER_ROLE.owner,
  USER_ROLE.admin,
  USER_ROLE.approver,
  USER_ROLE.viewer,
] as const;
const abuseRefs = {
  cleanupCredentialAuthFailures: makeFunctionReference<"mutation">(
    "abuse:cleanupCredentialAuthFailures",
  ),
};

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

const ensureAdminUser = async (ctx: MutationCtx): Promise<string> => {
  const identity = await requireIdentity(ctx);
  if (!isAdminUserId(identity.subject)) {
    throw new Error("Forbidden");
  }
  return identity.subject;
};

const isSecurityEventType = (eventType: string): boolean => {
  return (
    eventType.startsWith("security.") || SECURITY_AUDIT_EVENT_TYPES.has(eventType as AuditEventType)
  );
};

const activeSuspensionForOrg = async (
  ctx: DbCtx,
  orgId: string,
): Promise<Doc<"org_suspensions"> | null> => {
  return await ctx.db
    .query("org_suspensions")
    .withIndex("by_org_lifted", (q) => q.eq("org_id", orgId).eq("lifted_at", null))
    .first();
};

const suspendOrgImpl = async (
  ctx: MutationCtx,
  args: { orgId: string; reason: string; suspendedBy: string },
): Promise<Doc<"org_suspensions">> => {
  const existing = await activeSuspensionForOrg(ctx, args.orgId);
  if (existing) {
    return existing;
  }

  const createdAt = nowIso();
  const suspension = {
    id: randomIdFor("susp"),
    org_id: args.orgId,
    reason: args.reason,
    suspended_by: args.suspendedBy,
    suspended_at: createdAt,
    lifted_at: null,
    lifted_by: null,
  };

  await ctx.db.insert("org_suspensions", suspension);
  await writeAuditEvent(ctx, {
    orgId: args.orgId,
    actorType: AUDIT_ACTOR_TYPE.system,
    actorId: args.suspendedBy,
    eventType: AUDIT_EVENT_TYPES.orgSuspended,
    payload: {
      reason: args.reason,
      suspension_id: suspension.id,
    },
  });

  const inserted = await activeSuspensionForOrg(ctx, args.orgId);
  if (!inserted) {
    throw new Error("Failed to load suspension");
  }
  return inserted;
};

const unsuspendOrgImpl = async (
  ctx: MutationCtx,
  args: { orgId: string; liftedBy: string },
): Promise<boolean> => {
  const existing = await activeSuspensionForOrg(ctx, args.orgId);
  if (!existing) {
    return false;
  }

  await ctx.db.patch(existing._id, {
    lifted_at: nowIso(),
    lifted_by: args.liftedBy,
  });

  await writeAuditEvent(ctx, {
    orgId: args.orgId,
    actorType: AUDIT_ACTOR_TYPE.system,
    actorId: args.liftedBy,
    eventType: AUDIT_EVENT_TYPES.orgUnsuspended,
    payload: {
      suspension_id: existing.id,
    },
  });

  return true;
};

const unlockFailuresImpl = async (
  ctx: MutationCtx,
  args: { workspaceId: string; ipHash?: string },
): Promise<number> => {
  const rows = args.ipHash
    ? await ctx.db
        .query("credential_auth_failures")
        .withIndex("by_workspace_ip", (q) =>
          q.eq("workspace_id", args.workspaceId).eq("ip_hash", args.ipHash!),
        )
        .take(CREDENTIAL_FAILURE_SCAN_BUDGET)
    : await ctx.db
        .query("credential_auth_failures")
        .withIndex("by_workspace_ip", (q) => q.eq("workspace_id", args.workspaceId))
        .take(CREDENTIAL_FAILURE_SCAN_BUDGET);

  let count = 0;
  for (const row of rows) {
    await ctx.db.patch(row._id, {
      attempt_count: 0,
      locked_at: null,
      last_attempt_at: nowIso(),
    });
    count += 1;
  }

  return count;
};

const writeAuditEvent = async (
  ctx: MutationCtx,
  params: {
    orgId: string;
    actorType: AuditActorType;
    actorId: string;
    eventType: AuditEventType;
    payload: Record<string, unknown>;
  },
): Promise<void> => {
  await ctx.db.insert("audit_events", {
    id: randomIdFor("audit"),
    org_id: params.orgId,
    actor_type: params.actorType,
    actor_id: params.actorId,
    event_type: params.eventType,
    payload: params.payload,
    created_at: nowIso(),
  });
};

const maybeFlagOrg = async (
  ctx: MutationCtx,
  params: {
    orgId: string;
    flagType: string;
    severity: AbuseFlagSeverity;
    details: Record<string, unknown>;
    actorId?: string;
  },
): Promise<FlagRecord | null> => {
  const detailsJson = JSON.stringify(params.details);
  const duplicate = await ctx.db
    .query("abuse_flags")
    .withIndex("by_org_status_flag_details", (q) =>
      q
        .eq("org_id", params.orgId)
        .eq("status", ABUSE_FLAG_STATUS.open)
        .eq("flag_type", params.flagType)
        .eq("details", detailsJson),
    )
    .first();
  if (duplicate) {
    return null;
  }

  const createdAt = nowIso();
  const id = randomIdFor("aflag");
  const flag: FlagRecord = {
    id,
    org_id: params.orgId,
    flag_type: params.flagType,
    severity: params.severity,
    details: detailsJson,
    status: ABUSE_FLAG_STATUS.open,
    reviewed_by: null,
    reviewed_at: null,
    created_at: createdAt,
  };

  await ctx.db.insert("abuse_flags", flag);
  await writeAuditEvent(ctx, {
    orgId: params.orgId,
    actorType: AUDIT_ACTOR_TYPE.system,
    actorId: params.actorId ?? "abuse_detector",
    eventType: AUDIT_EVENT_TYPES.securityAbuseFlagged,
    payload: {
      flag_id: id,
      flag_type: params.flagType,
      severity: params.severity,
      details: params.details,
    },
  });

  return flag;
};

const parseJsonDetails = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const getOwnerEmailForOrg = async (ctx: DbCtx, orgId: string): Promise<string | null> => {
  const members = await ctx.runQuery(components.betterAuth.queries.listOrgMembers, { orgId });
  const preferred =
    members.find((entry) => entry.role === USER_ROLE.owner) ??
    members.find((entry) => entry.role === USER_ROLE.admin);
  if (!preferred) {
    return null;
  }

  const user = await ctx.runQuery(components.betterAuth.queries.getUserById, {
    userId: preferred.userId,
  });
  return user?.email ?? null;
};

const collectOrgOwnerEmails = async (
  ctx: DbCtx,
): Promise<Array<{ orgId: string; email: string; createdAt: string }>> => {
  const workspaceRows = await ctx.db
    .query("workspaces")
    .withIndex("by_created_at")
    .take(WORKSPACE_SCAN_BUDGET + 1);
  const atScanBudget = workspaceRows.length > WORKSPACE_SCAN_BUDGET;
  const workspaces = atScanBudget ? workspaceRows.slice(0, WORKSPACE_SCAN_BUDGET) : workspaceRows;
  const firstWorkspaceByOrg = new Map<string, string>();
  if (atScanBudget) {
    console.warn("abuse.collectOrgOwnerEmails.scan_budget_reached", {
      scan_budget: WORKSPACE_SCAN_BUDGET,
    });
  }
  for (const workspace of workspaces) {
    const existing = firstWorkspaceByOrg.get(workspace.org_id);
    if (!existing || workspace.created_at < existing) {
      firstWorkspaceByOrg.set(workspace.org_id, workspace.created_at);
    }
  }

  const entries: Array<{ orgId: string; email: string; createdAt: string }> = [];
  for (const [orgId, createdAt] of firstWorkspaceByOrg.entries()) {
    const email = await getOwnerEmailForOrg(ctx, orgId);
    if (!email) {
      continue;
    }
    entries.push({ orgId, email: email.toLowerCase(), createdAt });
  }

  return entries;
};

const normalizeEmailPattern = (
  email: string,
): { domain: string; local: string; base: string } | null => {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at >= email.length - 1) {
    return null;
  }

  const local = email.slice(0, at).toLowerCase();
  const domain = email.slice(at + 1).toLowerCase();
  if (!local || !domain) {
    return null;
  }

  const match = local.match(/^(.*?)(\d+)$/);
  const base = (match?.[1] ?? local).replace(/[._-]+/g, "");
  return {
    domain,
    local,
    base,
  };
};

const commonMailboxDomains = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

const applyVelocityFlags = async (ctx: MutationCtx): Promise<number> => {
  const detections = await detectVelocityAnomalyImpl(ctx, {
    windowHours: 1,
    perDomainThreshold: 5,
    globalThreshold: 20,
  });

  let created = 0;
  for (const domainHit of detections.domain_hits) {
    for (const orgId of domainHit.org_ids) {
      const flagged = await maybeFlagOrg(ctx, {
        orgId,
        flagType: "velocity_anomaly",
        severity: ABUSE_FLAG_SEVERITY.medium,
        details: {
          domain: domainHit.domain,
          count: domainHit.count,
          window_hours: detections.window_hours,
        },
      });
      if (flagged) {
        created += 1;
      }
    }
  }

  if (detections.global_count > detections.global_threshold) {
    for (const orgId of detections.recent_org_ids) {
      const flagged = await maybeFlagOrg(ctx, {
        orgId,
        flagType: "velocity_anomaly",
        severity: ABUSE_FLAG_SEVERITY.high,
        details: {
          global_count: detections.global_count,
          global_threshold: detections.global_threshold,
          window_hours: detections.window_hours,
        },
      });
      if (flagged) {
        created += 1;
      }
    }
  }

  return created;
};

const applyEmailPatternFlags = async (ctx: MutationCtx): Promise<number> => {
  const detections = await detectEmailPatternAbuseImpl(ctx);
  let created = 0;

  for (const detection of detections) {
    for (const orgId of detection.org_ids) {
      const flagged = await maybeFlagOrg(ctx, {
        orgId,
        flagType: "sybil_suspect",
        severity: ABUSE_FLAG_SEVERITY.medium,
        details: {
          domain: detection.domain,
          base_pattern: detection.base_pattern,
          emails: detection.emails,
        },
      });
      if (flagged) {
        created += 1;
      }
    }
  }

  return created;
};

const applyUsagePatternFlags = async (ctx: MutationCtx): Promise<number> => {
  const detections = await detectUsagePatternAbuseImpl(ctx, {
    minPeriods: 2,
    dormantDays: 30,
  });
  let created = 0;

  for (const detection of detections) {
    const flagged = await maybeFlagOrg(ctx, {
      orgId: detection.org_id,
      flagType: "usage_pattern",
      severity: ABUSE_FLAG_SEVERITY.medium,
      details: {
        period_hits: detection.period_hits,
        last_meter_at: detection.last_meter_at,
      },
    });
    if (flagged) {
      created += 1;
    }
  }

  return created;
};

const detectEmailPatternAbuseImpl = async (
  ctx: DbCtx,
): Promise<
  Array<{
    domain: string;
    base_pattern: string;
    count: number;
    org_ids: string[];
    emails: string[];
  }>
> => {
  const owners = await collectOrgOwnerEmails(ctx);
  const grouped = new Map<string, Array<{ orgId: string; email: string }>>();

  for (const entry of owners) {
    const pattern = normalizeEmailPattern(entry.email);
    if (!pattern || commonMailboxDomains.has(pattern.domain) || pattern.base.length < 3) {
      continue;
    }

    const key = `${pattern.domain}:${pattern.base}`;
    const group = grouped.get(key) ?? [];
    group.push({ orgId: entry.orgId, email: entry.email });
    grouped.set(key, group);
  }

  const results: Array<{
    domain: string;
    base_pattern: string;
    count: number;
    org_ids: string[];
    emails: string[];
  }> = [];

  for (const [key, rows] of grouped.entries()) {
    if (rows.length < 3) {
      continue;
    }
    const [domain, basePattern] = key.split(":");
    results.push({
      domain: domain ?? "unknown",
      base_pattern: basePattern ?? "unknown",
      count: rows.length,
      org_ids: rows.map((row) => row.orgId),
      emails: rows.map((row) => row.email),
    });
  }

  return results;
};

const detectVelocityAnomalyImpl = async (
  ctx: DbCtx,
  args: {
    windowHours: number;
    perDomainThreshold: number;
    globalThreshold: number;
  },
): Promise<{
  window_hours: number;
  per_domain_threshold: number;
  global_threshold: number;
  global_count: number;
  recent_org_ids: string[];
  domain_hits: Array<{ domain: string; count: number; org_ids: string[] }>;
}> => {
  const owners = await collectOrgOwnerEmails(ctx);
  const now = Date.now();
  const windowMs = Math.max(1, args.windowHours) * 60 * 60 * 1000;

  const recent = owners.filter((entry) => {
    const created = Date.parse(entry.createdAt);
    return Number.isFinite(created) && now - created <= windowMs;
  });

  const recentOrgIds = [...new Set(recent.map((entry) => entry.orgId))];
  const byDomain = new Map<string, string[]>();

  for (const entry of recent) {
    const pattern = normalizeEmailPattern(entry.email);
    if (!pattern) {
      continue;
    }

    const domainOrgIds = byDomain.get(pattern.domain) ?? [];
    domainOrgIds.push(entry.orgId);
    byDomain.set(pattern.domain, domainOrgIds);
  }

  const domainHits: Array<{ domain: string; count: number; org_ids: string[] }> = [];
  for (const [domain, orgIds] of byDomain.entries()) {
    const uniqueOrgIds = [...new Set(orgIds)];
    if (uniqueOrgIds.length <= args.perDomainThreshold) {
      continue;
    }
    domainHits.push({
      domain,
      count: uniqueOrgIds.length,
      org_ids: uniqueOrgIds,
    });
  }

  return {
    window_hours: Math.max(1, args.windowHours),
    per_domain_threshold: Math.max(1, args.perDomainThreshold),
    global_threshold: Math.max(1, args.globalThreshold),
    global_count: recentOrgIds.length,
    recent_org_ids: recentOrgIds,
    domain_hits: domainHits,
  };
};

const detectUsagePatternAbuseImpl = async (
  ctx: DbCtx,
  args: { minPeriods: number; dormantDays: number },
): Promise<Array<{ org_id: string; period_hits: number; last_meter_at: string }>> => {
  const minPeriods = Math.max(1, args.minPeriods);
  const dormantDays = Math.max(1, args.dormantDays);
  const dormantMs = dormantDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const usageMeterRows = await ctx.db.query("usage_meters").take(USAGE_METER_SCAN_BUDGET + 1);
  const atScanBudget = usageMeterRows.length > USAGE_METER_SCAN_BUDGET;
  const rows = atScanBudget ? usageMeterRows.slice(0, USAGE_METER_SCAN_BUDGET) : usageMeterRows;

  const hitsByOrg = new Map<string, { periodHits: number; lastMeterAt: string }>();
  const tierByOrg = new Map<string, string>();
  if (atScanBudget) {
    console.warn("abuse.detectUsagePatternAbuse.scan_budget_reached", {
      scan_budget: USAGE_METER_SCAN_BUDGET,
    });
  }
  for (const row of rows) {
    let tier = tierByOrg.get(row.org_id);
    if (!tier) {
      const subscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("org_id", row.org_id))
        .first();
      tier = subscription?.tier ?? SUBSCRIPTION_TIER.free;
      tierByOrg.set(row.org_id, tier);
    }
    if (tier !== SUBSCRIPTION_TIER.free) {
      continue;
    }

    const freeLimit = getTierConfig(SUBSCRIPTION_TIER.free).max_tool_calls_per_month;
    if (row.tool_call_count < freeLimit) {
      continue;
    }

    const lastUpdated = Date.parse(row.updated_at);
    if (!Number.isFinite(lastUpdated) || now - lastUpdated <= dormantMs) {
      continue;
    }

    const current = hitsByOrg.get(row.org_id) ?? { periodHits: 0, lastMeterAt: row.updated_at };
    current.periodHits += 1;
    if (row.updated_at > current.lastMeterAt) {
      current.lastMeterAt = row.updated_at;
    }
    hitsByOrg.set(row.org_id, current);
  }

  return [...hitsByOrg.entries()]
    .filter(([, value]) => value.periodHits >= minPeriods)
    .map(([orgId, value]) => ({
      org_id: orgId,
      period_hits: value.periodHits,
      last_meter_at: value.lastMeterAt,
    }));
};

export const isOrgSuspended = internalQuery({
  args: {
    orgId: v.string(),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      org_id: v.string(),
      reason: v.string(),
      suspended_by: v.string(),
      suspended_at: v.string(),
      lifted_at: v.union(v.string(), v.null()),
      lifted_by: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await activeSuspensionForOrg(ctx, args.orgId);
  },
});

export const suspendOrg = internalMutation({
  args: {
    orgId: v.string(),
    reason: v.string(),
    suspendedBy: v.string(),
  },
  returns: v.object({
    id: v.string(),
    org_id: v.string(),
    reason: v.string(),
    suspended_by: v.string(),
    suspended_at: v.string(),
    lifted_at: v.union(v.string(), v.null()),
    lifted_by: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    return await suspendOrgImpl(ctx, args);
  },
});

export const unsuspendOrg = internalMutation({
  args: {
    orgId: v.string(),
    liftedBy: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await unsuspendOrgImpl(ctx, args);
  },
});

export const suspendOrgManual = mutation({
  args: {
    orgId: v.string(),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await ensureAdminUser(ctx);
    await suspendOrgImpl(ctx, {
      orgId: args.orgId,
      reason: args.reason,
      suspendedBy: userId,
    });
    return null;
  },
});

export const unsuspendOrgManual = mutation({
  args: {
    orgId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await ensureAdminUser(ctx);
    await unsuspendOrgImpl(ctx, {
      orgId: args.orgId,
      liftedBy: userId,
    });
    return null;
  },
});

export const getOrgSuspension = query({
  args: {
    orgId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      org_id: v.string(),
      reason: v.string(),
      suspended_by: v.string(),
      suspended_at: v.string(),
      lifted_at: v.union(v.string(), v.null()),
      lifted_by: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    if (args.orgId && args.orgId.length > 0) {
      const identity = await requireIdentity(ctx);
      if (!isAdminUserId(identity.subject)) {
        throw new Error("Forbidden");
      }
      return await activeSuspensionForOrg(ctx, args.orgId);
    }

    const auth = await requireOrgMember(ctx, [...ABUSE_MANAGER_ROLES]);
    return await activeSuspensionForOrg(ctx, auth.orgId);
  },
});

export const unlockCredential = internalMutation({
  args: {
    workspaceId: v.string(),
    ipHash: v.optional(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    return await unlockFailuresImpl(ctx, args);
  },
});

export const unlockWorkspaceCredential = mutation({
  args: {
    workspaceId: v.string(),
    ipHash: v.optional(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId, [...ABUSE_MANAGER_ROLES]);
    const unlocked = await unlockFailuresImpl(ctx, {
      workspaceId: args.workspaceId,
      ...(args.ipHash ? { ipHash: args.ipHash } : {}),
    });

    await writeAuditEvent(ctx, {
      orgId: auth.orgId,
      actorType: AUDIT_ACTOR_TYPE.user,
      actorId: auth.userId,
      eventType: AUDIT_EVENT_TYPES.securityCredentialLockoutCleared,
      payload: {
        workspace_id: args.workspaceId,
        ip_hash: args.ipHash ?? null,
        rows_unlocked: unlocked,
      },
    });

    return unlocked;
  },
});

export const listLockedCredentials = query({
  args: {
    workspaceId: v.string(),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      workspace_id: v.string(),
      ip_hash: v.string(),
      attempt_count: v.number(),
      first_attempt_at: v.string(),
      last_attempt_at: v.string(),
      locked_at: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId, [...ABUSE_MANAGER_ROLES]);
    const rows = await ctx.db
      .query("credential_auth_failures")
      .withIndex("by_workspace_locked", (q) =>
        q.eq("workspace_id", args.workspaceId).gt("locked_at", null),
      )
      .take(CREDENTIAL_FAILURE_SCAN_BUDGET);
    return rows;
  },
});

export const cleanupCredentialAuthFailures = internalMutation({
  args: {
    olderThanHours: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const cutoffMs = Date.now() - Math.max(1, args.olderThanHours ?? 24) * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();
    const rows = await ctx.db
      .query("credential_auth_failures")
      .withIndex("by_last_attempt", (q) => q.lte("last_attempt_at", cutoffIso))
      .take(CREDENTIAL_FAILURE_CLEANUP_BUDGET + 1);
    const atBudget = rows.length > CREDENTIAL_FAILURE_CLEANUP_BUDGET;
    const candidates = atBudget ? rows.slice(0, CREDENTIAL_FAILURE_CLEANUP_BUDGET) : rows;
    let deleted = 0;

    for (const row of candidates) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }

    if (atBudget) {
      console.warn("abuse.cleanupCredentialAuthFailures.scan_budget_reached", {
        scan_budget: CREDENTIAL_FAILURE_CLEANUP_BUDGET,
      });
      if (shouldScheduleAbuseContinuation) {
        await ctx.scheduler.runAfter(0, abuseRefs.cleanupCredentialAuthFailures, {
          olderThanHours: args.olderThanHours,
        });
      }
    }

    return deleted;
  },
});

export const detectEmailPatternAbuse = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      domain: v.string(),
      base_pattern: v.string(),
      count: v.number(),
      org_ids: v.array(v.string()),
      emails: v.array(v.string()),
    }),
  ),
  handler: async (ctx) => {
    return await detectEmailPatternAbuseImpl(ctx);
  },
});

export const detectVelocityAnomaly = internalQuery({
  args: {
    windowHours: v.optional(v.number()),
    perDomainThreshold: v.optional(v.number()),
    globalThreshold: v.optional(v.number()),
  },
  returns: v.object({
    window_hours: v.number(),
    per_domain_threshold: v.number(),
    global_threshold: v.number(),
    global_count: v.number(),
    recent_org_ids: v.array(v.string()),
    domain_hits: v.array(
      v.object({
        domain: v.string(),
        count: v.number(),
        org_ids: v.array(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    return await detectVelocityAnomalyImpl(ctx, {
      windowHours: Math.max(1, args.windowHours ?? 1),
      perDomainThreshold: Math.max(1, args.perDomainThreshold ?? 5),
      globalThreshold: Math.max(1, args.globalThreshold ?? 20),
    });
  },
});

export const detectUsagePatternAbuse = internalQuery({
  args: {
    minPeriods: v.optional(v.number()),
    dormantDays: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      org_id: v.string(),
      period_hits: v.number(),
      last_meter_at: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    return await detectUsagePatternAbuseImpl(ctx, {
      minPeriods: Math.max(1, args.minPeriods ?? 2),
      dormantDays: Math.max(1, args.dormantDays ?? 30),
    });
  },
});

export const flagOrg = internalMutation({
  args: {
    orgId: v.string(),
    flagType: v.string(),
    severity: abuseFlagSeverityValidator,
    details: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const created = await maybeFlagOrg(ctx, {
      orgId: args.orgId,
      flagType: args.flagType,
      severity: args.severity,
      details: parseJsonDetails(args.details),
    });
    return created?.id ?? null;
  },
});

export const reviewFlag = mutation({
  args: {
    flagId: v.string(),
    status: abuseFlagReviewStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const flag = await ctx.db
      .query("abuse_flags")
      .withIndex("by_custom_id", (q) => q.eq("id", args.flagId))
      .unique();
    if (!flag) {
      throw new Error("Flag not found");
    }

    if (!isAdminUserId(identity.subject)) {
      const auth = await requireOrgMember(ctx, [...ABUSE_MANAGER_ROLES]);
      if (auth.orgId !== flag.org_id) {
        throw new Error("Forbidden");
      }
    }

    const reviewedAt = nowIso();
    await ctx.db.patch(flag._id, {
      status: args.status,
      reviewed_by: identity.subject,
      reviewed_at: reviewedAt,
    });

    await writeAuditEvent(ctx, {
      orgId: flag.org_id,
      actorType: AUDIT_ACTOR_TYPE.user,
      actorId: identity.subject,
      eventType: AUDIT_EVENT_TYPES.securityAbuseFlagReviewed,
      payload: {
        flag_id: flag.id,
        status: args.status,
      },
    });

    if (args.status === ABUSE_FLAG_STATUS.confirmed && flag.severity === ABUSE_FLAG_SEVERITY.high) {
      await suspendOrgImpl(ctx, {
        orgId: flag.org_id,
        reason: `Auto-suspended after confirmed ${flag.flag_type}`,
        suspendedBy: identity.subject,
      });
    }

    return null;
  },
});

export const runHeuristics = internalMutation({
  args: {},
  returns: v.object({
    email_pattern_flags: v.number(),
    velocity_flags: v.number(),
    usage_flags: v.number(),
  }),
  handler: async (ctx) => {
    const emailPatternFlags = await applyEmailPatternFlags(ctx);
    const velocityFlags = await applyVelocityFlags(ctx);
    const usageFlags = await applyUsagePatternFlags(ctx);

    return {
      email_pattern_flags: emailPatternFlags,
      velocity_flags: velocityFlags,
      usage_flags: usageFlags,
    };
  },
});

export const listSecurityEvents = query({
  args: {
    paginationOpts: paginationOptsValidator,
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  returns: v.object({
    page: v.array(
      v.object({
        id: v.string(),
        org_id: v.string(),
        actor_type: v.string(),
        actor_id: v.string(),
        event_type: v.string(),
        payload: jsonRecordValidator,
        created_at: v.string(),
        open_flag_count: v.number(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [...ABUSE_REVIEWER_ROLES]);
    const from = args.from;
    const to = args.to;

    const page = await ctx.db
      .query("audit_events")
      .withIndex("by_org_created", (q) => {
        if (from && to) {
          return q.eq("org_id", auth.orgId).gte("created_at", from).lte("created_at", to);
        }
        if (from) {
          return q.eq("org_id", auth.orgId).gte("created_at", from);
        }
        if (to) {
          return q.eq("org_id", auth.orgId).lte("created_at", to);
        }
        return q.eq("org_id", auth.orgId);
      })
      .order("desc")
      .paginate(args.paginationOpts);

    const openFlagCount = (
      await ctx.db
        .query("abuse_flags")
        .withIndex("by_org_status", (q) =>
          q.eq("org_id", auth.orgId).eq("status", ABUSE_FLAG_STATUS.open),
        )
        .take(ABUSE_FLAG_SCAN_BUDGET)
    ).length;

    return {
      page: page.page
        .filter((row) => isSecurityEventType(row.event_type))
        .map((row) => ({
          id: row.id,
          org_id: row.org_id,
          actor_type: row.actor_type,
          actor_id: row.actor_id,
          event_type: row.event_type,
          payload: row.payload,
          created_at: row.created_at,
          open_flag_count: openFlagCount,
        })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const getAbuseOverview = query({
  args: {},
  returns: v.object({
    open_flags: v.object({
      low: v.number(),
      medium: v.number(),
      high: v.number(),
      total: v.number(),
    }),
    recent_suspensions: v.array(
      v.object({
        id: v.string(),
        org_id: v.string(),
        reason: v.string(),
        suspended_by: v.string(),
        suspended_at: v.string(),
      }),
    ),
    rate_limit_violations_24h: v.number(),
  }),
  handler: async (ctx) => {
    const auth = await requireOrgMember(ctx, [...ABUSE_REVIEWER_ROLES]);

    const openFlags = await ctx.db
      .query("abuse_flags")
      .withIndex("by_org_status", (q) =>
        q.eq("org_id", auth.orgId).eq("status", ABUSE_FLAG_STATUS.open),
      )
      .take(ABUSE_FLAG_SCAN_BUDGET);
    const low = openFlags.filter((flag) => flag.severity === ABUSE_FLAG_SEVERITY.low).length;
    const medium = openFlags.filter((flag) => flag.severity === ABUSE_FLAG_SEVERITY.medium).length;
    const high = openFlags.filter((flag) => flag.severity === ABUSE_FLAG_SEVERITY.high).length;

    const suspensionRows = await ctx.db
      .query("org_suspensions")
      .withIndex("by_org_suspended", (q) => q.eq("org_id", auth.orgId))
      .order("desc")
      .take(10);
    const recentSuspensions = suspensionRows.map((row) => ({
      id: row.id,
      org_id: row.org_id,
      reason: row.reason,
      suspended_by: row.suspended_by,
      suspended_at: row.suspended_at,
    }));

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentAudits = await ctx.db
      .query("audit_events")
      .withIndex("by_org_event_type_created", (q) =>
        q
          .eq("org_id", auth.orgId)
          .eq("event_type", AUDIT_EVENT_TYPES.securityRateLimited)
          .gte("created_at", dayAgo),
      )
      .take(RATE_LIMIT_AUDIT_SCAN_BUDGET + 1);
    const atRateLimitAuditBudget = recentAudits.length > RATE_LIMIT_AUDIT_SCAN_BUDGET;
    const auditsToCount = atRateLimitAuditBudget
      ? recentAudits.slice(0, RATE_LIMIT_AUDIT_SCAN_BUDGET)
      : recentAudits;
    if (atRateLimitAuditBudget) {
      console.warn("abuse.getAbuseOverview.rate_limit_audit_scan_budget_reached", {
        scan_budget: RATE_LIMIT_AUDIT_SCAN_BUDGET,
      });
    }

    const rateLimitViolations = auditsToCount.length;

    return {
      open_flags: {
        low,
        medium,
        high,
        total: openFlags.length,
      },
      recent_suspensions: recentSuspensions,
      rate_limit_violations_24h: rateLimitViolations,
    };
  },
});
