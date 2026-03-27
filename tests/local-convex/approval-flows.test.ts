import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { beforeEach, describe, expect, it } from "vitest";
import { adminKey, convexUrl, resetAllLocalConvexState } from "./harness";

const http = new ConvexHttpClient(convexUrl);
(http as { setAdminAuth?: (token: string) => void }).setAdminAuth?.(adminKey);

const refs = {
  reset: makeFunctionReference<"mutation">("e2e:reset"),
  createWorkspace: makeFunctionReference<"mutation">("e2e:createWorkspace"),
  setToolAutoApproval: makeFunctionReference<"mutation">("e2e:setToolAutoApproval"),
  createCelRule: makeFunctionReference<"mutation">("e2e:createCelRule"),
  triggerWriteAction: makeFunctionReference<"mutation">("e2e:triggerWriteAction"),
  approveAction: makeFunctionReference<"mutation">("e2e:approveAction"),
  rejectAction: makeFunctionReference<"mutation">("e2e:rejectAction"),
  listPendingActions: makeFunctionReference<"query">("e2e:listPendingActions"),
  getAction: makeFunctionReference<"query">("e2e:getAction"),
  listAuditEvents: makeFunctionReference<"query">("e2e:listAuditEvents"),
};

describe.sequential("Local Convex E2E", () => {
  let workspaceId: string;

  beforeEach(async () => {
    await resetAllLocalConvexState();
    workspaceId = String(
      await http.mutation(refs.createWorkspace, {
        name: "e2e-workspace",
        policyMode: "manual_only",
        defaultActionBehavior: "require_approval",
      }),
    );
  });

  it("handles pending -> approve -> succeeded without double execution", async () => {
    const started = await http.mutation(refs.triggerWriteAction, {
      workspaceId,
      toolName: "gmail.sendEmail",
      payloadPreview: { recipients: ["customer@example.com"], subject: "Order update" },
    });

    expect(started.status).toBe("approval_required");

    const pending = await http.query(refs.listPendingActions, { workspaceId });
    expect(pending).toHaveLength(1);

    await http.mutation(refs.approveAction, {
      actionId: started.actionId,
      actorId: "usr_demo",
      reason: "looks good",
    });
    await http.mutation(refs.approveAction, {
      actionId: started.actionId,
      actorId: "usr_demo",
      reason: "duplicate approval should be idempotent",
    });

    const details = await http.query(refs.getAction, { actionId: started.actionId });
    expect(details.action.status).toBe("succeeded");
    expect(details.action.executionCount).toBe(1);
    expect(
      details.approvals.filter((approval: { deciderType: string; decision: string }) => {
        return approval.deciderType === "human" && approval.decision === "approve";
      }),
    ).toHaveLength(1);

    const events = await http.query(refs.listAuditEvents, { workspaceId });
    expect(
      events.some((event: { eventType: string }) => event.eventType === "action.executed"),
    ).toBe(true);
  });

  it("handles reject flow with reason and no execution", async () => {
    const started = await http.mutation(refs.triggerWriteAction, {
      workspaceId,
      toolName: "gmail.sendEmail",
      payloadPreview: { recipients: ["blocked@example.com"], subject: "Do not send" },
    });

    await http.mutation(refs.rejectAction, {
      actionId: started.actionId,
      actorId: "usr_demo",
      reason: "Tone is unsafe",
    });

    const details = await http.query(refs.getAction, { actionId: started.actionId });
    expect(details.action.status).toBe("rejected");
    expect(details.action.reason).toContain("Tone is unsafe");
    expect(details.action.executionCount).toBe(0);

    const events = await http.query(refs.listAuditEvents, { workspaceId });
    expect(
      events.some((event: { eventType: string }) => event.eventType === "action.rejected"),
    ).toBe(true);
    expect(
      events.some(
        (event: { eventType: string; payload?: { action_id?: string } }) =>
          event.eventType === "action.executed" && event.payload?.action_id === started.actionId,
      ),
    ).toBe(false);
  });

  it("enforces CEL deny before tool auto-approve", async () => {
    await http.mutation(refs.setToolAutoApproval, {
      workspaceId,
      toolName: "stripe.issueRefund",
      enabled: true,
    });
    await http.mutation(refs.createCelRule, {
      workspaceId,
      name: "block-large-refunds",
      expression: 'tool.name == "stripe.issueRefund" && action.preview.amount > 50',
      effect: "deny",
      enabled: true,
    });

    const started = await http.mutation(refs.triggerWriteAction, {
      workspaceId,
      toolName: "stripe.issueRefund",
      payloadPreview: { amount: 75, currency: "usd" },
    });

    expect(started.status).toBe("rejected");
    const details = await http.query(refs.getAction, { actionId: started.actionId });
    expect(details.action.status).toBe("rejected");
    expect(details.approvals[0]?.deciderType).toBe("cel_rule");
    expect(details.celRuleMatches[0]?.effect).toBe("deny");
  }, 10_000);

  it("auto-approves configured tools immediately", async () => {
    await http.mutation(refs.setToolAutoApproval, {
      workspaceId,
      toolName: "gmail.applyLabel",
      enabled: true,
    });

    const started = await http.mutation(refs.triggerWriteAction, {
      workspaceId,
      toolName: "gmail.applyLabel",
      payloadPreview: { threadId: "thr_123", label: "processed" },
    });

    expect(started.status).toBe("succeeded");
    const pending = await http.query(refs.listPendingActions, { workspaceId });
    expect(pending).toHaveLength(0);
  });

  it("pushes pending queue updates via Convex subscriptions", async () => {
    const realtime = new ConvexClient(convexUrl, { skipConvexDeploymentUrlCheck: true });
    let initialLoaded = false;

    const pendingPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for pending action subscription update"));
      }, 8000);

      realtime.onUpdate(
        refs.listPendingActions,
        { workspaceId },
        (rows) => {
          const pending = rows as Array<{ id: string }>;
          if (!initialLoaded) {
            initialLoaded = true;
            return;
          }
          const first = pending[0];
          if (first?.id) {
            clearTimeout(timeout);
            resolve(first.id);
          }
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });

    await http.mutation(refs.triggerWriteAction, {
      workspaceId,
      toolName: "gmail.sendEmail",
      payloadPreview: { recipients: ["customer@example.com"], subject: "Realtime test" },
    });

    const pendingId = await pendingPromise;
    expect(typeof pendingId).toBe("string");
    await realtime.close();
  });
});
