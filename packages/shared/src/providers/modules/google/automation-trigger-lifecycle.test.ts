import { describe, expect, it } from "vitest";
import { AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE } from "../../../automations.js";
import {
  createFakeGmailSdk,
  createFakeGmailClientStore,
} from "../../../provider-sdk/google/fake.js";
import type { ProviderRuntimeContext } from "../../../providers.js";
import type { ProviderAutomationTriggerDefinition } from "../../registry/types.js";
import { createGoogleAutomationTriggerLifecycle } from "./automation-trigger-lifecycle.js";
import { automationTriggers } from "./schemas.js";

const runtimeContext = (secrets?: Record<string, string | undefined>): ProviderRuntimeContext => ({
  httpClient: async (url, init) => await fetch(url, init),
  clock: {
    now: () => Date.parse("2026-03-16T00:00:00.000Z"),
    nowIso: () => "2026-03-16T00:00:00.000Z",
  },
  idGenerator: {
    randomId: (prefix) => `${prefix}_test`,
  },
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  secrets: secrets ?? {},
  featureFlags: {},
});

describe("google automation trigger lifecycle", () => {
  const requireIncomingEmailTrigger = (): ProviderAutomationTriggerDefinition => {
    const trigger = automationTriggers.triggers.incoming_email;
    if (!trigger) {
      throw new Error("Missing Google incoming email trigger definition.");
    }
    return trigger;
  };

  it("polls new Gmail history into normalized incoming-email events", async () => {
    const store = createFakeGmailClientStore();
    const lifecycle = createGoogleAutomationTriggerLifecycle(() =>
      createFakeGmailSdk({ clientStore: store }),
    );
    const namespace = "tests.google.lifecycle";

    store.seed(namespace, {
      messages: [
        {
          id: "msg_existing",
          threadId: "thr_existing",
          from: "support@example.com",
          to: "automation@example.com",
          subject: "Existing message",
          snippet: "Existing message",
          body: "Existing message",
          unread: false,
          historyId: "2001",
          labelIds: ["INBOX"],
        },
      ],
      historyCounter: 2001,
    });

    const trigger = requireIncomingEmailTrigger();
    const syncResult = await lifecycle.sync(
      {
        trigger,
        activeTriggers: [
          {
            automationId: "aut_1",
            configVersionId: "cfg_1",
            trigger: trigger.buildDefaultTrigger(),
          },
        ],
        state: {},
        context: {
          workspaceId: "workspace_test",
          orgId: "org_test",
          scopes: ["gmail.readonly", "gmail.modify"],
          access_token: "fake_gmail_access_token",
          metadata: {
            e2e_namespace: namespace,
          },
        },
      },
      runtimeContext(),
    );

    expect(syncResult.subscriptionState.active_mode).toBe(
      AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
    );
    expect(syncResult.state.history_cursor).toBe("2001");

    store.seed(namespace, {
      messages: [
        {
          id: "msg_existing",
          threadId: "thr_existing",
          from: "support@example.com",
          to: "automation@example.com",
          subject: "Existing message",
          snippet: "Existing message",
          body: "Existing message",
          unread: false,
          historyId: "2001",
          labelIds: ["INBOX"],
        },
        {
          id: "msg_live_1",
          threadId: "thr_live_1",
          from: "alerts@example.com",
          to: "automation@example.com",
          subject: "Threshold exceeded",
          snippet: "Threshold exceeded",
          body: "Threshold exceeded",
          unread: true,
          historyId: "2002",
          labelIds: ["INBOX", "UNREAD"],
        },
      ],
      historyCounter: 2002,
    });

    const pollResult = await lifecycle.poll(
      {
        trigger,
        activeTriggers: [
          {
            automationId: "aut_1",
            configVersionId: "cfg_1",
            trigger: trigger.buildDefaultTrigger(),
          },
        ],
        state: syncResult.state,
        context: {
          workspaceId: "workspace_test",
          orgId: "org_test",
          scopes: ["gmail.readonly", "gmail.modify"],
          access_token: "fake_gmail_access_token",
          metadata: {
            e2e_namespace: namespace,
          },
        },
      },
      runtimeContext(),
    );

    expect(pollResult.events).toEqual([
      expect.objectContaining({
        providerEventId: "msg_live_1",
        providerEventType: "google.gmail.incoming_email",
        deliveryMode: "polling",
        eventPayload: expect.objectContaining({
          history_id: "2002",
          message: expect.objectContaining({
            id: "msg_live_1",
            from: "alerts@example.com",
            label_ids: ["INBOX", "UNREAD"],
          }),
        }),
      }),
    ]);
    expect(pollResult.state.history_cursor).toBe("2002");
  });

  it("drains all Gmail history pages before advancing the cursor", async () => {
    const store = createFakeGmailClientStore();
    const lifecycle = createGoogleAutomationTriggerLifecycle(() =>
      createFakeGmailSdk({ clientStore: store }),
    );
    const namespace = "tests.google.lifecycle.pagination";
    const trigger = requireIncomingEmailTrigger();

    store.seed(namespace, {
      messages: Array.from({ length: 3 }, (_, index) => ({
        id: `msg_${index + 1}`,
        threadId: `thr_${index + 1}`,
        from: "alerts@example.com",
        to: "automation@example.com",
        subject: `Message ${index + 1}`,
        snippet: `Message ${index + 1}`,
        body: `Message ${index + 1}`,
        unread: true,
        historyId: String(2001 + index),
        labelIds: ["INBOX", "UNREAD"],
      })),
      historyCounter: 2003,
    });

    const pollResult = await lifecycle.poll(
      {
        trigger,
        activeTriggers: [
          {
            automationId: "aut_1",
            configVersionId: "cfg_1",
            trigger: trigger.buildDefaultTrigger(),
          },
        ],
        state: {
          history_cursor: "2000",
        },
        context: {
          workspaceId: "workspace_test",
          orgId: "org_test",
          scopes: ["gmail.readonly", "gmail.modify"],
          access_token: "fake_gmail_access_token",
          metadata: {
            e2e_namespace: namespace,
          },
        },
      },
      runtimeContext({
        GOOGLE_GMAIL_POLL_LIMIT: "1",
      }),
    );

    expect(pollResult.events.map((event) => event.providerEventId)).toEqual([
      "msg_1",
      "msg_2",
      "msg_3",
    ]);
    expect(pollResult.state.history_cursor).toBe("2003");
  });
});
