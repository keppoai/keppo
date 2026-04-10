import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import {
  getWorkspaceForMember,
  nowIso,
  randomIdFor,
  requireOrgMember,
  requireWorkspaceRole,
} from "./_auth";
import {
  defaultActionBehaviorValidator,
  policyModeValidator,
  providerValidator,
  requireBoundedString,
  roleValidator,
} from "./validators";
import { pickFields } from "./field_mapper";
import type { ProviderId } from "./provider_ids";
import {
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  CREDENTIAL_TYPE,
  type AuditEventType,
  USER_ROLE,
  WORKSPACE_STATUS,
} from "./domain_constants";
import { isKeppoToken, validateTokenEntropy } from "./credential_utils";
import { getTierConfig } from "../packages/shared/src/subscriptions.js";
import {
  getWorkspaceSlug,
  normalizeWorkspaceSlug,
  slugifyWorkspaceName,
  workspaceValidator,
  toWorkspaceView,
} from "./workspaces_shared";
import { enforceRateLimit } from "./rate_limit_helpers";

const WORKSPACE_LIST_BUDGET = 200;
const WORKSPACE_LOOKUP_SCAN_BUDGET = 200;
const WORKSPACE_MUTATION_SCAN_BUDGET = 200;
const WORKSPACE_INTEGRATION_SCAN_BUDGET = 200;
const WORKSPACE_CREATE_RATE_LIMIT = {
  limit: 10,
  windowMs: 15 * 60 * 1_000,
} as const;
const WORKSPACE_NAME_MAX_LENGTH = 80;
const refs = {
  getBillingContextForOrg: makeFunctionReference<"query">("billing:getBillingContextForOrg"),
  setWorkspaceCountForOrg: makeFunctionReference<"mutation">("billing:setWorkspaceCountForOrg"),
};

const resolveWorkspaceCountScanLimit = (maxWorkspaces: number): number =>
  Number.isFinite(maxWorkspaces)
    ? Math.max(WORKSPACE_MUTATION_SCAN_BUDGET, Math.floor(maxWorkspaces) + 1)
    : WORKSPACE_MUTATION_SCAN_BUDGET;

const workspaceIntegrationValidator = v.object({
  id: v.string(),
  workspace_id: v.string(),
  provider: providerValidator,
  enabled: v.boolean(),
  created_by: v.string(),
  created_at: v.string(),
});

type WorkspaceIntegrationView = {
  id: string;
  workspace_id: string;
  provider: ProviderId;
  enabled: boolean;
  created_by: string;
  created_at: string;
};

const workspaceIntegrationViewFields = [
  "id",
  "workspace_id",
  "provider",
  "enabled",
  "created_by",
  "created_at",
] as const satisfies readonly (keyof WorkspaceIntegrationView)[];

const toWorkspaceIntegration = (row: WorkspaceIntegrationView) =>
  pickFields(row, workspaceIntegrationViewFields);

const buildUniqueWorkspaceSlug = async (
  ctx: MutationCtx,
  orgId: string,
  value: string,
): Promise<string> => {
  const baseSlug = normalizeWorkspaceSlug(value);
  const existing = await ctx.db
    .query("workspaces")
    .withIndex("by_org_slug", (q) => q.eq("org_id", orgId).eq("slug", baseSlug))
    .unique();
  if (!existing) {
    return baseSlug;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = randomIdFor("slug")
      .replace(/^slug_/, "")
      .slice(0, 4);
    const candidate = normalizeWorkspaceSlug(`${baseSlug}-${suffix}`);
    const collision = await ctx.db
      .query("workspaces")
      .withIndex("by_org_slug", (q) => q.eq("org_id", orgId).eq("slug", candidate))
      .unique();
    if (!collision) {
      return candidate;
    }
  }

  throw new Error("workspace.slug_conflict: Failed to generate a unique workspace slug.");
};

const sha256Hex = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const buildCredentialSecret = (): string => {
  const token = `keppo_${randomIdFor("secret")}_${randomIdFor("secret")}`;
  if (!isKeppoToken(token) || !validateTokenEntropy(token)) {
    throw new Error("Generated credential token failed entropy validation");
  }
  return token;
};

const listActiveWorkspacesForOrg = async (ctx: QueryCtx | MutationCtx, orgId: string) =>
  await ctx.db
    .query("workspaces")
    .withIndex("by_org_status", (q) => q.eq("org_id", orgId).eq("status", WORKSPACE_STATUS.active))
    .collect();

const insertAudit = async (
  ctx: MutationCtx,
  orgId: string,
  actorId: string,
  eventType: AuditEventType,
  payload: Record<string, unknown>,
): Promise<void> => {
  await ctx.db.insert("audit_events", {
    id: randomIdFor("audit"),
    org_id: orgId,
    actor_type: AUDIT_ACTOR_TYPE.user,
    actor_id: actorId,
    event_type: eventType,
    payload,
    created_at: nowIso(),
  });
};

export const bootstrapIdentity = mutation({
  args: {},
  returns: v.object({
    org_id: v.string(),
    role: roleValidator,
    user_id: v.string(),
    email: v.string(),
  }),
  handler: async (ctx) => {
    const auth = await requireOrgMember(ctx);
    return {
      org_id: auth.orgId,
      role: auth.role,
      user_id: auth.userId,
      email: auth.user?.email ?? "unknown@example.com",
    };
  },
});

export const currentViewer = query({
  args: {},
  returns: v.union(
    v.object({
      org_id: v.string(),
      org_slug: v.string(),
      role: roleValidator,
      user_id: v.string(),
      email: v.string(),
      name: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    try {
      const auth = await requireOrgMember(ctx);
      const org = await ctx.runQuery(components.betterAuth.queries.getOrgById, {
        orgId: auth.orgId,
      });
      if (!org?.slug) {
        throw new Error("Forbidden");
      }
      return {
        org_id: auth.orgId,
        org_slug: org.slug,
        role: auth.role,
        user_id: auth.userId,
        email: auth.user?.email ?? `${auth.userId}@unknown.example`,
        name: auth.user?.name ?? "Keppo User",
      };
    } catch {
      return null;
    }
  },
});

export const listForCurrentOrg = query({
  args: {},
  returns: v.array(workspaceValidator),
  handler: async (ctx) => {
    const auth = await requireOrgMember(ctx);
    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_org_status", (q) =>
        q.eq("org_id", auth.orgId).eq("status", WORKSPACE_STATUS.active),
      )
      .take(WORKSPACE_LIST_BUDGET);
    return workspaces.map(toWorkspaceView);
  },
});

export const getById = query({
  args: { workspaceId: v.string() },
  returns: v.union(workspaceValidator, v.null()),
  handler: async (ctx, args) => {
    const auth = await getWorkspaceForMember(ctx, args.workspaceId);
    if (!auth || auth.workspace.status !== WORKSPACE_STATUS.active) {
      return null;
    }
    return toWorkspaceView(auth.workspace);
  },
});

export const getCredentialStatus = query({
  args: { workspaceId: v.string() },
  returns: v.object({
    has_active_credential: v.boolean(),
    last_rotated_at: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId);
    const credentials = await ctx.db
      .query("workspace_credentials")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .collect();
    const activeCredentials = credentials.filter((credential) => credential.revoked_at === null);
    return {
      has_active_credential: activeCredentials.length > 0,
      last_rotated_at:
        activeCredentials
          .map((credential) => credential.created_at)
          .sort((left, right) => right.localeCompare(left))[0] ?? null,
    };
  },
});

export const getByOrgSlug = query({
  args: { orgId: v.string(), slug: v.string() },
  returns: v.union(workspaceValidator, v.null()),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx);
    if (auth.orgId !== args.orgId) {
      throw new Error("Forbidden");
    }

    const normalizedSlug = normalizeWorkspaceSlug(args.slug);
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_org_slug", (q) => q.eq("org_id", args.orgId).eq("slug", normalizedSlug))
      .unique();
    if (workspace?.status === WORKSPACE_STATUS.active) {
      return toWorkspaceView(workspace);
    }

    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_org_status", (q) =>
        q.eq("org_id", args.orgId).eq("status", WORKSPACE_STATUS.active),
      )
      .take(WORKSPACE_LOOKUP_SCAN_BUDGET);
    const fallback = workspaces.find((row) => getWorkspaceSlug(row) === normalizedSlug) ?? null;
    return fallback ? toWorkspaceView(fallback) : null;
  },
});

export const createWorkspace = mutation({
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    policy_mode: policyModeValidator,
    default_action_behavior: defaultActionBehaviorValidator,
  },
  returns: v.object({
    workspace: workspaceValidator,
    credential_secret: v.string(),
  }),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [USER_ROLE.owner, USER_ROLE.admin]);
    const workspaceName = requireBoundedString(args.name, {
      field: "name",
      maxLength: WORKSPACE_NAME_MAX_LENGTH,
    });
    const requestedSlug =
      args.slug === undefined
        ? undefined
        : requireBoundedString(args.slug, {
            field: "slug",
            maxLength: 64,
          });
    await enforceRateLimit(ctx, {
      key: `workspace-create:${auth.orgId}`,
      limit: WORKSPACE_CREATE_RATE_LIMIT.limit,
      windowMs: WORKSPACE_CREATE_RATE_LIMIT.windowMs,
      message: "Too many workspace creations.",
    });
    const billing = await ctx.runQuery(refs.getBillingContextForOrg, {
      orgId: auth.orgId,
    });
    const tier = billing.effective_tier;
    const tierConfig = getTierConfig(tier);
    const workspaceCountScanLimit = resolveWorkspaceCountScanLimit(tierConfig.max_workspaces);
    const createdAt = nowIso();
    const workspaceCount =
      typeof billing.workspace_count === "number"
        ? billing.workspace_count
        : (
            await ctx.db
              .query("workspaces")
              .withIndex("by_org", (q) => q.eq("org_id", auth.orgId))
              .take(workspaceCountScanLimit)
          ).length;
    if (workspaceCount >= tierConfig.max_workspaces) {
      throw new ConvexError({
        code: "WORKSPACE_LIMIT_REACHED",
        current_count: workspaceCount,
        max_count: tierConfig.max_workspaces,
        tier,
      });
    }

    const workspaceId = randomIdFor("workspace");
    const workspaceSlug = await buildUniqueWorkspaceSlug(
      ctx,
      auth.orgId,
      requestedSlug ?? slugifyWorkspaceName(workspaceName),
    );

    await ctx.db.insert("workspaces", {
      id: workspaceId,
      org_id: auth.orgId,
      slug: workspaceSlug,
      name: workspaceName,
      status: WORKSPACE_STATUS.active,
      policy_mode: args.policy_mode,
      default_action_behavior: args.default_action_behavior,
      code_mode_enabled: true,
      automation_count: 0,
      created_at: createdAt,
    });

    const credentialSecret = buildCredentialSecret();
    const credentialId = randomIdFor("hcred");
    await ctx.db.insert("workspace_credentials", {
      id: credentialId,
      workspace_id: workspaceId,
      type: CREDENTIAL_TYPE.bearerToken,
      hashed_secret: await sha256Hex(credentialSecret),
      last_used_at: null,
      revoked_at: null,
      created_at: createdAt,
    });

    await insertAudit(ctx, auth.orgId, "api", "workspace.created", {
      workspace_id: workspaceId,
      name: workspaceName,
    });
    await insertAudit(ctx, auth.orgId, "api", "workspace.credential_rotated", {
      workspace_id: workspaceId,
      credential_id: credentialId,
    });
    await ctx.runMutation(refs.setWorkspaceCountForOrg, {
      orgId: auth.orgId,
      workspaceCount: workspaceCount + 1,
    });

    return {
      workspace: {
        id: workspaceId,
        org_id: auth.orgId,
        slug: workspaceSlug,
        name: workspaceName,
        status: WORKSPACE_STATUS.active,
        policy_mode: args.policy_mode,
        default_action_behavior: args.default_action_behavior,
        code_mode_enabled: true,
        created_at: createdAt,
      },
      credential_secret: credentialSecret,
    };
  },
});

export const backfillWorkspaceSlugs = mutation({
  args: {},
  returns: v.object({ updated: v.number() }),
  handler: async (ctx) => {
    const auth = await requireOrgMember(ctx, [USER_ROLE.owner, USER_ROLE.admin]);
    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_org", (q) => q.eq("org_id", auth.orgId))
      .take(WORKSPACE_MUTATION_SCAN_BUDGET);

    let updated = 0;
    for (const workspace of workspaces) {
      if (typeof workspace.slug === "string" && workspace.slug.trim().length > 0) {
        continue;
      }
      const slug = await buildUniqueWorkspaceSlug(ctx, auth.orgId, workspace.name);
      await ctx.db.patch(workspace._id, { slug });
      updated += 1;
    }

    return { updated };
  },
});

export const rotateWorkspaceCredential = mutation({
  args: { workspaceId: v.string() },
  returns: v.object({ credential_secret: v.string() }),
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);

    const credentials = await ctx.db
      .query("workspace_credentials")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .take(WORKSPACE_MUTATION_SCAN_BUDGET);

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
      type: CREDENTIAL_TYPE.bearerToken,
      hashed_secret: await sha256Hex(secret),
      last_used_at: null,
      revoked_at: null,
      created_at: nowIso(),
    });

    await insertAudit(ctx, auth.orgId, "api", "workspace.credential_rotated", {
      workspace_id: args.workspaceId,
      credential_id: credentialId,
    });

    return { credential_secret: secret };
  },
});

export const deleteWorkspace = mutation({
  args: { workspaceId: v.string() },
  returns: v.object({
    workspaceId: v.string(),
    nextWorkspaceId: v.union(v.string(), v.null()),
    nextWorkspaceSlug: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);

    const activeWorkspaces = await listActiveWorkspacesForOrg(ctx, auth.orgId);
    if (activeWorkspaces.length <= 1) {
      throw new Error("Cannot delete the last workspace.");
    }

    const nextWorkspace =
      activeWorkspaces.find((workspace) => workspace.id !== args.workspaceId) ?? null;
    const revokedAt = nowIso();
    const credentials = await ctx.db
      .query("workspace_credentials")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .take(WORKSPACE_MUTATION_SCAN_BUDGET);

    for (const credential of credentials) {
      if (credential.revoked_at === null) {
        await ctx.db.patch(credential._id, { revoked_at: revokedAt });
      }
    }

    await ctx.db.patch(auth.workspace._id, {
      status: WORKSPACE_STATUS.disabled,
    });

    await ctx.runMutation(refs.setWorkspaceCountForOrg, {
      orgId: auth.orgId,
      workspaceCount: Math.max(0, activeWorkspaces.length - 1),
    });

    await insertAudit(ctx, auth.orgId, auth.userId, AUDIT_EVENT_TYPES.workspaceDeleted, {
      workspace_id: args.workspaceId,
      previous_status: auth.workspace.status,
    });

    return {
      workspaceId: args.workspaceId,
      nextWorkspaceId: nextWorkspace?.id ?? null,
      nextWorkspaceSlug: nextWorkspace ? getWorkspaceSlug(nextWorkspace) : null,
    };
  },
});

export const issueAutomationWorkspaceCredential = internalMutation({
  args: {
    workspaceId: v.string(),
    automationRunId: v.optional(v.string()),
  },
  returns: v.object({ credential_secret: v.string() }),
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .unique();
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const secret = buildCredentialSecret();
    const credentialId = randomIdFor("hcred");

    await ctx.db.insert("workspace_credentials", {
      id: credentialId,
      workspace_id: args.workspaceId,
      type: CREDENTIAL_TYPE.bearerToken,
      hashed_secret: await sha256Hex(secret),
      ...(args.automationRunId
        ? {
            metadata: {
              source: "automation_dispatch",
              automation_run_id: args.automationRunId,
            },
          }
        : {}),
      last_used_at: null,
      revoked_at: null,
      created_at: nowIso(),
    });

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: workspace.org_id,
      actor_type: AUDIT_ACTOR_TYPE.system,
      actor_id: "automation_dispatch",
      event_type: AUDIT_EVENT_TYPES.workspaceCredentialRotated,
      payload: {
        workspace_id: args.workspaceId,
        credential_id: credentialId,
        source: "automation_dispatch",
      },
      created_at: nowIso(),
    });

    return { credential_secret: secret };
  },
});

export const setWorkspacePolicyMode = mutation({
  args: {
    workspaceId: v.string(),
    policy_mode: policyModeValidator,
  },
  returns: workspaceValidator,
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);

    await ctx.db.patch(auth.workspace._id, {
      policy_mode: args.policy_mode,
    });

    await insertAudit(ctx, auth.orgId, auth.userId, AUDIT_EVENT_TYPES.workspacePolicyModeUpdated, {
      workspace_id: args.workspaceId,
      policy_mode: args.policy_mode,
    });

    const updated = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .unique();

    if (!updated) {
      throw new Error("Workspace not found");
    }

    return toWorkspaceView(updated);
  },
});

export const setWorkspaceCodeMode = mutation({
  args: {
    workspaceId: v.string(),
    code_mode_enabled: v.boolean(),
  },
  returns: workspaceValidator,
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);

    await ctx.db.patch(auth.workspace._id, {
      code_mode_enabled: args.code_mode_enabled,
    });

    await insertAudit(ctx, auth.orgId, auth.userId, AUDIT_EVENT_TYPES.workspaceCodeModeUpdated, {
      workspace_id: args.workspaceId,
      code_mode_enabled: args.code_mode_enabled,
    });

    const updated = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .unique();

    if (!updated) {
      throw new Error("Workspace not found");
    }

    return toWorkspaceView(updated);
  },
});

export const listWorkspaceIntegrations = query({
  args: { workspaceId: v.string() },
  returns: v.array(workspaceIntegrationValidator),
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("workspace_integrations")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .take(WORKSPACE_INTEGRATION_SCAN_BUDGET);
    return rows.map(toWorkspaceIntegration);
  },
});

export const setWorkspaceIntegrations = mutation({
  args: {
    workspaceId: v.string(),
    providers: v.array(providerValidator),
  },
  returns: v.array(workspaceIntegrationValidator),
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);
    const requested = new Set(args.providers);

    const existing = await ctx.db
      .query("workspace_integrations")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .take(WORKSPACE_INTEGRATION_SCAN_BUDGET);

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
        created_by: auth.userId,
        created_at: nowIso(),
      });
    }

    await insertAudit(ctx, auth.orgId, auth.userId, "workspace.integrations_updated", {
      workspace_id: args.workspaceId,
      providers: args.providers,
    });

    const rows = await ctx.db
      .query("workspace_integrations")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .take(WORKSPACE_INTEGRATION_SCAN_BUDGET);
    return rows.map(toWorkspaceIntegration);
  },
});
