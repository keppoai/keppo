import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES, INTEGRATION_STATUS } from "../../convex/domain_constants";
import { PROVIDER_MODULE_VERSION } from "../../convex/integrations/model";
import { createConvexTestHarness } from "./harness";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  markProviderWebhookOrgIngested: makeFunctionReference<"mutation">(
    "integrations:markProviderWebhookOrgIngested",
  ),
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
      deliveryId: "evt_missing_account",
      externalAccountId,
      eventType: "invoice.payment_succeeded",
      payload: { id: "evt_missing_account" },
      receivedAt: "2026-04-02T12:05:00.000Z",
    });

    expect(result).toEqual({
      matched_orgs: 0,
      matched_integrations: 0,
      matched_org_ids: [],
      pending_org_ids: [],
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

  it("persists per-org completion so retries only return the failed organizations", async () => {
    const t = createConvexTestHarness();
    const now = "2026-04-02T12:00:00.000Z";

    const [orgOneId, orgTwoId] = await Promise.all([
      t.mutation(refs.seedUserOrg, {
        userId: "usr_retryable_org_one",
        email: "retryable-org-one@example.com",
        name: "Retryable Org One",
      }),
      t.mutation(refs.seedUserOrg, {
        userId: "usr_retryable_org_two",
        email: "retryable-org-two@example.com",
        name: "Retryable Org Two",
      }),
    ]);
    const matchedOrgIds = [orgOneId, orgTwoId].sort();
    const remainingOrgIds = matchedOrgIds.filter((orgId) => orgId !== orgOneId);

    await t.run(async (ctx) => {
      await ctx.db.insert("integrations", {
        id: "int_retryable_org_one",
        org_id: orgOneId,
        provider: "stripe",
        provider_module_version: PROVIDER_MODULE_VERSION,
        display_name: "Stripe Retry Org One",
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
        id: "int_retryable_org_two",
        org_id: orgTwoId,
        provider: "stripe",
        provider_module_version: PROVIDER_MODULE_VERSION,
        display_name: "Stripe Retry Org Two",
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
        id: "iacc_retryable_org_one",
        integration_id: "int_retryable_org_one",
        external_account_id: "acct_shared",
        scopes: [],
        metadata: {},
      });
      await ctx.db.insert("integration_accounts", {
        id: "iacc_retryable_org_two",
        integration_id: "int_retryable_org_two",
        external_account_id: "acct_shared",
        scopes: [],
        metadata: {},
      });
    });

    const first = await t.mutation(refs.recordProviderWebhook, {
      provider: "stripe",
      deliveryId: "evt_retryable",
      externalAccountId: "acct_shared",
      eventType: "invoice.payment_succeeded",
      payload: { id: "evt_retryable" },
      receivedAt: "2026-04-02T12:05:00.000Z",
    });

    expect(first).toEqual({
      matched_orgs: 2,
      matched_integrations: 2,
      matched_org_ids: matchedOrgIds,
      pending_org_ids: matchedOrgIds,
    });

    const afterOneSuccess = await t.mutation(refs.markProviderWebhookOrgIngested, {
      provider: "stripe",
      deliveryId: "evt_retryable",
      orgId: orgOneId,
    });

    expect(afterOneSuccess).toEqual({
      pending_org_ids: remainingOrgIds,
    });

    const retry = await t.mutation(refs.recordProviderWebhook, {
      provider: "stripe",
      deliveryId: "evt_retryable",
      externalAccountId: "acct_shared",
      eventType: "invoice.payment_succeeded",
      payload: { id: "evt_retryable" },
      receivedAt: "2026-04-02T12:06:00.000Z",
    });

    expect(retry).toEqual({
      matched_orgs: 2,
      matched_integrations: 2,
      matched_org_ids: matchedOrgIds,
      pending_org_ids: remainingOrgIds,
    });

    const persistedState = await t.run(async (ctx) => {
      const deliveries = await ctx.db
        .query("provider_webhook_deliveries")
        .withIndex("by_provider_delivery", (q) =>
          q.eq("provider", "stripe").eq("delivery_id", "evt_retryable"),
        )
        .collect();
      const webhookAuditEvents = await ctx.db
        .query("audit_events")
        .withIndex("by_event_type_created", (q) =>
          q.eq("event_type", AUDIT_EVENT_TYPES.integrationWebhookReceived),
        )
        .collect();

      return {
        deliveries,
        webhookAuditEvents,
      };
    });

    expect(persistedState.deliveries).toHaveLength(1);
    expect(persistedState.deliveries[0]).toMatchObject({
      provider: "stripe",
      delivery_id: "evt_retryable",
      matched_org_ids: matchedOrgIds,
      completed_org_ids: [orgOneId],
    });
    expect(persistedState.webhookAuditEvents).toHaveLength(2);
  });
});
