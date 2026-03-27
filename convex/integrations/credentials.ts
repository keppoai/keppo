import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { nowIso, randomIdFor } from "../_auth";
import { encryptSecretValue, isEncryptedValue } from "../crypto_helpers";
import { AUDIT_ACTOR_TYPE, AUDIT_EVENT_TYPES, INTEGRATION_STATUS } from "../domain_constants";
import { toIntegrationErrorClassification } from "../mcp_runtime_shared";
import { canonicalizeProvider } from "../provider_ids";
import {
  integrationErrorCategoryValidator,
  integrationErrorCodeValidator,
  providerValidator,
} from "../validators";
import { PROVIDER_MODULE_VERSION } from "./model";
import { findIntegrationByProvider } from "./persistence";

export const markCredentialRefreshResult = internalMutation({
  args: {
    orgId: v.string(),
    provider: providerValidator,
    success: v.boolean(),
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.union(v.string(), v.null())),
    expiresAt: v.optional(v.union(v.string(), v.null())),
    errorCode: v.optional(v.union(integrationErrorCodeValidator, v.null())),
    errorCategory: v.optional(v.union(integrationErrorCategoryValidator, v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const provider = canonicalizeProvider(args.provider);
    const integration = await findIntegrationByProvider(ctx, args.orgId, provider);
    if (!integration) {
      return null;
    }

    const account = await ctx.db
      .query("integration_accounts")
      .withIndex("by_integration", (q) => q.eq("integration_id", integration.id))
      .unique();
    if (!account) {
      return null;
    }

    const credential = await ctx.db
      .query("integration_credentials")
      .withIndex("by_integration_account", (q) => q.eq("integration_account_id", account.id))
      .unique();
    if (!credential) {
      return null;
    }

    const now = nowIso();
    if (args.success) {
      const encryptedAccessToken =
        args.accessToken !== undefined
          ? await encryptSecretValue(args.accessToken, "integration_credentials")
          : undefined;
      const encryptedRefreshToken =
        args.refreshToken === undefined
          ? undefined
          : args.refreshToken === null
            ? null
            : await encryptSecretValue(args.refreshToken, "integration_credentials");
      await ctx.db.patch(credential._id, {
        ...(encryptedAccessToken !== undefined ? { access_token_enc: encryptedAccessToken } : {}),
        ...(encryptedRefreshToken !== undefined
          ? { refresh_token_enc: encryptedRefreshToken }
          : {}),
        ...(args.expiresAt !== undefined ? { expires_at: args.expiresAt } : {}),
        last_refreshed_at: now,
        last_refresh_error_at: null,
        last_refresh_error_code: null,
      });

      await ctx.db.patch(integration._id, {
        provider,
        provider_module_version: PROVIDER_MODULE_VERSION,
        status: INTEGRATION_STATUS.connected,
        last_health_check_at: now,
        last_successful_health_check_at: now,
        last_error_code: null,
        last_error_category: null,
        degraded_reason: null,
      });

      await ctx.db.insert("audit_events", {
        id: randomIdFor("audit"),
        org_id: args.orgId,
        actor_type: AUDIT_ACTOR_TYPE.system,
        actor_id: "credential_refresh",
        event_type: AUDIT_EVENT_TYPES.integrationCredentialRefreshSucceeded,
        payload: {
          provider,
          integration_id: integration.id,
          expires_at: args.expiresAt ?? null,
        },
        created_at: now,
      });

      return null;
    }

    const errorCode = args.errorCode ?? "execution_failed";
    const errorCategory =
      args.errorCategory ?? toIntegrationErrorClassification(errorCode).errorCategory;

    await ctx.db.patch(credential._id, {
      last_refresh_error_at: now,
      last_refresh_error_code: errorCode,
    });

    await ctx.db.patch(integration._id, {
      provider,
      provider_module_version: PROVIDER_MODULE_VERSION,
      status: INTEGRATION_STATUS.degraded,
      last_health_check_at: now,
      last_error_code: errorCode,
      last_error_category: errorCategory,
      degraded_reason: "Reconnect required",
    });

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: args.orgId,
      actor_type: AUDIT_ACTOR_TYPE.system,
      actor_id: "credential_refresh",
      event_type: AUDIT_EVENT_TYPES.integrationCredentialRefreshFailed,
      payload: {
        provider,
        integration_id: integration.id,
        error_code: errorCode,
        error_category: errorCategory,
      },
      created_at: now,
    });

    return null;
  },
});

export const migrateLegacyIntegrationCredentialTokens = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    updated: v.number(),
    nextCursor: v.union(v.string(), v.null()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const pageSize = Math.max(1, Math.min(args.limit ?? 100, 250));
    const page = await ctx.db.query("integration_credentials").paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
    });

    let updated = 0;
    for (const credential of page.page) {
      const patch: {
        access_token_enc?: string;
        refresh_token_enc?: string | null;
      } = {};

      if (!isEncryptedValue(credential.access_token_enc)) {
        patch.access_token_enc = await encryptSecretValue(
          credential.access_token_enc,
          "integration_credentials",
        );
      }
      if (
        typeof credential.refresh_token_enc === "string" &&
        !isEncryptedValue(credential.refresh_token_enc)
      ) {
        patch.refresh_token_enc = await encryptSecretValue(
          credential.refresh_token_enc,
          "integration_credentials",
        );
      }

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(credential._id, patch);
        updated += 1;
      }
    }

    return {
      scanned: page.page.length,
      updated,
      nextCursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});
