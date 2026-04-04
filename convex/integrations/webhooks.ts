import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { nowIso, randomIdFor } from "../_auth";
import { AUDIT_ACTOR_TYPE, AUDIT_EVENT_TYPES } from "../domain_constants";
import { canonicalizeProvider } from "../provider_ids";
import { jsonRecordValidator, providerValidator } from "../validators";
import { PROVIDER_MODULE_VERSION } from "./model";

export const recordProviderWebhook = internalMutation({
  args: {
    provider: providerValidator,
    deliveryId: v.string(),
    externalAccountId: v.optional(v.union(v.string(), v.null())),
    eventType: v.string(),
    payload: jsonRecordValidator,
    receivedAt: v.optional(v.string()),
  },
  returns: v.object({
    matched_orgs: v.number(),
    matched_integrations: v.number(),
    matched_org_ids: v.array(v.string()),
    pending_org_ids: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const provider = canonicalizeProvider(args.provider);
    const receivedAt = args.receivedAt ?? nowIso();
    const externalAccountId = args.externalAccountId?.trim() ?? null;

    if (!externalAccountId) {
      return {
        matched_orgs: 0,
        matched_integrations: 0,
        matched_org_ids: [],
        pending_org_ids: [],
      };
    }

    const existingDelivery = await ctx.db
      .query("provider_webhook_deliveries")
      .withIndex("by_provider_delivery", (q) =>
        q.eq("provider", provider).eq("delivery_id", args.deliveryId),
      )
      .unique();
    if (existingDelivery) {
      if (
        existingDelivery.event_type !== args.eventType ||
        existingDelivery.external_account_id !== externalAccountId
      ) {
        throw new Error("Provider webhook replay payload does not match the stored delivery.");
      }
      const completedOrgIds = new Set(existingDelivery.completed_org_ids);
      const pendingOrgIds = existingDelivery.matched_org_ids.filter(
        (orgId) => !completedOrgIds.has(orgId),
      );
      return {
        matched_orgs: existingDelivery.matched_org_ids.length,
        matched_integrations: existingDelivery.matched_integrations,
        matched_org_ids: existingDelivery.matched_org_ids,
        pending_org_ids: pendingOrgIds,
      };
    }

    const filteredIntegrations = await ctx.db
      .query("integrations")
      .withIndex("by_provider", (q) => q.eq("provider", provider))
      .collect();
    const integrationById = new Map(
      filteredIntegrations.map((integration) => [integration.id, integration]),
    );

    const matchedAccounts = (
      await Promise.all(
        filteredIntegrations.map((integration) => {
          return ctx.db
            .query("integration_accounts")
            .withIndex("by_integration_external_account", (q) =>
              q.eq("integration_id", integration.id).eq("external_account_id", externalAccountId),
            )
            .collect();
        }),
      )
    ).flat();

    const touchedIntegrationIds = new Set<string>();
    const touchedOrgIds = new Set<string>();

    for (const account of matchedAccounts) {
      const integration = integrationById.get(account.integration_id);
      if (!integration) {
        continue;
      }
      touchedIntegrationIds.add(integration.id);
      touchedOrgIds.add(integration.org_id);

      await ctx.db.patch(integration._id, {
        provider,
        provider_module_version: PROVIDER_MODULE_VERSION,
        last_webhook_at: receivedAt,
      });

      await ctx.db.insert("audit_events", {
        id: randomIdFor("audit"),
        org_id: integration.org_id,
        actor_type: AUDIT_ACTOR_TYPE.system,
        actor_id: "provider_webhook",
        event_type: AUDIT_EVENT_TYPES.integrationWebhookReceived,
        payload: {
          provider,
          integration_id: integration.id,
          external_account_id: account.external_account_id,
          event_type: args.eventType,
          event: args.payload,
        },
        created_at: receivedAt,
      });
    }

    const matchedOrgIds = Array.from(touchedOrgIds).sort();
    await ctx.db.insert("provider_webhook_deliveries", {
      id: randomIdFor("pwd"),
      provider,
      delivery_id: args.deliveryId,
      external_account_id: externalAccountId,
      event_type: args.eventType,
      matched_integrations: touchedIntegrationIds.size,
      matched_org_ids: matchedOrgIds,
      completed_org_ids: [],
      created_at: receivedAt,
      updated_at: receivedAt,
    });

    return {
      matched_orgs: matchedOrgIds.length,
      matched_integrations: touchedIntegrationIds.size,
      matched_org_ids: matchedOrgIds,
      pending_org_ids: matchedOrgIds,
    };
  },
});

export const markProviderWebhookOrgIngested = internalMutation({
  args: {
    provider: providerValidator,
    deliveryId: v.string(),
    orgId: v.string(),
  },
  returns: v.object({
    pending_org_ids: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const provider = canonicalizeProvider(args.provider);
    const delivery = await ctx.db
      .query("provider_webhook_deliveries")
      .withIndex("by_provider_delivery", (q) =>
        q.eq("provider", provider).eq("delivery_id", args.deliveryId),
      )
      .unique();
    if (!delivery) {
      throw new Error("Provider webhook delivery state is missing.");
    }
    if (!delivery.matched_org_ids.includes(args.orgId)) {
      throw new Error("Provider webhook delivery does not match the requested organization.");
    }
    if (delivery.completed_org_ids.includes(args.orgId)) {
      return {
        pending_org_ids: delivery.matched_org_ids.filter(
          (orgId) => !delivery.completed_org_ids.includes(orgId),
        ),
      };
    }

    const completedOrgIds = [...delivery.completed_org_ids, args.orgId].sort();
    await ctx.db.patch(delivery._id, {
      completed_org_ids: completedOrgIds,
      updated_at: nowIso(),
    });
    return {
      pending_org_ids: delivery.matched_org_ids.filter((orgId) => !completedOrgIds.includes(orgId)),
    };
  },
});
