import { internalMutation, internalQuery, mutation } from "../_generated/server";
import { v } from "convex/values";
import { nowIso, randomIdFor, requireOrgMember } from "../_auth";
import { decryptSecretValue, encryptSecretValue } from "../crypto_helpers";
import {
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  CUSTOM_INTEGRATION_AUTH_METHOD,
  INTEGRATION_STATUS,
  USER_ROLE,
} from "../domain_constants";
import { CUSTOM_PROVIDER_ID, normalizeJsonRecord } from "../integrations_shared";
import { canonicalizeProvider } from "../provider_ids";
import {
  customIntegrationAuthMethodValidator,
  jsonRecordValidator,
  providerValidator,
} from "../validators";
import { PROVIDER_MODULE_VERSION, integrationValidator, toIntegrationResponse } from "./model";
import {
  disconnectIntegrationsForOrgProvider,
  findIntegrationByProvider,
  loadIntegrationBundleById,
  upsertConnectedIntegration,
} from "./persistence";

const ORG_INTEGRATION_MANAGER_ROLES = [USER_ROLE.owner, USER_ROLE.admin] as const;

export const connectProvider = mutation({
  args: {
    provider: providerValidator,
    display_name: v.optional(v.string()),
  },
  returns: v.object({
    integration: integrationValidator,
    oauth_start_url: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [...ORG_INTEGRATION_MANAGER_ROLES]);
    const provider = canonicalizeProvider(args.provider);
    const displayName = args.display_name ?? `${provider} integration`;

    const integrationId = await upsertConnectedIntegration(ctx, auth.orgId, provider, displayName);

    const bundle = await loadIntegrationBundleById(ctx, integrationId);
    if (!bundle) {
      throw new Error("Integration not found");
    }

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.integrationConnected,
      payload: {
        provider,
        integration_id: bundle.integration.id,
      },
      created_at: nowIso(),
    });

    return {
      integration: toIntegrationResponse(bundle),
      oauth_start_url: null,
    };
  },
});

export const disconnectProvider = mutation({
  args: { provider: providerValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [...ORG_INTEGRATION_MANAGER_ROLES]);
    const provider = canonicalizeProvider(args.provider);
    await disconnectIntegrationsForOrgProvider(ctx, {
      orgId: auth.orgId,
      provider,
      actorType: AUDIT_ACTOR_TYPE.user,
      actorId: auth.userId,
    });

    return null;
  },
});

export const disconnectOAuthProviderForOrg = internalMutation({
  args: {
    orgId: v.string(),
    provider: providerValidator,
    actorId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const provider = canonicalizeProvider(args.provider);
    await disconnectIntegrationsForOrgProvider(ctx, {
      orgId: args.orgId,
      provider,
      actorType: AUDIT_ACTOR_TYPE.system,
      actorId: args.actorId ?? "integration_seed",
    });
    return null;
  },
});

export const updateMetadata = mutation({
  args: {
    provider: providerValidator,
    metadata: jsonRecordValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [...ORG_INTEGRATION_MANAGER_ROLES]);
    const provider = canonicalizeProvider(args.provider);
    const integration = await findIntegrationByProvider(ctx, auth.orgId, provider);
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

    await ctx.db.patch(account._id, {
      metadata: {
        ...normalizeJsonRecord(account.metadata),
        ...args.metadata,
      },
    });

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.integrationMetadataUpdated,
      payload: {
        provider,
        integration_id: integration.id,
      },
      created_at: nowIso(),
    });

    return null;
  },
});

export const upsertManagedOAuthConnectState = internalMutation({
  args: {
    orgId: v.string(),
    provider: providerValidator,
    correlationId: v.string(),
    initiatingUserId: v.string(),
    createdAt: v.string(),
    expiresAt: v.string(),
    pkceCodeVerifier: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const provider = canonicalizeProvider(args.provider);
    const existing = await ctx.db
      .query("oauth_connect_states")
      .withIndex("by_org_provider_correlation", (q) =>
        q
          .eq("org_id", args.orgId)
          .eq("provider", provider)
          .eq("correlation_id", args.correlationId),
      )
      .unique();
    const encryptedPkceCodeVerifier =
      typeof args.pkceCodeVerifier === "string" && args.pkceCodeVerifier.length > 0
        ? await encryptSecretValue(args.pkceCodeVerifier, "integration_credentials")
        : null;

    if (!existing) {
      await ctx.db.insert("oauth_connect_states", {
        id: randomIdFor("oauthst"),
        org_id: args.orgId,
        initiating_user_id: args.initiatingUserId,
        provider,
        correlation_id: args.correlationId,
        pkce_code_verifier_enc: encryptedPkceCodeVerifier,
        key_version: "convex_first_v1",
        created_at: args.createdAt,
        expires_at: args.expiresAt,
      });
      return null;
    }

    await ctx.db.patch(existing._id, {
      initiating_user_id: args.initiatingUserId,
      pkce_code_verifier_enc: encryptedPkceCodeVerifier,
      key_version: "convex_first_v1",
      created_at: args.createdAt,
      expires_at: args.expiresAt,
    });
    return null;
  },
});

export const getManagedOAuthConnectState = internalQuery({
  args: {
    orgId: v.string(),
    provider: providerValidator,
    correlationId: v.string(),
  },
  returns: v.union(
    v.object({
      provider: providerValidator,
      correlationId: v.string(),
      initiatingUserId: v.string(),
      createdAt: v.string(),
      expiresAt: v.string(),
      pkceCodeVerifier: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const provider = canonicalizeProvider(args.provider);
    const existing = await ctx.db
      .query("oauth_connect_states")
      .withIndex("by_org_provider_correlation", (q) =>
        q
          .eq("org_id", args.orgId)
          .eq("provider", provider)
          .eq("correlation_id", args.correlationId),
      )
      .unique();
    if (!existing) {
      return null;
    }
    if (Date.parse(existing.expires_at) <= Date.now()) {
      return null;
    }
    return {
      provider,
      correlationId: args.correlationId,
      initiatingUserId: existing.initiating_user_id,
      createdAt: existing.created_at,
      expiresAt: existing.expires_at,
      pkceCodeVerifier:
        existing.pkce_code_verifier_enc === null
          ? null
          : await decryptSecretValue(existing.pkce_code_verifier_enc, "integration_credentials"),
    };
  },
});

export const deleteManagedOAuthConnectState = internalMutation({
  args: {
    orgId: v.string(),
    provider: providerValidator,
    correlationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const provider = canonicalizeProvider(args.provider);
    const existing = await ctx.db
      .query("oauth_connect_states")
      .withIndex("by_org_provider_correlation", (q) =>
        q
          .eq("org_id", args.orgId)
          .eq("provider", provider)
          .eq("correlation_id", args.correlationId),
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

export const registerCustomIntegration = mutation({
  args: {
    base_url: v.string(),
    display_name: v.optional(v.string()),
    auth_method: v.optional(customIntegrationAuthMethodValidator),
    manifest: v.optional(jsonRecordValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [...ORG_INTEGRATION_MANAGER_ROLES]);

    const integrationId = await upsertConnectedIntegration(
      ctx,
      auth.orgId,
      CUSTOM_PROVIDER_ID,
      args.display_name ?? "Custom Integration",
      {
        base_url: args.base_url,
        auth_method: args.auth_method ?? CUSTOM_INTEGRATION_AUTH_METHOD.bearerToken,
        manifest: args.manifest ?? {},
      },
    );

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.integrationCustomRegistered,
      payload: {
        integration_id: integrationId,
        base_url: args.base_url,
      },
      created_at: nowIso(),
    });

    return null;
  },
});

export const upsertOAuthProviderForOrg = internalMutation({
  args: {
    orgId: v.string(),
    provider: providerValidator,
    displayName: v.string(),
    scopes: v.array(v.string()),
    externalAccountId: v.string(),
    accessToken: v.string(),
    refreshToken: v.union(v.string(), v.null()),
    expiresAt: v.union(v.string(), v.null()),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: integrationValidator,
  handler: async (ctx, args) => {
    const provider = canonicalizeProvider(args.provider);
    const existingIntegration = await findIntegrationByProvider(ctx, args.orgId, provider);

    const integrationId = existingIntegration?.id ?? randomIdFor("int");
    const now = nowIso();
    const encryptedAccessToken = await encryptSecretValue(
      args.accessToken,
      "integration_credentials",
    );
    const encryptedRefreshToken =
      args.refreshToken === null
        ? null
        : await encryptSecretValue(args.refreshToken, "integration_credentials");

    if (!existingIntegration) {
      await ctx.db.insert("integrations", {
        id: integrationId,
        org_id: args.orgId,
        provider,
        provider_module_version: PROVIDER_MODULE_VERSION,
        display_name: args.displayName,
        status: INTEGRATION_STATUS.connected,
        created_at: now,
        last_health_check_at: now,
        last_successful_health_check_at: now,
        last_error_code: null,
        last_error_category: null,
        last_webhook_at: null,
        degraded_reason: null,
      });
    } else {
      await ctx.db.patch(existingIntegration._id, {
        provider,
        provider_module_version: PROVIDER_MODULE_VERSION,
        status: INTEGRATION_STATUS.connected,
        display_name: args.displayName,
        last_health_check_at: now,
        last_successful_health_check_at: now,
        last_error_code: null,
        last_error_category: null,
        degraded_reason: null,
      });
    }

    const existingAccount = await ctx.db
      .query("integration_accounts")
      .withIndex("by_integration", (q) => q.eq("integration_id", integrationId))
      .unique();

    const accountId = existingAccount?.id ?? randomIdFor("iacc");
    const nextMetadata = {
      ...normalizeJsonRecord(existingAccount?.metadata),
      ...args.metadata,
    };

    if (!existingAccount) {
      await ctx.db.insert("integration_accounts", {
        id: accountId,
        integration_id: integrationId,
        external_account_id: args.externalAccountId,
        scopes: args.scopes,
        metadata: nextMetadata,
      });
    } else {
      await ctx.db.patch(existingAccount._id, {
        external_account_id: args.externalAccountId,
        scopes: args.scopes,
        metadata: nextMetadata,
      });
    }

    const existingCredential = await ctx.db
      .query("integration_credentials")
      .withIndex("by_integration_account", (q) => q.eq("integration_account_id", accountId))
      .unique();

    if (!existingCredential) {
      await ctx.db.insert("integration_credentials", {
        id: randomIdFor("icred"),
        integration_account_id: accountId,
        access_token_enc: encryptedAccessToken,
        refresh_token_enc: encryptedRefreshToken,
        expires_at: args.expiresAt,
        key_version: "convex_first_v1",
        last_refreshed_at: now,
        last_refresh_error_at: null,
        last_refresh_error_code: null,
      });
    } else {
      await ctx.db.patch(existingCredential._id, {
        access_token_enc: encryptedAccessToken,
        refresh_token_enc: encryptedRefreshToken,
        expires_at: args.expiresAt,
        last_refreshed_at: now,
        last_refresh_error_at: null,
        last_refresh_error_code: null,
      });
    }

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: args.orgId,
      actor_type: AUDIT_ACTOR_TYPE.system,
      actor_id: "oauth_callback",
      event_type: AUDIT_EVENT_TYPES.integrationConnected,
      payload: {
        provider,
        integration_id: integrationId,
      },
      created_at: now,
    });

    const bundle = await loadIntegrationBundleById(ctx, integrationId);
    if (!bundle) {
      throw new Error("Integration not found");
    }

    return toIntegrationResponse(bundle);
  },
});

export const getProviderTriggerIntegrationContext = internalQuery({
  args: {
    orgId: v.string(),
    provider: providerValidator,
  },
  returns: v.union(
    v.null(),
    v.object({
      org_id: v.string(),
      provider: providerValidator,
      scopes: v.array(v.string()),
      access_token: v.union(v.string(), v.null()),
      refresh_token: v.union(v.string(), v.null()),
      access_token_expires_at: v.union(v.string(), v.null()),
      integration_account_id: v.union(v.string(), v.null()),
      external_account_id: v.union(v.string(), v.null()),
      metadata: jsonRecordValidator,
    }),
  ),
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
    const credential = account
      ? await ctx.db
          .query("integration_credentials")
          .withIndex("by_integration_account", (q) => q.eq("integration_account_id", account.id))
          .unique()
      : null;

    const accessToken =
      credential === null
        ? null
        : await decryptSecretValue(credential.access_token_enc, "integration_credentials");
    const refreshToken =
      credential?.refresh_token_enc === null || credential?.refresh_token_enc === undefined
        ? null
        : await decryptSecretValue(credential.refresh_token_enc, "integration_credentials");

    return {
      org_id: args.orgId,
      provider,
      scopes: account?.scopes ?? [],
      access_token: accessToken,
      refresh_token: refreshToken,
      access_token_expires_at: credential?.expires_at ?? null,
      integration_account_id: account?.id ?? null,
      external_account_id: account?.external_account_id ?? null,
      metadata: normalizeJsonRecord(account?.metadata),
    };
  },
});

export const updateProviderTriggerIntegrationState = internalMutation({
  args: {
    orgId: v.string(),
    provider: providerValidator,
    triggerKey: v.string(),
    state: jsonRecordValidator,
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

    const metadata = normalizeJsonRecord(account.metadata);
    const lifecycleRoot = normalizeJsonRecord(metadata.automation_trigger_lifecycle);
    const providerRoot = normalizeJsonRecord(lifecycleRoot[provider]);

    await ctx.db.patch(account._id, {
      metadata: {
        ...metadata,
        automation_trigger_lifecycle: {
          ...lifecycleRoot,
          [provider]: {
            ...providerRoot,
            [args.triggerKey]: args.state,
          },
        },
      },
    });

    return null;
  },
});
