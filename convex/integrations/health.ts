import { internalMutation, mutation } from "../_generated/server";
import { v } from "convex/values";
import { nowIso, randomIdFor, requireOrgMember } from "../_auth";
import { AUDIT_ACTOR_TYPE, AUDIT_EVENT_TYPES, INTEGRATION_STATUS } from "../domain_constants";
import { canonicalizeProvider } from "../provider_ids";
import {
  integrationErrorCategoryValidator,
  integrationErrorCodeValidator,
  integrationStatusValidator,
  providerValidator,
} from "../validators";
import { isIntegrationConnected, PROVIDER_MODULE_VERSION } from "./model";
import { findIntegrationByProvider } from "./persistence";

export const testProvider = mutation({
  args: { provider: providerValidator },
  returns: v.object({ ok: v.boolean(), detail: v.string() }),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx);
    const provider = canonicalizeProvider(args.provider);

    const integration = await findIntegrationByProvider(ctx, auth.orgId, provider);
    if (
      !integration ||
      !isIntegrationConnected({
        status: integration.status,
        lastErrorCategory: integration.last_error_category,
        credentialExpiresAt: undefined,
      })
    ) {
      return { ok: false, detail: `${provider} is not connected` };
    }

    await ctx.db.patch(integration._id, {
      provider,
      provider_module_version: PROVIDER_MODULE_VERSION,
      last_health_check_at: nowIso(),
      last_successful_health_check_at: nowIso(),
      last_error_code: null,
      last_error_category: null,
      degraded_reason: null,
    });

    return { ok: true, detail: `${provider} connection ok` };
  },
});

export const markIntegrationHealth = internalMutation({
  args: {
    orgId: v.string(),
    provider: providerValidator,
    status: integrationStatusValidator,
    errorCode: v.optional(v.union(integrationErrorCodeValidator, v.null())),
    errorCategory: v.optional(v.union(integrationErrorCategoryValidator, v.null())),
    degradedReason: v.optional(v.union(v.string(), v.null())),
    checkedAt: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const provider = canonicalizeProvider(args.provider);
    const integration = await findIntegrationByProvider(ctx, args.orgId, provider);
    if (!integration) {
      return null;
    }

    const checkedAt = args.checkedAt ?? nowIso();
    const nextStatus = args.status;
    await ctx.db.patch(integration._id, {
      provider,
      provider_module_version: PROVIDER_MODULE_VERSION,
      status: nextStatus,
      last_health_check_at: checkedAt,
      ...(nextStatus === INTEGRATION_STATUS.connected
        ? { last_successful_health_check_at: checkedAt }
        : {}),
      ...(nextStatus === INTEGRATION_STATUS.connected
        ? {
            last_error_code: null,
            last_error_category: null,
            degraded_reason: null,
          }
        : {
            last_error_code: args.errorCode ?? null,
            last_error_category: args.errorCategory ?? null,
            degraded_reason: args.degradedReason ?? null,
          }),
    });

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: args.orgId,
      actor_type: AUDIT_ACTOR_TYPE.system,
      actor_id: "integration_health",
      event_type: AUDIT_EVENT_TYPES.integrationHealthUpdated,
      payload: {
        provider,
        status: nextStatus,
        error_code: args.errorCode ?? null,
        error_category: args.errorCategory ?? null,
      },
      created_at: nowIso(),
    });

    return null;
  },
});
