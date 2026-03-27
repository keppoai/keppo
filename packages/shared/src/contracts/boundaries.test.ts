import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  automationDispatchMissingAiKeyResponseSchema,
  convexExecuteToolCallPayloadSchema,
  convexRunMaintenanceTickPayloadSchema,
  integrationDetailsResponseSchema,
  mcpRequestEnvelopeSchema,
  providerCatalogResponseSchema,
  approvedActionQueueEnvelopeSchema,
  providerUiPayloadSchema,
  stripeWebhookHeadersSchema,
  workspaceIntegrationsResponseSchema,
  workerMaintenanceTickResultSchema,
} from "../providers/boundaries/api-schemas.js";
import {
  canonicalProviderSchema,
  cronAuthorizationHeaderSchema,
} from "../providers/boundaries/common.js";
import {
  convexActionDispatchStateSchema,
  convexActionExecutionStateSchema,
  convexActionIdListSchema,
  convexActionStatusPayloadSchema,
  convexApprovedActionDispatchListSchema,
  convexConnectorContextSchema,
  convexDispatchResponseSchema,
  convexExecuteApprovedActionResultSchema,
  convexPollRateLimitSchema,
  convexRecordProviderWebhookPayloadSchema,
  convexRecordProviderWebhookResultSchema,
  convexPendingWorkspaceActionListSchema,
  convexRecordProviderMetricPayloadSchema,
  convexToolCallReferenceSchema,
  convexWorkspaceContextSchema,
  convexGatingDataSchema,
} from "../providers/boundaries/convex-schemas.js";
import {
  BoundaryParseError,
  buildBoundaryErrorEnvelope,
  parseApprovedActionDispatchRequest,
  parseApprovedActionQueueEnvelope,
  parseApiBoundary,
  parseAutomationDispatchMissingAiKeyResponse,
  parseBearerAuthorizationHeader,
  parseConnectorEnvelope,
  parseConvexActionDetail,
  parseConvexActionList,
  parseConvexPayload,
  parseConvexWorkspaceList,
  parseConvexWorkspaceRulesResponse,
  parseCronAuthorizationHeader,
  parseInternalInviteAcceptRequest,
  parseInternalInviteCreateRequest,
  parseInternalNotificationsDeliverRequest,
  parseInternalPushSubscribeRequest,
  parseLocalQueueEnqueueResponse,
  parseMcpErrorEnvelope,
  parseMcpResultEnvelope,
  parseMcpSessionHeader,
  parseMcpWorkspaceParams,
  parseOAuthCallbackRequest,
  parseOAuthConnectRequest,
  parseOAuthConnectResponse,
  parseProviderId,
  parseProviderUiPayload,
  parseToolInvocation,
  parseWebhookEnvelope,
  parseWebhookResponse,
  parseWorkerPayload,
} from "../providers/boundaries/error-boundary.js";
import { parseApiJsonBoundary, parseJsonRecord } from "../providers/boundaries/json.js";

describe("boundary contracts", () => {
  it("accepts canonical providers", () => {
    const provider = parseApiBoundary(canonicalProviderSchema, "google");
    expect(provider).toBe("google");
    expect(parseProviderId("stripe")).toBe("stripe");
  });

  it("rejects non-canonical provider aliases with explicit code", () => {
    expect(() => parseApiBoundary(canonicalProviderSchema, "gmail")).toThrowError(
      BoundaryParseError,
    );

    try {
      parseApiBoundary(canonicalProviderSchema, "gmail");
    } catch (error) {
      expect(error).toBeInstanceOf(BoundaryParseError);
      const boundaryError = error as BoundaryParseError;
      expect(boundaryError.code).toBe("non_canonical_provider");
      expect(boundaryError.message).toContain('Use "google"');
    }
  });

  it("uses api default error code for malformed payloads", () => {
    expect(() => parseApiBoundary(z.object({ org_id: z.string() }), "not-an-object")).toThrowError(
      BoundaryParseError,
    );
    try {
      parseApiBoundary(z.object({ org_id: z.string() }), "not-an-object");
    } catch (error) {
      const boundaryError = error as BoundaryParseError;
      expect(boundaryError.code).toBe("invalid_request");
      expect(boundaryError.source).toBe("api");
    }
  });

  it("supports signature payload specific error codes", () => {
    expect(() =>
      parseApiBoundary(
        stripeWebhookHeadersSchema,
        {},
        { defaultCode: "invalid_signature_payload" },
      ),
    ).toThrowError(BoundaryParseError);
    try {
      parseApiBoundary(
        stripeWebhookHeadersSchema,
        {},
        { defaultCode: "invalid_signature_payload" },
      );
    } catch (error) {
      const boundaryError = error as BoundaryParseError;
      expect(boundaryError.code).toBe("invalid_signature_payload");
    }
  });

  it("uses worker and connector default error codes", () => {
    const schema = z.object({ tool: z.string() });

    expect(() => parseWorkerPayload(schema, null)).toThrowError(BoundaryParseError);
    try {
      parseWorkerPayload(schema, null);
    } catch (error) {
      const boundaryError = error as BoundaryParseError;
      expect(boundaryError.code).toBe("invalid_worker_payload");
      expect(boundaryError.source).toBe("worker");
    }

    expect(() => parseConnectorEnvelope(schema, null)).toThrowError(BoundaryParseError);
    try {
      parseConnectorEnvelope(schema, null);
    } catch (error) {
      const boundaryError = error as BoundaryParseError;
      expect(boundaryError.code).toBe("invalid_connector_envelope");
      expect(boundaryError.source).toBe("connector");
    }
  });

  it("decodes raw JSON strings through shared helper wrappers", () => {
    expect(parseJsonRecord('{"key":"value"}')).toEqual({ key: "value" });
    expect(
      parseApiJsonBoundary(
        '{"provider":"google","values":{"enabled":true}}',
        providerUiPayloadSchema,
        {
          defaultCode: "invalid_provider_ui_payload",
          message: "Invalid provider UI payload.",
        },
      ),
    ).toEqual({
      provider: "google",
      values: { enabled: true },
    });

    expect(() => parseJsonRecord("[]")).toThrowError("JSON value must be an object.");
    expect(() =>
      parseApiJsonBoundary("not json", providerUiPayloadSchema, {
        defaultCode: "invalid_provider_ui_payload",
        message: "Invalid provider UI payload.",
      }),
    ).toThrowError("Invalid provider UI payload.");
  });

  it("builds a typed boundary error envelope from parser failures", () => {
    let parseError: unknown = null;
    try {
      parseApiBoundary(canonicalProviderSchema, "gmail");
    } catch (error) {
      parseError = error;
    }

    const envelope = buildBoundaryErrorEnvelope(parseError, {
      defaultCode: "invalid_request",
      defaultMessage: "Invalid request payload.",
      provider: "gmail",
    });

    expect(envelope.error.code).toBe("non_canonical_provider");
    expect(envelope.error.source).toBe("api");
    expect(envelope.error.provider).toBe("gmail");
    expect(envelope.error.issues.length).toBeGreaterThan(0);
  });

  it("builds fallback boundary error envelope for non-boundary errors", () => {
    const envelope = buildBoundaryErrorEnvelope(new Error("boom"), {
      defaultCode: "invalid_queue_payload",
      defaultMessage: "Queue payload must be valid JSON.",
      source: "api",
    });

    expect(envelope.error.code).toBe("invalid_queue_payload");
    expect(envelope.error.message).toBe("Queue payload must be valid JSON.");
    expect(envelope.error.source).toBe("api");
    expect(envelope.error.issues).toEqual([]);
  });

  it("validates MCP request and Convex bridge payload contracts", () => {
    expect(
      parseApiBoundary(mcpRequestEnvelopeSchema, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {},
      }).method,
    ).toBe("tools/call");

    expect(() =>
      parseConvexPayload(
        convexExecuteToolCallPayloadSchema,
        {
          workspaceId: "ws_1",
          runId: "run_1",
          toolName: "gmail.listUnread",
          input: {},
        },
        { defaultCode: "invalid_worker_payload" },
      ),
    ).toThrowError(BoundaryParseError);

    expect(parseToolInvocation({ name: "gmail.sendEmail", arguments: {} }).name).toBe(
      "gmail.sendEmail",
    );
  });

  it("parses OAuth request envelopes through shared helper wrappers", () => {
    const connect = parseOAuthConnectRequest(
      { provider: "google" },
      {
        org_id: "org_1",
      },
    );
    expect(connect.provider).toBe("google");
    expect(connect.body.org_id).toBe("org_1");

    const callback = parseOAuthCallbackRequest(
      { provider: "github" },
      {
        code: "auth_code",
        state: "abc",
      },
    );
    expect(callback.provider).toBe("github");
    expect(callback.query.code).toBe("auth_code");

    const redditConnect = parseOAuthConnectRequest(
      { provider: "reddit" },
      {
        org_id: "org_2",
      },
    );
    expect(redditConnect.provider).toBe("reddit");
  });

  it("parses shared internal API payload contracts", () => {
    expect(
      parseInternalInviteCreateRequest({
        email: "teammate@example.com",
        role: "viewer",
      }).role,
    ).toBe("viewer");
    expect(
      parseInternalInviteAcceptRequest({
        token: "invite_token",
      }).token,
    ).toBe("invite_token");
    expect(
      parseInternalNotificationsDeliverRequest({
        eventIds: ["evt_1", "evt_2"],
      }).eventIds,
    ).toEqual(["evt_1", "evt_2"]);
    expect(
      parseInternalPushSubscribeRequest({
        subscription: {
          endpoint: "https://push.example.test/subscriptions/1",
          keys: {
            p256dh: "key",
            auth: "auth",
          },
        },
      }).subscription.endpoint,
    ).toBe("https://push.example.test/subscriptions/1");
    expect(
      parseAutomationDispatchMissingAiKeyResponse({
        status: "missing_ai_key",
        provider: "openai",
        key_mode: "byok",
      }).provider,
    ).toBe("openai");
  });

  it("rejects malformed shared internal API payloads", () => {
    expect(() =>
      parseInternalInviteCreateRequest({
        email: "teammate@example.com",
        role: "invalid",
      }),
    ).toThrowError(BoundaryParseError);
    expect(() =>
      parseInternalPushSubscribeRequest({
        subscription: {
          keys: {
            p256dh: "key",
            auth: "auth",
          },
        },
      }),
    ).toThrowError(BoundaryParseError);
    expect(() =>
      parseApiJsonBoundary(
        JSON.stringify({
          status: "missing_ai_key",
          provider: "invalid",
          key_mode: "byok",
        }),
        automationDispatchMissingAiKeyResponseSchema,
        {
          defaultCode: "invalid_automation_dispatch_response",
          message: "Invalid automation dispatch response payload.",
        },
      ),
    ).toThrowError(BoundaryParseError);
  });

  it("parses MCP workspace/session/auth headers via shared helper wrappers", () => {
    expect(parseMcpWorkspaceParams({ workspaceId: "workspace_1" }).workspaceId).toBe("workspace_1");
    expect(parseMcpSessionHeader("mcp_session_1")).toBe("mcp_session_1");
    expect(parseBearerAuthorizationHeader("Bearer token_1")).toBe("token_1");

    expect(() => parseBearerAuthorizationHeader("Basic token_1")).toThrowError(BoundaryParseError);
  });

  it("parses OAuth connect API response envelopes", () => {
    const success = parseOAuthConnectResponse({
      status: "requires_oauth",
      provider: "google",
      oauth_start_url: "https://oauth.example.test/start",
      correlation_id: "corr_123",
    });
    expect(success.status).toBe("requires_oauth");

    const error = parseOAuthConnectResponse({
      error: {
        code: "provider_disabled",
        message: "provider disabled",
        provider: "google",
      },
    });
    expect("error" in error).toBe(true);

    expect(() =>
      parseOAuthConnectResponse({
        status: "requires_oauth",
        provider: "google",
      }),
    ).toThrowError(BoundaryParseError);
  });

  it("parses webhook/provider-ui envelopes", () => {
    expect(parseWebhookEnvelope({ event: "ping" }).event).toBe("ping");
    expect(
      parseProviderUiPayload({
        provider: "google",
        values: {
          key: "value",
        },
      }).provider,
    ).toBe("google");
  });

  it("parses MCP and webhook outbound response envelopes", () => {
    const mcpSuccess = parseMcpResultEnvelope({
      jsonrpc: "2.0",
      id: "req_1",
      result: {
        tools: [],
      },
    });
    expect(mcpSuccess.id).toBe("req_1");

    const mcpError = parseMcpErrorEnvelope({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32000,
        message: "invalid_request: Invalid request payload",
        data: {
          code: "invalid_request",
          message: "Invalid request payload",
          source: "api",
          issues: [],
        },
      },
    });
    expect(mcpError.error.data?.source).toBe("api");

    expect(() =>
      parseMcpErrorEnvelope({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32000,
          message: "",
        },
      }),
    ).toThrowError(BoundaryParseError);

    const webhookSuccess = parseWebhookResponse({
      received: true,
      provider: "google",
      duplicate: false,
      matched_integrations: 2,
      matched_orgs: 1,
    });
    expect("received" in webhookSuccess && webhookSuccess.received).toBe(true);

    const webhookError = parseWebhookResponse({
      error: {
        code: "provider_misconfigured",
        message: "Webhook facet missing",
        provider: "google",
      },
    });
    expect("error" in webhookError).toBe(true);

    expect(() =>
      parseWebhookResponse({
        error: {
          code: "provider_disabled",
          message: "disabled",
          provider: "gmail",
        },
      }),
    ).toThrowError(BoundaryParseError);
  });

  it("parses Convex dashboard payload helpers for actions/workspaces/rules", () => {
    expect(
      parseConvexActionList([
        {
          id: "act_1",
          action_type: "gmail.sendEmail",
          risk_level: "high",
          status: "pending",
          payload_preview: {},
          result_redacted: null,
          idempotency_key: "idem_1",
          created_at: "2026-03-01T00:00:00.000Z",
          resolved_at: null,
        },
      ]),
    ).toHaveLength(1);

    expect(parseConvexActionDetail(null)).toBeNull();
    expect(
      parseConvexActionDetail({
        action: {
          id: "act_1",
          action_type: "gmail.sendEmail",
          risk_level: "high",
          status: "pending",
          payload_preview: {},
          result_redacted: null,
          idempotency_key: "idem_1",
          created_at: "2026-03-01T00:00:00.000Z",
          resolved_at: null,
        },
        normalized_payload: {},
        approvals: [],
        cel_rule_matches: [],
        policy_decisions: [],
      }),
    ).not.toBeNull();

    expect(
      parseConvexWorkspaceList([
        {
          id: "workspace_1",
          org_id: "org_1",
          slug: "default",
          name: "Default",
          status: "active",
          policy_mode: "manual_only",
          default_action_behavior: "require_approval",
          code_mode_enabled: true,
          created_at: "2026-03-01T00:00:00.000Z",
        },
      ]),
    ).toHaveLength(1);

    expect(
      parseConvexWorkspaceRulesResponse({
        workspace: {
          id: "workspace_1",
          org_id: "org_1",
          slug: "default",
          name: "Default",
          status: "active",
          policy_mode: "manual_only",
          default_action_behavior: "require_approval",
          code_mode_enabled: true,
          created_at: "2026-03-01T00:00:00.000Z",
        },
        rules: [
          {
            id: "rule_1",
            workspace_id: "workspace_1",
            name: "Block large refunds",
            description: "",
            expression: 'tool.name == "stripe.issueRefund"',
            effect: "deny",
            enabled: true,
            created_by: "user_1",
            created_at: "2026-03-01T00:00:00.000Z",
          },
        ],
        policies: [],
        auto_approvals: [],
        matches: [],
        decisions: [],
      }).workspace.id,
    ).toBe("workspace_1");
  });

  it("validates worker tick request and result contracts", () => {
    expect(
      parseConvexPayload(convexRunMaintenanceTickPayloadSchema, {
        approvedLimit: 0,
        ttlMinutes: 60,
        inactivityMinutes: 30,
      }).approvedLimit,
    ).toBe(0);

    expect(
      parseWorkerPayload(workerMaintenanceTickResultSchema, {
        processed: 0,
        expired: 0,
        timedOutRuns: 0,
        securityFlagsCreated: 0,
        credentialLockoutRowsPurged: 0,
        credentialRotationRecommendations: 0,
        notificationsSent: 0,
        notificationsFailed: 0,
        purgedActions: 0,
        purgedBlobs: 0,
        purgedAudits: 0,
      }).processed,
    ).toBe(0);

    expect(() =>
      parseWorkerPayload(workerMaintenanceTickResultSchema, {
        processed: -1,
      }),
    ).toThrowError(BoundaryParseError);
  });

  it("validates convex internal action/connector/gating payload contracts", () => {
    expect(
      parseWorkerPayload(convexActionExecutionStateSchema, {
        action: {
          id: "act_1",
          status: "approved",
          result_redacted: null,
          payload_preview: {},
          normalized_payload_enc: '{"foo":"bar"}',
          tool_call_id: "tool_1",
        },
        run: {
          id: "run_1",
          metadata: {},
        },
        workspace: {
          id: "ws_1",
          org_id: "org_1",
        },
      }).action.tool_call_id,
    ).toBe("tool_1");

    expect(
      parseWorkerPayload(convexConnectorContextSchema, {
        workspace: {
          id: "ws_1",
          org_id: "org_1",
          slug: "primary",
          name: "Primary",
          status: "active",
          policy_mode: "rules_first",
          default_action_behavior: "require_approval",
          code_mode_enabled: true,
          created_at: "2026-02-28T00:00:00.000Z",
        },
        provider_enabled: true,
        integration_id: "int_1",
        integration_provider: "google",
        scopes: ["gmail.readonly"],
        access_token: "token",
        refresh_token: null,
        access_token_expires_at: null,
        integration_account_id: "acct_1",
        external_account_id: "user@example.com",
        metadata: {},
      }).workspace.id,
    ).toBe("ws_1");

    expect(
      parseWorkerPayload(convexGatingDataSchema, {
        workspace: {
          id: "ws_1",
          org_id: "org_1",
          slug: "primary",
          name: "Primary",
          status: "active",
          policy_mode: "rules_first",
          default_action_behavior: "require_approval",
          code_mode_enabled: true,
          created_at: "2026-02-28T00:00:00.000Z",
        },
        cel_rules: [],
        tool_auto_approvals: [],
        policies: [],
      }).workspace.policy_mode,
    ).toBe("rules_first");

    expect(() =>
      parseWorkerPayload(convexConnectorContextSchema, {
        workspace: {
          id: "ws_1",
          org_id: "org_1",
          slug: "primary",
          name: "Primary",
          status: "active",
          policy_mode: "rules_first",
          default_action_behavior: "require_approval",
          code_mode_enabled: true,
          created_at: "2026-02-28T00:00:00.000Z",
        },
        provider_enabled: true,
        integration_id: "int_1",
        integration_provider: "gmail",
        scopes: ["gmail.readonly"],
        access_token: "token",
        refresh_token: null,
        access_token_expires_at: null,
        integration_account_id: "acct_1",
        external_account_id: "user@example.com",
        metadata: {},
      }),
    ).toThrowError(BoundaryParseError);
  });

  it("validates provider metric payload contracts", () => {
    expect(
      parseConvexPayload(convexRecordProviderMetricPayloadSchema, {
        orgId: "org_1",
        metric: "oauth_connect",
        provider: "google",
        route: "/oauth/integrations/google/connect",
        outcome: "success",
      }).metric,
    ).toBe("oauth_connect");

    expect(() =>
      parseConvexPayload(convexRecordProviderMetricPayloadSchema, {
        orgId: "org_1",
        metric: "oauth_connect",
        provider: "gmail",
      }),
    ).toThrowError(BoundaryParseError);
  });

  it("validates additional convex payload schema matrix", () => {
    expect(
      parseConvexPayload(convexRecordProviderWebhookPayloadSchema, {
        provider: "google",
        externalAccountId: "acct_1",
        eventType: "email.delivered",
        payload: {
          event: "email.delivered",
        },
      }).provider,
    ).toBe("google");
    expect(() =>
      parseConvexPayload(convexRecordProviderWebhookPayloadSchema, {
        provider: "gmail",
        eventType: "email.delivered",
        payload: {},
      }),
    ).toThrowError(BoundaryParseError);

    expect(
      parseConvexPayload(convexRecordProviderWebhookResultSchema, {
        matched_orgs: 1,
        matched_integrations: 2,
        matched_org_ids: ["org_1"],
      }).matched_orgs,
    ).toBe(1);
    expect(() =>
      parseConvexPayload(convexRecordProviderWebhookResultSchema, {
        matched_orgs: -1,
        matched_integrations: 2,
        matched_org_ids: ["org_1"],
      }),
    ).toThrowError(BoundaryParseError);

    expect(
      parseConvexPayload(convexApprovedActionDispatchListSchema, [
        {
          actionId: "act_1",
          workspaceId: "ws_1",
          idempotencyKey: "idem_1",
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      ])[0]?.actionId,
    ).toBe("act_1");
    expect(() =>
      parseConvexPayload(convexApprovedActionDispatchListSchema, [
        {
          actionId: "",
          workspaceId: "ws_1",
          idempotencyKey: "idem_1",
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      ]),
    ).toThrowError(BoundaryParseError);

    expect(
      parseConvexPayload(convexExecuteApprovedActionResultSchema, {
        status: "succeeded",
        action: {
          id: "act_1",
        },
      }).status,
    ).toBe("succeeded");
    expect(() =>
      parseConvexPayload(convexExecuteApprovedActionResultSchema, {
        status: "",
        action: {},
      }),
    ).toThrowError(BoundaryParseError);

    expect(
      parseConvexPayload(convexActionStatusPayloadSchema, {
        id: "act_1",
        status: "approved",
        result_redacted: null,
        payload_preview: {},
      }).id,
    ).toBe("act_1");
    expect(() =>
      parseConvexPayload(convexActionStatusPayloadSchema, {
        id: "act_1",
        status: "approved",
        result_redacted: [],
        payload_preview: {},
      }),
    ).toThrowError(BoundaryParseError);

    expect(
      parseConvexPayload(convexActionDispatchStateSchema, {
        action: {
          status: "approved",
          idempotency_key: "idem_1",
          created_at: "2026-03-01T00:00:00.000Z",
        },
        run: {
          metadata: {},
        },
        workspace: {
          id: "ws_1",
        },
      }).action.status,
    ).toBe("approved");
    expect(() =>
      parseConvexPayload(convexActionDispatchStateSchema, {
        action: {
          status: "approved",
          idempotency_key: "",
          created_at: "2026-03-01T00:00:00.000Z",
        },
        run: {
          metadata: {},
        },
        workspace: {
          id: "ws_1",
        },
      }),
    ).toThrowError(BoundaryParseError);

    expect(
      parseConvexPayload(convexToolCallReferenceSchema, {
        id: "tool_1",
        tool_name: "gmail.sendEmail",
      }).tool_name,
    ).toBe("gmail.sendEmail");
    expect(() =>
      parseConvexPayload(convexToolCallReferenceSchema, {
        id: "tool_1",
        tool_name: "",
      }),
    ).toThrowError(BoundaryParseError);

    expect(
      parseConvexPayload(convexPollRateLimitSchema, {
        limited: true,
        retry_after_ms: 100,
      }).retry_after_ms,
    ).toBe(100);
    expect(() =>
      parseConvexPayload(convexPollRateLimitSchema, {
        limited: true,
        retry_after_ms: -1,
      }),
    ).toThrowError(BoundaryParseError);

    expect(
      parseConvexPayload(convexPendingWorkspaceActionListSchema, [
        {
          id: "act_1",
          status: "pending",
          payload_preview: {},
          created_at: "2026-03-01T00:00:00.000Z",
        },
      ])[0]?.status,
    ).toBe("pending");
    expect(() =>
      parseConvexPayload(convexPendingWorkspaceActionListSchema, [
        {
          id: "act_1",
          status: "pending",
          payload_preview: null,
          created_at: "2026-03-01T00:00:00.000Z",
        },
      ]),
    ).toThrowError(BoundaryParseError);

    expect(
      parseConvexPayload(convexActionIdListSchema, [
        {
          id: "act_1",
        },
      ])[0]?.id,
    ).toBe("act_1");
    expect(() =>
      parseConvexPayload(convexActionIdListSchema, [
        {
          id: "",
        },
      ]),
    ).toThrowError(BoundaryParseError);

    expect(
      parseConvexPayload(convexWorkspaceContextSchema, {
        id: "ws_1",
        org_id: "org_1",
        slug: "workspace",
        name: "Workspace",
        status: "active",
        policy_mode: "rules_first",
        default_action_behavior: "require_approval",
        code_mode_enabled: true,
        created_at: "2026-03-01T00:00:00.000Z",
      }).id,
    ).toBe("ws_1");
    expect(() =>
      parseConvexPayload(convexWorkspaceContextSchema, {
        id: "ws_1",
        org_id: "org_1",
        slug: "workspace",
        name: "Workspace",
        status: "active",
        policy_mode: "manual",
        default_action_behavior: "require_approval",
        code_mode_enabled: true,
        created_at: "2026-03-01T00:00:00.000Z",
      }),
    ).toThrowError(BoundaryParseError);

    expect(
      parseWorkerPayload(convexDispatchResponseSchema, {
        message_id: "msg_1",
      }).message_id,
    ).toBe("msg_1");
    expect(() =>
      parseWorkerPayload(convexDispatchResponseSchema, {
        message_id: "",
      }),
    ).toThrowError(BoundaryParseError);
  });

  it("parses queue envelopes and cron auth headers", () => {
    const envelope = parseApprovedActionQueueEnvelope({
      messageId: "msg_1",
      topic: "approved-action",
      attempt: 0,
      maxAttempts: 5,
      enqueuedAt: "2026-02-28T00:00:00.000Z",
      payload: {
        actionId: "act_1",
        workspaceId: "ws_1",
        idempotencyKey: "idem_1",
        requestedAt: "2026-02-28T00:00:00.000Z",
      },
    });
    expect(envelope.payload.actionId).toBe("act_1");

    const header = parseCronAuthorizationHeader("Bearer secret_value");
    expect(header).toBe("Bearer secret_value");

    expect(() =>
      parseApiBoundary(cronAuthorizationHeaderSchema, "Token secret", {
        defaultCode: "invalid_authorization_header",
      }),
    ).toThrowError(BoundaryParseError);

    expect(() =>
      parseConvexPayload(approvedActionQueueEnvelopeSchema, {
        messageId: "msg_1",
        topic: "approved-action",
        attempt: 0,
      }),
    ).toThrowError(BoundaryParseError);

    expect(
      parseApprovedActionDispatchRequest({
        actionId: "act_1",
        workspaceId: "ws_1",
        idempotencyKey: "idem_1",
        requestedAt: "2026-02-28T00:00:00.000Z",
      }).actionId,
    ).toBe("act_1");
    expect(() =>
      parseApprovedActionDispatchRequest({
        actionId: "act_1",
      }),
    ).toThrowError(BoundaryParseError);

    expect(parseLocalQueueEnqueueResponse({ messageId: "msg_1" }).messageId).toBe("msg_1");
    expect(() =>
      parseLocalQueueEnqueueResponse({
        messageId: "",
      }),
    ).toThrowError(BoundaryParseError);
  });

  it("validates provider catalog and integration response contracts", () => {
    expect(
      parseConvexPayload(providerCatalogResponseSchema, [
        {
          provider: "google",
          supported_tools: [
            {
              name: "gmail.searchThreads",
              capability: "read",
              risk_level: "low",
              requires_approval: false,
            },
          ],
          deprecation: {
            status: "deprecated",
            message: "Google provider will be replaced.",
            replacement_provider: "google",
          },
        },
      ])[0]?.deprecation?.status,
    ).toBe("deprecated");

    expect(
      parseConvexPayload(integrationDetailsResponseSchema, [
        {
          id: "int_1",
          org_id: "org_1",
          provider: "google",
          display_name: "Google",
          status: "connected",
          created_at: "2026-02-28T00:00:00.000Z",
          connected: true,
          scopes: ["gmail.readonly"],
          external_account_id: "test@example.com",
          credential_expires_at: null,
          has_refresh_token: true,
          metadata: {},
        },
      ])[0]?.provider,
    ).toBe("google");

    expect(
      parseConvexPayload(workspaceIntegrationsResponseSchema, [
        {
          id: "hint_1",
          workspace_id: "workspace_1",
          provider: "stripe",
          enabled: true,
          created_by: "user_1",
          created_at: "2026-02-28T00:00:00.000Z",
        },
      ])[0]?.provider,
    ).toBe("stripe");
  });

  it("rejects malformed provider catalog/integration boundary payloads", () => {
    expect(() =>
      parseConvexPayload(providerCatalogResponseSchema, [
        { provider: "gmail", supported_tools: [] },
      ]),
    ).toThrowError(BoundaryParseError);
    expect(() =>
      parseConvexPayload(providerCatalogResponseSchema, [
        {
          provider: "google",
          supported_tools: [],
          deprecation: { status: "retired", message: "invalid" },
        },
      ]),
    ).toThrowError(BoundaryParseError);
    expect(() =>
      parseConvexPayload(integrationDetailsResponseSchema, [{ provider: "google" }]),
    ).toThrowError(BoundaryParseError);
    expect(() =>
      parseConvexPayload(workspaceIntegrationsResponseSchema, [{ provider: "gmail" }]),
    ).toThrowError(BoundaryParseError);
  });
});
