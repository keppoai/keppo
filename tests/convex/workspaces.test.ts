import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { components } from "../../convex/_generated/api";
import {
  DEFAULT_ACTION_BEHAVIOR,
  POLICY_MODE,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
} from "../../convex/domain_constants";
import { getTierConfig, getDefaultBillingPeriod } from "../../packages/shared/src/subscriptions.js";
import { subscriptionIdForOrg } from "../../convex/billing/shared";
import { createConvexTestHarness } from "./harness";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  upsertSubscriptionForOrg: makeFunctionReference<"mutation">(
    "billing/subscriptions:upsertSubscriptionForOrg",
  ),
  createWorkspace: makeFunctionReference<"mutation">("workspaces:createWorkspace"),
  createWorkspaceForOrg: makeFunctionReference<"mutation">("mcp:createWorkspaceForOrg"),
  deleteWorkspace: makeFunctionReference<"mutation">("workspaces:deleteWorkspace"),
  getById: makeFunctionReference<"query">("workspaces:getById"),
  getByOrgSlug: makeFunctionReference<"query">("workspaces:getByOrgSlug"),
  listForCurrentOrg: makeFunctionReference<"query">("workspaces:listForCurrentOrg"),
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
  const email = `${label}@example.com`;
  const orgId = await t.mutation(refs.seedUserOrg, {
    userId: `usr_${label}`,
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
  return { t, authT, orgId };
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

describe("convex workspace creation rules", () => {
  it("enforces the free tier workspace cap at two workspaces", async () => {
    const { authT } = await createAuthenticatedHarness("workspace_free_limit");

    await authT.mutation(refs.createWorkspace, {
      name: "Free Workspace Two",
      policy_mode: POLICY_MODE.manualOnly,
      default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
    });

    await expectMessage(
      async () =>
        await authT.mutation(refs.createWorkspace, {
          name: "Free Workspace Three",
          policy_mode: POLICY_MODE.manualOnly,
          default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
        }),
      "WORKSPACE_LIMIT_REACHED",
    );
  });

  it("enforces the starter tier workspace cap at five workspaces", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("workspace_starter_limit");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.starter);

    for (let index = 2; index <= getTierConfig("starter").max_workspaces; index += 1) {
      await authT.mutation(refs.createWorkspace, {
        name: `Starter Workspace ${index}`,
        policy_mode: POLICY_MODE.manualOnly,
        default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
      });
    }

    await expectMessage(
      async () =>
        await authT.mutation(refs.createWorkspace, {
          name: "Starter Workspace 6",
          policy_mode: POLICY_MODE.manualOnly,
          default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
        }),
      "WORKSPACE_LIMIT_REACHED",
    );
  });

  it("uses the pro tier constant while allowing additional workspace creation", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("workspace_pro_limit");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.pro);

    for (let index = 0; index < 3; index += 1) {
      await authT.mutation(refs.createWorkspace, {
        name: `Pro Workspace ${index}`,
        policy_mode: POLICY_MODE.manualOnly,
        default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
      });
    }

    const workspaceCount = await t.run((ctx) =>
      ctx.db
        .query("workspaces")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .collect()
        .then((rows) => rows.length),
    );

    expect(getTierConfig("pro").max_workspaces).toBe(25);
    expect(workspaceCount).toBe(4);
  });

  it("creates an active workspace credential alongside each new workspace", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("workspace_credential_seed");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.starter);

    const result = await authT.mutation(refs.createWorkspace, {
      name: "Credential Workspace",
      policy_mode: POLICY_MODE.manualOnly,
      default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
    });

    const credentials = await t.run((ctx) =>
      ctx.db
        .query("workspace_credentials")
        .withIndex("by_workspace", (q) => q.eq("workspace_id", result.workspace.id))
        .collect(),
    );

    expect(result.workspace.org_id).toBe(orgId);
    expect(result.credential_secret.startsWith("keppo_")).toBe(true);
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.revoked_at).toBeNull();
  });

  it("generates a unique slug suffix when a requested slug already exists in the org", async () => {
    const { authT, t, orgId } = await createAuthenticatedHarness("workspace_slug_uniqueness");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.starter);

    const first = await authT.mutation(refs.createWorkspace, {
      name: "Slug Alpha",
      slug: "shared-slug",
      policy_mode: POLICY_MODE.manualOnly,
      default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
    });
    const second = await authT.mutation(refs.createWorkspace, {
      name: "Slug Beta",
      slug: "shared-slug",
      policy_mode: POLICY_MODE.manualOnly,
      default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
    });

    expect(first.workspace.slug).toBe("shared-slug");
    expect(second.workspace.slug).toMatch(/^shared-slug-/);
    expect(second.workspace.slug).not.toBe(first.workspace.slug);
  });

  it("rate limits rapid workspace creation attempts within the 15 minute window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const { t, authT, orgId } = await createAuthenticatedHarness("workspace_rate_limit");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.pro);

    for (let index = 0; index < 10; index += 1) {
      await authT.mutation(refs.createWorkspace, {
        name: `Rate Limited Workspace ${index}`,
        slug: `rate-limit-${index}`,
        policy_mode: POLICY_MODE.manualOnly,
        default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
      });
    }

    await expectMessage(
      async () =>
        await authT.mutation(refs.createWorkspace, {
          name: "Rate Limited Workspace 11",
          slug: "rate-limit-11",
          policy_mode: POLICY_MODE.manualOnly,
          default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
        }),
      "Too many workspace creations.",
    );

    const rateLimitRow = await t.run((ctx) =>
      ctx.db
        .query("rate_limits")
        .withIndex("by_key", (q) => q.eq("key", `workspace-create:${orgId}`))
        .unique(),
    );

    expect(rateLimitRow?.timestamps).toHaveLength(10);
    expect(rateLimitRow?.window_ms).toBe(15 * 60 * 1_000);
  });

  it("initializes a missing workspace counter from the actual org workspace count", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness(
      "workspace_counter_initialization",
    );
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.starter);
    await t.mutation(refs.createWorkspaceForOrg, {
      orgId,
      name: "Existing Workspace Seed",
      policyMode: POLICY_MODE.manualOnly,
      defaultActionBehavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
    });

    const canonicalSubId = await subscriptionIdForOrg(orgId);
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
      const period = getDefaultBillingPeriod(new Date());
      await ctx.db.insert("subscriptions", {
        id: canonicalSubId,
        org_id: orgId,
        tier: SUBSCRIPTION_TIER.starter,
        status: SUBSCRIPTION_STATUS.active,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        current_period_start: period.periodStart,
        current_period_end: period.periodEnd,
        created_at: "2026-03-22T12:00:00.000Z",
        updated_at: "2026-03-22T12:00:00.000Z",
      });
    });

    await authT.mutation(refs.createWorkspace, {
      name: "Counter Initialized Workspace",
      policy_mode: POLICY_MODE.manualOnly,
      default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
    });

    const [workspaceCount, subscriptionRows] = await Promise.all([
      t.run((ctx) =>
        ctx.db
          .query("workspaces")
          .withIndex("by_org", (q) => q.eq("org_id", orgId))
          .collect()
          .then((rows) => rows.length),
      ),
      t.run((ctx) =>
        ctx.db
          .query("subscriptions")
          .withIndex("by_org", (q) => q.eq("org_id", orgId))
          .collect(),
      ),
    ]);

    expect(workspaceCount).toBe(3);
    expect(subscriptionRows.at(-1)?.workspace_count).toBe(3);
  });

  it("deletes a non-last workspace by disabling it, revoking credentials, and decrementing the counter", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("workspace_delete_active");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.starter);

    const created = await authT.mutation(refs.createWorkspace, {
      name: "Workspace To Delete",
      policy_mode: POLICY_MODE.manualOnly,
      default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
    });

    await expect(
      authT.mutation(refs.deleteWorkspace, {
        workspaceId: created.workspace.id,
      }),
    ).resolves.toEqual({
      workspaceId: created.workspace.id,
      nextWorkspaceId: expect.any(String),
      nextWorkspaceSlug: expect.any(String),
    });

    const [activeWorkspaces, deletedWorkspace, credentials, subscriptionRows] = await Promise.all([
      authT.query(refs.listForCurrentOrg, {}),
      t.run((ctx) =>
        ctx.db
          .query("workspaces")
          .withIndex("by_custom_id", (q) => q.eq("id", created.workspace.id))
          .unique(),
      ),
      t.run((ctx) =>
        ctx.db
          .query("workspace_credentials")
          .withIndex("by_workspace", (q) => q.eq("workspace_id", created.workspace.id))
          .collect(),
      ),
      t.run((ctx) =>
        ctx.db
          .query("subscriptions")
          .withIndex("by_org", (q) => q.eq("org_id", orgId))
          .collect(),
      ),
    ]);

    expect(activeWorkspaces.map((workspace) => workspace.id)).not.toContain(created.workspace.id);
    expect(deletedWorkspace?.status).toBe("disabled");
    expect(credentials.every((credential) => credential.revoked_at !== null)).toBe(true);
    expect(subscriptionRows.at(-1)?.workspace_count).toBe(1);
  });

  it("returns null from getById for disabled workspaces instead of throwing", async () => {
    const { authT } = await createAuthenticatedHarness("workspace_get_by_id_disabled");
    const created = await authT.mutation(refs.createWorkspace, {
      name: "Disabled Lookup Workspace",
      policy_mode: POLICY_MODE.manualOnly,
      default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
    });

    await authT.mutation(refs.deleteWorkspace, {
      workspaceId: created.workspace.id,
    });

    await expect(
      authT.query(refs.getById, { workspaceId: created.workspace.id }),
    ).resolves.toBeNull();
  });

  it("lists and resolves active workspaces even when disabled rows exceed the old scan budget", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("workspace_active_index");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.pro);

    await t.run(async (ctx) => {
      for (let index = 0; index < 230; index += 1) {
        await ctx.db.insert("workspaces", {
          id: `workspace_disabled_${index}`,
          org_id: orgId,
          slug: `disabled-${index}`,
          name: `Disabled ${index}`,
          status: "disabled",
          policy_mode: POLICY_MODE.manualOnly,
          default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
          code_mode_enabled: true,
          created_at: `2026-03-22T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
        });
      }
    });

    const created = await authT.mutation(refs.createWorkspace, {
      name: "Late Active Workspace",
      slug: "late-active-workspace",
      policy_mode: POLICY_MODE.manualOnly,
      default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
    });

    const [workspaces, resolved] = await Promise.all([
      authT.query(refs.listForCurrentOrg, {}),
      authT.query(refs.getByOrgSlug, { orgId, slug: created.workspace.slug }),
    ]);

    expect(workspaces.map((workspace) => workspace.id)).toContain(created.workspace.id);
    expect(resolved?.id).toBe(created.workspace.id);
  });

  it("recounts the workspace counter when deleting with a missing stored count", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("workspace_delete_recount");
    await setSubscriptionTier(t, orgId, SUBSCRIPTION_TIER.starter);

    const created = await authT.mutation(refs.createWorkspace, {
      name: "Workspace Delete Recount",
      policy_mode: POLICY_MODE.manualOnly,
      default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
    });

    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .collect();
      const latest = rows.at(-1);
      if (!latest) {
        throw new Error("Missing subscription");
      }
      await ctx.db.patch(latest._id, { workspace_count: undefined });
    });

    await authT.mutation(refs.deleteWorkspace, {
      workspaceId: created.workspace.id,
    });

    const subscriptionRows = await t.run((ctx) =>
      ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .collect(),
    );
    expect(subscriptionRows.at(-1)?.workspace_count).toBe(1);
  });

  it("rejects deleting the last active workspace", async () => {
    const { authT } = await createAuthenticatedHarness("workspace_delete_last_guard");
    const [defaultWorkspace] = await authT.query(refs.listForCurrentOrg, {});
    expect(defaultWorkspace).toBeTruthy();

    await expectMessage(
      async () =>
        await authT.mutation(refs.deleteWorkspace, {
          workspaceId: defaultWorkspace!.id,
        }),
      "Cannot delete the last workspace.",
    );
  });
});
