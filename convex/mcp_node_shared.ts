"use node";

import { CODE_MODE_TOOLS } from "../packages/shared/src/code-mode/mcp-tools.js";
import type { ConnectorContext, PreparedWrite } from "../packages/shared/src/connectors/base.js";
import {
  convexExecuteToolCallPayloadSchema,
  convexRunMaintenanceTickPayloadSchema,
} from "../packages/shared/src/providers/boundaries/api-schemas.js";
import {
  convexActionCreationResultSchema,
  convexActionExecutionStateSchema,
  convexActionStateSchema,
  convexActionDispatchStateSchema,
  convexActionIdListSchema,
  convexActionStatusPayloadSchema,
  convexConnectorContextSchema,
  convexGatingDataSchema,
  convexDispatchResponseSchema,
  convexPendingWorkspaceActionListSchema,
  convexPollRateLimitSchema,
  convexToolCallReferenceSchema,
} from "../packages/shared/src/providers/boundaries/convex-schemas.js";
import { jsonRecordSchema } from "../packages/shared/src/providers/boundaries/common.js";
import {
  parseApprovedActionDispatchRequest,
  parseWorkerPayload,
} from "../packages/shared/src/providers/boundaries/error-boundary.js";
import type {
  ConvexActionExecutionState,
  ConvexActionState,
  ConvexActionStatusPayload,
  ConvexConnectorContext,
  ConvexExecuteToolCallPayload,
  ConvexGatingData,
} from "../packages/shared/src/providers/boundaries/types.js";
import type { CanonicalProviderId } from "../packages/shared/src/provider-catalog.js";
import type { ProviderRuntimeContext } from "../packages/shared/src/provider-runtime-context.js";
import { getProviderRuntimeSecrets } from "../packages/shared/src/provider-runtime-secrets.js";
import { safeFetch } from "../packages/shared/src/network.js";
import { allTools, toolMap, type ToolDefinition } from "../packages/shared/src/tool-definitions.js";
import { getProviderModuleV2 } from "../packages/shared/src/providers/modules/index.js";
import { providerRegistry } from "../packages/shared/src/providers.js";
import {
  createWorkerExecutionError,
  formatWorkerExecutionErrorMessage,
  parseWorkerExecutionErrorCode,
  toIntegrationErrorClassification,
  toIntegrationErrorCodeFromWorkerCode,
  toWorkerExecutionError,
  toWorkerExecutionErrorCode,
  type IntegrationErrorClassification,
  type IntegrationErrorCode,
  type WorkerExecutionErrorCode,
} from "../packages/shared/src/execution-errors.js";
import {
  PROVIDER_REGISTRY_PATH_FEATURE_FLAG,
  providerRolloutFeatureFlag,
  readFeatureFlagValue,
} from "../packages/shared/src/feature-flags.js";
import { evaluateGating, shouldGateTool } from "../packages/shared/src/gating.js";
import { stableIdempotencyKey } from "../packages/shared/src/ids.js";
import { nowIso } from "../packages/shared/src/runtime.js";

export {
  CODE_MODE_TOOLS,
  PROVIDER_REGISTRY_PATH_FEATURE_FLAG,
  allTools,
  convexActionCreationResultSchema,
  convexActionDispatchStateSchema,
  convexActionExecutionStateSchema,
  convexActionIdListSchema,
  convexActionStateSchema,
  convexActionStatusPayloadSchema,
  convexConnectorContextSchema,
  convexDispatchResponseSchema,
  convexExecuteToolCallPayloadSchema,
  convexGatingDataSchema,
  convexPendingWorkspaceActionListSchema,
  convexPollRateLimitSchema,
  convexRunMaintenanceTickPayloadSchema,
  convexToolCallReferenceSchema,
  createWorkerExecutionError,
  evaluateGating,
  formatWorkerExecutionErrorMessage,
  getProviderModuleV2,
  getProviderRuntimeSecrets,
  jsonRecordSchema,
  nowIso,
  parseApprovedActionDispatchRequest,
  parseWorkerExecutionErrorCode,
  parseWorkerPayload,
  providerRegistry,
  providerRolloutFeatureFlag,
  readFeatureFlagValue,
  safeFetch,
  shouldGateTool,
  stableIdempotencyKey,
  toIntegrationErrorClassification,
  toIntegrationErrorCodeFromWorkerCode,
  toWorkerExecutionError,
  toWorkerExecutionErrorCode,
  toolMap,
};
export type {
  CanonicalProviderId,
  ConnectorContext,
  ConvexActionExecutionState,
  ConvexActionState,
  ConvexActionStatusPayload,
  ConvexConnectorContext,
  ConvexExecuteToolCallPayload,
  ConvexGatingData,
  IntegrationErrorClassification,
  IntegrationErrorCode,
  PreparedWrite,
  ProviderRuntimeContext,
  ToolDefinition,
  WorkerExecutionErrorCode,
};
