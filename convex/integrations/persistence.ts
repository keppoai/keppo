import type { MutationCtx, QueryCtx } from "../_generated/server";
import { nowIso, randomIdFor } from "../_auth";
import { encryptSecretValue } from "../crypto_helpers";
import { AUDIT_ACTOR_TYPE, AUDIT_EVENT_TYPES, INTEGRATION_STATUS } from "../domain_constants";
import { normalizeJsonRecord } from "../integrations_shared";
import type { ProviderId } from "../provider_ids";
import { PROVIDER_MODULE_VERSION, resolveFallbackScopes } from "./model";

type IntegrationReadCtx = {
  db: QueryCtx["db"] | MutationCtx["db"];
};

export const findIntegrationByProvider = async (
  ctx: IntegrationReadCtx,
  orgId: string,
  provider: ProviderId,
) => {
  const integrations = await ctx.db
    .query("integrations")
    .withIndex("by_org_provider", (q) => q.eq("org_id", orgId).eq("provider", provider))
    .collect();
  if (integrations.length === 0) {
    return null;
  }

  const sorted = [...integrations].sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );
  const connected = sorted.find(
    (integration) => integration.status === INTEGRATION_STATUS.connected,
  );
  return connected ?? sorted[0];
};

export const loadIntegrationBundleByProvider = async (
  ctx: IntegrationReadCtx,
  orgId: string,
  provider: ProviderId,
) => {
  const integration = await findIntegrationByProvider(ctx, orgId, provider);
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

  return { integration, account, credential };
};

export const upsertConnectedIntegration = async (
  ctx: MutationCtx,
  orgId: string,
  provider: ProviderId,
  displayName: string,
  metadata: Record<string, unknown> = {},
): Promise<string> => {
  const existingIntegration = await findIntegrationByProvider(ctx, orgId, provider);

  const integrationId = existingIntegration?.id ?? randomIdFor("int");
  const now = nowIso();

  if (!existingIntegration) {
    await ctx.db.insert("integrations", {
      id: integrationId,
      org_id: orgId,
      provider,
      provider_module_version: PROVIDER_MODULE_VERSION,
      display_name: displayName,
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
      display_name: displayName,
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
  const fallbackScopes = resolveFallbackScopes(provider);

  if (!existingAccount) {
    await ctx.db.insert("integration_accounts", {
      id: accountId,
      integration_id: integrationId,
      external_account_id: `acct_${provider}`,
      scopes: fallbackScopes,
      metadata,
    });
  } else {
    await ctx.db.patch(existingAccount._id, {
      scopes: fallbackScopes,
      metadata: {
        ...normalizeJsonRecord(existingAccount.metadata),
        ...metadata,
      },
    });
  }

  const existingCredential = await ctx.db
    .query("integration_credentials")
    .withIndex("by_integration_account", (q) => q.eq("integration_account_id", accountId))
    .unique();

  if (!existingCredential) {
    const encryptedPlaceholder = await encryptSecretValue(
      `placeholder_${provider}`,
      "integration_credentials",
    );
    await ctx.db.insert("integration_credentials", {
      id: randomIdFor("icred"),
      integration_account_id: accountId,
      access_token_enc: encryptedPlaceholder,
      refresh_token_enc: null,
      expires_at: null,
      key_version: "convex_first_v1",
      last_refreshed_at: null,
      last_refresh_error_at: null,
      last_refresh_error_code: null,
    });
  }

  return integrationId;
};

export const loadIntegrationBundleById = async (ctx: MutationCtx, integrationId: string) => {
  const integration = await ctx.db
    .query("integrations")
    .withIndex("by_custom_id", (q) => q.eq("id", integrationId))
    .unique();
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
  return { integration, account, credential };
};

export const disconnectIntegrationsForOrgProvider = async (
  ctx: MutationCtx,
  params: {
    orgId: string;
    provider: ProviderId;
    actorType: typeof AUDIT_ACTOR_TYPE.user | typeof AUDIT_ACTOR_TYPE.system;
    actorId: string;
  },
): Promise<void> => {
  const integrationsToDisconnect = await ctx.db
    .query("integrations")
    .withIndex("by_org_provider", (q) =>
      q.eq("org_id", params.orgId).eq("provider", params.provider),
    )
    .collect();

  for (const integration of integrationsToDisconnect) {
    const accounts = await ctx.db
      .query("integration_accounts")
      .withIndex("by_integration", (q) => q.eq("integration_id", integration.id))
      .collect();

    for (const account of accounts) {
      const credentials = await ctx.db
        .query("integration_credentials")
        .withIndex("by_integration_account", (q) => q.eq("integration_account_id", account.id))
        .collect();
      for (const credential of credentials) {
        await ctx.db.delete(credential._id);
      }
      await ctx.db.delete(account._id);
    }

    await ctx.db.patch(integration._id, {
      provider: params.provider,
      provider_module_version: PROVIDER_MODULE_VERSION,
      status: INTEGRATION_STATUS.disconnected,
      degraded_reason: null,
    });

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: params.orgId,
      actor_type: params.actorType,
      actor_id: params.actorId,
      event_type: AUDIT_EVENT_TYPES.integrationDisconnected,
      payload: {
        provider: params.provider,
        integration_id: integration.id,
      },
      created_at: nowIso(),
    });
  }
};
