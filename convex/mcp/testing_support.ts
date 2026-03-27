import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { components } from "../_generated/api";
import { isKeppoToken, validateTokenEntropy } from "../credential_utils";
import { nowIso, randomIdFor } from "../_auth";
import {
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
  WORKSPACE_STATUS,
} from "../domain_constants";
import { safeRunMutation, safeRunQuery } from "../safe_convex";
import {
  defaultActionBehaviorValidator,
  jsonRecordValidator,
  notificationEndpointTypeValidator,
  policyModeValidator,
  providerValidator,
} from "../validators";
import {
  getWorkspaceSlug,
  slugifyWorkspaceName,
  toWorkspaceBoundary,
  workspaceValidator,
} from "../workspaces_shared";
import { getDefaultBillingPeriod, subscriptionIdForOrg } from "../billing/shared";
import { requireE2EIdentity } from "../e2e_shared";
import { actionValidator } from "./shared";

const sha256Hex = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const buildCredentialSecret = (): string => {
  const token = `keppo_${randomIdFor("secret")}_${randomIdFor("secret")}`;
  if (!isKeppoToken(token) || !validateTokenEntropy(token)) {
    throw new Error("Generated credential token failed entropy validation");
  }
  return token;
};

const isTruthyEnvFlag = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const ensureWorkspaceCredential = async (
  ctx: MutationCtx,
  workspaceId: string,
  orgId: string,
): Promise<void> => {
  const existingCredentials = await ctx.db
    .query("workspace_credentials")
    .withIndex("by_workspace", (q) => q.eq("workspace_id", workspaceId))
    .collect();
  if (existingCredentials.some((credential) => credential.revoked_at === null)) {
    return;
  }

  const secret = buildCredentialSecret();
  const credentialId = randomIdFor("hcred");
  await ctx.db.insert("workspace_credentials", {
    id: credentialId,
    workspace_id: workspaceId,
    type: "bearer_token",
    hashed_secret: await sha256Hex(secret),
    last_used_at: null,
    revoked_at: null,
    created_at: nowIso(),
  });
  await ctx.db.insert("audit_events", {
    id: randomIdFor("audit"),
    org_id: orgId,
    actor_type: AUDIT_ACTOR_TYPE.user,
    actor_id: "api",
    event_type: AUDIT_EVENT_TYPES.workspaceCredentialRotated,
    payload: { workspace_id: workspaceId, credential_id: credentialId },
    created_at: nowIso(),
  });
};

export const setWorkspaceIntegrationsForTesting = internalMutation({
  args: {
    workspaceId: v.string(),
    providers: v.array(providerValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .unique();
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const requested = new Set(args.providers);
    const existing = await ctx.db
      .query("workspace_integrations")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .collect();

    for (const row of existing) {
      const shouldEnable = requested.has(row.provider);
      if (row.enabled !== shouldEnable) {
        await ctx.db.patch(row._id, { enabled: shouldEnable });
      }
    }

    const existingByProvider = new Set(existing.map((row) => row.provider));
    for (const provider of requested) {
      if (existingByProvider.has(provider)) {
        continue;
      }
      await ctx.db.insert("workspace_integrations", {
        id: randomIdFor("hint"),
        workspace_id: args.workspaceId,
        provider,
        enabled: true,
        created_by: "api",
        created_at: nowIso(),
      });
    }

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: workspace.org_id,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: "api",
      event_type: AUDIT_EVENT_TYPES.workspaceIntegrationsUpdated,
      payload: {
        workspace_id: args.workspaceId,
        providers: args.providers,
      },
      created_at: nowIso(),
    });

    return null;
  },
});

export const rotateWorkspaceCredentialForTesting = internalMutation({
  args: {
    workspaceId: v.string(),
  },
  returns: v.object({
    credential_id: v.string(),
    secret: v.string(),
  }),
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .unique();
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const credentials = await ctx.db
      .query("workspace_credentials")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .collect();

    for (const credential of credentials) {
      if (credential.revoked_at === null) {
        await ctx.db.patch(credential._id, { revoked_at: nowIso() });
      }
    }

    const secret = buildCredentialSecret();
    const credentialId = randomIdFor("hcred");
    await ctx.db.insert("workspace_credentials", {
      id: credentialId,
      workspace_id: args.workspaceId,
      type: "bearer_token",
      hashed_secret: await sha256Hex(secret),
      last_used_at: null,
      revoked_at: null,
      created_at: nowIso(),
    });

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: workspace.org_id,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: "api",
      event_type: AUDIT_EVENT_TYPES.workspaceCredentialRotated,
      payload: { workspace_id: args.workspaceId, credential_id: credentialId },
      created_at: nowIso(),
    });

    return {
      credential_id: credentialId,
      secret,
    };
  },
});

export const seedUserOrg = internalMutation({
  args: {
    userId: v.string(),
    email: v.string(),
    name: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const existingUser = (await safeRunQuery("mcp.seedUserOrg.findUserByEmail", () =>
      ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: args.email }],
      }),
    )) as { _id: string; email: string; name: string } | null;

    let userId = existingUser?._id ?? null;
    if (!userId) {
      const createdUser = (await safeRunMutation("mcp.seedUserOrg.createUser", () =>
        ctx.runMutation(components.betterAuth.adapter.create, {
          input: {
            model: "user",
            data: {
              name: args.name,
              email: args.email,
              emailVerified: true,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              image: null,
              userId: args.userId,
            },
          },
        }),
      )) as { _id: string };
      userId = createdUser._id;
    }
    if (!userId) {
      throw new Error("Failed to resolve user id for seedUserOrg.");
    }

    const memberResult = (await safeRunQuery("mcp.seedUserOrg.findMemberByUser", () =>
      ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "member",
        where: [{ field: "userId", value: userId }],
        paginationOpts: { numItems: 20, cursor: null },
      }),
    )) as { page: Array<{ _id: string; organizationId: string }>; isDone: boolean };

    let orgId = memberResult.page[0]?.organizationId ?? null;
    if (!orgId) {
      const slugBase = args.email
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      const createdOrg = (await safeRunMutation("mcp.seedUserOrg.createOrg", () =>
        ctx.runMutation(components.betterAuth.adapter.create, {
          input: {
            model: "organization",
            data: {
              name: `${args.name} Org`,
              slug: `${slugBase || "org"}-${Math.random().toString(16).slice(2, 8)}`,
              createdAt: Date.now(),
              logo: null,
              metadata: null,
            },
          },
        }),
      )) as { _id: string };
      const createdOrgId = createdOrg._id;
      orgId = createdOrgId;
      await safeRunMutation("mcp.seedUserOrg.createMember", () =>
        ctx.runMutation(components.betterAuth.adapter.create, {
          input: {
            model: "member",
            data: {
              organizationId: createdOrgId,
              userId,
              role: "owner",
              createdAt: Date.now(),
            },
          },
        }),
      );
    }
    if (!orgId) {
      throw new Error("Failed to resolve organization id for seedUserOrg.");
    }

    await safeRunMutation("mcp.seedUserOrg.updateSessions", () =>
      ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: "session",
          where: [{ field: "userId", value: userId }],
          update: {
            activeOrganizationId: orgId,
            updatedAt: Date.now(),
          },
        },
        paginationOpts: {
          numItems: 200,
          cursor: null,
        },
      }),
    );

    const retention = await ctx.db
      .query("retention_policies")
      .withIndex("by_org", (q) => q.eq("org_id", orgId))
      .first();
    if (!retention) {
      await ctx.db.insert("retention_policies", {
        id: randomIdFor("ret"),
        org_id: orgId,
        raw_tool_io_retention_days: null,
        action_payload_retention_days: 30,
        audit_retention_days: null,
        updated_by: userId,
        updated_at: nowIso(),
      });
    }

    const existingWorkspace = await ctx.db
      .query("workspaces")
      .withIndex("by_org", (q) => q.eq("org_id", orgId))
      .first();
    if (!existingWorkspace) {
      const workspaceId = randomIdFor("workspace");
      const createdAt = nowIso();
      const period = getDefaultBillingPeriod(new Date());
      await ctx.db.insert("workspaces", {
        id: workspaceId,
        org_id: orgId,
        slug: slugifyWorkspaceName("Default Workspace"),
        name: "Default Workspace",
        status: WORKSPACE_STATUS.active,
        policy_mode: "manual_only",
        default_action_behavior: "require_approval",
        code_mode_enabled: true,
        created_at: createdAt,
      });
      await ctx.db.insert("audit_events", {
        id: randomIdFor("audit"),
        org_id: orgId,
        actor_type: AUDIT_ACTOR_TYPE.user,
        actor_id: "api",
        event_type: AUDIT_EVENT_TYPES.workspaceCreated,
        payload: { workspace_id: workspaceId, name: "Default Workspace" },
        created_at: createdAt,
      });
      const subscriptionId = await subscriptionIdForOrg(orgId);
      const existingSubscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_custom_id", (q) => q.eq("id", subscriptionId))
        .first();
      if (!existingSubscription) {
        await ctx.db.insert("subscriptions", {
          id: subscriptionId,
          org_id: orgId,
          tier: SUBSCRIPTION_TIER.free,
          status: SUBSCRIPTION_STATUS.active,
          stripe_customer_id: null,
          stripe_subscription_id: null,
          workspace_count: 1,
          current_period_start: period.periodStart,
          current_period_end: period.periodEnd,
          created_at: createdAt,
          updated_at: createdAt,
        });
      }
      await ensureWorkspaceCredential(ctx, workspaceId, orgId);
    } else {
      await ensureWorkspaceCredential(ctx, existingWorkspace.id, orgId);
    }

    return orgId;
  },
});

export const createWorkspaceForOrg = internalMutation({
  args: {
    orgId: v.string(),
    name: v.string(),
    policyMode: policyModeValidator,
    defaultActionBehavior: defaultActionBehaviorValidator,
  },
  returns: workspaceValidator,
  handler: async (ctx, args) => {
    const id = randomIdFor("workspace");
    const createdAt = nowIso();
    await ctx.db.insert("workspaces", {
      id,
      org_id: args.orgId,
      slug: slugifyWorkspaceName(args.name),
      name: args.name,
      status: WORKSPACE_STATUS.active,
      policy_mode: args.policyMode,
      default_action_behavior: args.defaultActionBehavior,
      code_mode_enabled: true,
      created_at: createdAt,
    });
    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: args.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: "api",
      event_type: AUDIT_EVENT_TYPES.workspaceCreated,
      payload: { workspace_id: id, name: args.name },
      created_at: createdAt,
    });
    return {
      id,
      org_id: args.orgId,
      slug: slugifyWorkspaceName(args.name),
      name: args.name,
      status: WORKSPACE_STATUS.active,
      policy_mode: args.policyMode,
      default_action_behavior: args.defaultActionBehavior,
      code_mode_enabled: true,
      created_at: createdAt,
    };
  },
});

const notificationEndpointValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  user_id: v.string(),
  type: notificationEndpointTypeValidator,
  destination: v.string(),
  push_subscription: v.union(v.string(), v.null()),
  notification_preferences: v.optional(v.string()),
  enabled: v.boolean(),
  created_at: v.string(),
});

export const findWorkspaceForOrgForTesting = internalQuery({
  args: {
    orgId: v.string(),
    slug: v.optional(v.string()),
  },
  returns: v.union(workspaceValidator, v.null()),
  handler: async (ctx, args) => {
    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_org", (q) => q.eq("org_id", args.orgId))
      .collect();
    const sortedWorkspaces = [...workspaces].sort((left, right) =>
      left.created_at.localeCompare(right.created_at),
    );
    const workspace =
      args.slug === undefined
        ? (sortedWorkspaces[0] ?? null)
        : (sortedWorkspaces.find((candidate) => getWorkspaceSlug(candidate) === args.slug) ?? null);
    return workspace ? toWorkspaceBoundary(workspace) : null;
  },
});

export const getActionForTesting = internalQuery({
  args: {
    actionId: v.string(),
  },
  returns: v.union(actionValidator, v.null()),
  handler: async (ctx, args) => {
    const action = await ctx.db
      .query("actions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.actionId))
      .unique();
    if (!action) {
      return null;
    }
    return {
      id: action.id,
      automation_run_id: action.automation_run_id,
      tool_call_id: action.tool_call_id,
      action_type: action.action_type,
      risk_level: action.risk_level,
      normalized_payload_enc: action.normalized_payload_enc,
      payload_preview: action.payload_preview,
      payload_purged_at: action.payload_purged_at,
      status: action.status,
      idempotency_key: action.idempotency_key,
      created_at: action.created_at,
      resolved_at: action.resolved_at,
      result_redacted: action.result_redacted,
    };
  },
});

export const findNotificationEndpointForTesting = internalQuery({
  args: {
    orgId: v.string(),
    destination: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    type: v.optional(notificationEndpointTypeValidator),
    userId: v.optional(v.string()),
  },
  returns: v.union(notificationEndpointValidator, v.null()),
  handler: async (ctx, args) => {
    const rows =
      args.userId && args.type
        ? await ctx.db
            .query("notification_endpoints")
            .withIndex("by_org_user_type", (q) =>
              q.eq("org_id", args.orgId).eq("user_id", args.userId!).eq("type", args.type!),
            )
            .order("desc")
            .take(50)
        : args.userId
          ? await ctx.db
              .query("notification_endpoints")
              .withIndex("by_org_user_created", (q) =>
                q.eq("org_id", args.orgId).eq("user_id", args.userId!),
              )
              .order("desc")
              .take(50)
          : args.type
            ? await ctx.db
                .query("notification_endpoints")
                .withIndex("by_org_type", (q) => q.eq("org_id", args.orgId).eq("type", args.type!))
                .order("desc")
                .take(50)
            : await ctx.db
                .query("notification_endpoints")
                .withIndex("by_org", (q) => q.eq("org_id", args.orgId))
                .order("desc")
                .take(50);

    const endpoint =
      rows.find((candidate) => {
        if (args.destination !== undefined && candidate.destination !== args.destination) {
          return false;
        }
        if (args.enabled !== undefined && candidate.enabled !== args.enabled) {
          return false;
        }
        return true;
      }) ?? null;

    if (!endpoint) {
      return null;
    }

    return {
      id: endpoint.id,
      org_id: endpoint.org_id,
      user_id: endpoint.user_id,
      type: endpoint.type,
      destination: endpoint.destination,
      push_subscription: endpoint.push_subscription,
      ...(endpoint.notification_preferences !== undefined
        ? { notification_preferences: endpoint.notification_preferences }
        : {}),
      enabled: endpoint.enabled,
      created_at: endpoint.created_at,
    };
  },
});

const dbSnapshotValidator = v.object({
  subscriptions: v.array(jsonRecordValidator),
  usage_meters: v.array(jsonRecordValidator),
  invite_codes: v.array(jsonRecordValidator),
  invite_code_redemptions: v.array(jsonRecordValidator),
  invites: v.array(jsonRecordValidator),
  workspaces: v.array(jsonRecordValidator),
  workspace_integrations: v.array(jsonRecordValidator),
  code_mode_tool_index: v.array(jsonRecordValidator),
  workspace_credentials: v.array(jsonRecordValidator),
  org_suspensions: v.array(jsonRecordValidator),
  credential_auth_failures: v.array(jsonRecordValidator),
  credential_usage_observations: v.array(jsonRecordValidator),
  abuse_flags: v.array(jsonRecordValidator),
  integrations: v.array(jsonRecordValidator),
  integration_accounts: v.array(jsonRecordValidator),
  integration_credentials: v.array(jsonRecordValidator),
  automation_runs: v.array(jsonRecordValidator),
  tool_calls: v.array(jsonRecordValidator),
  actions: v.array(jsonRecordValidator),
  approvals: v.array(jsonRecordValidator),
  cel_rules: v.array(jsonRecordValidator),
  cel_rule_matches: v.array(jsonRecordValidator),
  tool_auto_approvals: v.array(jsonRecordValidator),
  policies: v.array(jsonRecordValidator),
  policy_decisions: v.array(jsonRecordValidator),
  feature_flags: v.array(jsonRecordValidator),
  dogfood_orgs: v.array(jsonRecordValidator),
  audit_events: v.array(jsonRecordValidator),
  notification_endpoints: v.array(jsonRecordValidator),
  notification_events: v.array(jsonRecordValidator),
  sensitive_blobs: v.array(jsonRecordValidator),
  retention_policies: v.array(jsonRecordValidator),
  poll_trackers: v.array(jsonRecordValidator),
});

const snapshotTableNames = [
  "subscriptions",
  "usage_meters",
  "invite_codes",
  "invite_code_redemptions",
  "invites",
  "workspaces",
  "workspace_integrations",
  "code_mode_tool_index",
  "workspace_credentials",
  "org_suspensions",
  "credential_auth_failures",
  "credential_usage_observations",
  "abuse_flags",
  "integrations",
  "integration_accounts",
  "integration_credentials",
  "automation_runs",
  "tool_calls",
  "actions",
  "approvals",
  "cel_rules",
  "cel_rule_matches",
  "tool_auto_approvals",
  "policies",
  "policy_decisions",
  "feature_flags",
  "dogfood_orgs",
  "audit_events",
  "notification_endpoints",
  "notification_events",
  "sensitive_blobs",
  "retention_policies",
  "poll_trackers",
] as const;

type SnapshotTableName = (typeof snapshotTableNames)[number];
type DbSnapshot = Record<SnapshotTableName, Array<Record<string, unknown>>>;

const stripSystemFields = <TableName extends SnapshotTableName>(
  row: Doc<TableName>,
): Record<string, unknown> => {
  const clone: Record<string, unknown> = { ...row };
  delete clone._id;
  delete clone._creationTime;
  return clone;
};

const loadSnapshotTable = async <TableName extends SnapshotTableName>(
  ctx: QueryCtx,
  table: TableName,
): Promise<Array<Record<string, unknown>>> => {
  // Keep snapshots bounded so large audit/event tables stay within Convex array validator limits.
  const rows = await ctx.db.query(table).take(8_000);
  return rows.map(stripSystemFields);
};

export const getDbSnapshot = internalQuery({
  args: {},
  returns: dbSnapshotValidator,
  handler: async (ctx): Promise<DbSnapshot> => {
    const entries = await Promise.all(
      snapshotTableNames.map(
        async (table) => [table, await loadSnapshotTable(ctx, table)] as const,
      ),
    );
    return Object.fromEntries(entries) as DbSnapshot;
  },
});

export const getAuthOrganizationForTesting = query({
  args: {
    orgId: v.string(),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      name: v.string(),
      slug: v.string(),
      metadata: v.union(v.string(), v.null()),
      createdAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (_ctx, args) => {
    await requireE2EIdentity(_ctx);
    const organization = (await safeRunQuery("mcp.getAuthOrganizationForTesting.findOrg", () =>
      _ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "organization",
        where: [{ field: "_id", value: args.orgId }],
      }),
    )) as {
      _id: string;
      name: string;
      slug: string;
      metadata?: string | null;
      createdAt: number;
    } | null;

    if (!organization) {
      return null;
    }

    return {
      id: String(organization._id),
      name: String(organization.name),
      slug: String(organization.slug),
      metadata:
        typeof organization.metadata === "string"
          ? organization.metadata
          : (organization.metadata ?? null),
      createdAt: Number(organization.createdAt),
    };
  },
});

export const getAuthUserForTesting = query({
  args: {
    email: v.string(),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      email: v.string(),
      name: v.string(),
    }),
    v.null(),
  ),
  handler: async (_ctx, args) => {
    await requireE2EIdentity(_ctx);
    const user = (await safeRunQuery("mcp.getAuthUserForTesting.findUser", () =>
      _ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: args.email }],
      }),
    )) as {
      _id: string;
      email: string;
      name: string;
    } | null;

    if (!user) {
      return null;
    }

    return {
      id: String(user._id),
      email: String(user.email),
      name: String(user.name),
    };
  },
});
