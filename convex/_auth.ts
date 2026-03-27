import type { UserIdentity } from "convex/server";
import { nowIso as sharedNowIso } from "../packages/shared/src/runtime.js";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { components } from "./_generated/api";
import { auditActionIdField } from "./audit_shared";
import {
  AUDIT_ACTOR_TYPE,
  USER_ROLES,
  WORKSPACE_STATUS,
  type AuditEventType,
  type UserRole,
} from "./domain_constants";

export type Role = UserRole;
export type BaseCtx = QueryCtx | MutationCtx;

export type BetterAuthUser = {
  id: string;
  name: string;
  email: string;
} | null;

type BetterAuthMembership = {
  id: string;
  role: Role;
  createdAt: number;
} | null;

type AuthContext = {
  identity: UserIdentity;
  userId: string;
  orgId: string;
  role: Role;
  user: BetterAuthUser;
};

type AuthOptions = {
  includeUser?: boolean;
};

const roleSet = new Set<Role>(USER_ROLES);

const readClaim = (identity: UserIdentity, keys: string[]): string | null => {
  const raw = identity as Record<string, unknown>;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

export const isRole = (value: string | null): value is Role => {
  if (!value) {
    return false;
  }
  return roleSet.has(value as Role);
};

const resolveOrgId = async (ctx: BaseCtx, identity: UserIdentity): Promise<string | null> => {
  const claimOrgId = getIdentityOrgId(identity);
  if (claimOrgId) {
    return claimOrgId;
  }

  const firstMember = await ctx.runQuery(components.betterAuth.queries.getFirstMemberForUser, {
    userId: identity.subject,
  });
  return firstMember?.orgId ?? null;
};

export const getMembership = async (
  ctx: BaseCtx,
  orgId: string,
  userId: string,
): Promise<BetterAuthMembership> => {
  const member = await ctx.runQuery(components.betterAuth.queries.getMemberByOrgAndUser, {
    orgId,
    userId,
  });
  if (!member || !isRole(member.role)) {
    return null;
  }
  return {
    id: member.id,
    role: member.role,
    createdAt: member.createdAt,
  };
};

const getMemberRole = async (ctx: BaseCtx, orgId: string, userId: string): Promise<Role | null> => {
  return (await getMembership(ctx, orgId, userId))?.role ?? null;
};

const ensureOrgNotSuspended = async (ctx: BaseCtx, orgId: string): Promise<void> => {
  const suspensions = await ctx.db
    .query("org_suspensions")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .collect();

  const active = suspensions.find((entry) => entry.lifted_at === null);
  if (active) {
    throw new Error("OrgSuspended");
  }
};

export const getUser = async (ctx: BaseCtx, userId: string): Promise<BetterAuthUser> => {
  const user = await ctx.runQuery(components.betterAuth.queries.getUserById, {
    userId,
  });
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
};

export const getIdentityOrgId = (identity: UserIdentity): string | null => {
  return readClaim(identity, [
    "activeOrganizationId",
    "organizationId",
    "organization_id",
    "org_id",
  ]);
};

export const requireIdentity = async (ctx: BaseCtx): Promise<UserIdentity> => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }
  return identity;
};

export const requireOrgMember = async (
  ctx: BaseCtx,
  allowedRoles: readonly Role[] = USER_ROLES,
  options?: AuthOptions,
): Promise<AuthContext> => {
  const identity = await requireIdentity(ctx);
  const orgId = await resolveOrgId(ctx, identity);
  if (!orgId) {
    throw new Error("Forbidden");
  }

  const role = await getMemberRole(ctx, orgId, identity.subject);
  if (!role || !allowedRoles.includes(role)) {
    throw new Error("Forbidden");
  }
  await ensureOrgNotSuspended(ctx, orgId);

  return {
    identity,
    userId: identity.subject,
    orgId,
    role,
    user: options?.includeUser === false ? null : await getUser(ctx, identity.subject),
  };
};

export const requireWorkspaceRole = async (
  ctx: BaseCtx,
  workspaceId: string,
  allowedRoles: readonly Role[] = USER_ROLES,
  options?: AuthOptions,
): Promise<AuthContext & { workspace: Doc<"workspaces"> }> => {
  const identity = await requireIdentity(ctx);

  const workspace = await ctx.db
    .query("workspaces")
    .withIndex("by_custom_id", (q) => q.eq("id", workspaceId))
    .unique();

  if (!workspace || workspace.status !== WORKSPACE_STATUS.active) {
    throw new Error("Forbidden");
  }

  const role = await getMemberRole(ctx, workspace.org_id, identity.subject);
  if (!role || !allowedRoles.includes(role)) {
    throw new Error("Forbidden");
  }
  await ensureOrgNotSuspended(ctx, workspace.org_id);

  return {
    identity,
    userId: identity.subject,
    orgId: workspace.org_id,
    role,
    user: options?.includeUser === false ? null : await getUser(ctx, identity.subject),
    workspace,
  };
};

export const getWorkspaceForMember = async (
  ctx: BaseCtx,
  workspaceId: string,
): Promise<(AuthContext & { workspace: Doc<"workspaces"> }) | null> => {
  const identity = await requireIdentity(ctx);
  const workspace = await ctx.db
    .query("workspaces")
    .withIndex("by_custom_id", (q) => q.eq("id", workspaceId))
    .unique();

  if (!workspace) {
    return null;
  }

  const role = await getMemberRole(ctx, workspace.org_id, identity.subject);
  if (!role) {
    return null;
  }
  await ensureOrgNotSuspended(ctx, workspace.org_id);

  return {
    identity,
    userId: identity.subject,
    orgId: workspace.org_id,
    role,
    user: await getUser(ctx, identity.subject),
    workspace,
  };
};

export const hasFeatureAccess = async (
  ctx: BaseCtx,
  orgId: string,
  featureKey: string,
): Promise<boolean> => {
  const dogfoodOrg = await ctx.db
    .query("dogfood_orgs")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .unique();
  if (!dogfoodOrg) {
    return false;
  }

  const flag = await ctx.db
    .query("feature_flags")
    .withIndex("by_key", (q) => q.eq("key", featureKey))
    .unique();
  return flag?.enabled === true;
};

export const randomIdFor = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

export const nowIso = sharedNowIso;

export const sha256Hex = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const deterministicIdFor = async (prefix: string, seed: string): Promise<string> => {
  const digest = await sha256Hex(seed);
  return `${prefix}_${digest.slice(0, 24)}`;
};

export const insertAudit = async (
  ctx: MutationCtx,
  orgId: string,
  actorId: string,
  eventType: AuditEventType,
  payload: Record<string, unknown>,
): Promise<void> => {
  await ctx.db.insert("audit_events", {
    id: randomIdFor("audit"),
    org_id: orgId,
    ...auditActionIdField(payload),
    actor_type: AUDIT_ACTOR_TYPE.user,
    actor_id: actorId,
    event_type: eventType,
    payload,
    created_at: nowIso(),
  });
};
