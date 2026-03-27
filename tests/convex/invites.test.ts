import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { components } from "../../convex/_generated/api";
import {
  INVITE_STATUS,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
  USER_ROLE,
} from "../../convex/domain_constants";
import { getDefaultBillingPeriod } from "../../packages/shared/src/subscriptions.js";
import { createConvexTestHarness } from "./harness";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  upsertSubscriptionForOrg: makeFunctionReference<"mutation">(
    "billing/subscriptions:upsertSubscriptionForOrg",
  ),
  createInvite: makeFunctionReference<"mutation">("invites:createInvite"),
  removeMember: makeFunctionReference<"mutation">("invites:removeMember"),
  updateMemberRole: makeFunctionReference<"mutation">("invites:updateMemberRole"),
  cleanupExpiredInvites: makeFunctionReference<"mutation">("invites:cleanupExpiredInvites"),
};

const getAuthUserIdByEmail = async (
  t: ReturnType<typeof createConvexTestHarness>,
  email: string,
): Promise<string> => {
  const authUserId = await t.run(async (ctx) => {
    const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", value: email }],
    })) as { _id?: string } | null;
    return user?._id ?? null;
  });
  expect(authUserId).toBeTruthy();
  return authUserId!;
};

const createAuthenticatedHarness = async (label: string) => {
  const t = createConvexTestHarness();
  const userId = `usr_${label}`;
  const email = `${label}@example.com`;
  const orgId = await t.mutation(refs.seedUserOrg, {
    userId,
    email,
    name: `Test ${label}`,
  });
  const authUserId = await getAuthUserIdByEmail(t, email);
  const authT = t.withIdentity({
    subject: authUserId,
    email,
    name: `Test ${label}`,
    activeOrganizationId: orgId,
  });
  return { t, authT, orgId, authUserId, email };
};

const setSubscriptionTier = async (
  t: ReturnType<typeof createConvexTestHarness>,
  orgId: string,
  tier: (typeof SUBSCRIPTION_TIER)[keyof typeof SUBSCRIPTION_TIER],
) => {
  const period = getDefaultBillingPeriod(new Date());
  await t.mutation(refs.upsertSubscriptionForOrg, {
    orgId,
    tier,
    status: SUBSCRIPTION_STATUS.active,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodStart: period.periodStart,
    currentPeriodEnd: period.periodEnd,
  });
};

const createOrgMember = async (
  t: ReturnType<typeof createConvexTestHarness>,
  orgId: string,
  params: {
    email: string;
    name: string;
    role: (typeof USER_ROLE)[keyof typeof USER_ROLE];
  },
) => {
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: params.name,
          email: params.email,
          emailVerified: true,
          image: null,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  });
  const authUserId = await getAuthUserIdByEmail(t, params.email);
  await t.run(async (ctx) => {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "member",
        data: {
          organizationId: orgId,
          userId: authUserId,
          role: params.role,
          createdAt: now,
        },
      },
    });
  });
  const authT = t.withIdentity({
    subject: authUserId,
    email: params.email,
    name: params.name,
    activeOrganizationId: orgId,
  });
  return { authUserId, authT };
};

const expectMessage = async (fn: () => Promise<unknown>, text: string): Promise<void> => {
  try {
    await fn();
    throw new Error(`Expected error containing "${text}"`);
  } catch (error) {
    expect(error instanceof Error ? error.message : String(error)).toContain(text);
  }
};

afterEach(() => {
  vi.useRealTimers();
});

describe("convex invite membership flows", () => {
  it("rejects creating an invite on the free tier once the lone seat is occupied", async () => {
    const { authT } = await createAuthenticatedHarness("invite_free_limit");

    await expectMessage(
      async () =>
        await authT.mutation(refs.createInvite, {
          email: "free-limit@example.com",
          role: USER_ROLE.viewer,
        }),
      "MEMBER_LIMIT_REACHED",
    );
  });

  it("counts pending invites against the starter tier seat limit", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("invite_starter_pending_limit");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.starter);

    await authT.mutation(refs.createInvite, {
      email: "starter-pending-1@example.com",
      role: USER_ROLE.viewer,
    });

    await expectMessage(
      async () =>
        await authT.mutation(refs.createInvite, {
          email: "starter-pending-2@example.com",
          role: USER_ROLE.viewer,
        }),
      "MEMBER_LIMIT_REACHED",
    );
  });

  it("allows repeated invite creation on the pro tier", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("invite_pro_unlimited");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.pro);

    for (let index = 0; index < 6; index += 1) {
      await authT.mutation(refs.createInvite, {
        email: `pro-invite-${index}@example.com`,
        role: USER_ROLE.viewer,
      });
    }

    const invites = await t.run((ctx) =>
      ctx.db
        .query("invites")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .collect(),
    );

    expect(invites).toHaveLength(6);
    expect(invites.every((invite) => invite.status === INVITE_STATUS.pending)).toBe(true);
  });

  it("prevents admins from inviting owners", async () => {
    const { t, orgId } = await createAuthenticatedHarness("invite_admin_hierarchy");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.pro);
    const { authT: adminT } = await createOrgMember(t, orgId, {
      email: "admin-hierarchy@example.com",
      name: "Admin Hierarchy",
      role: USER_ROLE.admin,
    });

    await expectMessage(
      async () =>
        await adminT.mutation(refs.createInvite, {
          email: "forbidden-owner@example.com",
          role: USER_ROLE.owner,
        }),
      "higher role than your own",
    );
  });

  it("lets owners invite every supported role", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("invite_owner_roles");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.pro);

    for (const role of [USER_ROLE.owner, USER_ROLE.admin, USER_ROLE.approver, USER_ROLE.viewer]) {
      await authT.mutation(refs.createInvite, {
        email: `owner-${role}@example.com`,
        role,
      });
    }

    const invites = await t.run((ctx) =>
      ctx.db
        .query("invites")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .collect(),
    );

    expect(invites.map((invite) => invite.role).sort()).toEqual([
      USER_ROLE.admin,
      USER_ROLE.approver,
      USER_ROLE.owner,
      USER_ROLE.viewer,
    ]);
  });

  it("rejects duplicate pending invites for the same normalized email", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("invite_duplicate_pending");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.pro);

    await authT.mutation(refs.createInvite, {
      email: "duplicate@example.com",
      role: USER_ROLE.viewer,
    });

    await expectMessage(
      async () =>
        await authT.mutation(refs.createInvite, {
          email: "  DUPLICATE@example.com  ",
          role: USER_ROLE.viewer,
        }),
      "pending invite already exists",
    );
  });

  it("normalizes invite email casing and whitespace before storage", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("invite_email_normalization");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.pro);

    await authT.mutation(refs.createInvite, {
      email: "  Mixed.Case+Alias@Example.COM  ",
      role: USER_ROLE.viewer,
    });

    const invite = await t.run((ctx) =>
      ctx.db
        .query("invites")
        .withIndex("by_org_email", (q) =>
          q.eq("org_id", orgId).eq("email", "mixed.case+alias@example.com"),
        )
        .unique(),
    );

    expect(invite?.email).toBe("mixed.case+alias@example.com");
  });

  it("marks expired pending invites as expired during cleanup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const { t, orgId, authUserId } = await createAuthenticatedHarness("invite_cleanup_expired");

    await t.run(async (ctx) => {
      await ctx.db.insert("invites", {
        id: "inv_expired_cleanup",
        org_id: orgId,
        email: "expired@example.com",
        role: USER_ROLE.viewer,
        token_hash: "token-hash-expired",
        invited_by: authUserId,
        status: INVITE_STATUS.pending,
        created_at: "2026-03-10T12:00:00.000Z",
        expires_at: "2026-03-15T12:00:00.000Z",
        accepted_at: null,
      });
      await ctx.db.insert("invites", {
        id: "inv_active_cleanup",
        org_id: orgId,
        email: "active@example.com",
        role: USER_ROLE.viewer,
        token_hash: "token-hash-active",
        invited_by: authUserId,
        status: INVITE_STATUS.pending,
        created_at: "2026-03-22T11:00:00.000Z",
        expires_at: "2026-03-29T12:00:00.000Z",
        accepted_at: null,
      });
    });

    const result = await t.mutation(refs.cleanupExpiredInvites, {});

    const [expiredInvite, activeInvite] = await Promise.all([
      t.run((ctx) =>
        ctx.db
          .query("invites")
          .withIndex("by_custom_id", (q) => q.eq("id", "inv_expired_cleanup"))
          .unique(),
      ),
      t.run((ctx) =>
        ctx.db
          .query("invites")
          .withIndex("by_custom_id", (q) => q.eq("id", "inv_active_cleanup"))
          .unique(),
      ),
    ]);

    expect(result).toEqual({ expired: 1 });
    expect(expiredInvite?.status).toBe(INVITE_STATUS.expired);
    expect(activeInvite?.status).toBe(INVITE_STATUS.pending);
  });

  it("prevents removing yourself through the member removal path", async () => {
    const { authT, authUserId } = await createAuthenticatedHarness("invite_remove_self_guard");

    await expectMessage(
      async () =>
        await authT.mutation(refs.removeMember, {
          userId: authUserId,
        }),
      "Use leave org to remove yourself",
    );
  });

  it("lets owners change member roles and blocks non-owners from promoting to owner", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("invite_member_role_update");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.pro);
    const member = await createOrgMember(t, orgId, {
      email: "member-role-target@example.com",
      name: "Role Target",
      role: USER_ROLE.viewer,
    });
    const admin = await createOrgMember(t, orgId, {
      email: "member-role-admin@example.com",
      name: "Role Admin",
      role: USER_ROLE.admin,
    });

    await expect(
      authT.mutation(refs.updateMemberRole, {
        userId: member.authUserId,
        newRole: USER_ROLE.admin,
      }),
    ).resolves.toEqual({
      userId: member.authUserId,
      role: USER_ROLE.admin,
    });

    const updatedMember = await t.run(async (ctx) => {
      const membership = (await ctx.runQuery(components.betterAuth.queries.getMemberByOrgAndUser, {
        orgId,
        userId: member.authUserId,
      })) as { role?: string } | null;
      return membership?.role ?? null;
    });

    expect(updatedMember).toBe(USER_ROLE.admin);

    await expectMessage(
      async () =>
        await admin.authT.mutation(refs.updateMemberRole, {
          userId: member.authUserId,
          newRole: USER_ROLE.owner,
        }),
      "Forbidden",
    );
  });
});
