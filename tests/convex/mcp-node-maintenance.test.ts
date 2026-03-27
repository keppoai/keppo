import { describe, expect, it, vi } from "vitest";
import { ACTION_STATUS } from "../../convex/domain_constants";
import { processApprovedActionsImpl } from "../../convex/mcp_node/maintenance";

describe("processApprovedActionsImpl", () => {
  it("schedules approved actions instead of executing them inline", async () => {
    const runQuery = vi.fn().mockResolvedValue([{ id: "act_1" }, { id: "act_2" }]);
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ dispatched: true })
      .mockResolvedValueOnce({ dispatched: true });

    const processed = await processApprovedActionsImpl(
      {
        runQuery,
        runMutation,
      } as never,
      2,
      {
        listActionsByStatusRef: {} as never,
        scheduleApprovedActionRef: {} as never,
        expirePendingActionsRef: {} as never,
        timeoutInactiveRunsRef: {} as never,
        runSecurityMaintenanceRef: {} as never,
        recordCronSuccessRef: {} as never,
        recordCronFailureRef: {} as never,
        enqueueDeadLetterRef: {} as never,
      },
    );

    expect(processed).toBe(2);
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      status: ACTION_STATUS.approved,
      limit: 2,
    });
    expect(runMutation).toHaveBeenNthCalledWith(1, expect.anything(), {
      actionId: "act_1",
      source: "maintenance_tick",
    });
    expect(runMutation).toHaveBeenNthCalledWith(2, expect.anything(), {
      actionId: "act_2",
      source: "maintenance_tick",
    });
  });
});
