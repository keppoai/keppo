import {
  createWorkerExecutionError,
  formatWorkerExecutionErrorMessage,
  toIntegrationErrorClassification,
} from "../packages/shared/src/execution-errors.js";
import {
  MCP_CREDENTIAL_AUTH_STATUS,
  type McpCredentialAuthStatus,
} from "../packages/shared/src/mcp-auth.js";
import {
  PROVIDER_METRIC_EVENT_TYPE,
  PROVIDER_METRIC_NAMES,
  PROVIDER_METRIC_OUTCOMES,
} from "../packages/shared/src/providers/boundaries/convex-schemas.js";
import type {
  ProviderMetricName,
  ProviderMetricOutcome,
} from "../packages/shared/src/providers/boundaries/types.js";
import { normalizeJsonRecord } from "../packages/shared/src/runtime.js";

export {
  MCP_CREDENTIAL_AUTH_STATUS,
  PROVIDER_METRIC_EVENT_TYPE,
  PROVIDER_METRIC_NAMES,
  PROVIDER_METRIC_OUTCOMES,
  createWorkerExecutionError,
  formatWorkerExecutionErrorMessage,
  normalizeJsonRecord,
  toIntegrationErrorClassification,
};
export type { McpCredentialAuthStatus, ProviderMetricName, ProviderMetricOutcome };
