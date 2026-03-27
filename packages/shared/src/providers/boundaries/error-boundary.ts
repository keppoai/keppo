import { z } from "zod";
import {
  automationDispatchMissingAiKeyResponseSchema,
  approvedActionDispatchRequestSchema,
  approvedActionQueueEnvelopeSchema,
  internalInviteAcceptRequestSchema,
  internalInviteCreateRequestSchema,
  internalNotificationsDeliverRequestSchema,
  internalPushSubscribeRequestSchema,
  localQueueEnqueueResponseSchema,
  mcpToolCallParamsSchema,
  mcpWorkspaceParamsSchema,
  oauthCallbackParamsSchema,
  oauthCallbackQuerySchema,
  oauthConnectBodySchema,
  oauthConnectParamsSchema,
  oauthConnectResponseSchema,
  providerUiPayloadSchema,
  webhookPayloadSchema,
} from "./api-schemas.js";
import {
  convexActionListSchema,
  convexNullableActionDetailSchema,
  convexWorkspaceListSchema,
  convexWorkspaceRulesResponseSchema,
} from "./convex-schemas.js";
import {
  BOUNDARY_CODE_PARAM,
  bearerAuthorizationHeaderSchema,
  boundaryParseSourceSchema,
  canonicalProviderIdSchema,
  cronAuthorizationHeaderSchema,
  mcpSessionHeaderSchema,
  mcpRpcIdSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  type BoundaryParseSource,
  type ManagedOAuthProvider,
} from "./common.js";

export type BoundaryParseIssue = {
  path: string;
  code: string;
  message: string;
};

export const boundaryErrorIssueSchema = z.object({
  path: nonEmptyStringSchema,
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
});

export const boundaryErrorDetailsSchema = z.object({
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
  source: boundaryParseSourceSchema,
  issues: z.array(boundaryErrorIssueSchema),
  provider: nonEmptyStringSchema.optional(),
});

export const boundaryErrorEnvelopeSchema = z.object({
  error: boundaryErrorDetailsSchema,
});

export const mcpResultEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: mcpRpcIdSchema,
  result: z.unknown(),
});

export const mcpErrorObjectSchema = z.object({
  code: z.number().int(),
  message: nonEmptyStringSchema,
  data: boundaryErrorDetailsSchema.optional(),
});

export const mcpErrorEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: mcpRpcIdSchema,
  error: mcpErrorObjectSchema,
});

export const mcpResponseEnvelopeSchema = z.union([mcpResultEnvelopeSchema, mcpErrorEnvelopeSchema]);

const webhookErrorPayloadSchema = z.object({
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
  provider: canonicalProviderIdSchema,
  reason: nonEmptyStringSchema.optional(),
  source: boundaryParseSourceSchema.optional(),
  issues: z.array(boundaryErrorIssueSchema).optional(),
});

export const webhookErrorResponseSchema = z.object({
  error: webhookErrorPayloadSchema,
});

export const webhookReceiptResponseSchema = z.object({
  received: z.literal(true),
  provider: canonicalProviderIdSchema,
  duplicate: z.boolean(),
  matched_integrations: nonNegativeIntegerSchema.optional(),
  matched_orgs: nonNegativeIntegerSchema.optional(),
});

export const webhookResponseSchema = z.union([
  webhookErrorResponseSchema,
  webhookReceiptResponseSchema,
]);

export class BoundaryParseError extends Error {
  readonly code: string;
  readonly source: BoundaryParseSource;
  readonly issues: Array<BoundaryParseIssue>;

  constructor(params: {
    code: string;
    source: BoundaryParseSource;
    message: string;
    issues: Array<BoundaryParseIssue>;
  }) {
    super(params.message);
    this.name = "BoundaryParseError";
    this.code = params.code;
    this.source = params.source;
    this.issues = params.issues;
  }
}

type ParseBoundaryOptions = {
  defaultCode?: string;
  message?: string;
};

type BoundaryErrorEnvelopeOptions = {
  defaultCode: string;
  defaultMessage: string;
  source?: BoundaryParseSource;
  provider?: string;
};

const toIssuePath = (path: PropertyKey[]): string => {
  if (path.length === 0) {
    return "$";
  }
  return path
    .map((entry) => (typeof entry === "number" ? `[${String(entry)}]` : String(entry)))
    .join(".");
};

const resolveIssueCode = (issue: z.ZodIssue): string | null => {
  if (issue.code !== z.ZodIssueCode.custom) {
    return null;
  }
  const params = (issue as { params?: unknown }).params;
  if (!params || typeof params !== "object") {
    return null;
  }
  const value = (params as Record<string, unknown>)[BOUNDARY_CODE_PARAM];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const parseBoundary = <TSchema extends z.ZodTypeAny>(
  source: BoundaryParseSource,
  schema: TSchema,
  payload: unknown,
  options: ParseBoundaryOptions = {},
): z.infer<TSchema> => {
  const result = schema.safeParse(payload);
  if (result.success) {
    return result.data;
  }

  const issues: Array<BoundaryParseIssue> = result.error.issues.map((issue) => ({
    path: toIssuePath(issue.path),
    code: issue.code,
    message: issue.message,
  }));
  const firstIssue = result.error.issues[0];
  const issueBoundaryCode = firstIssue ? resolveIssueCode(firstIssue) : null;
  const code = issueBoundaryCode ?? options.defaultCode ?? "invalid_request";
  const message = firstIssue?.message ?? options.message ?? "Boundary payload validation failed.";

  throw new BoundaryParseError({
    code,
    source,
    message,
    issues,
  });
};

export const parseApiBoundary = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  payload: unknown,
  options: ParseBoundaryOptions = {},
): z.infer<TSchema> => {
  return parseBoundary("api", schema, payload, {
    defaultCode: "invalid_request",
    ...options,
  });
};

export const parseWorkerPayload = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  payload: unknown,
  options: ParseBoundaryOptions = {},
): z.infer<TSchema> => {
  return parseBoundary("worker", schema, payload, {
    defaultCode: "invalid_worker_payload",
    ...options,
  });
};

export const parseConnectorEnvelope = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  payload: unknown,
  options: ParseBoundaryOptions = {},
): z.infer<TSchema> => {
  return parseBoundary("connector", schema, payload, {
    defaultCode: "invalid_connector_envelope",
    ...options,
  });
};

export const parseConvexPayload = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  payload: unknown,
  options: ParseBoundaryOptions = {},
): z.infer<TSchema> => {
  return parseBoundary("convex", schema, payload, {
    defaultCode: "invalid_convex_payload",
    ...options,
  });
};

export const isBoundaryParseError = (value: unknown): value is BoundaryParseError => {
  return value instanceof BoundaryParseError;
};

export const buildBoundaryErrorEnvelope = (
  error: unknown,
  options: BoundaryErrorEnvelopeOptions,
): z.infer<typeof boundaryErrorEnvelopeSchema> => {
  const source = options.source ?? "api";

  if (isBoundaryParseError(error)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        source: error.source,
        issues: error.issues,
        ...(options.provider ? { provider: options.provider } : {}),
      },
    };
  }

  return {
    error: {
      code: options.defaultCode,
      message: options.defaultMessage,
      source,
      issues: [],
      ...(options.provider ? { provider: options.provider } : {}),
    },
  };
};

export const parseProviderId = (provider: unknown) => {
  return parseApiBoundary(canonicalProviderIdSchema, provider);
};

export const parseOAuthConnectRequest = (
  params: unknown,
  body: unknown,
): { provider: ManagedOAuthProvider; body: z.infer<typeof oauthConnectBodySchema> } => {
  const parsedParams = parseApiBoundary(oauthConnectParamsSchema, params);
  return {
    provider: parsedParams.provider,
    body: parseApiBoundary(oauthConnectBodySchema, body),
  };
};

export const parseOAuthCallbackRequest = (
  params: unknown,
  query: unknown,
): { provider: ManagedOAuthProvider; query: z.infer<typeof oauthCallbackQuerySchema> } => {
  const parsedParams = parseApiBoundary(oauthCallbackParamsSchema, params);
  return {
    provider: parsedParams.provider,
    query: parseApiBoundary(oauthCallbackQuerySchema, query),
  };
};

export const parseOAuthConnectResponse = (
  payload: unknown,
): z.infer<typeof oauthConnectResponseSchema> => {
  return parseApiBoundary(oauthConnectResponseSchema, payload, {
    defaultCode: "invalid_oauth_connect_response",
    message: "Invalid OAuth connect response payload.",
  });
};

export const parseMcpResultEnvelope = (
  payload: unknown,
): z.infer<typeof mcpResultEnvelopeSchema> => {
  return parseApiBoundary(mcpResultEnvelopeSchema, payload, {
    defaultCode: "invalid_mcp_response",
    message: "Invalid MCP success response payload.",
  });
};

export const parseMcpErrorEnvelope = (payload: unknown): z.infer<typeof mcpErrorEnvelopeSchema> => {
  return parseApiBoundary(mcpErrorEnvelopeSchema, payload, {
    defaultCode: "invalid_mcp_response",
    message: "Invalid MCP error response payload.",
  });
};

export const parseWebhookEnvelope = (payload: unknown): Record<string, unknown> => {
  return parseApiBoundary(webhookPayloadSchema, payload, {
    defaultCode: "invalid_payload",
    message: "Webhook payload must be a JSON object.",
  });
};

export const parseWebhookResponse = (payload: unknown): z.infer<typeof webhookResponseSchema> => {
  return parseApiBoundary(webhookResponseSchema, payload, {
    defaultCode: "invalid_webhook_response",
    message: "Invalid webhook response payload.",
  });
};

export const parseToolInvocation = (payload: unknown): z.infer<typeof mcpToolCallParamsSchema> => {
  return parseApiBoundary(mcpToolCallParamsSchema, payload, {
    defaultCode: "invalid_request",
    message: "Invalid tools/call payload",
  });
};

export const parseMcpWorkspaceParams = (
  payload: unknown,
): z.infer<typeof mcpWorkspaceParamsSchema> => {
  return parseApiBoundary(mcpWorkspaceParamsSchema, payload, {
    defaultCode: "invalid_request",
    message: "Invalid MCP workspace path parameter.",
  });
};

export const parseBearerAuthorizationHeader = (payload: unknown): string => {
  return parseApiBoundary(bearerAuthorizationHeaderSchema, payload, {
    defaultCode: "invalid_authorization_header",
    message: "Authorization header must use Bearer token format.",
  });
};

export const parseMcpSessionHeader = (payload: unknown): string => {
  return parseApiBoundary(mcpSessionHeaderSchema, payload, {
    defaultCode: "invalid_request",
    message: "Invalid MCP session header.",
  });
};

export const parseProviderUiPayload = (
  payload: unknown,
): z.infer<typeof providerUiPayloadSchema> => {
  return parseApiBoundary(providerUiPayloadSchema, payload, {
    defaultCode: "invalid_provider_ui_payload",
    message: "Invalid provider UI payload.",
  });
};

export const parseApprovedActionQueueEnvelope = (
  payload: unknown,
): z.infer<typeof approvedActionQueueEnvelopeSchema> => {
  return parseApiBoundary(approvedActionQueueEnvelopeSchema, payload, {
    defaultCode: "invalid_queue_payload",
    message: "Invalid queue message envelope.",
  });
};

export const parseApprovedActionDispatchRequest = (
  payload: unknown,
): z.infer<typeof approvedActionDispatchRequestSchema> => {
  return parseApiBoundary(approvedActionDispatchRequestSchema, payload, {
    defaultCode: "invalid_queue_dispatch_payload",
    message: "Invalid approved-action dispatch payload.",
  });
};

export const parseCronAuthorizationHeader = (payload: unknown): string => {
  return parseApiBoundary(cronAuthorizationHeaderSchema, payload, {
    defaultCode: "invalid_authorization_header",
    message: "Invalid cron authorization header.",
  });
};

export const parseLocalQueueEnqueueResponse = (
  payload: unknown,
): z.infer<typeof localQueueEnqueueResponseSchema> => {
  return parseApiBoundary(localQueueEnqueueResponseSchema, payload, {
    defaultCode: "invalid_queue_enqueue_response",
    message: "Invalid queue enqueue response payload.",
  });
};

export const parseInternalInviteCreateRequest = (
  payload: unknown,
): z.infer<typeof internalInviteCreateRequestSchema> => {
  return parseApiBoundary(internalInviteCreateRequestSchema, payload, {
    defaultCode: "invalid_invite_request",
    message: "Invalid invite create payload.",
  });
};

export const parseInternalInviteAcceptRequest = (
  payload: unknown,
): z.infer<typeof internalInviteAcceptRequestSchema> => {
  return parseApiBoundary(internalInviteAcceptRequestSchema, payload, {
    defaultCode: "invalid_invite_request",
    message: "Invalid invite accept payload.",
  });
};

export const parseInternalNotificationsDeliverRequest = (
  payload: unknown,
): z.infer<typeof internalNotificationsDeliverRequestSchema> => {
  return parseApiBoundary(internalNotificationsDeliverRequestSchema, payload, {
    defaultCode: "invalid_notification_delivery_payload",
    message: "Invalid notification delivery payload.",
  });
};

export const parseInternalPushSubscribeRequest = (
  payload: unknown,
): z.infer<typeof internalPushSubscribeRequestSchema> => {
  return parseApiBoundary(internalPushSubscribeRequestSchema, payload, {
    defaultCode: "invalid_push_subscription_payload",
    message: "Invalid push subscription payload.",
  });
};

export const parseAutomationDispatchMissingAiKeyResponse = (
  payload: unknown,
): z.infer<typeof automationDispatchMissingAiKeyResponseSchema> => {
  return parseApiBoundary(automationDispatchMissingAiKeyResponseSchema, payload, {
    defaultCode: "invalid_automation_dispatch_response",
    message: "Invalid automation dispatch response payload.",
  });
};

export const parseConvexActionList = (payload: unknown): z.infer<typeof convexActionListSchema> => {
  return parseConvexPayload(convexActionListSchema, payload, {
    defaultCode: "invalid_convex_payload",
    message: "Invalid Convex action list payload.",
  });
};

export const parseConvexActionDetail = (
  payload: unknown,
): z.infer<typeof convexNullableActionDetailSchema> => {
  return parseConvexPayload(convexNullableActionDetailSchema, payload, {
    defaultCode: "invalid_convex_payload",
    message: "Invalid Convex action detail payload.",
  });
};

export const parseConvexWorkspaceList = (
  payload: unknown,
): z.infer<typeof convexWorkspaceListSchema> => {
  return parseConvexPayload(convexWorkspaceListSchema, payload, {
    defaultCode: "invalid_convex_payload",
    message: "Invalid Convex workspace list payload.",
  });
};

export const parseConvexWorkspaceRulesResponse = (
  payload: unknown,
): z.infer<typeof convexWorkspaceRulesResponseSchema> => {
  return parseConvexPayload(convexWorkspaceRulesResponseSchema, payload, {
    defaultCode: "invalid_convex_payload",
    message: "Invalid Convex workspace rules payload.",
  });
};
