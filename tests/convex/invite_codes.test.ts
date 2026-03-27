import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { components, internal } from "../../convex/_generated/api";
import { USER_ROLE } from "../../convex/domain_constants";
import { createConvexTestHarness } from "./harness";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  redeemInviteCode: makeFunctionReference<"mutation">("invite_codes:redeemInviteCode"),
  listWorkspaces: makeFunctionReference<"query">("workspaces:listForCurrentOrg"),
  listInviteCodes: makeFunctionReference<"query">("admin:listInviteCodes"),
  createInviteCode: makeFunctionReference<"mutation">("admin:createInviteCode"),
  setInviteCodeActive: makeFunctionReference<"mutation">("admin:setInviteCodeActive"),
};

const insertInviteCode = async (
  t: ReturnType<typeof createConvexTestHarness>,
  params: {
    id: string;
    code: string;
    label: string;
    grantTier?: "free" | "starter" | "pro";
    active?: boolean;
  },
): Promise<void> => {
  await t.run(async (ctx) => {
    await ctx.db.insert("invite_codes", {
      id: params.id,
      code: params.code,
      label: params.label,
      grant_tier: params.grantTier,
      active: params.active ?? true,
      use_count: 0,
      created_by: "usr_admin",
      created_at: new Date().toISOString(),
    });
  });
};

const getAuthUserIdByEmail = async (
  t: ReturnType<typeof createConvexTestHarness>,
  email: string,
): Promise<string> => {
  const userId = await t.run(async (ctx) => {
    const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", value: email }],
    })) as { _id?: string } | null;
    return user?._id ?? null;
  });
  expect(userId).toBeTruthy();
  return userId!;
};

const createOrgMember = async (
  t: ReturnType<typeof createConvexTestHarness>,
  params: {
    orgId: string;
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
          organizationId: params.orgId,
          userId: authUserId,
          role: params.role,
          createdAt: now,
        },
      },
    });
  });
  return t.withIdentity({
    subject: authUserId,
    email: params.email,
    name: params.name,
    activeOrganizationId: params.orgId,
  });
};

describe("invite code redemption", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("rejects free invite codes because launch gating no longer exists", async () => {
    const t = createConvexTestHarness();
    const email = "invite-user@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_invited",
      email,
      name: "Invited User",
    });
    const authUserId = await getAuthUserIdByEmail(t, email);

    await insertInviteCode(t, {
      id: "icode_beta1",
      code: "ABC123",
      label: "Beta Batch 1",
    });

    const authT = t.withIdentity({
      subject: authUserId,
      email,
      name: "Invited User",
      activeOrganizationId: orgId,
    });

    await expect(authT.mutation(refs.redeemInviteCode, { code: "abc123" })).resolves.toEqual({
      ok: false,
      errorCode: "INVITE_CODE_NOT_REQUIRED",
      message: "Free invite codes are no longer required.",
    });

    await t.run(async (ctx) => {
      const inviteCode = await ctx.db
        .query("invite_codes")
        .withIndex("by_custom_id", (q) => q.eq("id", "icode_beta1"))
        .unique();
      const subscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .first();
      const redemption = await ctx.db
        .query("invite_code_redemptions")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .first();
      expect(inviteCode?.use_count).toBe(0);
      expect(subscription?.invite_code_id).toBeUndefined();
      expect(redemption).toBeNull();
    });
  });

  it("requires owner or admin role to redeem paid invite promos", async () => {
    const t = createConvexTestHarness();
    const ownerEmail = "owner-promo@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_owner_promo",
      email: ownerEmail,
      name: "Owner Promo",
    });

    await insertInviteCode(t, {
      id: "icode_owner_only",
      code: "ADMIN1",
      label: "Owner Only Promo",
      grantTier: "starter",
    });

    const viewerT = await createOrgMember(t, {
      orgId,
      email: "viewer-promo@example.com",
      name: "Viewer Promo",
      role: USER_ROLE.viewer,
    });

    await expect(viewerT.mutation(refs.redeemInviteCode, { code: "ADMIN1" })).resolves.toEqual({
      ok: false,
      errorCode: "INVITE_CODE_PROMO_REQUIRES_BILLING_ADMIN",
      message: "Only org owners and admins can redeem paid invite codes.",
    });
  });

  it("redeems paid invite promos on first sign-in and marks the org trialing", async () => {
    const t = createConvexTestHarness();
    const email = "starter-promo@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_starter_promo",
      email,
      name: "Starter Promo",
    });
    const authUserId = await getAuthUserIdByEmail(t, email);

    await insertInviteCode(t, {
      id: "icode_starter1",
      code: "STAR11",
      label: "Starter Promo",
      grantTier: "starter",
    });

    const authT = t.withIdentity({
      subject: authUserId,
      email,
      name: "Starter Promo",
      activeOrganizationId: orgId,
    });

    const result = await authT.mutation(refs.redeemInviteCode, { code: "star11" });
    expect(result).toMatchObject({
      ok: true,
      inviteCodeId: "icode_starter1",
      code: "STAR11",
      grantTier: "starter",
    });
    if (!result.ok) {
      throw new Error("Expected paid invite promo redemption to succeed.");
    }
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await t.run(async (ctx) => {
      const subscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .first();
      const redemption = await ctx.db
        .query("invite_code_redemptions")
        .withIndex("by_org_status", (q) => q.eq("org_id", orgId).eq("status", "active"))
        .first();
      expect(subscription).toMatchObject({
        tier: "starter",
        status: "trialing",
        invite_code_id: "icode_starter1",
        stripe_subscription_id: null,
      });
      expect(subscription?.current_period_end).toBe(result.expiresAt);
      expect(redemption).toMatchObject({
        invite_code_id: "icode_starter1",
        grant_tier: "starter",
        status: "active",
        expires_at: result.expiresAt,
      });
    });
  });

  it("clamps month-end promo expiry to the last day of the next calendar month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-31T10:15:30.000Z"));

    const t = createConvexTestHarness();
    const email = "month-end-promo@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_month_end_promo",
      email,
      name: "Month End Promo",
    });
    const authUserId = await getAuthUserIdByEmail(t, email);

    await insertInviteCode(t, {
      id: "icode_month_end",
      code: "MONTH1",
      label: "Month End Promo",
      grantTier: "starter",
    });

    const authT = t.withIdentity({
      subject: authUserId,
      email,
      name: "Month End Promo",
      activeOrganizationId: orgId,
    });

    const result = await authT.mutation(refs.redeemInviteCode, { code: "MONTH1" });
    expect(result).toMatchObject({
      ok: true,
      inviteCodeId: "icode_month_end",
      grantTier: "starter",
      expiresAt: "2026-02-28T10:15:30.000Z",
    });
  });

  it("allows a later paid promo after an existing invite marker already exists", async () => {
    const t = createConvexTestHarness();
    const email = "mixed-invites@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_mixed_invites",
      email,
      name: "Mixed Invites",
    });
    const authUserId = await getAuthUserIdByEmail(t, email);
    const authT = t.withIdentity({
      subject: authUserId,
      email,
      name: "Mixed Invites",
      activeOrganizationId: orgId,
    });

    await insertInviteCode(t, {
      id: "icode_free1",
      code: "FREE11",
      label: "Free Marker",
    });
    await insertInviteCode(t, {
      id: "icode_pro1",
      code: "PRO111",
      label: "Pro Promo",
      grantTier: "pro",
    });

    await t.run(async (ctx) => {
      const subscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .first();
      if (!subscription) {
        throw new Error("Expected subscription to exist.");
      }
      await ctx.db.patch(subscription._id, {
        invite_code_id: "icode_free1",
      });
    });

    const promoResult = await authT.mutation(refs.redeemInviteCode, { code: "pro111" });
    expect(promoResult).toMatchObject({
      ok: true,
      inviteCodeId: "icode_pro1",
      grantTier: "pro",
    });

    await t.run(async (ctx) => {
      const subscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .first();
      const redemptions = await ctx.db
        .query("invite_code_redemptions")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .collect();
      expect(subscription?.invite_code_id).toBe("icode_free1");
      expect(subscription?.tier).toBe("pro");
      expect(redemptions).toHaveLength(1);
      expect(redemptions[0]?.invite_code_id).toBe("icode_pro1");
    });
  });

  it("rejects inactive and unknown invite codes with structured results", async () => {
    const t = createConvexTestHarness();
    const email = "invite-failure@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_invite_failure",
      email,
      name: "Invite Failure",
    });
    const authUserId = await getAuthUserIdByEmail(t, email);

    await insertInviteCode(t, {
      id: "icode_inactive",
      code: "ZZZ999",
      label: "Inactive cohort",
      active: false,
    });

    const authT = t.withIdentity({
      subject: authUserId,
      email,
      name: "Invite Failure",
      activeOrganizationId: orgId,
    });

    await expect(authT.mutation(refs.redeemInviteCode, { code: "zzz999" })).resolves.toEqual({
      ok: false,
      errorCode: "INVALID_INVITE_CODE",
      message: "That invite code is invalid or inactive.",
    });

    await expect(authT.mutation(refs.redeemInviteCode, { code: "bad" })).resolves.toEqual({
      ok: false,
      errorCode: "INVALID_INVITE_CODE",
      message: "Enter a valid 6-character invite code.",
    });
  });

  it("keeps protected Convex queries available without invite gating", async () => {
    const t = createConvexTestHarness();
    const email = "invite-blocked@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_invite_blocked",
      email,
      name: "Invite Blocked",
    });
    const authUserId = await getAuthUserIdByEmail(t, email);

    const authT = t.withIdentity({
      subject: authUserId,
      email,
      name: "Invite Blocked",
      activeOrganizationId: orgId,
    });

    await expect(authT.query(refs.listWorkspaces, {})).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          org_id: orgId,
        }),
      ]),
    );
  });

  it("rejects overlapping paid promos and orgs with active Stripe billing", async () => {
    const t = createConvexTestHarness();
    const email = "paid-promo-errors@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_paid_promo_errors",
      email,
      name: "Paid Promo Errors",
    });
    const authUserId = await getAuthUserIdByEmail(t, email);
    const authT = t.withIdentity({
      subject: authUserId,
      email,
      name: "Paid Promo Errors",
      activeOrganizationId: orgId,
    });

    await insertInviteCode(t, {
      id: "icode_startx",
      code: "STARTX",
      label: "Starter Promo",
      grantTier: "starter",
    });
    await insertInviteCode(t, {
      id: "icode_prox1",
      code: "PROX11",
      label: "Pro Promo",
      grantTier: "pro",
    });

    await expect(authT.mutation(refs.redeemInviteCode, { code: "startx" })).resolves.toMatchObject({
      ok: true,
      grantTier: "starter",
    });
    await expect(authT.mutation(refs.redeemInviteCode, { code: "prox11" })).resolves.toEqual({
      ok: false,
      errorCode: "INVITE_CODE_PROMO_ALREADY_ACTIVE",
      message: "This organization already has an active paid invite promo.",
    });

    await t.run(async (ctx) => {
      const subscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .first();
      if (!subscription) {
        throw new Error("Expected subscription to exist.");
      }
      await ctx.db.patch(subscription._id, {
        tier: "pro",
        status: "active",
        stripe_customer_id: "cus_paid",
        stripe_subscription_id: "sub_paid",
        updated_at: new Date().toISOString(),
      });
      const activePromo = await ctx.db
        .query("invite_code_redemptions")
        .withIndex("by_org_status", (q) => q.eq("org_id", orgId).eq("status", "active"))
        .first();
      if (!activePromo) {
        throw new Error("Expected active promo redemption.");
      }
      await ctx.db.patch(activePromo._id, {
        status: "converted",
        updated_at: new Date().toISOString(),
      });
    });

    await expect(authT.mutation(refs.redeemInviteCode, { code: "prox11" })).resolves.toEqual({
      ok: false,
      errorCode: "INVITE_CODE_PROMO_STRIPE_ACTIVE",
      message: "This organization already has an active Stripe subscription.",
    });
  });

  it("expires active paid promos and downgrades orgs that have not converted", async () => {
    const t = createConvexTestHarness();
    const email = "expiring-promo@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_expiring_promo",
      email,
      name: "Expiring Promo",
    });
    const authUserId = await getAuthUserIdByEmail(t, email);
    const authT = t.withIdentity({
      subject: authUserId,
      email,
      name: "Expiring Promo",
      activeOrganizationId: orgId,
    });

    await insertInviteCode(t, {
      id: "icode_exp11",
      code: "EXP111",
      label: "Expiring Pro",
      grantTier: "pro",
    });
    await expect(authT.mutation(refs.redeemInviteCode, { code: "exp111" })).resolves.toMatchObject({
      ok: true,
      grantTier: "pro",
    });

    await t.run(async (ctx) => {
      const redemption = await ctx.db
        .query("invite_code_redemptions")
        .withIndex("by_org_status", (q) => q.eq("org_id", orgId).eq("status", "active"))
        .first();
      if (!redemption) {
        throw new Error("Expected active invite promo redemption.");
      }
      await ctx.db.patch(redemption._id, {
        expires_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
    });

    const sweepResult = await t.run(async (ctx) => {
      return await ctx.runMutation(internal.invite_codes.expireInviteCodePromos, {
        limit: 10,
      });
    });
    expect(sweepResult).toEqual({
      processed: 1,
      expired: 1,
      continued: false,
    });

    await t.run(async (ctx) => {
      const subscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .first();
      const redemptions = await ctx.db
        .query("invite_code_redemptions")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .collect();
      expect(subscription).toMatchObject({
        tier: "free",
        status: "active",
        invite_code_id: "icode_exp11",
      });
      expect(redemptions[0]?.status).toBe("expired");
    });
  });

  it("limits invite code management to platform admins", async () => {
    vi.stubEnv("KEPPO_ADMIN_USER_IDS", "platform_admin");

    const t = createConvexTestHarness();
    const adminT = t.withIdentity({
      subject: "platform_admin",
      email: "admin@example.com",
      name: "Platform Admin",
      activeOrganizationId: "org_admin",
    });
    const userT = t.withIdentity({
      subject: "regular_user",
      email: "user@example.com",
      name: "Regular User",
      activeOrganizationId: "org_user",
    });

    const created = await adminT.mutation(refs.createInviteCode, {
      label: "Admin cohort",
      grantTier: "starter",
    });
    expect(created.label).toBe("Admin cohort");
    expect(created.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(created.grant_tier).toBe("starter");

    await expect(adminT.query(refs.listInviteCodes, {})).resolves.toHaveLength(1);
    await expect(
      adminT.mutation(refs.setInviteCodeActive, {
        inviteCodeId: created.id,
        active: false,
      }),
    ).resolves.toMatchObject({
      id: created.id,
      active: false,
    });

    await expect(userT.query(refs.listInviteCodes, {})).rejects.toThrow("Forbidden");
    await expect(
      adminT.mutation(refs.createInviteCode, {
        label: "x".repeat(81),
        grantTier: "free",
      }),
    ).rejects.toThrow("Label must be 80 characters or fewer.");
  });
});
