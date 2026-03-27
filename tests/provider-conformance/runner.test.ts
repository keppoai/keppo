import { describe, expect, it } from "vitest";
import { runProviderActionConformance, type RunProviderActionConformanceOptions } from "./runner";
import type { ProviderActionPack } from "./action-matrix";

const slackReadPack: ProviderActionPack = {
  providerId: "slack",
  gatewayProviderId: "slack",
  scenarios: [
    {
      toolName: "slack.listChannels",
      capability: "read",
      positiveInput: {},
      negativeInput: {},
      negativeMode: "not_connected",
      expectedSdkCalls: [{ method: "slack.conversations.list" }],
    },
  ],
};

describe("runProviderActionConformance", () => {
  it("asserts negative-path SDK calls before reconnect side effects", async () => {
    const sdkCalls: Array<Record<string, unknown>> = [];
    let disconnected = false;

    const options: RunProviderActionConformanceOptions = {
      pack: slackReadPack,
      assertSdkCalls: true,
      assertGolden: false,
      runIdempotencyCases: false,
      runAuthScopeCases: false,
      client: {
        async callTool() {
          if (disconnected) {
            throw new Error("integration not connected");
          }
          sdkCalls.push({ method: "slack.conversations.list" });
          return { status: "succeeded", output: { channels: [] } };
        },
      },
      fetchSdkCalls: async () => [...sdkCalls],
      disconnectProvider: async () => {
        disconnected = true;
      },
      reconnectProvider: async () => {
        disconnected = false;
        // Reconnect flows can legitimately emit provider SDK calls.
        sdkCalls.push({ method: "slack.oauth.exchange" });
      },
    };

    await expect(runProviderActionConformance(options)).resolves.toBeUndefined();
    expect(sdkCalls).toHaveLength(2);
  });

  it("runs auth/scope failure coverage for every scenario when enabled", async () => {
    let disconnected = false;
    let disconnectCalls = 0;
    let reconnectCalls = 0;

    const options: RunProviderActionConformanceOptions = {
      pack: {
        providerId: "google",
        scenarios: [
          {
            toolName: "gmail.listLabels",
            capability: "read",
            positiveInput: {},
            negativeInput: { bad: true },
            expectedSdkCalls: [{ method: "gmail.users.labels.list" }],
          },
          {
            toolName: "gmail.getProfile",
            capability: "read",
            positiveInput: {},
            negativeInput: { bad: true },
            expectedSdkCalls: [{ method: "gmail.users.getProfile" }],
          },
        ],
      },
      assertSdkCalls: false,
      assertGolden: false,
      runNegativeCases: false,
      runIdempotencyCases: false,
      runAuthScopeCases: true,
      client: {
        async callTool() {
          if (disconnected) {
            throw new Error("integration not connected");
          }
          return { status: "succeeded", output: {} };
        },
      },
      disconnectProvider: async () => {
        disconnected = true;
        disconnectCalls += 1;
      },
      reconnectProvider: async () => {
        disconnected = false;
        reconnectCalls += 1;
      },
    };

    await expect(runProviderActionConformance(options)).resolves.toBeUndefined();
    expect(disconnectCalls).toBe(1);
    expect(reconnectCalls).toBe(1);
  });

  it("waits for approval_required writes before asserting SDK calls", async () => {
    const sdkCalls: Array<Record<string, unknown>> = [];
    let actionPollCount = 0;

    const options: RunProviderActionConformanceOptions = {
      pack: {
        providerId: "stripe",
        scenarios: [
          {
            toolName: "stripe.closeDispute",
            capability: "write",
            positiveInput: {
              customerId: "cus_100",
              disputeId: "dp_seed_1",
            },
            negativeInput: {
              customerId: "cus_100",
              disputeId: "",
            },
            expectedSdkCalls: [
              {
                method: "stripe.disputes.close",
                requireIdempotencyKey: true,
              },
            ],
          },
        ],
      },
      assertSdkCalls: true,
      assertGolden: false,
      runNegativeCases: false,
      client: {
        async callTool(toolName) {
          if (toolName === "stripe.closeDispute") {
            if (actionPollCount > 0) {
              return {
                status: "idempotent_replay",
                action_id: "action_close_dispute",
                output: {},
              };
            }
            return {
              status: "approval_required",
              action_id: "action_close_dispute",
              output: {},
            };
          }
          if (toolName === "keppo.wait_for_action") {
            actionPollCount += 1;
            sdkCalls.push({
              method: "stripe.disputes.close",
              idempotencyKey: "idem_close_dispute",
            });
            return {
              status: "succeeded",
              action_id: "action_close_dispute",
              output: {},
            };
          }
          throw new Error(`Unexpected tool call: ${toolName}`);
        },
      },
      fetchSdkCalls: async () => [...sdkCalls],
    };

    await expect(runProviderActionConformance(options)).resolves.toBeUndefined();
    expect(actionPollCount).toBe(1);
    expect(sdkCalls).toHaveLength(1);
  });
});
