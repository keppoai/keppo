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
    externalAccountId: v.optional(v.union(v.string(), v.null())),
    eventType: v.string(),
    payload: jsonRecordValidator,
    receivedAt: v.optional(v.string()),
  },
  returns: v.object({
    matched_orgs: v.number(),
    matched_integrations: v.number(),
    matched_org_ids: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const provider = canonicalizeProvider(args.provider);
    const receivedAt = args.receivedAt ?? nowIso();

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
          if (args.externalAccountId) {
            return ctx.db
              .query("integration_accounts")
              .withIndex("by_integration_external_account", (q) =>
                q
                  .eq("integration_id", integration.id)
                  .eq("external_account_id", args.externalAccountId!),
              )
              .collect();
          }
          return ctx.db
            .query("integration_accounts")
            .withIndex("by_integration", (q) => q.eq("integration_id", integration.id))
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

    return {
      matched_orgs: touchedOrgIds.size,
      matched_integrations: touchedIntegrationIds.size,
      matched_org_ids: Array.from(touchedOrgIds),
    };
  },
});
