import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { APPROVAL_DECIDER_TYPE, DECISION_OUTCOME } from "../../convex/domain_constants";
import { createConvexTestHarness, seedAutomationFixture } from "./harness";

const refs = {
  createActionFromDecision: makeFunctionReference<"mutation">("mcp:createActionFromDecision"),
  createAutomationRun: makeFunctionReference<"mutation">("automation_runs:createAutomationRun"),
};

describe("mcp action idempotency", () => {
  it("replays an existing action instead of inserting a duplicate for the same workspace key", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_mcp_action_idempotency";
    const fixture = await seedAutomationFixture(t, orgId);
    const run = await t.mutation(refs.createAutomationRun, {
      automation_id: fixture.automationId,
      trigger_type: "manual",
    });

    const first = await t.mutation(refs.createActionFromDecision, {
      runId: run.id,
      toolCallId: "tool_call_first",
      toolName: "gmail.sendEmail",
      actionType: "send_email",
      riskLevel: "high",
      normalizedPayload: {
        to: ["person@example.com"],
        subject: "Hello",
      },
      payloadPreview: {
        to: ["person@example.com"],
        subject: "Hello",
      },
      idempotencyKey: "idem_shared_key",
      decision: {
        outcome: DECISION_OUTCOME.pending,
        decider_type: APPROVAL_DECIDER_TYPE.human,
        decision_reason: "Manual approval required.",
        context_snapshot: {
          tool: {
            name: "gmail.sendEmail",
          },
        },
      },
    });

    const replay = await t.mutation(refs.createActionFromDecision, {
      runId: run.id,
      toolCallId: "tool_call_second",
      toolName: "gmail.sendEmail",
      actionType: "send_email",
      riskLevel: "high",
      normalizedPayload: {
        to: ["person@example.com"],
        subject: "Hello",
      },
      payloadPreview: {
        to: ["person@example.com"],
        subject: "Hello",
      },
      idempotencyKey: "idem_shared_key",
      decision: {
        outcome: DECISION_OUTCOME.approve,
        decider_type: APPROVAL_DECIDER_TYPE.system,
        decision_reason: "This should not create a second action.",
        context_snapshot: {
          tool: {
            name: "gmail.sendEmail",
          },
        },
      },
    });

    expect(first.idempotencyReplayed).toBe(false);
    expect(replay.idempotencyReplayed).toBe(true);
    expect(replay.action.id).toBe(first.action.id);
    expect(replay.action.tool_call_id).toBe("tool_call_first");
    expect(replay.action.status).toBe(first.action.status);

    const actions = await t.run((ctx) =>
      ctx.db
        .query("actions")
        .withIndex("by_idempotency_key", (q) => q.eq("idempotency_key", "idem_shared_key"))
        .collect(),
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]?.workspace_id).toBe(fixture.workspaceId);
  });
});
