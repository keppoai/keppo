import { describe, expect, it } from "vitest";
import { createFakeXClientStore, createFakeXSdk } from "../../../provider-sdk/x/fake.js";
import type { ProviderRuntimeContext } from "../../../providers.js";
import type { ProviderAutomationTriggerDefinition } from "../../registry/types.js";
import { createXAutomationTriggerLifecycle } from "./automation-trigger-lifecycle.js";
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

describe("x automation trigger lifecycle", () => {
  const requireTrigger = (): ProviderAutomationTriggerDefinition => {
    const trigger = automationTriggers.triggers.mentions;
    if (!trigger) {
      throw new Error("Missing X mentions trigger definition.");
    }
    return trigger;
  };

  it("polls new X mentions into normalized events and persists the resolved account id", async () => {
    const store = createFakeXClientStore();
    const lifecycle = createXAutomationTriggerLifecycle(() =>
      createFakeXSdk({ clientStore: store }),
    );
    const namespace = "tests.x.lifecycle";
    const trigger = requireTrigger();

    store.seed(namespace, {
      users: [
        { id: "u_200", username: "keppo_bot", name: "Keppo Bot" },
        { id: "u_201", username: "alerts", name: "Alerts" },
      ],
      posts: [
        {
          id: "x_900",
          text: "Initial ping for @keppo_bot",
          authorId: "u_201",
          createdAt: "2026-03-19T23:55:00.000Z",
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
          scopes: ["x.read"],
          access_token: "fake_x_access_token",
          metadata: {
            e2e_namespace: namespace,
          },
        },
      },
      runtimeContext(),
    );

    expect(syncResult.state.user_id).toBe("u_200");

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
          scopes: ["x.read"],
          access_token: "fake_x_access_token",
          metadata: {
            e2e_namespace: namespace,
          },
        },
      },
      runtimeContext(),
    );

    expect(firstPoll.events).toEqual([]);

    store.seed(namespace, {
      users: [
        { id: "u_200", username: "keppo_bot", name: "Keppo Bot" },
        { id: "u_201", username: "alerts", name: "Alerts" },
      ],
      posts: [
        {
          id: "x_901",
          text: "Fresh mention for @keppo_bot",
          authorId: "u_201",
          createdAt: "2026-03-20T00:01:00.000Z",
        },
        {
          id: "x_900",
          text: "Initial ping for @keppo_bot",
          authorId: "u_201",
          createdAt: "2026-03-19T23:55:00.000Z",
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
          scopes: ["x.read"],
          access_token: "fake_x_access_token",
          metadata: {
            e2e_namespace: namespace,
          },
        },
      },
      runtimeContext(),
    );

    expect(secondPoll.events).toEqual([
      expect.objectContaining({
        providerEventId: "x_901",
        providerEventType: "x.mentions.post",
      }),
    ]);
  });
});
