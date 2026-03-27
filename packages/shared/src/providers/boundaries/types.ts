import type { z } from "zod";
import {
  approvedActionDispatchRequestSchema,
  approvedActionQueueEnvelopeSchema,
  approvedActionQueuePayloadSchema,
  convexExecuteToolCallPayloadSchema,
  convexRunMaintenanceTickPayloadSchema,
  integrationDetailSchema,
  integrationDetailsResponseSchema,
  localQueueEnqueueResponseSchema,
  mcpRequestEnvelopeSchema,
  mcpToolCallParamsSchema,
  mcpWorkspaceParamsSchema,
  oauthCallbackParamsSchema,
  oauthCallbackQuerySchema,
  oauthConnectBodySchema,
  oauthConnectParamsSchema,
  oauthConnectResponseSchema,
  oauthStatePayloadSchema,
  oauthTokenResponseSchema,
  providerCatalogDeprecationSchema,
  providerCatalogEntrySchema,
  providerCatalogResponseSchema,
  providerCatalogToolSchema,
  providerUiPayloadSchema,
  workerMaintenanceTickResultSchema,
  workspaceIntegrationSchema,
  workspaceIntegrationsResponseSchema,
} from "./api-schemas.js";
import {
  convexActionCreationResultSchema,
  convexActionDispatchStateSchema,
  convexActionExecutionStateSchema,
  convexActionListSchema,
  convexActionRiskLevelSchema,
  convexActionSchema,
  convexActionStateSchema,
  convexActionStatusPayloadSchema,
  convexActionStatusSchema,
  convexApprovalSchema,
  convexAuditEventSchema,
  convexCelRuleMatchSchema,
  convexConnectorContextSchema,
  convexExecuteApprovedActionResultSchema,
  convexGatingDataSchema,
  convexIngestProviderEventPayloadSchema,
  convexIngestProviderEventResultSchema,
  convexPendingWorkspaceActionSchema,
  convexPollRateLimitSchema,
  convexPolicyDecisionSchema,
  convexRecordProviderMetricPayloadSchema,
  convexRecordProviderWebhookPayloadSchema,
  convexRecordProviderWebhookResultSchema,
  convexToolCallReferenceSchema,
  convexUpsertOAuthProviderPayloadSchema,
  convexWorkspaceAutoApprovalSchema,
  convexWorkspaceContextSchema,
  convexWorkspaceListSchema,
  convexWorkspacePolicySchema,
  convexWorkspaceRuleSchema,
  convexWorkspaceRulesResponseSchema,
  providerMetricNameSchema,
  providerMetricOutcomeSchema,
  convexActionDetailSchema,
  convexNullableActionDetailSchema,
  convexApprovedActionDispatchSchema,
} from "./convex-schemas.js";
import {
  boundaryErrorDetailsSchema,
  boundaryErrorEnvelopeSchema,
  boundaryErrorIssueSchema,
  mcpErrorEnvelopeSchema,
  mcpErrorObjectSchema,
  mcpResponseEnvelopeSchema,
  mcpResultEnvelopeSchema,
  webhookResponseSchema,
} from "./error-boundary.js";

export type OAuthConnectParams = z.infer<typeof oauthConnectParamsSchema>;
export type OAuthConnectBody = z.infer<typeof oauthConnectBodySchema>;
export type OAuthCallbackParams = z.infer<typeof oauthCallbackParamsSchema>;
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
export type OAuthStatePayload = z.infer<typeof oauthStatePayloadSchema>;
export type OAuthTokenResponse = z.infer<typeof oauthTokenResponseSchema>;
export type OAuthConnectResponse = z.infer<typeof oauthConnectResponseSchema>;
export type BoundaryErrorIssue = z.infer<typeof boundaryErrorIssueSchema>;
export type BoundaryErrorDetails = z.infer<typeof boundaryErrorDetailsSchema>;
export type BoundaryErrorEnvelope = z.infer<typeof boundaryErrorEnvelopeSchema>;
export type McpResultEnvelope = z.infer<typeof mcpResultEnvelopeSchema>;
export type McpErrorObject = z.infer<typeof mcpErrorObjectSchema>;
export type McpErrorEnvelope = z.infer<typeof mcpErrorEnvelopeSchema>;
export type McpResponseEnvelope = z.infer<typeof mcpResponseEnvelopeSchema>;
export type BoundaryProviderCatalogTool = z.infer<typeof providerCatalogToolSchema>;
export type BoundaryProviderCatalogDeprecation = z.infer<typeof providerCatalogDeprecationSchema>;
export type BoundaryProviderCatalogEntry = z.infer<typeof providerCatalogEntrySchema>;
export type BoundaryProviderCatalogResponse = z.infer<typeof providerCatalogResponseSchema>;
export type BoundaryIntegrationDetail = z.infer<typeof integrationDetailSchema>;
export type BoundaryIntegrationDetailsResponse = z.infer<typeof integrationDetailsResponseSchema>;
export type BoundaryWorkspaceIntegration = z.infer<typeof workspaceIntegrationSchema>;
export type BoundaryWorkspaceIntegrationsResponse = z.infer<
  typeof workspaceIntegrationsResponseSchema
>;
export type McpWorkspaceParams = z.infer<typeof mcpWorkspaceParamsSchema>;
export type McpRequestEnvelope = z.infer<typeof mcpRequestEnvelopeSchema>;
export type McpToolCallParams = z.infer<typeof mcpToolCallParamsSchema>;
export type WebhookResponse = z.infer<typeof webhookResponseSchema>;
export type ProviderUiPayload = z.infer<typeof providerUiPayloadSchema>;
export type ConvexExecuteToolCallPayload = z.infer<typeof convexExecuteToolCallPayloadSchema>;
export type ConvexRunMaintenanceTickPayload = z.infer<typeof convexRunMaintenanceTickPayloadSchema>;
export type WorkerMaintenanceTickResult = z.infer<typeof workerMaintenanceTickResultSchema>;
export type ApprovedActionQueuePayload = z.infer<typeof approvedActionQueuePayloadSchema>;
export type ApprovedActionQueueEnvelope = z.infer<typeof approvedActionQueueEnvelopeSchema>;
export type ApprovedActionDispatchRequest = z.infer<typeof approvedActionDispatchRequestSchema>;
export type LocalQueueEnqueueResponse = z.infer<typeof localQueueEnqueueResponseSchema>;
export type ConvexUpsertOAuthProviderPayload = z.infer<
  typeof convexUpsertOAuthProviderPayloadSchema
>;
export type ConvexRecordProviderWebhookPayload = z.infer<
  typeof convexRecordProviderWebhookPayloadSchema
>;
export type ConvexRecordProviderWebhookResult = z.infer<
  typeof convexRecordProviderWebhookResultSchema
>;
export type ConvexIngestProviderEventPayload = z.infer<
  typeof convexIngestProviderEventPayloadSchema
>;
export type ConvexIngestProviderEventResult = z.infer<typeof convexIngestProviderEventResultSchema>;
export type ConvexApprovedActionDispatch = z.infer<typeof convexApprovedActionDispatchSchema>;
export type ConvexExecuteApprovedActionResult = z.infer<
  typeof convexExecuteApprovedActionResultSchema
>;
export type ConvexActionRiskLevel = z.infer<typeof convexActionRiskLevelSchema>;
export type ConvexActionStatus = z.infer<typeof convexActionStatusSchema>;
export type ConvexActionStatusPayload = z.infer<typeof convexActionStatusPayloadSchema>;
export type ConvexAction = z.infer<typeof convexActionSchema>;
export type ConvexActionList = z.infer<typeof convexActionListSchema>;
export type ConvexApproval = z.infer<typeof convexApprovalSchema>;
export type ConvexCelRuleMatch = z.infer<typeof convexCelRuleMatchSchema>;
export type ConvexPolicyDecision = z.infer<typeof convexPolicyDecisionSchema>;
export type ConvexAuditEvent = z.infer<typeof convexAuditEventSchema>;
export type ConvexActionDetail = z.infer<typeof convexActionDetailSchema>;
export type ConvexNullableActionDetail = z.infer<typeof convexNullableActionDetailSchema>;
export type ConvexActionState = z.infer<typeof convexActionStateSchema>;
export type ConvexActionExecutionState = z.infer<typeof convexActionExecutionStateSchema>;
export type ConvexActionCreationResult = z.infer<typeof convexActionCreationResultSchema>;
export type ConvexActionDispatchState = z.infer<typeof convexActionDispatchStateSchema>;
export type ConvexToolCallReference = z.infer<typeof convexToolCallReferenceSchema>;
export type ConvexPollRateLimit = z.infer<typeof convexPollRateLimitSchema>;
export type ConvexPendingWorkspaceAction = z.infer<typeof convexPendingWorkspaceActionSchema>;
export type ConvexWorkspaceContext = z.infer<typeof convexWorkspaceContextSchema>;
export type ConvexWorkspaceList = z.infer<typeof convexWorkspaceListSchema>;
export type ConvexWorkspaceRule = z.infer<typeof convexWorkspaceRuleSchema>;
export type ConvexWorkspacePolicy = z.infer<typeof convexWorkspacePolicySchema>;
export type ConvexWorkspaceAutoApproval = z.infer<typeof convexWorkspaceAutoApprovalSchema>;
export type ConvexConnectorContext = z.infer<typeof convexConnectorContextSchema>;
export type ConvexGatingData = z.infer<typeof convexGatingDataSchema>;
export type ConvexWorkspaceRulesResponse = z.infer<typeof convexWorkspaceRulesResponseSchema>;
export type ProviderMetricName = z.infer<typeof providerMetricNameSchema>;
export type ProviderMetricOutcome = z.infer<typeof providerMetricOutcomeSchema>;
export type ConvexRecordProviderMetricPayload = z.infer<
  typeof convexRecordProviderMetricPayloadSchema
>;
