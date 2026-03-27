import { describe, expect, it, vi } from "vitest";
import { createMcpRouteDispatcher } from "./mcp";

const createWorkspaceAuth = () => ({
  status: "ok" as const,
  credential_id: "cred_test",
  workspace: {
    id: "ws_test",
    org_id: "org_test",
    name: "Workspace",
    status: "active",
    policy_mode: "manual_only",
    default_action_behavior: "require_approval",
    code_mode_enabled: true,
    created_at: "2026-03-01T00:00:00.000Z",
  },
});

const createDeps = () => {
  const convex = {
    authenticateCredential: vi.fn(),
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

const createToolCallRequest = (sessionId: string, args: Record<string, unknown>): Request =>
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
        name: "search_tools",
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
      request: createToolCallRequest(sessionId!, { query: "send email" }),
      workspaceIdParam: "ws_test",
    });
    const secondResponse = await dispatch({
      request: createToolCallRequest(sessionId!, { query: "gmail send email message" }),
      workspaceIdParam: "ws_test",
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    await expect(parseStreamableHttpJson(firstResponse)).resolves.toBeTruthy();
    await expect(parseStreamableHttpJson(secondResponse)).resolves.toBeTruthy();
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
        request: createToolCallRequest(sessionId!, { query: "send email" }),
        workspaceIdParam: "ws_test",
      }),
      dispatch({
        request: createToolCallRequest(sessionId!, { query: "gmail send email message" }),
        workspaceIdParam: "ws_test",
      }),
    ]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    await expect(parseStreamableHttpJson(firstResponse)).resolves.toBeTruthy();
    await expect(parseStreamableHttpJson(secondResponse)).resolves.toBeTruthy();
  });
});
