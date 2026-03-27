import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { components } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { getTierConfig, isMemberLimitReached } from "../packages/shared/src/subscriptions.js";
import {
  AUDIT_EVENT_TYPES,
  INVITE_STATUS,
  SUBSCRIPTION_TIER,
  type SubscriptionTier,
  USER_ROLE,
} from "./domain_constants";
import {
  getMembership,
  getUser,
  isRole,
  insertAudit,
  nowIso,
  randomIdFor,
  requireIdentity,
  requireOrgMember,
  sha256Hex,
  type BaseCtx,
  type Role,
} from "./_auth";
import {
  inviteStatusValidator,
  requireBoundedEmail,
  roleValidator,
  subscriptionTierValidator,
} from "./validators";
import { enforceRateLimit } from "./rate_limit_helpers";

type BetterAuthMember = {
  id: string;
  userId: string;
  role: Role;
  createdAt: number;
};

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const EXPIRED_INVITE_SCAN_BUDGET = 1_000;
const INVITE_SCAN_BUDGET = 200;
const INVITE_EMAIL_MAX_LENGTH = 320;
const INVITE_CREATE_RATE_LIMIT = {
  limit: 20,
  windowMs: 60 * 60 * 1_000,
} as const;

const inviteValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  email: v.string(),
  role: roleValidator,
  token_hash: v.string(),
  invited_by: v.string(),
  status: inviteStatusValidator,
  created_at: v.string(),
  expires_at: v.string(),
  accepted_at: v.union(v.string(), v.null()),
});

const memberWithUserValidator = v.object({
  membership_id: v.string(),
  user_id: v.string(),
  role: roleValidator,
  joined_at: v.string(),
  email: v.string(),
  name: v.string(),
});

const roleRank: Record<Role, number> = {
  [USER_ROLE.owner]: 4,
  [USER_ROLE.admin]: 3,
  [USER_ROLE.approver]: 2,
  [USER_ROLE.viewer]: 1,
};

const roleCanManageMembers = (role: Role): boolean =>
  role === USER_ROLE.owner || role === USER_ROLE.admin;

const refs = {
  getSubscriptionForOrg: makeFunctionReference<"query">("billing:getSubscriptionForOrg"),
  storeInviteToken: makeFunctionReference<"mutation">("e2e:storeInviteToken"),
};

const canAssignRole = (inviterRole: Role, inviteRole: Role): boolean => {
  return roleRank[inviterRole] >= roleRank[inviteRole];
};

const toIsoFromEpochMs = (value: number): string => new Date(value).toISOString();

const normalizeEmail = (value: string): string =>
  requireBoundedEmail(value, {
    field: "email",
    maxLength: INVITE_EMAIL_MAX_LENGTH,
  });

const assertValidInviteEmail = (email: string): void => {
  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    throw new Error("Please enter a valid email address.");
  }
};

const resolveTierForOrg = async (ctx: BaseCtx, orgId: string): Promise<SubscriptionTier> => {
  const subscription = await ctx.runQuery(refs.getSubscriptionForOrg, {
    orgId,
  });
  return subscription?.tier ?? SUBSCRIPTION_TIER.free;
};

const listOrgMembers = async (ctx: BaseCtx, orgId: string): Promise<BetterAuthMember[]> => {
  const members = await ctx.runQuery(components.betterAuth.queries.listOrgMembers, { orgId });
  return members
    .map((member) => {
      const role = member.role;
      if (!isRole(role)) {
        return null;
      }
      return {
        id: member.id,
        userId: member.userId,
        role,
        createdAt: member.createdAt,
      };
    })
    .filter((member): member is BetterAuthMember => member !== null);
};

const countPendingInvitesForOrg = async (ctx: BaseCtx, orgId: string): Promise<number> => {
  const rows = await ctx.db
    .query("invites")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .take(INVITE_SCAN_BUDGET);
  const currentTime = nowIso();
  return rows.filter((row) => row.status === INVITE_STATUS.pending && row.expires_at > currentTime)
    .length;
};

const ensureSeatAvailable = async (
  ctx: BaseCtx,
  orgId: string,
  occupiedSeats: number,
): Promise<{ tier: SubscriptionTier; maxMembers: number }> => {
  const tier = await resolveTierForOrg(ctx, orgId);
  const maxMembers = getTierConfig(tier).max_members;
  if (isMemberLimitReached(tier, occupiedSeats)) {
    throw new ConvexError({
      code: "MEMBER_LIMIT_REACHED",
      current_count: occupiedSeats,
      max_count: maxMembers,
      tier,
    });
  }
  return {
    tier,
    maxMembers,
  };
};

const getOrgName = async (ctx: BaseCtx, orgId: string): Promise<string> => {
  const org = await ctx.runQuery(components.betterAuth.queries.getOrgById, {
    orgId,
  });
  return org?.name ?? "your organization";
};

const findInviteByCustomId = async (ctx: BaseCtx, inviteId: string) => {
  return await ctx.db
    .query("invites")
    .withIndex("by_custom_id", (q) => q.eq("id", inviteId))
    .unique();
};

const findInviteByTokenHash = async (ctx: BaseCtx, tokenHash: string) => {
  return await ctx.db
    .query("invites")
    .withIndex("by_token_hash", (q) => q.eq("token_hash", tokenHash))
    .unique();
};

const createInviteCore = async (
  ctx: MutationCtx,
  params: {
    orgId: string;
    inviterUserId: string;
    inviterRole: Role;
    email: string;
    role: Role;
  },
): Promise<{ inviteId: string; rawToken: string; orgName: string }> => {
  if (!roleCanManageMembers(params.inviterRole)) {
    throw new Error("Forbidden");
  }
  if (!canAssignRole(params.inviterRole, params.role)) {
    throw new Error("You cannot invite a member with a higher role than your own.");
  }

  const normalizedEmail = normalizeEmail(params.email);
  assertValidInviteEmail(normalizedEmail);

  const members = await listOrgMembers(ctx, params.orgId);
  for (const member of members) {
    const user = await getUser(ctx, member.userId);
    if (user && normalizeEmail(user.email) === normalizedEmail) {
      throw new Error("This email is already a member of the organization.");
    }
  }

  const existingInvites = await ctx.db
    .query("invites")
    .withIndex("by_org_email", (q) => q.eq("org_id", params.orgId).eq("email", normalizedEmail))
    .take(INVITE_SCAN_BUDGET);
  const currentTime = nowIso();
  const pendingInvite = existingInvites.find(
    (invite) => invite.status === INVITE_STATUS.pending && invite.expires_at > currentTime,
  );
  if (pendingInvite) {
    throw new Error("A pending invite already exists for this email.");
  }

  const pendingCount = await countPendingInvitesForOrg(ctx, params.orgId);
  await ensureSeatAvailable(ctx, params.orgId, members.length + pendingCount);

  const inviteId = randomIdFor("inv");
  const rawToken = `inv_tok_${randomIdFor("tok").replace(/^tok_/, "")}`;
  const tokenHash = await sha256Hex(rawToken);
  const createdAt = nowIso();
  const expiresAt = toIsoFromEpochMs(Date.now() + INVITE_TTL_MS);

  await ctx.db.insert("invites", {
    id: inviteId,
    org_id: params.orgId,
    email: normalizedEmail,
    role: params.role,
    token_hash: tokenHash,
    invited_by: params.inviterUserId,
    status: INVITE_STATUS.pending,
    created_at: createdAt,
    expires_at: expiresAt,
    accepted_at: null,
  });

  if (process.env.KEPPO_E2E_MODE === "true") {
    await ctx.runMutation(refs.storeInviteToken, {
      inviteId,
      orgId: params.orgId,
      email: normalizedEmail,
      rawToken,
      createdAt,
    });
  }

  await insertAudit(ctx, params.orgId, params.inviterUserId, AUDIT_EVENT_TYPES.orgInviteCreated, {
    invite_id: inviteId,
    email: normalizedEmail,
    role: params.role,
    expires_at: expiresAt,
  });

  return {
    inviteId,
    rawToken,
    orgName: await getOrgName(ctx, params.orgId),
  };
};

const acceptInviteCore = async (
  ctx: MutationCtx,
  params: {
    tokenHash: string;
    userId: string;
  },
): Promise<{ orgId: string; orgName: string; role: Role }> => {
  const invite = await findInviteByTokenHash(ctx, params.tokenHash);
  if (!invite || invite.status !== INVITE_STATUS.pending) {
    throw new Error("Invitation is invalid or no longer available.");
  }
  if (invite.expires_at <= nowIso()) {
    await ctx.db.patch(invite._id, { status: INVITE_STATUS.expired });
    throw new Error("Invitation has expired.");
  }

  const user = await getUser(ctx, params.userId);
  if (!user) {
    throw new Error("User must be signed in to accept this invitation.");
  }
  if (normalizeEmail(user.email) !== invite.email) {
    throw new Error("This invitation was sent to a different email address.");
  }

  const existingMembership = await getMembership(ctx, invite.org_id, params.userId);
  if (!existingMembership) {
    const members = await listOrgMembers(ctx, invite.org_id);
    const pendingCount = await countPendingInvitesForOrg(ctx, invite.org_id);
    await ensureSeatAvailable(ctx, invite.org_id, members.length + Math.max(0, pendingCount - 1));

    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "member",
        data: {
          organizationId: invite.org_id,
          userId: params.userId,
          role: invite.role,
          createdAt: Date.now(),
        },
      },
    });
  }

  const acceptedAt = nowIso();
  await ctx.db.patch(invite._id, {
    status: INVITE_STATUS.accepted,
    accepted_at: acceptedAt,
  });

  await insertAudit(ctx, invite.org_id, params.userId, AUDIT_EVENT_TYPES.orgInviteAccepted, {
    invite_id: invite.id,
    role: invite.role,
    accepted_at: acceptedAt,
  });

  return {
    orgId: invite.org_id,
    orgName: await getOrgName(ctx, invite.org_id),
    role: invite.role,
  };
};

const coerceRole = (value: string): Role => {
  if (
    value === USER_ROLE.owner ||
    value === USER_ROLE.admin ||
    value === USER_ROLE.approver ||
    value === USER_ROLE.viewer
  ) {
    return value;
  }
  throw new Error("Invalid role.");
};

export const listMembers = query({
  args: {},
  returns: v.array(memberWithUserValidator),
  handler: async (ctx) => {
    const auth = await requireOrgMember(ctx);
    const members = await listOrgMembers(ctx, auth.orgId);
    const rows = await Promise.all(
      members.map(async (member) => {
        const user = await getUser(ctx, member.userId);
        return {
          membership_id: member.id,
          user_id: member.userId,
          role: member.role,
          joined_at: toIsoFromEpochMs(member.createdAt),
          email: user?.email ?? `${member.userId}@unknown.example`,
          name: user?.name ?? "Keppo User",
        };
      }),
    );
    return rows.sort((a, b) => a.email.localeCompare(b.email));
  },
});

export const listPendingInvites = query({
  args: {},
  returns: v.array(inviteValidator),
  handler: async (ctx) => {
    const auth = await requireOrgMember(ctx, [USER_ROLE.owner, USER_ROLE.admin]);
    const currentTime = nowIso();
    const rows = await ctx.db
      .query("invites")
      .withIndex("by_org", (q) => q.eq("org_id", auth.orgId))
      .take(INVITE_SCAN_BUDGET);
    return rows
      .filter((row) => row.status === INVITE_STATUS.pending && row.expires_at > currentTime)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((row) => ({
        id: row.id,
        org_id: row.org_id,
        email: row.email,
        role: row.role,
        token_hash: row.token_hash,
        invited_by: row.invited_by,
        status: row.status,
        created_at: row.created_at,
        expires_at: row.expires_at,
        accepted_at: row.accepted_at,
      }));
  },
});

export const createInvite = mutation({
  args: {
    email: v.string(),
    role: roleValidator,
  },
  returns: v.object({
    inviteId: v.string(),
    rawToken: v.string(),
    orgName: v.string(),
    tier: subscriptionTierValidator,
    maxMembers: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [USER_ROLE.owner, USER_ROLE.admin]);
    await enforceRateLimit(ctx, {
      key: `invite-create:${auth.orgId}`,
      limit: INVITE_CREATE_RATE_LIMIT.limit,
      windowMs: INVITE_CREATE_RATE_LIMIT.windowMs,
      message: "Too many invite attempts.",
    });
    const created = await createInviteCore(ctx, {
      orgId: auth.orgId,
      inviterUserId: auth.userId,
      inviterRole: auth.role,
      email: args.email,
      role: args.role,
    });
    const tier = await resolveTierForOrg(ctx, auth.orgId);
    const maxMembers = getTierConfig(tier).max_members;
    return {
      inviteId: created.inviteId,
      rawToken: created.rawToken,
      orgName: created.orgName,
      tier,
      maxMembers: Number.isFinite(maxMembers) ? maxMembers : null,
    };
  },
});

export const createInviteInternal = internalMutation({
  args: {
    orgId: v.string(),
    inviterUserId: v.string(),
    email: v.string(),
    role: roleValidator,
  },
  returns: v.object({
    inviteId: v.string(),
    rawToken: v.string(),
    orgName: v.string(),
  }),
  handler: async (ctx, args) => {
    const membership = await getMembership(ctx, args.orgId, args.inviterUserId);
    if (!membership) {
      throw new Error("Forbidden");
    }
    return await createInviteCore(ctx, {
      orgId: args.orgId,
      inviterUserId: args.inviterUserId,
      inviterRole: membership.role,
      email: args.email,
      role: args.role,
    });
  },
});

export const acceptInvite = mutation({
  args: {
    tokenHash: v.string(),
  },
  returns: v.object({
    orgId: v.string(),
    orgName: v.string(),
    role: roleValidator,
  }),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    return await acceptInviteCore(ctx, {
      tokenHash: args.tokenHash,
      userId: identity.subject,
    });
  },
});

export const acceptInviteInternal = internalMutation({
  args: {
    tokenHash: v.string(),
    userId: v.string(),
  },
  returns: v.object({
    orgId: v.string(),
    orgName: v.string(),
    role: roleValidator,
  }),
  handler: async (ctx, args) => {
    return await acceptInviteCore(ctx, {
      tokenHash: args.tokenHash,
      userId: args.userId,
    });
  },
});

export const revokeInvite = mutation({
  args: {
    inviteId: v.string(),
  },
  returns: v.object({
    inviteId: v.string(),
    status: inviteStatusValidator,
  }),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [USER_ROLE.owner, USER_ROLE.admin]);
    const invite = await findInviteByCustomId(ctx, args.inviteId);
    if (!invite || invite.org_id !== auth.orgId) {
      throw new Error("Invite not found.");
    }
    if (invite.status === INVITE_STATUS.accepted) {
      throw new Error("Accepted invitations cannot be revoked.");
    }

    const status = invite.status === INVITE_STATUS.revoked ? invite.status : INVITE_STATUS.revoked;
    if (invite.status !== INVITE_STATUS.revoked) {
      await ctx.db.patch(invite._id, {
        status,
      });
      await insertAudit(ctx, auth.orgId, auth.userId, AUDIT_EVENT_TYPES.orgInviteRevoked, {
        invite_id: invite.id,
        email: invite.email,
      });
    }

    return {
      inviteId: invite.id,
      status,
    };
  },
});

export const removeMember = mutation({
  args: {
    userId: v.string(),
  },
  returns: v.object({ userId: v.string() }),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [USER_ROLE.owner, USER_ROLE.admin]);
    const members = await listOrgMembers(ctx, auth.orgId);
    const target = members.find((member) => member.userId === args.userId);
    if (!target) {
      throw new Error("Member not found.");
    }
    if (target.userId === auth.userId) {
      throw new Error("Use leave org to remove yourself.");
    }
    if (roleRank[target.role] > roleRank[auth.role]) {
      throw new Error("You cannot remove a member with a higher role than your own.");
    }

    const ownerCount = members.filter((member) => member.role === USER_ROLE.owner).length;
    if (target.role === USER_ROLE.owner && ownerCount <= 1) {
      throw new Error("Cannot remove the last owner from the organization.");
    }

    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: {
        model: "member",
        where: [{ field: "_id", operator: "eq", value: target.id }],
      },
      paginationOpts: {
        numItems: 20,
        cursor: null,
      },
    });

    await insertAudit(ctx, auth.orgId, auth.userId, AUDIT_EVENT_TYPES.orgMemberRemoved, {
      removed_user_id: target.userId,
      removed_role: target.role,
    });

    return { userId: target.userId };
  },
});

export const updateMemberRole = mutation({
  args: {
    userId: v.string(),
    newRole: roleValidator,
  },
  returns: v.object({ userId: v.string(), role: roleValidator }),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [USER_ROLE.owner]);
    const members = await listOrgMembers(ctx, auth.orgId);
    const target = members.find((member) => member.userId === args.userId);
    if (!target) {
      throw new Error("Member not found.");
    }

    const nextRole = coerceRole(args.newRole);
    const ownerCount = members.filter((member) => member.role === USER_ROLE.owner).length;
    if (target.role === USER_ROLE.owner && nextRole !== USER_ROLE.owner && ownerCount <= 1) {
      throw new Error("Cannot change the role of the last owner.");
    }

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: "member",
        where: [{ field: "_id", operator: "eq", value: target.id }],
        update: { role: nextRole },
      },
      paginationOpts: {
        numItems: 20,
        cursor: null,
      },
    });

    await insertAudit(ctx, auth.orgId, auth.userId, AUDIT_EVENT_TYPES.orgMemberRoleUpdated, {
      user_id: target.userId,
      previous_role: target.role,
      new_role: nextRole,
    });

    return {
      userId: target.userId,
      role: nextRole,
    };
  },
});

export const leaveOrg = mutation({
  args: {},
  returns: v.object({ userId: v.string(), orgId: v.string() }),
  handler: async (ctx) => {
    const auth = await requireOrgMember(ctx);
    const members = await listOrgMembers(ctx, auth.orgId);
    const ownMembership = members.find((member) => member.userId === auth.userId);
    if (!ownMembership) {
      throw new Error("Member not found.");
    }

    const ownerCount = members.filter((member) => member.role === USER_ROLE.owner).length;
    if (ownMembership.role === USER_ROLE.owner && ownerCount <= 1) {
      throw new Error("Cannot leave organization as the sole owner.");
    }

    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: {
        model: "member",
        where: [{ field: "_id", operator: "eq", value: ownMembership.id }],
      },
      paginationOpts: {
        numItems: 20,
        cursor: null,
      },
    });

    await insertAudit(ctx, auth.orgId, auth.userId, AUDIT_EVENT_TYPES.orgMemberLeft, {
      user_id: auth.userId,
      previous_role: ownMembership.role,
    });

    return {
      userId: auth.userId,
      orgId: auth.orgId,
    };
  },
});

export const cleanupExpiredInvites = internalMutation({
  args: {},
  returns: v.object({ expired: v.number() }),
  handler: async (ctx) => {
    const currentTime = nowIso();
    const rows = await ctx.db
      .query("invites")
      .withIndex("by_expires_at", (q) => q.lte("expires_at", currentTime))
      .take(EXPIRED_INVITE_SCAN_BUDGET + 1);
    const atBudget = rows.length > EXPIRED_INVITE_SCAN_BUDGET;
    const candidates = atBudget ? rows.slice(0, EXPIRED_INVITE_SCAN_BUDGET) : rows;
    let expired = 0;

    for (const row of candidates) {
      if (row.status === INVITE_STATUS.pending && row.expires_at <= currentTime) {
        await ctx.db.patch(row._id, {
          status: INVITE_STATUS.expired,
        });
        expired += 1;
      }
    }

    if (atBudget) {
      console.warn("invites.cleanupExpiredInvites.scan_budget_reached", {
        scan_budget: EXPIRED_INVITE_SCAN_BUDGET,
      });
    }

    return { expired };
  },
});
