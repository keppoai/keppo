import type { ActionCtx } from "../../convex/_generated/server";
import { createExecuteToolCallHandler } from "../../convex/mcp_node/execution";
import { describe, expect, it, vi } from "vitest";

const makeDeps = () => ({
  refs: {
    loadConnectorContext: {} as never,
    loadGatingData: {} as never,
    createToolCall: {} as never,
    createActionFromDecision: {} as never,
    createAuditEvent: {} as never,
    markIntegrationHealth: {} as never,
    getOrgBillingForWorkspace: {} as never,
    beginToolCall: {} as never,
    finishToolCall: {} as never,
  },
  handleInternalToolCall: vi.fn(async () => ({ status: "succeeded" })),
  executeApprovedActionImpl: vi.fn(),
  finalizeToolCallRecord: vi.fn(),
  resolveToolOwnerProvider: vi.fn(() => "google"),
  assertProviderRegistryPathEnabled: vi.fn(),
  assertProviderCapability: vi.fn(),
  assertProviderRolloutEnabled: vi.fn(),
  assertIntegrationProviderMatch: vi.fn(),
  refreshConnectorContextAccessToken: vi.fn(),
  toProviderRuntimeContext: vi.fn(),
  classifyIntegrationError: vi.fn(() => ({
    errorCode: "execution_failed",
    errorCategory: "provider_api",
  })),
  createWorkerExecutionError: vi.fn(
    (code: string, message: string) => new Error(`${code}: ${message}`),
  ),
});

describe("createExecuteToolCallHandler", () => {
  it("preserves beginToolCall errors without attempting finalization", async () => {
    const deps = makeDeps();
    const beginError = new Error("execution_failed: billing validation failed");
    const runQuery = vi.fn<ActionCtx["runQuery"]>().mockResolvedValue({
      org_id: "org_123",
    });
    const runMutation = vi.fn<ActionCtx["runMutation"]>().mockRejectedValueOnce(beginError);
    const runAction = vi.fn<ActionCtx["runAction"]>();
    const ctx = {
      runQuery,
      runMutation,
      runAction,
    } as unknown as ActionCtx;

    const executeToolCall = createExecuteToolCallHandler(deps);

    await expect(
      executeToolCall(ctx, {
        workspaceId: "ws_123",
        runId: "run_123",
        toolName: "keppo.list_pending_actions",
        input: {},
        credentialId: "cred_123",
      }),
    ).rejects.toThrow("execution_failed: billing validation failed");

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(deps.handleInternalToolCall).not.toHaveBeenCalled();
  });
});
