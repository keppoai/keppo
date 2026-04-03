import type { ActionCtx } from "../../convex/_generated/server";
import { ACTION_STATUS } from "../../convex/domain_constants";
import {
  buildApprovedActionFailureLogMetadata,
  createExecuteApprovedActionImpl,
} from "../../convex/mcp_node/approved_actions_execution";
import type { ApprovedActionDeps } from "../../convex/mcp_node/approved_actions_types";
import { describe, expect, it, vi } from "vitest";

const makeExecutionState = () => ({
  action: {
    id: "act_123",
    status: ACTION_STATUS.approved,
    result_redacted: null,
    payload_preview: {},
    normalized_payload_enc: '{"subject":"hello"}',
    tool_call_id: "tool_123",
  },
  run: {
    id: "run_123",
    metadata: {},
  },
  workspace: {
    id: "ws_123",
    org_id: "org_123",
  },
});

const makeConnectorContext = () => ({
  workspace: {
    id: "ws_123",
    org_id: "org_123",
    slug: "primary",
    name: "Primary",
    status: "active" as const,
    policy_mode: "rules_first" as const,
    default_action_behavior: "require_approval" as const,
    code_mode_enabled: true,
    created_at: "2026-04-03T00:00:00.000Z",
  },
  provider_enabled: true,
  integration_id: "int_123",
  integration_provider: "google" as const,
  scopes: ["gmail.send"],
  access_token: "token",
  refresh_token: null,
  access_token_expires_at: null,
  integration_account_id: "acct_123",
  external_account_id: "user@example.com",
  metadata: {},
});

const makeDeps = (overrides?: Partial<ApprovedActionDeps>): ApprovedActionDeps => ({
  refs: {
    getActionState: {} as never,
    setActionStatus: {} as never,
    loadConnectorContext: {} as never,
    createToolCall: {} as never,
    updateToolCall: {} as never,
    createActionFromDecision: {} as never,
    updatePendingPollTracker: {} as never,
    recordPollAttempt: {} as never,
    listPendingActionsForWorkspace: {} as never,
    getToolCall: {} as never,
    createAuditEvent: {} as never,
    markIntegrationHealth: {} as never,
    executeApprovedCustomAction: {} as never,
  },
  refreshConnectorContextAccessToken: vi.fn(async (_ctx, params) => params.context),
  resolveToolOwnerProvider: vi.fn(() => "google"),
  assertProviderRegistryPathEnabled: vi.fn(),
  assertProviderCapability: vi.fn(),
  assertProviderRolloutEnabled: vi.fn(),
  assertIntegrationProviderMatch: vi.fn(),
  toProviderRuntimeContext: vi.fn(() => ({}) as never),
  classifyIntegrationError: vi.fn(() => ({
    errorCode: "execution_failed",
    errorCategory: "provider_api",
  })),
  createWorkerExecutionError: vi.fn((code, message) => new Error(`${code}: ${message}`)),
  ...overrides,
});

describe("buildApprovedActionFailureLogMetadata", () => {
  it("includes provider classification and response details for provider failures", () => {
    const error = Object.assign(new Error("Gmail API request failed: 403"), {
      shape: {
        category: "unknown",
        code: "provider_error",
        status: 403,
        retryable: false,
        message: "Gmail API request failed: 403",
      },
      causeData: {
        response: {
          status: 403,
          data: {
            error: {
              code: 403,
              status: "PERMISSION_DENIED",
              message: "Request had insufficient authentication scopes.",
              errors: [{ reason: "insufficientPermissions" }],
            },
          },
        },
      },
    });

    expect(
      buildApprovedActionFailureLogMetadata({
        actionId: "act_123",
        toolName: "gmail.sendEmail",
        provider: "google",
        providerModuleVersion: 1,
        workspaceId: "ws_123",
        orgId: "org_123",
        error,
        classification: {
          errorCode: "execution_failed",
          errorCategory: "provider_api",
        },
      }),
    ).toEqual({
      actionId: "act_123",
      toolName: "gmail.sendEmail",
      provider: "google",
      providerModuleVersion: 1,
      workspaceId: "ws_123",
      orgId: "org_123",
      errorMessage: "Gmail API request failed: 403",
      errorCode: "execution_failed",
      errorCategory: "provider_api",
      providerError: {
        category: "unknown",
        code: "provider_error",
        status: 403,
        retryable: false,
        message: "Gmail API request failed: 403",
      },
      providerResponseStatus: 403,
      providerResponseData: {
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          message: "Request had insufficient authentication scopes.",
          errors: ["[object]"],
        },
      },
    });
  });

  it("truncates oversized nested response payloads to keep logs readable", () => {
    const error = {
      response: {
        status: 403,
        data: {
          message: "x".repeat(1105),
          nested: {
            keep: true,
            deep: {
              hidden: "value",
            },
          },
        },
      },
    };

    const metadata = buildApprovedActionFailureLogMetadata({
      actionId: "act_456",
      toolName: "gmail.sendEmail",
      provider: "google",
      providerModuleVersion: 1,
      workspaceId: "ws_456",
      orgId: "org_456",
      error,
      classification: {
        errorCode: "execution_failed",
        errorCategory: "provider_api",
      },
    });

    expect(metadata.providerResponseStatus).toBe(403);
    expect(metadata.providerResponseData).toEqual({
      message: `${"x".repeat(1000)}…`,
      nested: {
        keep: true,
        deep: {
          hidden: "value",
        },
      },
    });
  });
});

describe("createExecuteApprovedActionImpl", () => {
  it("fails closed when the action disappears during the executing transition", async () => {
    const runQuery = vi
      .fn<ActionCtx["runQuery"]>()
      .mockResolvedValueOnce(makeExecutionState())
      .mockResolvedValueOnce({
        id: "tool_123",
        tool_name: "gmail.sendEmail",
      })
      .mockResolvedValueOnce(makeConnectorContext());
    const runMutation = vi.fn<ActionCtx["runMutation"]>().mockResolvedValueOnce(null);
    const runAction = vi.fn<ActionCtx["runAction"]>();
    const ctx = {
      runQuery,
      runMutation,
      runAction,
    } as unknown as ActionCtx;
    const deps = makeDeps();

    const executeApprovedAction = createExecuteApprovedActionImpl(deps);

    await expect(executeApprovedAction(ctx, "act_123")).rejects.toThrow(
      "execution_failed: Action act_123 not found",
    );
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runAction).not.toHaveBeenCalled();
    expect(deps.createWorkerExecutionError).toHaveBeenCalledWith(
      "execution_failed",
      "Action act_123 not found",
    );
  });
});
