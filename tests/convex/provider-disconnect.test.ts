import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { components } from "../../convex/_generated/api";
import {
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  INTEGRATION_STATUS,
} from "../../convex/domain_constants";
import { PROVIDER_MODULE_VERSION } from "../../convex/integrations/model";
import { createConvexTestHarness } from "./harness";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  connectProvider: makeFunctionReference<"mutation">("integrations:connectProvider"),
  disconnectProvider: makeFunctionReference<"mutation">("integrations:disconnectProvider"),
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
  return { t, authT, orgId, authUserId };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("convex provider disconnect lifecycle", () => {
  it("deletes provider accounts and credentials while marking the integration disconnected", async () => {
    vi.stubEnv("KEPPO_MASTER_KEY", "keppo-master-key-for-provider-disconnect-tests");
    const { t, authT, orgId } = await createAuthenticatedHarness("provider_disconnect_cleanup");

    await authT.mutation(refs.connectProvider, {
      provider: "google",
      display_name: "Google Workspace",
    });
    await authT.mutation(refs.disconnectProvider, {
      provider: "google",
    });

    const integration = await t.run((ctx) =>
      ctx.db
        .query("integrations")
        .withIndex("by_org_provider", (q) => q.eq("org_id", orgId).eq("provider", "google"))
        .first(),
    );
    const accounts = await t.run((ctx) =>
      ctx.db
        .query("integration_accounts")
        .collect()
        .then((rows) => rows.filter((row) => row.integration_id === integration?.id)),
    );
    const credentials = await t.run((ctx) =>
      ctx.db
        .query("integration_credentials")
        .collect()
        .then((rows) =>
          rows.filter((row) =>
            accounts.some((account) => account.id === row.integration_account_id),
          ),
        ),
    );

    expect(integration?.status).toBe(INTEGRATION_STATUS.disconnected);
    expect(accounts).toHaveLength(0);
    expect(credentials).toHaveLength(0);
  });

  it("records a disconnect audit event with the acting user", async () => {
    vi.stubEnv("KEPPO_MASTER_KEY", "keppo-master-key-for-provider-disconnect-tests");
    const { t, authT, orgId, authUserId } = await createAuthenticatedHarness(
      "provider_disconnect_audit",
    );

    await authT.mutation(refs.connectProvider, {
      provider: "google",
      display_name: "Google Workspace",
    });
    await authT.mutation(refs.disconnectProvider, {
      provider: "google",
    });

    const auditEvent = await t.run((ctx) =>
      ctx.db
        .query("audit_events")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .collect()
        .then(
          (rows) =>
            rows.find(
              (row) =>
                row.event_type === AUDIT_EVENT_TYPES.integrationDisconnected &&
                row.payload["provider"] === "google",
            ) ?? null,
        ),
    );

    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actor_type).toBe(AUDIT_ACTOR_TYPE.user);
    expect(auditEvent?.actor_id).toBe(authUserId);
  });

  it("succeeds even when the provider has no stored accounts or credentials", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("provider_disconnect_empty");

    await t.run(async (ctx) => {
      await ctx.db.insert("integrations", {
        id: "int_disconnect_empty",
        org_id: orgId,
        provider: "google",
        provider_module_version: PROVIDER_MODULE_VERSION,
        display_name: "Google Workspace",
        status: INTEGRATION_STATUS.connected,
        created_at: "2026-03-22T12:00:00.000Z",
        last_health_check_at: null,
        last_successful_health_check_at: null,
        last_error_code: null,
        last_error_category: null,
        last_webhook_at: null,
        degraded_reason: null,
      });
    });

    await expect(
      authT.mutation(refs.disconnectProvider, {
        provider: "google",
      }),
    ).resolves.toBeNull();

    const integration = await t.run((ctx) =>
      ctx.db
        .query("integrations")
        .withIndex("by_custom_id", (q) => q.eq("id", "int_disconnect_empty"))
        .unique(),
    );

    expect(integration?.status).toBe(INTEGRATION_STATUS.disconnected);
  });
});
