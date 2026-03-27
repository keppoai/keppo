import { describe, expect, it } from "vitest";
import {
  createFakeRedditClientStore,
  createFakeRedditSdk,
} from "../../../provider-sdk/reddit/fake.js";
import type { ProviderRuntimeContext } from "../../../providers.js";
import type { ProviderAutomationTriggerDefinition } from "../../registry/types.js";
import { createRedditAutomationTriggerLifecycle } from "./automation-trigger-lifecycle.js";
import { automationTriggers } from "./schemas.js";

const runtimeContext = (secrets?: Record<string, string | undefined>): ProviderRuntimeContext => ({
  httpClient: async (url, init) => await fetch(url, init),
  clock: {
    now: () => Date.parse("2026-03-20T00:00:00.000Z"),
    nowIso: () => "2026-03-20T00:00:00.000Z",
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

describe("reddit automation trigger lifecycle", () => {
  const requireTrigger = (
    key: "mentions" | "unread_inbox_message",
  ): ProviderAutomationTriggerDefinition => {
    const trigger = automationTriggers.triggers[key];
    if (!trigger) {
      throw new Error(`Missing Reddit trigger definition for ${key}.`);
    }
    return trigger;
  };

  it("polls new Reddit mentions into normalized events without re-emitting seen ids", async () => {
    const store = createFakeRedditClientStore();
    const lifecycle = createRedditAutomationTriggerLifecycle(() =>
      createFakeRedditSdk({ clientStore: store }),
    );
    const namespace = "tests.reddit.lifecycle";
    const trigger = requireTrigger("mentions");

    store.seed(namespace, {
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
          body: "hello u/keppo_bot",
          unread: true,
        },
      ],
    });

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
          scopes: ["reddit.read"],
          access_token: "fake_reddit_access_token",
          metadata: {
            e2e_namespace: namespace,
          },
        },
      },
      runtimeContext(),
    );

    const firstPoll = await lifecycle.poll(
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
          scopes: ["reddit.read"],
          access_token: "fake_reddit_access_token",
          metadata: {
            e2e_namespace: namespace,
          },
        },
      },
      runtimeContext(),
    );

    expect(firstPoll.events).toEqual([]);

    store.seed(namespace, {
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
          body: "please check u/keppo_bot",
          unread: true,
        },
        {
          id: "t4_existing",
          to: "keppo_bot",
          from: "support_mod",
          subject: "Existing mention",
          body: "hello u/keppo_bot",
          unread: true,
        },
      ],
    });

    const secondPoll = await lifecycle.poll(
      {
        trigger,
        activeTriggers: [
          {
            automationId: "aut_1",
            configVersionId: "cfg_1",
            trigger: trigger.buildDefaultTrigger(),
          },
        ],
        state: firstPoll.state,
        context: {
          workspaceId: "workspace_test",
          orgId: "org_test",
          scopes: ["reddit.read"],
          access_token: "fake_reddit_access_token",
          metadata: {
            e2e_namespace: namespace,
          },
        },
      },
      runtimeContext(),
    );

    expect(secondPoll.events).toEqual([
      expect.objectContaining({
        providerEventId: "t4_live",
        providerEventType: "reddit.inbox.mention",
      }),
    ]);
  });

  it("polls unread inbox messages through the unread-specific trigger", async () => {
    const store = createFakeRedditClientStore();
    const lifecycle = createRedditAutomationTriggerLifecycle(() =>
      createFakeRedditSdk({ clientStore: store }),
    );
    const namespace = "tests.reddit.lifecycle.unread";
    const trigger = requireTrigger("unread_inbox_message");

    store.seed(namespace, {
      me: {
        id: "u_200",
        name: "keppo_bot",
      },
      messages: [
        {
          id: "t4_unread_1",
          to: "keppo_bot",
          from: "alerts_mod",
          subject: "Unread alert",
          body: "Please review this inbox alert",
          unread: true,
        },
        {
          id: "t4_read_1",
          to: "keppo_bot",
          from: "alerts_mod",
          subject: "Already read",
          body: "This should not appear",
          unread: false,
        },
      ],
    });

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
          scopes: ["reddit.read"],
          access_token: "fake_reddit_access_token",
          metadata: {
            e2e_namespace: namespace,
          },
        },
      },
      runtimeContext(),
    );

    expect(syncResult.events).toEqual([]);

    store.seed(namespace, {
      me: {
        id: "u_200",
        name: "keppo_bot",
      },
      messages: [
        {
          id: "t4_unread_2",
          to: "keppo_bot",
          from: "alerts_mod",
          subject: "Unread alert",
          body: "Please review this inbox alert",
          unread: true,
        },
      ],
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
          scopes: ["reddit.read"],
          access_token: "fake_reddit_access_token",
          metadata: {
            e2e_namespace: namespace,
          },
        },
      },
      runtimeContext(),
    );

    expect(pollResult.events).toEqual([
      expect.objectContaining({
        providerEventId: "t4_unread_2",
        providerEventType: "reddit.inbox.unread_message",
      }),
    ]);
  });
});
