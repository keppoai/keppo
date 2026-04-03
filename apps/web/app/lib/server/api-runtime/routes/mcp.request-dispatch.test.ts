import { describe, expect, it, vi } from "vitest";
import { createMcpRouteDispatcher } from "./mcp";

const createWorkspaceAuth = (options?: {
  automationRunId?: string;
  codeModeEnabled?: boolean;
}) => ({
  status: "ok" as const,
  credential_id: "cred_test",
  workspace: {
    id: "ws_test",
    org_id: "org_test",
    name: "Workspace",
    status: "active",
    policy_mode: "manual_only",
    default_action_behavior: "require_approval",
    code_mode_enabled: options?.codeModeEnabled ?? true,
    created_at: "2026-03-01T00:00:00.000Z",
  },
  ...(options?.automationRunId ? { automation_run_id: options.automationRunId } : {}),
});

const createDeps = () => {
  const convex = {
    authenticateCredential: vi.fn(),
    appendAutomationRunLog: vi.fn(),
    closeRunBySession: vi.fn(),
    createRun: vi.fn(),
    getRunBySession: vi.fn(),
    executeCustomToolCall: vi.fn(),
    executeToolCall: vi.fn(),
    getWorkspaceCodeModeContext: vi.fn(),
    listToolCatalogForWorkspace: vi.fn(),
    markCredentialUsed: vi.fn(),
    searchTools: vi.fn(),
    seedToolIndex: vi.fn(),
    touchRun: vi.fn(),
  };

  const deps = {
    convex,
    getE2ENamespace: (value: string | undefined) => value?.trim() ?? null,
    hashIpAddress: (value: string) => `hash:${value}`,
    resolveClientIp: () => "203.0.113.7",
    resolveRegistryPathEnabled: vi.fn(async () => true),
    recordRateLimitedEvent: vi.fn(),
    recordProviderMetric: vi.fn(),
    mcpAuthFailureLimiter: {
      check: vi.fn(async () => ({
        allowed: true,
        remaining: 1,
        retryAfterMs: 0,
      })),
    },
    mcpCredentialLimiter: {
      check: vi.fn(async () => ({
        allowed: true,
        remaining: 4,
        retryAfterMs: 0,
      })),
    },
    mcpAuthFailuresPerMinute: 5,
    mcpRequestsPerCredentialPerMinute: 10,
    systemMetricsOrgId: "system",
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };

  return { convex, deps };
};

const createAuthorizedRequest = (url: string, init?: RequestInit): Request =>
  new Request(url, {
    ...init,
    headers: {
      authorization: "Bearer cred_secret_test",
      ...init?.headers,
    },
  });

const createInitializeRequest = (): Request =>
  createAuthorizedRequest("http://127.0.0.1/mcp/ws_test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "vitest",
          version: "0.0.0",
        },
      },
    }),
  });

const createToolsListRequest = (sessionId: string): Request =>
  createAuthorizedRequest("http://127.0.0.1/mcp/ws_test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });

const createToolCallRequest = (
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): Request =>
  createAuthorizedRequest("http://127.0.0.1/mcp/ws_test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });

const parseStreamableHttpJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text) as unknown;
  }
  const eventChunks = text
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  const dataLines = eventChunks.flatMap((chunk) =>
    chunk
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim()),
  );
  const lastPayload = dataLines.at(-1);
  return lastPayload ? (JSON.parse(lastPayload) as unknown) : null;
};

describe("createMcpRouteDispatcher", () => {
  it("rejects requests without a bearer token before hitting Convex auth", async () => {
    const { convex, deps } = createDeps();
    const dispatch = createMcpRouteDispatcher(deps);

    const response = await dispatch({
      request: new Request("http://127.0.0.1/mcp/ws_test", { method: "GET" }),
      workspaceIdParam: "ws_test",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: "Missing bearer token",
      },
    });
    expect(convex.authenticateCredential).not.toHaveBeenCalled();
  });

  it("fails closed on malformed workspace params", async () => {
    const { convex, deps } = createDeps();
    const dispatch = createMcpRouteDispatcher(deps);

    const response = await dispatch({
      request: new Request("http://127.0.0.1/mcp/", {
        method: "GET",
        headers: {
          authorization: "Bearer cred_secret_test",
        },
      }),
      workspaceIdParam: "",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining("expected string"),
      },
    });
    expect(convex.authenticateCredential).not.toHaveBeenCalled();
  });

  it("returns retry-after when the credential is locked", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue({
      status: "locked",
      retry_after_ms: 4_500,
    });
    const dispatch = createMcpRouteDispatcher(deps);

    const response = await dispatch({
      request: new Request("http://127.0.0.1/mcp/ws_test", {
        method: "GET",
        headers: {
          authorization: "Bearer cred_secret_test",
        },
      }),
      workspaceIdParam: "ws_test",
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(deps.recordRateLimitedEvent).toHaveBeenCalledWith({
      route: "/mcp/:workspaceId",
      key: "mcp_credential_lockout",
      ipHash: "hash:203.0.113.7",
      retryAfterMs: 4_500,
      orgId: "system",
    });
  });

  it("maps invalid JSON request bodies to boundary errors", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(createWorkspaceAuth());
    const dispatch = createMcpRouteDispatcher(deps);

    const response = await dispatch({
      request: new Request("http://127.0.0.1/mcp/ws_test", {
        method: "POST",
        headers: {
          authorization: "Bearer cred_secret_test",
          "content-type": "application/json",
        },
        body: "{",
      }),
      workspaceIdParam: "ws_test",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining("Invalid MCP request payload"),
      },
    });
    expect(convex.markCredentialUsed).toHaveBeenCalledWith("cred_test", "hash:203.0.113.7");
  });

  it("returns 405 for optional GET stream requests", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(createWorkspaceAuth());
    const dispatch = createMcpRouteDispatcher(deps);

    const response = await dispatch({
      request: new Request("http://127.0.0.1/mcp/ws_test", {
        method: "GET",
        headers: {
          authorization: "Bearer cred_secret_test",
          accept: "text/event-stream",
        },
      }),
      workspaceIdParam: "ws_test",
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, DELETE");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining("Method not allowed"),
      },
    });
    expect(convex.authenticateCredential).toHaveBeenCalledWith(
      "ws_test",
      "cred_secret_test",
      "hash:203.0.113.7",
    );
  });

  it("treats unknown DELETE sessions as idempotent closes", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(createWorkspaceAuth());
    convex.closeRunBySession.mockResolvedValue(true);
    const dispatch = createMcpRouteDispatcher(deps);

    const response = await dispatch({
      request: new Request("http://127.0.0.1/mcp/ws_test", {
        method: "DELETE",
        headers: {
          authorization: "Bearer cred_secret_test",
          "mcp-session-id": "mcp_missing_session",
        },
      }),
      workspaceIdParam: "ws_test",
    });

    expect(response.status).toBe(200);
    expect(convex.closeRunBySession).toHaveBeenCalledWith("ws_test", "mcp_missing_session");
  });

  it("returns parseable bodies for sequential same-session tool calls", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(createWorkspaceAuth());
    convex.createRun.mockResolvedValue({ id: "run_test" });
    convex.listToolCatalogForWorkspace.mockResolvedValue([
      {
        name: "search_tools",
        description: "Search tools",
      },
    ]);
    convex.seedToolIndex.mockResolvedValue({ inserted: 0, updated: 0, total: 0 });
    convex.getWorkspaceCodeModeContext.mockResolvedValue({
      available_providers: ["gmail", "google"],
    });
    convex.searchTools.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");
    expect(sessionId).toMatch(/^mcp_/);

    const firstResponse = await dispatch({
      request: createToolCallRequest(sessionId!, "search_tools", { query: "send email" }),
      workspaceIdParam: "ws_test",
    });
    const secondResponse = await dispatch({
      request: createToolCallRequest(sessionId!, "search_tools", {
        query: "gmail send email message",
      }),
      workspaceIdParam: "ws_test",
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    await expect(parseStreamableHttpJson(firstResponse)).resolves.toBeTruthy();
    await expect(parseStreamableHttpJson(secondResponse)).resolves.toBeTruthy();
    expect(deps.logger.info).toHaveBeenCalledWith(
      "mcp.tool_call.received",
      expect.objectContaining({
        workspace_id: "ws_test",
        run_id: "run_test",
        org_id: "org_test",
        tool_name: "search_tools",
        code_mode_enabled: true,
      }),
    );
  });

  it("returns parseable bodies for concurrent same-session tool calls", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(createWorkspaceAuth());
    convex.createRun.mockResolvedValue({ id: "run_test" });
    convex.listToolCatalogForWorkspace.mockResolvedValue([
      {
        name: "search_tools",
        description: "Search tools",
      },
    ]);
    convex.seedToolIndex.mockResolvedValue({ inserted: 0, updated: 0, total: 0 });
    convex.getWorkspaceCodeModeContext.mockResolvedValue({
      available_providers: ["gmail", "google"],
    });
    convex.searchTools.mockImplementation(async ({ query }: { query: string }) => {
      if (query === "gmail send email message") {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return [];
    });
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");
    expect(sessionId).toMatch(/^mcp_/);

    const [firstResponse, secondResponse] = await Promise.all([
      dispatch({
        request: createToolCallRequest(sessionId!, "search_tools", { query: "send email" }),
        workspaceIdParam: "ws_test",
      }),
      dispatch({
        request: createToolCallRequest(sessionId!, "search_tools", {
          query: "gmail send email message",
        }),
        workspaceIdParam: "ws_test",
      }),
    ]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    await expect(parseStreamableHttpJson(firstResponse)).resolves.toBeTruthy();
    await expect(parseStreamableHttpJson(secondResponse)).resolves.toBeTruthy();
  });

  it("hides automation-only tools from non-automation tool lists", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(createWorkspaceAuth());
    convex.createRun.mockResolvedValue({ id: "run_test" });
    convex.listToolCatalogForWorkspace.mockResolvedValue([
      { name: "search_tools", description: "Search tools" },
      { name: "record_outcome", description: "Record automation outcome" },
      { name: "add_memory", description: "Append automation memory" },
      { name: "edit_memory", description: "Edit automation memory" },
    ]);
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    const listResponse = await dispatch({
      request: createToolsListRequest(sessionId!),
      workspaceIdParam: "ws_test",
    });
    const payload = (await parseStreamableHttpJson(listResponse)) as {
      result?: { tools?: Array<{ name: string }> };
    };

    expect(listResponse.status).toBe(200);
    expect(payload.result?.tools?.map((tool) => tool.name)).toEqual(["search_tools"]);
  });

  it("injects automation-only tools for automation-authenticated sessions", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(
      createWorkspaceAuth({ automationRunId: "arun_test" }),
    );
    convex.createRun.mockResolvedValue({ id: "run_test" });
    convex.listToolCatalogForWorkspace.mockResolvedValue([
      { name: "search_tools", description: "Search tools" },
    ]);
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    const listResponse = await dispatch({
      request: createToolsListRequest(sessionId!),
      workspaceIdParam: "ws_test",
    });
    const payload = (await parseStreamableHttpJson(listResponse)) as {
      result?: { tools?: Array<{ name: string }> };
    };

    expect(listResponse.status).toBe(200);
    expect(payload.result?.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["record_outcome", "add_memory", "edit_memory"]),
    );
  });

  it("advertises execute_code with a required description field in code mode", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(createWorkspaceAuth());
    convex.createRun.mockResolvedValue({ id: "run_test" });
    convex.listToolCatalogForWorkspace.mockResolvedValue([
      {
        name: "execute_code",
        description: "Execute code",
      },
    ]);
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    const listResponse = await dispatch({
      request: createToolsListRequest(sessionId!),
      workspaceIdParam: "ws_test",
    });
    const payload = (await parseStreamableHttpJson(listResponse)) as {
      result?: {
        tools?: Array<{
          name: string;
          inputSchema?: { required?: string[]; properties?: Record<string, { type?: string }> };
        }>;
      };
    };

    const executeCodeTool = payload.result?.tools?.find((tool) => tool.name === "execute_code");
    expect(executeCodeTool?.inputSchema?.required).toEqual(["description", "code"]);
    expect(executeCodeTool?.inputSchema?.properties).toMatchObject({
      description: { type: "string" },
      code: { type: "string" },
    });
  });

  it("rejects record_outcome outside automation sessions", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(createWorkspaceAuth());
    convex.createRun.mockResolvedValue({ id: "run_test" });
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    const response = await dispatch({
      request: createToolCallRequest(sessionId!, "record_outcome", {
        success: true,
        summary: "Done",
      }),
      workspaceIdParam: "ws_test",
    });
    const payload = (await parseStreamableHttpJson(response)) as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
    };

    expect(response.status).toBe(200);
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.content?.[0]?.text).toContain(
      "record_outcome is only available inside automation runs.",
    );
    expect(convex.executeToolCall).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "mcp.tool_call.failed",
      expect.objectContaining({
        workspace_id: "ws_test",
        run_id: "run_test",
        org_id: "org_test",
        tool_name: "record_outcome",
        client_message: "record_outcome is only available inside automation runs.",
        message_redacted: false,
      }),
    );
  });

  it("rejects add_memory outside automation sessions", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(createWorkspaceAuth());
    convex.createRun.mockResolvedValue({ id: "run_test" });
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    const response = await dispatch({
      request: createToolCallRequest(sessionId!, "add_memory", {
        memory: "Remember the operator prefers concise summaries.",
      }),
      workspaceIdParam: "ws_test",
    });
    const payload = (await parseStreamableHttpJson(response)) as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
    };

    expect(response.status).toBe(200);
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.content?.[0]?.text).toContain(
      "add_memory is only available inside automation runs.",
    );
    expect(convex.executeToolCall).not.toHaveBeenCalled();
  });

  it("logs direct execute_code error results when Code Mode is disabled", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(
      createWorkspaceAuth({ codeModeEnabled: false }),
    );
    convex.createRun.mockResolvedValue({ id: "run_test" });
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    const response = await dispatch({
      request: createToolCallRequest(sessionId!, "execute_code", {
        description: "Log a greeting for the operator.",
        code: "console.log('hi')",
      }),
      workspaceIdParam: "ws_test",
    });
    const payload = (await parseStreamableHttpJson(response)) as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
    };

    expect(response.status).toBe(200);
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.content?.[0]?.text).toBe("Code Mode is disabled for this workspace.");
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "mcp.execute_code.failed",
      expect.objectContaining({
        workspace_id: "ws_test",
        run_id: "run_test",
        org_id: "org_test",
        tool_name: "execute_code",
        client_message: "Code Mode is disabled for this workspace.",
        message_redacted: false,
      }),
    );
  });

  it("passes the automation run id through record_outcome tool calls", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(
      createWorkspaceAuth({ automationRunId: "arun_test" }),
    );
    convex.createRun.mockResolvedValue({ id: "run_test" });
    convex.executeToolCall.mockResolvedValue({
      status: "recorded",
      success: true,
      summary: "Completed triage",
    });
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    const response = await dispatch({
      request: createToolCallRequest(sessionId!, "record_outcome", {
        success: true,
        summary: "Completed triage",
      }),
      workspaceIdParam: "ws_test",
    });

    expect(response.status).toBe(200);
    expect(convex.executeToolCall).toHaveBeenCalledWith({
      workspaceId: "ws_test",
      runId: "run_test",
      automationRunId: "arun_test",
      toolName: "record_outcome",
      input: {
        success: true,
        summary: "Completed triage",
      },
      credentialId: "cred_test",
    });
  });

  it("passes the automation run id through add_memory tool calls", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(
      createWorkspaceAuth({ automationRunId: "arun_test" }),
    );
    convex.createRun.mockResolvedValue({ id: "run_test" });
    convex.executeToolCall.mockResolvedValue({
      status: "updated",
      operation: "append",
      memory_length: 52,
      remaining_characters: 19_948,
    });
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    const response = await dispatch({
      request: createToolCallRequest(sessionId!, "add_memory", {
        memory: "Remember the operator prefers concise summaries.",
      }),
      workspaceIdParam: "ws_test",
    });

    expect(response.status).toBe(200);
    expect(convex.executeToolCall).toHaveBeenCalledWith({
      workspaceId: "ws_test",
      runId: "run_test",
      automationRunId: "arun_test",
      toolName: "add_memory",
      input: {
        memory: "Remember the operator prefers concise summaries.",
      },
      credentialId: "cred_test",
    });
  });

  it("writes automation-only search_tools query and result logs for grouped timelines", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(
      createWorkspaceAuth({ automationRunId: "arun_test" }),
    );
    convex.createRun.mockResolvedValue({ id: "run_test" });
    convex.seedToolIndex.mockResolvedValue({ inserted: 0, updated: 0, total: 0 });
    convex.getWorkspaceCodeModeContext.mockResolvedValue({
      available_providers: ["google"],
    });
    convex.searchTools.mockResolvedValue([
      {
        name: "gmail.listUnread",
        provider: "google",
        capability: "read",
        risk_level: "low",
        requires_approval: false,
        description: "List unread Gmail threads.",
        action_type: "read",
        input_schema: { type: "object" },
        type_stub: "type gmail_listUnread = {}",
      },
    ]);
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    const response = await dispatch({
      request: createToolCallRequest(sessionId!, "search_tools", {
        query: "unread gmail",
      }),
      workspaceIdParam: "ws_test",
    });

    expect(response.status).toBe(200);
    expect(convex.appendAutomationRunLog).toHaveBeenNthCalledWith(1, {
      automationRunId: "arun_test",
      level: "system",
      content: "search_tools query: unread gmail",
      eventType: "tool_call",
      eventData: {
        tool_name: "search_tools",
        args: {
          query: "unread gmail",
        },
        source: "mcp_route",
      },
    });
    expect(convex.appendAutomationRunLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        automationRunId: "arun_test",
        level: "system",
        content: "search_tools returned 1 match",
        eventType: "tool_call",
        eventData: expect.objectContaining({
          tool_name: "search_tools",
          status: "success",
          duration_ms: expect.any(Number),
          is_result: true,
          result: {
            count: 1,
            results: [
              {
                name: "gmail.listUnread",
                provider: "google",
                capability: "read",
                risk_level: "low",
                requires_approval: false,
                action_type: "read",
                description: "List unread Gmail threads.",
              },
            ],
          },
          source: "mcp_route",
        }),
      }),
    );
  });

  it("logs sanitized search_tools failures without raw secret-bearing messages", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(createWorkspaceAuth());
    convex.createRun.mockResolvedValue({ id: "run_test" });
    convex.seedToolIndex.mockResolvedValue({ inserted: 0, updated: 0, total: 0 });
    convex.getWorkspaceCodeModeContext.mockResolvedValue({
      available_providers: ["github"],
    });
    convex.searchTools.mockRejectedValue(
      new Error("custom_server_error: Authorization: Bearer ghp_1234567890abcdefghijklmnop"),
    );
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    const response = await dispatch({
      request: createToolCallRequest(sessionId!, "search_tools", { query: "repo triage" }),
      workspaceIdParam: "ws_test",
    });
    const payload = (await parseStreamableHttpJson(response)) as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
    };

    expect(response.status).toBe(200);
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.content?.[0]?.text).toMatch(
      /^search_tools failed \(ref: mcp_err_[a-f0-9]{12}\)$/,
    );
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "mcp.search_tools.failed",
      expect.objectContaining({
        workspace_id: "ws_test",
        run_id: "run_test",
        org_id: "org_test",
        tool_name: "search_tools",
        message_redacted: true,
        client_message: expect.stringMatching(
          /^search_tools failed \(ref: mcp_err_[a-f0-9]{12}\)$/,
        ),
        reference_id: expect.stringMatching(/^mcp_err_[a-f0-9]{12}$/),
      }),
    );
    expect(deps.logger.error).toHaveBeenCalledWith(
      "mcp.search_tools.error_redacted",
      expect.objectContaining({
        workspace_id: "ws_test",
        run_id: "run_test",
        org_id: "org_test",
        tool_name: "search_tools",
        message_redacted: true,
        client_message: expect.stringMatching(
          /^search_tools failed \(ref: mcp_err_[a-f0-9]{12}\)$/,
        ),
        reference_id: expect.stringMatching(/^mcp_err_[a-f0-9]{12}$/),
      }),
    );

    const redactedFailureMetadata = (deps.logger.error as ReturnType<typeof vi.fn>).mock.calls.find(
      ([message]) => message === "mcp.search_tools.error_redacted",
    )?.[1] as Record<string, unknown> | undefined;
    expect(redactedFailureMetadata).toBeDefined();
    expect(redactedFailureMetadata).not.toHaveProperty("raw_message");
  });

  it("logs structured execute_code validation failures returned to the client", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(createWorkspaceAuth());
    convex.createRun.mockResolvedValue({ id: "run_test" });
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    const response = await dispatch({
      request: createToolCallRequest(sessionId!, "execute_code", {
        description: "Try to execute blank code.",
        code: "   ",
      }),
      workspaceIdParam: "ws_test",
    });
    const payload = (await parseStreamableHttpJson(response)) as {
      result?: {
        structuredContent?: { status?: string; reason?: string; error_code?: string };
        content?: Array<{ text?: string }>;
        isError?: boolean;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.result?.isError).not.toBe(true);
    expect(payload.result?.structuredContent).toMatchObject({
      status: "execution_failed",
      reason: "execute_code requires a non-empty code string.",
      error_code: "validation_failed",
    });
    expect(payload.result?.content?.[0]?.text).toBe(
      "execution_failed: execute_code requires a non-empty code string.",
    );
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "mcp.execute_code.failed",
      expect.objectContaining({
        workspace_id: "ws_test",
        run_id: "run_test",
        org_id: "org_test",
        tool_name: "execute_code",
        error_code: "validation_failed",
        client_message: "execution_failed: execute_code requires a non-empty code string.",
        message_redacted: false,
      }),
    );
  });

  it("logs structured execute_code description validation failures returned to the client", async () => {
    const { convex, deps } = createDeps();
    convex.authenticateCredential.mockResolvedValue(createWorkspaceAuth());
    convex.createRun.mockResolvedValue({ id: "run_test" });
    const dispatch = createMcpRouteDispatcher(deps);

    const initializeResponse = await dispatch({
      request: createInitializeRequest(),
      workspaceIdParam: "ws_test",
    });
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    const response = await dispatch({
      request: createToolCallRequest(sessionId!, "execute_code", {
        description: "   ",
        code: "console.log('hi')",
      }),
      workspaceIdParam: "ws_test",
    });
    const payload = (await parseStreamableHttpJson(response)) as {
      result?: {
        structuredContent?: { status?: string; reason?: string; error_code?: string };
        content?: Array<{ text?: string }>;
        isError?: boolean;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.result?.isError).not.toBe(true);
    expect(payload.result?.structuredContent).toMatchObject({
      status: "execution_failed",
      reason: "execute_code requires a non-empty description string.",
      error_code: "validation_failed",
    });
    expect(payload.result?.content?.[0]?.text).toBe(
      "execution_failed: execute_code requires a non-empty description string.",
    );
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "mcp.execute_code.failed",
      expect.objectContaining({
        workspace_id: "ws_test",
        run_id: "run_test",
        org_id: "org_test",
        tool_name: "execute_code",
        error_code: "validation_failed",
        client_message: "execution_failed: execute_code requires a non-empty description string.",
        message_redacted: false,
      }),
    );
  });
});
