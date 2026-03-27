import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { nowIso, randomIdFor } from "../_auth";
import { canonicalizeProvider } from "../provider_ids";
import { providerValidator } from "../validators";
import { findOrgIntegrationByProvider } from "./shared";
import { encryptSecretValue } from "../crypto_helpers";

export const updateIntegrationCredential = internalMutation({
  args: {
    orgId: v.string(),
    provider: providerValidator,
    accessToken: v.string(),
    refreshToken: v.union(v.string(), v.null()),
    expiresAt: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const provider = canonicalizeProvider(args.provider);
    const encryptedAccessToken = await encryptSecretValue(
      args.accessToken,
      "integration_credentials",
    );
    const encryptedRefreshToken =
      args.refreshToken === null
        ? null
        : await encryptSecretValue(args.refreshToken, "integration_credentials");
    const integration = await findOrgIntegrationByProvider(ctx, args.orgId, provider);
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

    if (credential) {
      await ctx.db.patch(credential._id, {
        access_token_enc: encryptedAccessToken,
        refresh_token_enc: encryptedRefreshToken,
        expires_at: args.expiresAt,
        last_refreshed_at: nowIso(),
        last_refresh_error_at: null,
        last_refresh_error_code: null,
      });
      return null;
    }

    await ctx.db.insert("integration_credentials", {
      id: randomIdFor("icred"),
      integration_account_id: account.id,
      access_token_enc: encryptedAccessToken,
      refresh_token_enc: encryptedRefreshToken,
      expires_at: args.expiresAt,
      key_version: "convex_first_v1",
      last_refreshed_at: nowIso(),
      last_refresh_error_at: null,
      last_refresh_error_code: null,
    });

    return null;
  },
});
