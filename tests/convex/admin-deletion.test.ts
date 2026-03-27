import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { components } from "../../convex/_generated/api";
import {
  AUTOMATION_STATUS,
  DEAD_LETTER_SOURCE,
  SUBSCRIPTION_STATUS,
} from "../../convex/domain_constants";
import { createConvexTestHarness, seedAutomationFixture } from "./harness";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  getOrgDeletionPreview: makeFunctionReference<"query">("admin:getOrgDeletionPreview"),
  getUserDeletionPreview: makeFunctionReference<"query">("admin:getUserDeletionPreview"),
  hardDeleteOrganization: makeFunctionReference<"mutation">("admin:hardDeleteOrganization"),
  hardDeleteUser: makeFunctionReference<"mutation">("admin:hardDeleteUser"),
};

const getAuthUserIdByEmail = async (
  t: ReturnType<typeof createConvexTestHarness>,
  email: string,
): Promise<string> => {
  const userId = await t.run(async (ctx) => {
    const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", value: email }],
    })) as { _id?: string } | null;
    return user?._id ?? null;
  });
  expect(userId).toBeTruthy();
  return userId!;
};

describe("admin hard deletion", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hard deletes an organization and its auth + app descendants", async () => {
    vi.stubEnv("KEPPO_LOCAL_ADMIN_BYPASS", "true");
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:keppo");

    const t = createConvexTestHarness();
    const ownerEmail = "hard-delete-org@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_hard_delete_org",
      email: ownerEmail,
      name: "Hard Delete Org",
    });
    const ownerAuthUserId = await getAuthUserIdByEmail(t, ownerEmail);
    const fixture = await seedAutomationFixture(t, orgId);
    const now = "2026-03-25T18:00:00.000Z";

    await t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "user",
          data: {
            name: "Extra Member",
            email: "extra-member@example.com",
            emailVerified: true,
            image: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      });
      const extraMember = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: "extra-member@example.com" }],
      })) as { _id: string };
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "member",
          data: {
            organizationId: orgId,
            userId: extraMember._id,
            role: "viewer",
            createdAt: Date.now(),
          },
        },
      });
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "session",
          data: {
            expiresAt: Date.now() + 60_000,
            token: "session_hard_delete_org_active_org",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ipAddress: "127.0.0.1",
            userAgent: "vitest",
            userId: extraMember._id,
            activeOrganizationId: orgId,
          },
        },
      });
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "invitation",
          data: {
            organizationId: orgId,
            email: "pending@example.com",
            role: "viewer",
            status: "pending",
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now(),
            inviterId: ownerAuthUserId,
          },
        },
      });

      await ctx.db.insert("notification_endpoints", {
        id: "nendpoint_hard_delete_org",
        org_id: orgId,
        user_id: ownerAuthUserId,
        type: "email",
        destination: ownerEmail,
        push_subscription: null,
        enabled: true,
        created_at: now,
      });
      await ctx.db.insert("notification_events", {
        id: "nevent_hard_delete_org",
        org_id: orgId,
        event_type: "approval_needed",
        channel: "email",
        title: "Approval needed",
        body: "Review this action",
        cta_url: "/",
        cta_label: "Open",
        action_id: null,
        endpoint_id: "nendpoint_hard_delete_org",
        read_at: null,
        status: "pending",
        attempts: 0,
        last_error: null,
        created_at: now,
      });
      await ctx.db.insert("dead_letter_queue", {
        id: "dlq_hard_delete_org",
        source_table: DEAD_LETTER_SOURCE.notificationEvents,
        source_id: "nevent_hard_delete_org",
        failure_reason: "test",
        error_code: null,
        payload: {},
        retry_count: 0,
        max_retries: 3,
        last_attempt_at: now,
        status: "pending",
        created_at: now,
        updated_at: now,
      });

      await ctx.db.insert("integrations", {
        id: "integration_hard_delete_org",
        org_id: orgId,
        provider: "github",
        display_name: "GitHub",
        provider_module_version: 1,
        status: "connected",
        created_at: now,
        last_health_check_at: null,
        last_successful_health_check_at: null,
        last_error_code: null,
        last_error_category: null,
        last_webhook_at: null,
        degraded_reason: null,
      });
      await ctx.db.insert("integration_accounts", {
        id: "iacc_hard_delete_org",
        integration_id: "integration_hard_delete_org",
        external_account_id: "acct_123",
        scopes: [],
        metadata: {},
      });
      await ctx.db.insert("integration_credentials", {
        id: "icred_hard_delete_org",
        integration_account_id: "iacc_hard_delete_org",
        access_token_enc: "enc",
        refresh_token_enc: null,
        expires_at: null,
        key_version: "1",
      });

      await ctx.db.insert("custom_mcp_servers", {
        id: "server_hard_delete_org",
        org_id: orgId,
        slug: "server-hard-delete-org",
        display_name: "Hard Delete Server",
        url: "https://example.com/mcp",
        bearer_token_enc: null,
        key_version: "1",
        status: "connected",
        last_discovery_at: now,
        last_discovery_error: null,
        tool_count: 1,
        created_by: ownerAuthUserId,
        created_at: now,
        updated_at: now,
      });
      await ctx.db.insert("custom_mcp_tools", {
        id: "tool_hard_delete_org",
        server_id: "server_hard_delete_org",
        org_id: orgId,
        tool_name: "server.write",
        remote_tool_name: "write",
        description: "Writes",
        input_schema_json: "{}",
        risk_level: "low",
        requires_approval: false,
        enabled: true,
        discovered_at: now,
      });
      await ctx.db.insert("workspace_custom_servers", {
        id: "wserver_hard_delete_org",
        workspace_id: fixture.workspaceId,
        server_id: "server_hard_delete_org",
        enabled: true,
        created_by: ownerAuthUserId,
        created_at: now,
      });

      await ctx.db.insert("credential_auth_failures", {
        id: "caf_hard_delete_org",
        workspace_id: fixture.workspaceId,
        ip_hash: "hash",
        attempt_count: 1,
        first_attempt_at: now,
        last_attempt_at: now,
        locked_at: null,
      });

      await ctx.db.insert("automations", {
        id: "automation_extra_hard_delete_org",
        org_id: orgId,
        workspace_id: fixture.workspaceId,
        slug: "extra-hard-delete-org",
        name: "Extra Automation",
        description: "Extra",
        mermaid_content: null,
        status: AUTOMATION_STATUS.paused,
        current_config_version_id: fixture.configVersionId,
        created_by: ownerAuthUserId,
        created_at: now,
        updated_at: now,
      });
    });

    await expect(t.query(refs.getOrgDeletionPreview, { orgLookup: orgId })).resolves.toMatchObject({
      orgId,
      memberCount: 2,
      workspaceCount: 2,
    });

    await expect(
      t.mutation(refs.hardDeleteOrganization, {
        orgId,
        confirm: "DELETE_ORG",
      }),
    ).resolves.toMatchObject({ orgId });

    const remaining = await t.run(async (ctx) => {
      const organization = await ctx.runQuery(components.betterAuth.queries.getOrgById, { orgId });
      const members = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "member",
        where: [{ field: "organizationId", value: orgId }],
        paginationOpts: { numItems: 20, cursor: null },
      })) as { page: Array<{ _id: string }> };
      const invitations = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "invitation",
        where: [{ field: "organizationId", value: orgId }],
        paginationOpts: { numItems: 20, cursor: null },
      })) as { page: Array<{ _id: string }> };
      const sessions = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "session",
        where: [{ field: "activeOrganizationId", value: orgId }],
        paginationOpts: { numItems: 20, cursor: null },
      })) as { page: Array<{ _id: string }> };

      return {
        organization,
        members: members.page.length,
        invitations: invitations.page.length,
        sessions: sessions.page.length,
        workspaces: (
          await ctx.db
            .query("workspaces")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .collect()
        ).length,
        automations: (
          await ctx.db
            .query("automations")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .collect()
        ).length,
        endpoints: (
          await ctx.db
            .query("notification_endpoints")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .collect()
        ).length,
        events: (
          await ctx.db
            .query("notification_events")
            .withIndex("by_org_created", (q) => q.eq("org_id", orgId))
            .collect()
        ).length,
        dlq: (
          await ctx.db
            .query("dead_letter_queue")
            .withIndex("by_source", (q) =>
              q
                .eq("source_table", DEAD_LETTER_SOURCE.notificationEvents)
                .eq("source_id", "nevent_hard_delete_org"),
            )
            .collect()
        ).length,
        integrations: (
          await ctx.db
            .query("integrations")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .collect()
        ).length,
        servers: (
          await ctx.db
            .query("custom_mcp_servers")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .collect()
        ).length,
        subscriptions: (
          await ctx.db
            .query("subscriptions")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .collect()
        ).length,
        retentionPolicies: (
          await ctx.db
            .query("retention_policies")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .collect()
        ).length,
      };
    });

    expect(remaining.organization).toBeNull();
    expect(remaining.members).toBe(0);
    expect(remaining.invitations).toBe(0);
    expect(remaining.sessions).toBe(0);
    expect(remaining.workspaces).toBe(0);
    expect(remaining.automations).toBe(0);
    expect(remaining.endpoints).toBe(0);
    expect(remaining.events).toBe(0);
    expect(remaining.dlq).toBe(0);
    expect(remaining.integrations).toBe(0);
    expect(remaining.servers).toBe(0);
    expect(remaining.subscriptions).toBe(0);
    expect(remaining.retentionPolicies).toBe(0);
  });

  it("blocks organization hard delete while Stripe still has an active subscription", async () => {
    vi.stubEnv("KEPPO_LOCAL_ADMIN_BYPASS", "true");
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:keppo");

    const t = createConvexTestHarness();
    const email = "hard-delete-org-billing@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_hard_delete_org_billing",
      email,
      name: "Hard Delete Org Billing",
    });

    await t.run(async (ctx) => {
      const now = "2026-03-26T08:00:00.000Z";
      await ctx.db.insert("subscriptions", {
        id: "sub_hard_delete_org_billing",
        org_id: orgId,
        tier: "starter",
        status: SUBSCRIPTION_STATUS.active,
        stripe_customer_id: "cus_hard_delete_org_billing",
        stripe_subscription_id: "sub_stripe_hard_delete_org_billing",
        current_period_start: now,
        current_period_end: "2026-04-26T08:00:00.000Z",
        created_at: now,
        updated_at: now,
      });
    });

    await expect(
      t.mutation(refs.hardDeleteOrganization, {
        orgId,
        confirm: "DELETE_ORG",
      }),
    ).rejects.toThrow(
      "Cancel the active Stripe subscription before permanently deleting this organization.",
    );

    await expect(t.query(refs.getOrgDeletionPreview, { orgLookup: orgId })).resolves.toMatchObject({
      orgId,
      memberCount: 1,
    });
  });

  it("hard deletes a user, their auth rows, and every org they belong to", async () => {
    vi.stubEnv("KEPPO_LOCAL_ADMIN_BYPASS", "true");
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:keppo");

    const t = createConvexTestHarness();
    const email = "hard-delete-user@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_hard_delete_user",
      email,
      name: "Hard Delete User",
    });
    const authUserId = await getAuthUserIdByEmail(t, email);

    await t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "session",
          data: {
            expiresAt: Date.now() + 60_000,
            token: "session_hard_delete_user",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ipAddress: "127.0.0.1",
            userAgent: "vitest",
            userId: authUserId,
            activeOrganizationId: orgId,
          },
        },
      });
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "verification",
          data: {
            identifier: email,
            value: "reset-token",
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      });
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "account",
          data: {
            accountId: "acct_hard_delete_user",
            providerId: "github",
            userId: authUserId,
            accessToken: null,
            refreshToken: null,
            idToken: null,
            accessTokenExpiresAt: null,
            refreshTokenExpiresAt: null,
            scope: null,
            password: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      });
    });

    await expect(
      t.query(refs.getUserDeletionPreview, { userLookup: email }),
    ).resolves.toMatchObject({
      email,
      organizationMemberships: [{ orgId, action: "delete_org" }],
    });

    await expect(
      t.mutation(refs.hardDeleteUser, {
        userId: authUserId,
        confirm: "DELETE_USER",
      }),
    ).resolves.toMatchObject({
      userId: authUserId,
      deletedOrgIds: [orgId],
    });

    const remaining = await t.run(async (ctx) => {
      const user = await ctx.runQuery(components.betterAuth.queries.getUserById, {
        userId: authUserId,
      });
      const sessions = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "session",
        where: [{ field: "userId", value: authUserId }],
        paginationOpts: { numItems: 20, cursor: null },
      })) as { page: Array<{ _id: string }> };
      const accounts = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "account",
        where: [{ field: "userId", value: authUserId }],
        paginationOpts: { numItems: 20, cursor: null },
      })) as { page: Array<{ _id: string }> };
      const members = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "member",
        where: [{ field: "userId", value: authUserId }],
        paginationOpts: { numItems: 20, cursor: null },
      })) as { page: Array<{ _id: string }> };
      const organization = await ctx.runQuery(components.betterAuth.queries.getOrgById, { orgId });
      const verifications = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "verification",
        where: [{ field: "identifier", value: email }],
        paginationOpts: { numItems: 20, cursor: null },
      })) as { page: Array<{ _id: string }> };
      return {
        user,
        sessions: sessions.page.length,
        accounts: accounts.page.length,
        members: members.page.length,
        organization,
        verifications: verifications.page.length,
      };
    });

    expect(remaining.user).toBeNull();
    expect(remaining.sessions).toBe(0);
    expect(remaining.accounts).toBe(0);
    expect(remaining.members).toBe(0);
    expect(remaining.organization).toBeNull();
    expect(remaining.verifications).toBe(0);
  });

  it("hard deletes a user without deleting organizations they only share with other owners", async () => {
    vi.stubEnv("KEPPO_LOCAL_ADMIN_BYPASS", "true");
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:keppo");

    const t = createConvexTestHarness();
    const ownerEmail = "shared-owner@example.com";
    const otherOwnerEmail = "other-owner@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_shared_owner",
      email: ownerEmail,
      name: "Shared Owner",
    });
    const ownerAuthUserId = await getAuthUserIdByEmail(t, ownerEmail);

    await t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "user",
          data: {
            name: "Other Owner",
            email: otherOwnerEmail,
            emailVerified: true,
            image: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      });
      const otherOwner = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: otherOwnerEmail }],
      })) as { _id: string };
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "member",
          data: {
            organizationId: orgId,
            userId: otherOwner._id,
            role: "owner",
            createdAt: Date.now(),
          },
        },
      });
    });

    await expect(
      t.query(refs.getUserDeletionPreview, { userLookup: ownerEmail }),
    ).resolves.toMatchObject({
      email: ownerEmail,
      organizationMemberships: [{ orgId, action: "remove_membership", ownerCount: 2 }],
    });

    await expect(
      t.mutation(refs.hardDeleteUser, {
        userId: ownerAuthUserId,
        confirm: "DELETE_USER",
      }),
    ).resolves.toMatchObject({
      userId: ownerAuthUserId,
      deletedOrgIds: [],
    });

    const remaining = await t.run(async (ctx) => {
      const organization = await ctx.runQuery(components.betterAuth.queries.getOrgById, { orgId });
      const members = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "member",
        where: [{ field: "organizationId", value: orgId }],
        paginationOpts: { numItems: 20, cursor: null },
      })) as { page: Array<{ userId: string }> };
      return {
        organization,
        memberCount: members.page.length,
      };
    });

    expect(remaining.organization).not.toBeNull();
    expect(remaining.memberCount).toBe(1);
  });

  it("blocks hard deleting a user who is the sole owner of a shared organization", async () => {
    vi.stubEnv("KEPPO_LOCAL_ADMIN_BYPASS", "true");
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:keppo");

    const t = createConvexTestHarness();
    const ownerEmail = "sole-owner@example.com";
    const viewerEmail = "shared-viewer@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_sole_owner",
      email: ownerEmail,
      name: "Sole Owner",
    });
    const ownerAuthUserId = await getAuthUserIdByEmail(t, ownerEmail);

    await t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "user",
          data: {
            name: "Shared Viewer",
            email: viewerEmail,
            emailVerified: true,
            image: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      });
      const viewer = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: viewerEmail }],
      })) as { _id: string };
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "member",
          data: {
            organizationId: orgId,
            userId: viewer._id,
            role: "viewer",
            createdAt: Date.now(),
          },
        },
      });
    });

    await expect(
      t.query(refs.getUserDeletionPreview, { userLookup: ownerEmail }),
    ).resolves.toMatchObject({
      email: ownerEmail,
      organizationMemberships: [{ orgId, action: "blocked_transfer_required", ownerCount: 1 }],
    });

    await expect(
      t.mutation(refs.hardDeleteUser, {
        userId: ownerAuthUserId,
        confirm: "DELETE_USER",
      }),
    ).rejects.toThrow(/Transfer ownership or manually delete/);
  });
});
