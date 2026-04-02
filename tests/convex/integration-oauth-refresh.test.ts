import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { components } from "../../convex/_generated/api";
import { createConvexTestHarness } from "./harness";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  upsertOAuthProviderForOrg: makeFunctionReference<"mutation">(
    "integrations:upsertOAuthProviderForOrg",
  ),
  listIntegrations: makeFunctionReference<"query">("integrations:listForCurrentOrg"),
  listWorkspaces: makeFunctionReference<"query">("workspaces:listForCurrentOrg"),
  loadConnectorContext: makeFunctionReference<"query">("mcp:loadConnectorContext"),
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
  return { t, authT, orgId };
};

describe("managed OAuth integration refresh semantics", () => {
  it("keeps refreshable expired Google credentials connected", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("google_refreshable_expired");

    await t.mutation(refs.upsertOAuthProviderForOrg, {
      orgId,
      provider: "google",
      displayName: "Google",
      scopes: ["gmail.readonly"],
      externalAccountId: "automation@example.com",
      accessToken: "google_access_token",
      refreshToken: "google_refresh_token",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });

    const [integration] = await authT.query(refs.listIntegrations, {});
    expect(integration?.provider).toBe("google");
    expect(integration?.connected).toBe(true);
    expect(integration?.has_refresh_token).toBe(true);
    expect(integration?.credential_expires_at).toBe("2000-01-01T00:00:00.000Z");

    const [workspace] = await authT.query(refs.listWorkspaces, {});
    const connectorContext = await t.query(refs.loadConnectorContext, {
      workspaceId: workspace!.id,
      provider: "google",
    });

    expect(connectorContext.integration_id).toBe(integration?.id ?? null);
    expect(connectorContext.access_token).toBe("google_access_token");
    expect(connectorContext.refresh_token).toBe("google_refresh_token");
    expect(connectorContext.access_token_expires_at).toBe("2000-01-01T00:00:00.000Z");
  });

  it("requires reconnect once an expired Google credential has no refresh token", async () => {
    const { t, authT, orgId } = await createAuthenticatedHarness("google_non_refreshable_expired");

    await t.mutation(refs.upsertOAuthProviderForOrg, {
      orgId,
      provider: "google",
      displayName: "Google",
      scopes: ["gmail.readonly"],
      externalAccountId: "automation@example.com",
      accessToken: "google_access_token",
      refreshToken: null,
      expiresAt: "2000-01-01T00:00:00.000Z",
    });

    const [integration] = await authT.query(refs.listIntegrations, {});
    expect(integration?.provider).toBe("google");
    expect(integration?.connected).toBe(false);
    expect(integration?.has_refresh_token).toBe(false);

    const [workspace] = await authT.query(refs.listWorkspaces, {});
    const connectorContext = await t.query(refs.loadConnectorContext, {
      workspaceId: workspace!.id,
      provider: "google",
    });

    expect(connectorContext.integration_id).toBeNull();
    expect(connectorContext.access_token).toBeNull();
    expect(connectorContext.refresh_token).toBeNull();
  });
});
