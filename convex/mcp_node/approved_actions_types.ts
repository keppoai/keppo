"use node";

import { type FunctionReference } from "convex/server";
import { type ActionCtx } from "../_generated/server";
import { TOOL_CALL_STATUS, type ActionStatus } from "../domain_constants";
import {
  type CanonicalProviderId,
  type ConnectorContext,
  type ConvexActionStatusPayload,
  type IntegrationErrorClassification,
  type ProviderRuntimeContext,
  type WorkerExecutionErrorCode,
} from "../mcp_node_shared";

type AnyInternalQueryReference = FunctionReference<"query", "internal">;
type AnyInternalMutationReference = FunctionReference<"mutation", "internal">;
type AnyInternalActionReference = FunctionReference<"action", "internal">;

export type ToolCallRecordStatus =
  | typeof TOOL_CALL_STATUS.completed
  | typeof TOOL_CALL_STATUS.failed
  | typeof TOOL_CALL_STATUS.approvalRequired;

export type ExecuteApprovedActionResult = {
  status: ActionStatus;
  action: ConvexActionStatusPayload;
};

export type ApprovedActionRefs = {
  getActionState: AnyInternalQueryReference;
  setActionStatus: AnyInternalMutationReference;
  loadConnectorContext: AnyInternalQueryReference;
  createToolCall: AnyInternalMutationReference;
  updateToolCall: AnyInternalMutationReference;
  createActionFromDecision: AnyInternalMutationReference;
  updatePendingPollTracker: AnyInternalMutationReference;
  recordPollAttempt: AnyInternalMutationReference;
  listPendingActionsForWorkspace: AnyInternalQueryReference;
  getToolCall: AnyInternalQueryReference;
  createAuditEvent: AnyInternalMutationReference;
  markIntegrationHealth: AnyInternalMutationReference;
  executeApprovedCustomAction: AnyInternalActionReference;
};

export type ApprovedActionDeps = {
  refs: ApprovedActionRefs;
  refreshConnectorContextAccessToken: (
    ctx: ActionCtx,
    params: {
      provider: CanonicalProviderId;
      context: ConnectorContext;
    },
  ) => Promise<ConnectorContext>;
  resolveToolOwnerProvider: (toolName: string) => CanonicalProviderId;
  assertProviderRegistryPathEnabled: () => void;
  assertProviderCapability: (
    provider: CanonicalProviderId,
    capability: "read" | "write" | "refresh_credentials",
  ) => void;
  assertProviderRolloutEnabled: (provider: CanonicalProviderId) => void;
  assertIntegrationProviderMatch: (
    expectedProvider: CanonicalProviderId,
    actualProvider: CanonicalProviderId | null,
  ) => void;
  toProviderRuntimeContext: (namespace: string | undefined) => ProviderRuntimeContext;
  classifyIntegrationError: (error: unknown) => IntegrationErrorClassification;
  createWorkerExecutionError: (code: WorkerExecutionErrorCode, message: string) => Error;
};
