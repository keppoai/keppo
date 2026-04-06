import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  automationConfigSummaryFields,
  automationConfigVersionViewFields,
  automationViewFields,
} from "../../convex/automations_shared";
import { getIncludedAiCreditsForTier } from "../../packages/shared/src/subscriptions.js";
import { postGatewaySeed } from "../e2e/helpers/api-client";
import {
  adminKey,
  convexUrl,
  createNamespace,
  fakeGatewayBaseUrl,
  resetAllLocalConvexState,
} from "./harness";

const http = new ConvexHttpClient(convexUrl);
(http as { setAdminAuth?: (token: string) => void }).setAdminAuth?.(adminKey);

const refs = {
  reset: makeFunctionReference<"mutation">("e2e:reset"),
  seedAutomationFixture: makeFunctionReference<"mutation">("e2e:seedAutomationFixture"),
  createAutomationViaContract: makeFunctionReference<"mutation">("e2e:createAutomationViaContract"),
  seedAutomationCascadeFixture: makeFunctionReference<"mutation">(
    "e2e:seedAutomationCascadeFixture",
  ),
  updateAutomationFixtureConfig: makeFunctionReference<"mutation">(
    "e2e:updateAutomationFixtureConfig",
  ),
  rollbackAutomationFixtureConfig: makeFunctionReference<"mutation">(
    "e2e:rollbackAutomationFixtureConfig",
  ),
  deleteAutomationFixture: makeFunctionReference<"mutation">("e2e:deleteAutomationFixture"),
  getAutomationCascadeFixtureState: makeFunctionReference<"query">(
    "e2e:getAutomationCascadeFixtureState",
  ),
  getAutomationFixtureState: makeFunctionReference<"query">("e2e:getAutomationFixtureState"),
  getAutomationFixturePublicViews: makeFunctionReference<"query">(
    "e2e:getAutomationFixturePublicViews",
  ),
  listAutomationFixtureRuns: makeFunctionReference<"query">("e2e:listAutomationFixtureRuns"),
  listAutomationFixtureTriggerEvents: makeFunctionReference<"query">(
    "e2e:listAutomationFixtureTriggerEvents",
  ),
  createAutomationRun: makeFunctionReference<"mutation">("automation_runs:createAutomationRun"),
  ingestProviderEvent: makeFunctionReference<"mutation">("automation_triggers:ingestProviderEvent"),
  upsertOAuthProviderForOrg: makeFunctionReference<"mutation">(
    "integrations:upsertOAuthProviderForOrg",
  ),
  updateAutomationRunStatus: makeFunctionReference<"mutation">(
    "automation_runs:updateAutomationRunStatus",
  ),
  reconcileProviderTriggerSubscriptions: makeFunctionReference<"action">(
    "automation_scheduler_node:reconcileProviderTriggerSubscriptions",
  ),
  checkScheduledAutomations: makeFunctionReference<"mutation">(
    "automation_scheduler:checkScheduledAutomations",
  ),
  processAutomationTriggerEvents: makeFunctionReference<"mutation">(
    "automation_scheduler:processAutomationTriggerEvents",
  ),
  deductAiCredit: makeFunctionReference<"mutation">("ai_credits:deductAiCredit"),
  addPurchasedCredits: makeFunctionReference<"mutation">("ai_credits:addPurchasedCredits"),
};

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const expectCode = async (fn: () => Promise<unknown>, code: string): Promise<void> => {
  try {
    await fn();
    throw new Error(`Expected error containing ${code}`);
  } catch (error) {
    expect(extractErrorMessage(error)).toContain(code);
  }
};

const expectExactKeys = (value: Record<string, unknown>, keys: readonly string[]): void => {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
  expect(value).not.toHaveProperty("_id");
  expect(value).not.toHaveProperty("_creationTime");
};

describe.sequential("Local Convex Automation Integration", () => {
  beforeEach(async () => {
    await resetAllLocalConvexState();
  });

  it("handles CRUD and config version history for automation fixtures", async () => {
    const seeded = await http.mutation(refs.seedAutomationFixture, {
      tier: "free",
    });

    const initial = await http.query(refs.getAutomationFixtureState, {
      automationId: seeded.automationId,
    });
    expect(initial.automation?.current_config_version_id).toBe(seeded.configVersionId);
    expect(initial.versions.map((version) => version.version_number)).toEqual([1]);

    const updated = await http.mutation(refs.updateAutomationFixtureConfig, {
      automationId: seeded.automationId,
      prompt: "Prompt v2",
      changeSummary: "v2 rollout",
    });

    const afterUpdate = await http.query(refs.getAutomationFixtureState, {
      automationId: seeded.automationId,
    });
    expect(afterUpdate.automation?.current_config_version_id).toBe(updated.configVersionId);
    expect(afterUpdate.versions.map((version) => version.version_number)).toEqual([2, 1]);

    await http.mutation(refs.rollbackAutomationFixtureConfig, {
      automationId: seeded.automationId,
      configVersionId: seeded.configVersionId,
    });
    const afterRollback = await http.query(refs.getAutomationFixtureState, {
      automationId: seeded.automationId,
    });
    expect(afterRollback.automation?.current_config_version_id).toBe(seeded.configVersionId);

    const deleted = await http.mutation(refs.deleteAutomationFixture, {
      automationId: seeded.automationId,
    });
    expect(deleted.deleted).toBe(true);

    const afterDelete = await http.query(refs.getAutomationFixtureState, {
      automationId: seeded.automationId,
    });
    expect(afterDelete.automation).toBeNull();
    expect(afterDelete.versions).toEqual([]);
  }, 10_000);

  it("returns only public automation fields in live local contract views", async () => {
    const seeded = await http.mutation(refs.seedAutomationFixture, {
      tier: "free",
    });

    const contract = await http.query(refs.getAutomationFixturePublicViews, {
      automationId: seeded.automationId,
      workspaceId: seeded.workspaceId,
      configVersionId: seeded.configVersionId,
    });

    expectExactKeys(contract.created.automation, automationViewFields);
    expectExactKeys(contract.created.config_version, automationConfigVersionViewFields);
    expect(contract.created.automation.memory).toBe("");
    expectExactKeys(contract.detail.automation, automationViewFields);
    expectExactKeys(contract.detail.current_config_version, automationConfigVersionViewFields);
    expectExactKeys(contract.list_entry.automation, automationViewFields);
    expectExactKeys(contract.list_entry.current_config_version, automationConfigSummaryFields);
    for (const version of contract.versions) {
      expectExactKeys(version, automationConfigVersionViewFields);
    }
  }, 10_000);

  it("returns only public fields from the create-automation contract path", async () => {
    const created = await http.mutation(refs.createAutomationViaContract, {
      tier: "free",
    });

    expectExactKeys(created.created.automation, automationViewFields);
    expectExactKeys(created.created.config_version, automationConfigVersionViewFields);
    expect(created.created.automation.memory).toBe("");
    expect(created.created.warning).toBeNull();
  });

  it("blocks run creation for keyless automations even when creation remains allowed", async () => {
    const created = await http.mutation(refs.createAutomationViaContract, {
      tier: "free",
      seedByokKey: false,
    });

    expect(created.created.automation.status).toBe("active");
    await expectCode(
      () =>
        http.mutation(refs.createAutomationRun, {
          automation_id: created.created.automation.id,
          trigger_type: "manual",
        }),
      "automation.byok_required",
    );
  });

  it("normalizes legacy event trigger inputs into provider-trigger config fields", async () => {
    const created = await http.mutation(refs.createAutomationViaContract, {
      tier: "free",
      triggerType: "event",
      eventProvider: "github",
      eventType: "issues.opened",
      eventPredicate: "payload.action == 'opened'",
    });

    expect(created.created.config_version.provider_trigger).toEqual({
      provider_id: "github",
      trigger_key: "issues.opened",
      schema_version: 1,
      filter: {
        predicate: "payload.action == 'opened'",
      },
      delivery: {
        preferred_mode: "webhook",
        supported_modes: ["webhook", "polling"],
        fallback_mode: "polling",
      },
      subscription_state: {
        status: "inactive",
        active_mode: null,
        last_error: null,
        updated_at: null,
      },
    });
    expect(created.created.config_version.provider_trigger_migration_state).toMatchObject({
      status: "legacy_passthrough",
      legacy_event_provider: "github",
      legacy_event_type: "issues.opened",
      legacy_event_predicate: "payload.action == 'opened'",
    });
    expect(created.created.config_version.event_provider).toBe("github");
    expect(created.created.config_version.event_type).toBe("issues.opened");
    expect(created.created.config_version.event_predicate).toBe("payload.action == 'opened'");
  });

  it("records native provider-trigger matches, skip reasons, and dispatches runs from the queued config snapshot", async () => {
    const created = await http.mutation(refs.createAutomationViaContract, {
      tier: "free",
      triggerType: "event",
      providerTrigger: {
        provider_id: "google",
        trigger_key: "incoming_email",
        schema_version: 1,
        filter: {
          from: "alerts@example.com",
          unread_only: true,
        },
        delivery: {
          preferred_mode: "webhook",
          supported_modes: ["webhook", "polling"],
          fallback_mode: "polling",
        },
        subscription_state: {
          status: "active",
          active_mode: "webhook",
          last_error: null,
          updated_at: null,
        },
      },
    });

    expect(created.created.config_version.provider_trigger?.subscription_state).toEqual({
      status: "inactive",
      active_mode: null,
      last_error: null,
      updated_at: null,
    });

    const skipped = await http.mutation(refs.ingestProviderEvent, {
      org_id: created.orgId,
      provider: "google",
      trigger_key: "incoming_email",
      provider_event_id: "gmail_delivery_skip",
      provider_event_type: "google.gmail.incoming_email",
      delivery_mode: "webhook",
      event_payload: {
        delivery_id: "gmail_delivery_skip",
        event_type: "google.gmail.incoming_email",
        history_id: "101",
        message: {
          id: "msg_skip",
          thread_id: "thread_skip",
          from: "other@example.com",
          to: ["team@example.com"],
          subject: "Ignore me",
          label_ids: [],
        },
      },
      event_payload_ref: "gmail_delivery_skip",
    });
    expect(skipped).toEqual({
      queued_count: 0,
      skipped_count: 1,
    });

    const invalidPayload = await http.mutation(refs.ingestProviderEvent, {
      org_id: created.orgId,
      provider: "google",
      trigger_key: "incoming_email",
      provider_event_id: "gmail_delivery_invalid",
      provider_event_type: "google.gmail.incoming_email",
      delivery_mode: "webhook",
      event_payload: {
        delivery_id: "gmail_delivery_invalid",
        event_type: "google.gmail.incoming_email",
        history_id: "103",
        message: {
          id: "",
          thread_id: "thread_invalid",
        },
      },
      event_payload_ref: "gmail_delivery_invalid",
    });
    expect(invalidPayload).toEqual({
      queued_count: 0,
      skipped_count: 1,
    });

    const queued = await http.mutation(refs.ingestProviderEvent, {
      org_id: created.orgId,
      provider: "google",
      trigger_key: "incoming_email",
      provider_event_id: "gmail_delivery_match",
      provider_event_type: "google.gmail.incoming_email",
      delivery_mode: "webhook",
      event_payload: {
        delivery_id: "gmail_delivery_match",
        event_type: "google.gmail.incoming_email",
        history_id: "102",
        message: {
          id: "msg_match",
          thread_id: "thread_match",
          from: "alerts@example.com",
          to: ["team@example.com"],
          subject: "Server alert",
          label_ids: ["UNREAD", "Label_1"],
        },
      },
      event_payload_ref: "gmail_delivery_match",
    });
    expect(queued).toEqual({
      queued_count: 1,
      skipped_count: 0,
    });

    const triggerEventsBeforeDispatch = await http.query(refs.listAutomationFixtureTriggerEvents, {
      automationId: created.created.automation.id,
    });
    expect(triggerEventsBeforeDispatch).toEqual([
      expect.objectContaining({
        event_id: "gmail_delivery_match",
        event_type: "google.gmail.incoming_email",
        status: "pending",
        match_status: "matched",
        failure_reason: null,
        delivery_mode: "webhook",
        config_version_id: created.created.config_version.id,
      }),
      expect.objectContaining({
        event_id: "gmail_delivery_invalid",
        event_type: "google.gmail.incoming_email",
        status: "skipped",
        match_status: "skipped",
        failure_reason: "invalid_event_payload",
        delivery_mode: "webhook",
        config_version_id: created.created.config_version.id,
      }),
      expect.objectContaining({
        event_id: "gmail_delivery_skip",
        event_type: "google.gmail.incoming_email",
        status: "skipped",
        match_status: "skipped",
        failure_reason: "filter_mismatch",
        delivery_mode: "webhook",
        config_version_id: created.created.config_version.id,
      }),
    ]);

    const processed = await http.mutation(refs.processAutomationTriggerEvents, {
      limit: 10,
    });
    expect(processed.processed).toBeGreaterThanOrEqual(1);
    expect(processed.dispatched).toBe(1);
    expect(processed.skipped).toBe(0);

    const triggerEventsAfterDispatch = await http.query(refs.listAutomationFixtureTriggerEvents, {
      automationId: created.created.automation.id,
    });
    expect(triggerEventsAfterDispatch[0]).toEqual(
      expect.objectContaining({
        event_id: "gmail_delivery_match",
        status: "dispatched",
        match_status: "matched",
        failure_reason: null,
        config_version_id: created.created.config_version.id,
      }),
    );

    const runs = await http.query(refs.listAutomationFixtureRuns, {
      automationId: created.created.automation.id,
    });
    expect(runs).toEqual([
      expect.objectContaining({
        trigger_type: "event",
      }),
    ]);
  }, 10_000);

  it("reconciles Gmail provider triggers through polling fallback and ingests normalized mail events", async () => {
    const namespace = createNamespace("local", "gmail-trigger-lifecycle");
    const created = await http.mutation(refs.createAutomationViaContract, {
      tier: "free",
      triggerType: "event",
      providerTrigger: {
        provider_id: "google",
        trigger_key: "incoming_email",
        schema_version: 1,
        filter: {
          from: "alerts@example.com",
          unread_only: true,
        },
        delivery: {
          preferred_mode: "webhook",
          supported_modes: ["webhook", "polling"],
          fallback_mode: "polling",
        },
        subscription_state: {
          status: "inactive",
          active_mode: null,
          last_error: null,
          updated_at: null,
        },
      },
    });

    await http.mutation(refs.upsertOAuthProviderForOrg, {
      orgId: created.orgId,
      provider: "google",
      displayName: "Google",
      scopes: ["gmail.readonly", "gmail.modify"],
      externalAccountId: "automation@example.com",
      accessToken: "fake_gmail_access_token",
      refreshToken: "fake_gmail_refresh_token",
      expiresAt: null,
      metadata: {
        e2e_namespace: namespace,
      },
    });

    await postGatewaySeed(fakeGatewayBaseUrl, namespace, "google", {
      messages: [
        {
          id: "msg_existing",
          threadId: "thr_existing",
          from: "support@example.com",
          to: "automation@example.com",
          subject: "Existing mailbox state",
          snippet: "Existing mailbox state",
          body: "Existing mailbox state",
          unread: false,
          historyId: "2001",
          labelIds: ["INBOX"],
        },
      ],
      historyCounter: 2001,
    });

    const firstReconcile = await http.action(refs.reconcileProviderTriggerSubscriptions, {});
    expect(firstReconcile.processed).toBeGreaterThanOrEqual(1);
    expect(firstReconcile.events_ingested).toBeGreaterThanOrEqual(0);

    const publicViewsAfterFirstReconcile = await http.query(refs.getAutomationFixturePublicViews, {
      automationId: created.created.automation.id,
      workspaceId: created.workspaceId,
      configVersionId: created.created.config_version.id,
    });
    expect(
      publicViewsAfterFirstReconcile.detail.current_config_version.provider_trigger
        ?.subscription_state,
    ).toEqual({
      status: "active",
      active_mode: "polling",
      last_error: null,
      updated_at: expect.any(String),
    });

    const triggerEventsAfterFirstReconcile = await http.query(
      refs.listAutomationFixtureTriggerEvents,
      {
        automationId: created.created.automation.id,
      },
    );
    expect(triggerEventsAfterFirstReconcile).toEqual([]);

    await postGatewaySeed(fakeGatewayBaseUrl, namespace, "google", {
      messages: [
        {
          id: "msg_existing",
          threadId: "thr_existing",
          from: "support@example.com",
          to: "automation@example.com",
          subject: "Existing mailbox state",
          snippet: "Existing mailbox state",
          body: "Existing mailbox state",
          unread: false,
          historyId: "2001",
          labelIds: ["INBOX"],
        },
        {
          id: "msg_live_1",
          threadId: "thr_live_1",
          from: "alerts@example.com",
          to: "automation@example.com",
          subject: "Alert: CPU threshold exceeded",
          snippet: "CPU threshold exceeded",
          body: "CPU threshold exceeded",
          unread: true,
          historyId: "2002",
          labelIds: ["INBOX", "UNREAD"],
        },
      ],
      historyCounter: 2002,
    });

    const secondReconcile = await http.action(refs.reconcileProviderTriggerSubscriptions, {});
    expect(secondReconcile.processed).toBeGreaterThanOrEqual(1);
    expect(secondReconcile.events_ingested).toBeGreaterThanOrEqual(1);

    const triggerEvents = await http.query(refs.listAutomationFixtureTriggerEvents, {
      automationId: created.created.automation.id,
    });
    expect(triggerEvents[0]).toEqual(
      expect.objectContaining({
        event_id: "msg_live_1",
        event_type: "google.gmail.incoming_email",
        delivery_mode: "polling",
        match_status: "matched",
        status: "pending",
      }),
    );

    const publicViewsAfterSecondReconcile = await http.query(refs.getAutomationFixturePublicViews, {
      automationId: created.created.automation.id,
      workspaceId: created.workspaceId,
      configVersionId: created.created.config_version.id,
    });
    expect(
      publicViewsAfterSecondReconcile.detail.current_config_version.provider_trigger
        ?.subscription_state,
    ).toEqual({
      status: "active",
      active_mode: "polling",
      last_error: null,
      updated_at: expect.any(String),
    });
  }, 20_000);

  it("allows direct provider-trigger reconciliation without relying on cron registration", async () => {
    const namespace = createNamespace("local", "gmail-trigger-direct-reconcile");
    const created = await http.mutation(refs.createAutomationViaContract, {
      tier: "free",
      triggerType: "event",
      providerTrigger: {
        provider_id: "google",
        trigger_key: "incoming_email",
        schema_version: 1,
        filter: {
          from: "alerts@example.com",
          unread_only: true,
        },
        delivery: {
          preferred_mode: "webhook",
          supported_modes: ["webhook", "polling"],
          fallback_mode: "polling",
        },
        subscription_state: {
          status: "inactive",
          active_mode: null,
          last_error: null,
          updated_at: null,
        },
      },
    });

    await http.mutation(refs.upsertOAuthProviderForOrg, {
      orgId: created.orgId,
      provider: "google",
      displayName: "Google",
      scopes: ["gmail.readonly", "gmail.modify"],
      externalAccountId: "automation@example.com",
      accessToken: "fake_gmail_access_token",
      refreshToken: "fake_gmail_refresh_token",
      expiresAt: null,
      metadata: {
        e2e_namespace: namespace,
      },
    });

    await postGatewaySeed(fakeGatewayBaseUrl, namespace, "google", {
      messages: [
        {
          id: "msg_existing_direct_reconcile",
          threadId: "thr_existing_direct_reconcile",
          from: "alerts@example.com",
          to: "automation@example.com",
          subject: "Preview-safe direct reconcile",
          snippet: "Preview-safe direct reconcile",
          body: "Preview-safe direct reconcile",
          unread: true,
          historyId: "3001",
          labelIds: ["INBOX", "UNREAD"],
        },
      ],
      historyCounter: 3001,
    });

    const reconcile = await http.action(refs.reconcileProviderTriggerSubscriptions, {});
    expect(reconcile.processed).toBeGreaterThanOrEqual(1);

    const publicViewsAfterReconcile = await http.query(refs.getAutomationFixturePublicViews, {
      automationId: created.created.automation.id,
      workspaceId: created.workspaceId,
      configVersionId: created.created.config_version.id,
    });
    expect(
      publicViewsAfterReconcile.detail.current_config_version.provider_trigger?.subscription_state,
    ).toEqual({
      status: "active",
      active_mode: "polling",
      last_error: null,
      updated_at: expect.any(String),
    });
  }, 15_000);

  it("reconciles Reddit mentions through the generic polling scheduler and suppresses the initial backlog", async () => {
    const namespace = createNamespace("local", "reddit-trigger-lifecycle");
    const created = await http.mutation(refs.createAutomationViaContract, {
      tier: "free",
      triggerType: "event",
      providerTrigger: {
        provider_id: "reddit",
        trigger_key: "mentions",
        schema_version: 1,
        filter: {
          from: "support_mod",
          body_contains: "incident",
        },
        delivery: {
          preferred_mode: "polling",
          supported_modes: ["polling"],
          fallback_mode: null,
        },
        subscription_state: {
          status: "inactive",
          active_mode: null,
          last_error: null,
          updated_at: null,
        },
      },
    });

    await http.mutation(refs.upsertOAuthProviderForOrg, {
      orgId: created.orgId,
      provider: "reddit",
      displayName: "Reddit",
      scopes: ["reddit.read"],
      externalAccountId: "keppo_bot",
      accessToken: "fake_reddit_access_token",
      refreshToken: "fake_reddit_refresh_token",
      expiresAt: null,
      metadata: {
        e2e_namespace: namespace,
      },
    });

    await postGatewaySeed(fakeGatewayBaseUrl, namespace, "reddit", {
      me: {
        id: "u_200",
        name: "keppo_bot",
      },
      messages: [
        {
          id: "t4_existing",
          to: "keppo_bot",
          from: "support_mod",
          subject: "Existing mention",
          body: "Please review this incident for u/keppo_bot",
          unread: true,
        },
      ],
    });

    const firstReconcile = await http.action(refs.reconcileProviderTriggerSubscriptions, {});
    expect(firstReconcile.processed).toBeGreaterThanOrEqual(1);

    const initialEvents = await http.query(refs.listAutomationFixtureTriggerEvents, {
      automationId: created.created.automation.id,
    });
    expect(initialEvents).toEqual([]);

    await postGatewaySeed(fakeGatewayBaseUrl, namespace, "reddit", {
      me: {
        id: "u_200",
        name: "keppo_bot",
      },
      messages: [
        {
          id: "t4_live",
          to: "keppo_bot",
          from: "support_mod",
          subject: "Live mention",
          body: "A fresh incident just mentioned u/keppo_bot",
          unread: true,
        },
        {
          id: "t4_existing",
          to: "keppo_bot",
          from: "support_mod",
          subject: "Existing mention",
          body: "Please review this incident for u/keppo_bot",
          unread: true,
        },
      ],
    });

    const secondReconcile = await http.action(refs.reconcileProviderTriggerSubscriptions, {});
    expect(secondReconcile.events_ingested).toBeGreaterThanOrEqual(1);

    const triggerEvents = await http.query(refs.listAutomationFixtureTriggerEvents, {
      automationId: created.created.automation.id,
    });
    expect(triggerEvents[0]).toEqual(
      expect.objectContaining({
        event_id: "t4_live",
        event_type: "reddit.inbox.mention",
        delivery_mode: "polling",
        match_status: "matched",
        status: "pending",
      }),
    );
  }, 15_000);

  it("reconciles X mentions through the generic polling scheduler and advances its seen cursor", async () => {
    const namespace = createNamespace("local", "x-trigger-lifecycle");
    const created = await http.mutation(refs.createAutomationViaContract, {
      tier: "free",
      triggerType: "event",
      providerTrigger: {
        provider_id: "x",
        trigger_key: "mentions",
        schema_version: 1,
        filter: {
          text_contains: "outage",
          author_id: "u_201",
        },
        delivery: {
          preferred_mode: "polling",
          supported_modes: ["polling"],
          fallback_mode: null,
        },
        subscription_state: {
          status: "inactive",
          active_mode: null,
          last_error: null,
          updated_at: null,
        },
      },
    });

    await http.mutation(refs.upsertOAuthProviderForOrg, {
      orgId: created.orgId,
      provider: "x",
      displayName: "X",
      scopes: ["x.read"],
      externalAccountId: "u_200",
      accessToken: "fake_x_access_token",
      refreshToken: "fake_x_refresh_token",
      expiresAt: null,
      metadata: {
        e2e_namespace: namespace,
      },
    });

    await postGatewaySeed(fakeGatewayBaseUrl, namespace, "x", {
      users: [
        { id: "u_200", username: "keppo_bot", name: "Keppo Bot" },
        { id: "u_201", username: "alerts", name: "Alerts" },
      ],
      posts: [
        {
          id: "x_900",
          text: "Earlier outage mention for @keppo_bot",
          authorId: "u_201",
          createdAt: "2026-03-19T23:59:00.000Z",
        },
      ],
    });

    const firstReconcile = await http.action(refs.reconcileProviderTriggerSubscriptions, {});
    expect(firstReconcile.processed).toBeGreaterThanOrEqual(1);

    const initialEvents = await http.query(refs.listAutomationFixtureTriggerEvents, {
      automationId: created.created.automation.id,
    });
    expect(initialEvents).toEqual([]);

    await postGatewaySeed(fakeGatewayBaseUrl, namespace, "x", {
      users: [
        { id: "u_200", username: "keppo_bot", name: "Keppo Bot" },
        { id: "u_201", username: "alerts", name: "Alerts" },
      ],
      posts: [
        {
          id: "x_901",
          text: "Fresh outage mention for @keppo_bot",
          authorId: "u_201",
          createdAt: "2026-03-20T00:01:00.000Z",
        },
        {
          id: "x_900",
          text: "Earlier outage mention for @keppo_bot",
          authorId: "u_201",
          createdAt: "2026-03-19T23:59:00.000Z",
        },
      ],
    });

    const secondReconcile = await http.action(refs.reconcileProviderTriggerSubscriptions, {});
    expect(secondReconcile.events_ingested).toBeGreaterThanOrEqual(1);

    const triggerEvents = await http.query(refs.listAutomationFixtureTriggerEvents, {
      automationId: created.created.automation.id,
    });
    expect(triggerEvents[0]).toEqual(
      expect.objectContaining({
        event_id: "x_901",
        event_type: "x.mentions.post",
        delivery_mode: "polling",
        match_status: "matched",
        status: "pending",
      }),
    );
  }, 15_000);

  it("cascades automation descendants on delete without leaving orphaned rows", async () => {
    const seeded = await http.mutation(refs.seedAutomationCascadeFixture, {
      tier: "free",
    });

    const beforeDelete = await http.query(refs.getAutomationCascadeFixtureState, seeded);
    expect(beforeDelete.automation).toBe(true);
    expect(beforeDelete.configVersion).toBe(true);
    expect(beforeDelete.triggerEvent).toBe(true);
    expect(beforeDelete.run).toBe(true);
    expect(beforeDelete.runLogCount).toBeGreaterThan(0);
    expect(beforeDelete.toolCall).toBe(true);
    expect(beforeDelete.action).toBe(true);
    expect(beforeDelete.approval).toBe(true);
    expect(beforeDelete.policyDecision).toBe(true);
    expect(beforeDelete.rule).toBe(true);
    expect(beforeDelete.ruleMatch).toBe(true);
    expect(beforeDelete.sensitiveBlob).toBe(true);

    await http.mutation(refs.deleteAutomationFixture, {
      automationId: seeded.automationId,
    });

    const afterDelete = await http.query(refs.getAutomationCascadeFixtureState, seeded);
    expect(afterDelete.automation).toBe(false);
    expect(afterDelete.configVersion).toBe(false);
    expect(afterDelete.triggerEvent).toBe(false);
    expect(afterDelete.run).toBe(false);
    expect(afterDelete.runLogCount).toBe(0);
    expect(afterDelete.toolCall).toBe(false);
    expect(afterDelete.action).toBe(false);
    expect(afterDelete.approval).toBe(false);
    expect(afterDelete.policyDecision).toBe(false);
    expect(afterDelete.ruleMatch).toBe(false);
    expect(afterDelete.sensitiveBlob).toBe(false);
    expect(afterDelete.rule).toBe(true);
  });

  it("enforces run concurrency limits and schedules periodic runs", async () => {
    const seeded = await http.mutation(refs.seedAutomationFixture, {
      tier: "free",
      scheduleCron: "* * * * *",
    });

    const firstRun = await http.mutation(refs.createAutomationRun, {
      automation_id: seeded.automationId,
      trigger_type: "manual",
    });
    expect(firstRun.status).toBe("pending");

    await expectCode(
      async () =>
        await http.mutation(refs.createAutomationRun, {
          automation_id: seeded.automationId,
          trigger_type: "manual",
        }),
      "AUTOMATION_CONCURRENCY_LIMIT_REACHED",
    );

    await http.mutation(refs.updateAutomationRunStatus, {
      automation_run_id: firstRun.id,
      status: "cancelled",
      error_message: "test cleanup",
    });

    const firstScheduleCheck = await http.mutation(refs.checkScheduledAutomations, {});
    expect(firstScheduleCheck.scanned).toBeGreaterThan(0);
    expect(firstScheduleCheck.dispatched).toBeGreaterThan(0);

    const runs = await http.query(refs.listAutomationFixtureRuns, {
      automationId: seeded.automationId,
    });
    expect(runs.some((run) => run.trigger_type === "schedule")).toBe(true);

    const secondScheduleCheck = await http.mutation(refs.checkScheduledAutomations, {});
    expect(secondScheduleCheck.dispatched).toBe(0);
  });

  it("skips scheduled automations with no remaining hosted runtime credits without aborting the scheduler loop", async () => {
    const blocked = await http.mutation(refs.createAutomationViaContract, {
      tier: "free",
      triggerType: "schedule",
      scheduleCron: "* * * * *",
      seedByokKey: false,
    });
    const runnable = await http.mutation(refs.seedAutomationFixture, {
      tier: "free",
      scheduleCron: "* * * * *",
    });

    const freeTierCredits = getIncludedAiCreditsForTier("free").total;
    for (let count = 0; count < freeTierCredits; count += 1) {
      await http.mutation(refs.deductAiCredit, {
        org_id: blocked.orgId,
        usage_source: "runtime",
      });
    }

    const scheduleCheck = await http.mutation(refs.checkScheduledAutomations, {});
    expect(scheduleCheck).toEqual({
      scanned: 2,
      dispatched: 1,
      skipped: 1,
    });

    const blockedRuns = await http.query(refs.listAutomationFixtureRuns, {
      automationId: blocked.created.automation.id,
    });
    expect(blockedRuns).toEqual([]);

    const runnableRuns = await http.query(refs.listAutomationFixtureRuns, {
      automationId: runnable.automationId,
    });
    expect(runnableRuns.some((run) => run.trigger_type === "schedule")).toBe(true);
  });

  it("tracks allowance and purchased AI credits and enforces credit limits", async () => {
    const seeded = await http.mutation(refs.seedAutomationFixture, {
      tier: "free",
    });
    const freeTierCredits = getIncludedAiCreditsForTier("free").total;

    for (let count = 1; count <= freeTierCredits; count += 1) {
      const balance = await http.mutation(refs.deductAiCredit, {
        org_id: seeded.orgId,
      });
      expect(balance.allowance_used).toBe(count);
    }

    await expectCode(
      async () =>
        await http.mutation(refs.deductAiCredit, {
          org_id: seeded.orgId,
        }),
      "AI_CREDIT_LIMIT_REACHED",
    );

    await http.mutation(refs.addPurchasedCredits, {
      org_id: seeded.orgId,
      credits: 2,
      price_cents: 1000,
      stripe_payment_intent_id: null,
    });

    const purchasedOne = await http.mutation(refs.deductAiCredit, {
      org_id: seeded.orgId,
    });
    expect(purchasedOne.purchased_remaining).toBe(1);

    const purchasedTwo = await http.mutation(refs.deductAiCredit, {
      org_id: seeded.orgId,
    });
    expect(purchasedTwo.purchased_remaining).toBe(0);
    expect(purchasedTwo.total_available).toBe(0);

    await expectCode(
      async () =>
        await http.mutation(refs.deductAiCredit, {
          org_id: seeded.orgId,
        }),
      "AI_CREDIT_LIMIT_REACHED",
    );
  }, 15_000);

  it("accepts webhook provider events when trigger_key is omitted", async () => {
    const created = await http.mutation(refs.createAutomationViaContract, {
      tier: "free",
      triggerType: "event",
      providerTrigger: {
        provider_id: "google",
        trigger_key: "incoming_email",
        schema_version: 1,
        filter: {
          from: "alerts@example.com",
        },
        delivery: {
          preferred_mode: "webhook",
          supported_modes: ["webhook", "polling"],
          fallback_mode: "polling",
        },
        subscription_state: {
          status: "active",
          active_mode: "webhook",
          last_error: null,
          updated_at: null,
        },
      },
    });

    const queued = await http.mutation(refs.ingestProviderEvent, {
      org_id: created.orgId,
      provider: "google",
      provider_event_id: "gmail_webhook_match_no_key",
      provider_event_type: "google.gmail.incoming_email",
      delivery_mode: "webhook",
      event_payload: {
        delivery_id: "gmail_webhook_match_no_key",
        event_type: "google.gmail.incoming_email",
        history_id: "201",
        message: {
          id: "msg_webhook",
          thread_id: "thread_webhook",
          from: "alerts@example.com",
          to: ["team@example.com"],
          subject: "Server alert",
          label_ids: ["UNREAD"],
        },
      },
      event_payload_ref: "gmail_webhook_match_no_key",
    });

    expect(queued).toEqual({
      queued_count: 1,
      skipped_count: 0,
    });
  });

  it("rejects creating a run with a config version from another automation", async () => {
    const first = await http.mutation(refs.seedAutomationFixture, {
      tier: "free",
    });
    const second = await http.mutation(refs.seedAutomationFixture, {
      tier: "free",
    });

    await expectCode(
      async () =>
        await http.mutation(refs.createAutomationRun, {
          automation_id: first.automationId,
          trigger_type: "manual",
          config_version_id: second.configVersionId,
        }),
      "AutomationConfigVersionNotFound",
    );
  });
});
