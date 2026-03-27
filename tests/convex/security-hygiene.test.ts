import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { components } from "../../convex/_generated/api";
import {
  DEFAULT_ACTION_BEHAVIOR,
  POLICY_MODE,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
  WORKSPACE_STATUS,
} from "../../convex/domain_constants";
import { subscriptionIdForOrg } from "../../convex/billing/shared";
import { createConvexTestHarness } from "./harness";

process.env.BETTER_AUTH_SECRET ??= "better-auth-secret-for-security-hygiene-tests";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  createWorkspace: makeFunctionReference<"mutation">("workspaces:createWorkspace"),
  createInvite: makeFunctionReference<"mutation">("invites:createInvite"),
  createAutomation: makeFunctionReference<"mutation">("automations:createAutomation"),
  createCelRule: makeFunctionReference<"mutation">("rules:createCelRule"),
  testCelRule: makeFunctionReference<"mutation">("rules:testCelRule"),
  decryptForTestsOnly: makeFunctionReference<"query">("org_ai_keys:_decryptForTestsOnly"),
};

const encryptStoredKeyForTests = async (secret: string, rawValue: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(rawValue),
  );
  const toHex = (bytes: Uint8Array): string =>
    Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  return `keppo-v1.${toHex(iv)}.${toHex(new Uint8Array(encrypted))}`;
};

const createAuthenticatedHarness = async () => {
  const t = createConvexTestHarness();
  const userId = `usr_${crypto.randomUUID().replace(/-/g, "")}`;
  const email = `${userId}@example.com`;
  const orgId = await t.mutation(refs.seedUserOrg, {
    userId,
    email,
    name: "Security Hygiene",
  });
  const authUserId = await t.run(async (ctx) => {
    const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", value: email }],
    })) as { _id?: string } | null;
    return user?._id ?? null;
  });
  if (!authUserId) {
    throw new Error("Failed to resolve auth user id for test harness.");
  }

  const authT = t.withIdentity({
    subject: authUserId,
    email,
    name: "Security Hygiene",
    activeOrganizationId: orgId,
  });

  return {
    t,
    authT,
    orgId,
    workspaceId: `workspace_${crypto.randomUUID().replace(/-/g, "")}`,
  };
};

const seedOrgSubscriptionAndWorkspace = async (params: {
  t: ReturnType<typeof createConvexTestHarness>;
  orgId: string;
  workspaceId: string;
  enableCelRules?: boolean;
}) => {
  const now = new Date().toISOString();
  const subscriptionId = await subscriptionIdForOrg(params.orgId);
  await params.t.run(async (ctx) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_custom_id", (q) => q.eq("id", subscriptionId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        tier: SUBSCRIPTION_TIER.pro,
        workspace_count: 0,
        updated_at: now,
      });
    } else {
      await ctx.db.insert("subscriptions", {
        id: subscriptionId,
        org_id: params.orgId,
        tier: SUBSCRIPTION_TIER.pro,
        status: SUBSCRIPTION_STATUS.active,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        workspace_count: 0,
        current_period_start: now,
        current_period_end: new Date(Date.now() + 60_000).toISOString(),
        created_at: now,
        updated_at: now,
      });
    }

    await ctx.db.insert("workspaces", {
      id: params.workspaceId,
      org_id: params.orgId,
      slug: `slug-${params.workspaceId.slice(-8)}`,
      name: "Security Workspace",
      status: WORKSPACE_STATUS.active,
      policy_mode: POLICY_MODE.manualOnly,
      default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
      code_mode_enabled: true,
      automation_count: 0,
      created_at: now,
    });

    if (params.enableCelRules) {
      await ctx.db.insert("dogfood_orgs", {
        id: `dogfood_${params.orgId}`,
        org_id: params.orgId,
        added_by: "security_hygiene_test",
        created_at: now,
      });
      await ctx.db.insert("feature_flags", {
        id: "flag_cel_rules",
        key: "cel_rules",
        label: "CEL rules",
        description: "Enable CEL rules for tests",
        enabled: true,
        created_at: now,
        updated_at: now,
      });
    }
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
  delete process.env.KEPPO_ENABLE_TEST_ONLY_DECRYPT;
  delete process.env.KEPPO_MASTER_KEY_INTEGRATION;
});

describe("Convex security hygiene", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "better-auth-secret-for-convex-tests-0123456789";
  });

  it("rate limits workspace creation and bounds workspace names", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness();
    const workspaceSeed = `workspace_seed_${crypto.randomUUID().replace(/-/g, "")}`;
    await seedOrgSubscriptionAndWorkspace({
      t,
      orgId,
      workspaceId: workspaceSeed,
    });

    await expectMessage(
      async () =>
        await authT.mutation(refs.createWorkspace, {
          name: "x".repeat(81),
          policy_mode: "manual_only",
          default_action_behavior: "require_approval",
        }),
      "name must be 80 characters or fewer",
    );

    for (let index = 0; index < 10; index += 1) {
      await authT.mutation(refs.createWorkspace, {
        name: `Workspace ${index}`,
        slug: `workspace-${index}-${crypto.randomUUID().slice(0, 8)}`,
        policy_mode: "manual_only",
        default_action_behavior: "require_approval",
      });
    }

    await expectMessage(
      async () =>
        await authT.mutation(refs.createWorkspace, {
          name: "Workspace rate limited",
          policy_mode: "manual_only",
          default_action_behavior: "require_approval",
        }),
      "Too many workspace creations.",
    );
  });

  it("rate limits invite creation", async () => {
    const { t, authT, orgId, workspaceId } = await createAuthenticatedHarness();
    await seedOrgSubscriptionAndWorkspace({ t, orgId, workspaceId });

    for (let index = 0; index < 20; index += 1) {
      await authT.mutation(refs.createInvite, {
        email: `invite-${index}@example.com`,
        role: "viewer",
      });
    }

    await expectMessage(
      async () =>
        await authT.mutation(refs.createInvite, {
          email: "invite-rate-limit@example.com",
          role: "viewer",
        }),
      "Too many invite attempts.",
    );
  });

  it("bounds automation prompts and CEL rule test contexts", async () => {
    const { t, authT, orgId, workspaceId } = await createAuthenticatedHarness();
    await seedOrgSubscriptionAndWorkspace({ t, orgId, workspaceId, enableCelRules: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("org_ai_keys", {
        id: "oaik_security_openai_byok",
        org_id: orgId,
        provider: "openai",
        key_mode: "byok",
        encrypted_key: "keppo-v1.fakeiv.fakecipher",
        credential_kind: "secret",
        key_hint: "...sec",
        key_version: 1,
        is_active: true,
        subject_email: null,
        account_id: null,
        token_expires_at: null,
        last_refreshed_at: null,
        last_validated_at: null,
        created_by: "usr_security_test",
        created_at: "2026-03-02T00:00:00.000Z",
        updated_at: "2026-03-02T00:00:00.000Z",
      });
    });

    await expectMessage(
      async () =>
        await authT.mutation(refs.createAutomation, {
          workspace_id: workspaceId,
          name: "Security Automation",
          description: "Checks limits",
          trigger_type: "manual",
          runner_type: "chatgpt_codex",
          ai_model_provider: "openai",
          ai_model_name: "gpt-5",
          prompt: "x".repeat(12_001),
          network_access: "mcp_only",
        }),
      "prompt must be 12000 characters or fewer",
    );

    await authT.mutation(refs.createCelRule, {
      workspaceId,
      name: "Safe rule",
      description: "Bounded",
      expression: "request.amount < 100",
      effect: "deny",
      enabled: true,
    });

    await expectMessage(
      async () =>
        await authT.mutation(refs.testCelRule, {
          workspaceId,
          expression: "request.amount < 100",
          context: {
            request: {
              nested: {
                deeper: {
                  tooDeep: {
                    value: true,
                  },
                },
              },
            },
          },
        }),
      "context exceeds the supported nesting depth",
    );
  });

  it("requires an explicit flag before decrypting test-only AI keys", async () => {
    process.env.KEPPO_MASTER_KEY_INTEGRATION = "integration-master-key-test-0123456789";
    const encryptedKey = await encryptStoredKeyForTests(
      process.env.KEPPO_MASTER_KEY_INTEGRATION,
      "secret-value",
    );
    const t = createConvexTestHarness();

    await expectMessage(
      async () =>
        await t.query(refs.decryptForTestsOnly, {
          encrypted_key: encryptedKey,
        }),
      "Forbidden",
    );

    process.env.KEPPO_ENABLE_TEST_ONLY_DECRYPT = "true";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      t.query(refs.decryptForTestsOnly, {
        encrypted_key: encryptedKey,
      }),
    ).resolves.toBe("secret-value");
    expect(warnSpy).toHaveBeenCalledWith(
      "org_ai_keys.test_only_decrypt_invoked",
      expect.objectContaining({
        explicit_flag: "KEPPO_ENABLE_TEST_ONLY_DECRYPT",
      }),
    );
  });
});
