import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { components } from "../../convex/_generated/api";
import { AUDIT_EVENT_TYPES } from "../../convex/domain_constants";
import { createConvexTestHarness } from "./harness";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  listOrgAiKeys: makeFunctionReference<"query">("org_ai_keys:listOrgAiKeys"),
  deleteOrgAiKey: makeFunctionReference<"mutation">("org_ai_keys:deleteOrgAiKey"),
};

const createAuthedHarness = async (params: { userId: string; email: string; name: string }) => {
  const t = createConvexTestHarness();
  const orgId = await t.mutation(refs.seedUserOrg, params);
  const authUserId = await t.run(async (ctx) => {
    const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", value: params.email }],
    })) as { _id?: string } | null;
    return user?._id ?? null;
  });
  if (!authUserId) {
    throw new Error("Expected seeded auth user.");
  }
  return {
    orgId,
    t,
    authT: t.withIdentity({
      subject: authUserId,
      email: params.email,
      name: params.name,
      activeOrganizationId: orgId,
    }),
  };
};

describe("convex org ai key deletion", () => {
  it("hard-deletes user-managed keys and preserves audit metadata", async () => {
    const { orgId, t, authT } = await createAuthedHarness({
      userId: "usr_org_ai_key_delete",
      email: "org-ai-key-delete@example.com",
      name: "Org AI Key Delete",
    });
    const now = "2026-03-19T12:00:00.000Z";

    await t.run(async (ctx) => {
      await ctx.db.insert("org_ai_keys", {
        id: "oaik_delete_me",
        org_id: orgId,
        provider: "openai",
        key_mode: "subscription_token",
        encrypted_key: "keppo-v1.fakeiv.fakecipher",
        credential_kind: "openai_oauth",
        key_hint: "person@example.com",
        key_version: 7,
        is_active: true,
        subject_email: "person@example.com",
        account_id: "acct_1234",
        token_expires_at: "2026-03-20T12:00:00.000Z",
        last_refreshed_at: "2026-03-19T11:00:00.000Z",
        last_validated_at: "2026-03-19T11:30:00.000Z",
        created_by: "usr_org_ai_key_delete",
        created_at: now,
        updated_at: now,
      });
    });

    await expect(
      authT.mutation(refs.deleteOrgAiKey, { key_id: "oaik_delete_me" }),
    ).resolves.toBeNull();
    await expect(authT.query(refs.listOrgAiKeys, { org_id: orgId })).resolves.toEqual([]);

    const persisted = await t.run((ctx) =>
      ctx.db
        .query("org_ai_keys")
        .withIndex("by_custom_id", (q) => q.eq("id", "oaik_delete_me"))
        .unique(),
    );
    expect(persisted).toBeNull();

    const audits = await t.run((ctx) =>
      ctx.db
        .query("audit_events")
        .withIndex("by_org_event_type_created", (q) =>
          q.eq("org_id", orgId).eq("event_type", AUDIT_EVENT_TYPES.orgAiKeyDeleted),
        )
        .collect(),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.payload).toMatchObject({
      key_id: "oaik_delete_me",
      provider: "openai",
      key_mode: "subscription_token",
      credential_kind: "openai_oauth",
      key_hint: "person@example.com",
      key_version: 7,
      is_active: true,
      subject_email: "person@example.com",
      account_id: "acct_1234",
      token_expires_at: "2026-03-20T12:00:00.000Z",
      last_refreshed_at: "2026-03-19T11:00:00.000Z",
      last_validated_at: "2026-03-19T11:30:00.000Z",
      created_by: "usr_org_ai_key_delete",
      created_at: now,
      updated_at: now,
    });
  });

  it("keeps bundled keys protected from public deletion", async () => {
    const { orgId, t, authT } = await createAuthedHarness({
      userId: "usr_org_ai_key_bundled",
      email: "org-ai-key-bundled@example.com",
      name: "Org AI Key Bundled",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("org_ai_keys", {
        id: "oaik_bundled",
        org_id: orgId,
        provider: "openai",
        key_mode: "bundled",
        encrypted_key: "keppo-v1.fakeiv.fakecipher",
        credential_kind: "secret",
        key_hint: "...bundled",
        key_version: 1,
        is_active: true,
        subject_email: null,
        account_id: null,
        token_expires_at: null,
        last_refreshed_at: null,
        last_validated_at: "2026-03-19T12:00:00.000Z",
        created_by: "billing",
        created_at: "2026-03-19T12:00:00.000Z",
        updated_at: "2026-03-19T12:00:00.000Z",
      });
    });

    await expect(authT.mutation(refs.deleteOrgAiKey, { key_id: "oaik_bundled" })).rejects.toThrow(
      "Bundled AI keys are managed automatically by billing.",
    );

    const persisted = await t.run((ctx) =>
      ctx.db
        .query("org_ai_keys")
        .withIndex("by_custom_id", (q) => q.eq("id", "oaik_bundled"))
        .unique(),
    );
    expect(persisted?.key_mode).toBe("bundled");
  });
});
