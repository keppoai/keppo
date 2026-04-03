import { describe, expect, it } from "vitest";
import {
  buildApprovalQueueView,
  getApprovalGroupForAction,
  searchApprovalAction,
} from "./approvals-view-model";
import type { Action } from "./types";

const createAction = (overrides: Partial<Action> = {}): Action => ({
  id: "act_1",
  automation_run_id: "run_1",
  automation_name: "Daily Digest",
  automation_run_started_at: "2026-03-08T00:00:00.000Z",
  action_type: "gmail.sendEmail",
  risk_level: "medium",
  status: "pending",
  payload_preview: { subject: "Digest" },
  result_redacted: null,
  idempotency_key: "idem_1",
  created_at: "2026-03-08T00:00:00.000Z",
  resolved_at: null,
  ...overrides,
});

describe("approvals view model", () => {
  it("groups queue rows by automation run while preserving queue order", () => {
    const view = buildApprovalQueueView(
      [
        createAction({
          id: "act_low_newer",
          automation_run_id: "run_b",
          automation_name: "Run B",
          risk_level: "low",
          created_at: "2026-03-08T00:02:00.000Z",
        }),
        createAction({
          id: "act_high_oldest",
          automation_run_id: "run_a",
          automation_name: "Run A",
          risk_level: "high",
          created_at: "2026-03-08T00:00:00.000Z",
        }),
        createAction({
          id: "act_high_newer",
          automation_run_id: "run_a",
          automation_name: "Run A",
          risk_level: "high",
          created_at: "2026-03-08T00:01:00.000Z",
        }),
      ],
      "",
    );

    expect(view.visible_action_ids).toEqual(["act_high_newer", "act_high_oldest", "act_low_newer"]);
    expect(view.groups).toHaveLength(2);
    expect(view.groups[0]?.automation_run_id).toBe("run_a");
    expect(view.groups[0]?.actions.map((action) => action.id)).toEqual([
      "act_high_newer",
      "act_high_oldest",
    ]);
    expect(view.groups[1]?.automation_run_id).toBe("run_b");
  });

  it("tracks pending and resolved counts inside each run group", () => {
    const view = buildApprovalQueueView(
      [
        createAction({ id: "act_pending", automation_run_id: "run_a", status: "pending" }),
        createAction({
          id: "act_approved",
          automation_run_id: "run_a",
          status: "approved",
          resolved_at: "2026-03-08T00:03:00.000Z",
        }),
        createAction({ id: "act_other", automation_run_id: "run_b", status: "pending" }),
      ],
      "",
    );

    expect(view.groups[0]).toMatchObject({
      automation_run_id: "run_a",
      pending_action_ids: ["act_pending"],
      pending_count: 1,
      resolved_count: 1,
    });
    expect(getApprovalGroupForAction(view.groups, "act_other")?.automation_run_id).toBe("run_b");
    expect(getApprovalGroupForAction(view.groups, "missing")).toBeNull();
  });

  it("searches run ids and automation names in addition to action fields", () => {
    const action = createAction({
      automation_run_id: "run_search_target",
      automation_name: "Weekly Customer Follow-up",
    });

    expect(searchApprovalAction(action, "search_target")).toBe(true);
    expect(searchApprovalAction(action, "customer follow")).toBe(true);
    expect(searchApprovalAction(action, "missing")).toBe(false);
  });

  it("filters groups after search is applied", () => {
    const view = buildApprovalQueueView(
      [
        createAction({
          id: "act_invoice",
          automation_run_id: "run_invoice",
          automation_name: "Invoice Follow-up",
          payload_preview: { subject: "Invoice reminder" },
        }),
        createAction({
          id: "act_digest",
          automation_run_id: "run_digest",
          automation_name: "Digest",
          payload_preview: { subject: "Digest" },
        }),
      ],
      "invoice",
    );

    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]?.automation_run_id).toBe("run_invoice");
    expect(view.visible_action_ids).toEqual(["act_invoice"]);
  });
});
