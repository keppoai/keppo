import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES, INTEGRATION_STATUS } from "../../convex/domain_constants";
import { PROVIDER_MODULE_VERSION } from "../../convex/integrations/model";
import { createConvexTestHarness } from "./harness";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  recordProviderWebhook: makeFunctionReference<"mutation">("integrations:recordProviderWebhook"),
};

describe("provider webhook routing", () => {
  it.each([
    {
      caseName: "null external account ids",
      externalAccountId: null,
    },
    {
      caseName: "whitespace-only external account ids",
      externalAccountId: "   ",
    },
  ])("matches no organizations when the webhook has $caseName", async ({ externalAccountId }) => {
    const t = createConvexTestHarness();
    const now = "2026-04-02T12:00:00.000Z";

    const [orgOneId, orgTwoId] = await Promise.all([
      t.mutation(refs.seedUserOrg, {
        userId: "usr_webhook_org_one",
        email: "webhook-org-one@example.com",
        name: "Webhook Org One",
      }),
      t.mutation(refs.seedUserOrg, {
        userId: "usr_webhook_org_two",
        email: "webhook-org-two@example.com",
        name: "Webhook Org Two",
      }),
    ]);

    await t.run(async (ctx) => {
      await ctx.db.insert("integrations", {
        id: "int_webhook_org_one",
        org_id: orgOneId,
        provider: "stripe",
        provider_module_version: PROVIDER_MODULE_VERSION,
        display_name: "Stripe Org One",
        status: INTEGRATION_STATUS.connected,
        created_at: now,
        last_health_check_at: null,
        last_successful_health_check_at: null,
        last_error_code: null,
        last_error_category: null,
        last_webhook_at: null,
        degraded_reason: null,
      });
      await ctx.db.insert("integrations", {
        id: "int_webhook_org_two",
        org_id: orgTwoId,
        provider: "stripe",
        provider_module_version: PROVIDER_MODULE_VERSION,
        display_name: "Stripe Org Two",
        status: INTEGRATION_STATUS.connected,
        created_at: now,
        last_health_check_at: null,
        last_successful_health_check_at: null,
        last_error_code: null,
        last_error_category: null,
        last_webhook_at: null,
        degraded_reason: null,
      });
      await ctx.db.insert("integration_accounts", {
        id: "iacc_webhook_org_one",
        integration_id: "int_webhook_org_one",
        external_account_id: "acct_org_one",
        scopes: [],
        metadata: {},
      });
      await ctx.db.insert("integration_accounts", {
        id: "iacc_webhook_org_two",
        integration_id: "int_webhook_org_two",
        external_account_id: "acct_org_two",
        scopes: [],
        metadata: {},
      });
    });

    const result = await t.mutation(refs.recordProviderWebhook, {
      provider: "stripe",
      externalAccountId,
      eventType: "invoice.payment_succeeded",
      payload: { id: "evt_missing_account" },
      receivedAt: "2026-04-02T12:05:00.000Z",
    });

    expect(result).toEqual({
      matched_orgs: 0,
      matched_integrations: 0,
      matched_org_ids: [],
    });

    const persistedState = await t.run(async (ctx) => {
      const integrations = await ctx.db
        .query("integrations")
        .withIndex("by_provider", (q) => q.eq("provider", "stripe"))
        .collect();
      const webhookAuditEvents = await ctx.db
        .query("audit_events")
        .withIndex("by_event_type_created", (q) =>
          q.eq("event_type", AUDIT_EVENT_TYPES.integrationWebhookReceived),
        )
        .collect();

      return {
        lastWebhookTimes: integrations.map((integration) => integration.last_webhook_at),
        webhookAuditEvents,
      };
    });

    expect(persistedState.lastWebhookTimes.every((value) => value === null)).toBe(true);
    expect(persistedState.webhookAuditEvents).toEqual([]);
  });
});
