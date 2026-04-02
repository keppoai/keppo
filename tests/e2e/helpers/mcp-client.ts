type JsonRpcResponse = {
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type CallToolRpcResult = {
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  content?: Array<{
    json?: Record<string, unknown>;
    text?: string;
  }>;
};

export type ToolClient = {
  initialize: () => Promise<void>;
  callTool: (toolName: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const IN_FLIGHT_ACTION_STATUSES = new Set([
  "approval_required",
  "approved",
  "executing",
  "pending",
]);

type WaitForToolReadyOptions = {
  toolName: string;
  args: Record<string, unknown>;
  timeoutMs?: number;
  intervalMs?: number;
};

type WaitForSuccessfulActionOptions = {
  scope: string;
  response: Record<string, unknown>;
  timeoutMs?: number;
};

const parseMcpPayload = (body: string): JsonRpcResponse => {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as JsonRpcResponse;
  }

  const dataLine = trimmed
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data: "));
  if (!dataLine) {
    throw new Error(`Missing MCP JSON payload: ${body}`);
  }
  return JSON.parse(dataLine.slice("data: ".length)) as JsonRpcResponse;
};

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const toMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const isRetryableRpcError = (error: unknown): boolean => {
  const normalized = toMessage(error).toLowerCase();
  return (
    normalized.includes("fetch failed") ||
    normalized.includes("socketerror") ||
    normalized.includes("other side closed") ||
    normalized.includes("econnrefused") ||
    normalized.includes("econnreset")
  );
};

export const isTransientServerError = (error: unknown): boolean => {
  const normalized = toMessage(error).toLowerCase();
  return (
    normalized.includes("server error") ||
    normalized.includes("function execution timed out") ||
    normalized.includes("internal server error") ||
    normalized.includes("overloaded")
  );
};

const isRetryableAuthResponse = (status: number, body: string): boolean => {
  if (status !== 401 && status !== 403) {
    return false;
  }
  const normalized = body.toLowerCase();
  return (
    normalized.includes("invalid bearer token") ||
    normalized.includes("invalid or revoked credential")
  );
};

export const isSessionExpiredMcpError = (error: unknown): boolean => {
  const normalized = toMessage(error).toLowerCase();
  return (
    normalized.includes("session not found") ||
    normalized.includes("session expired") ||
    normalized.includes("re-initialize required")
  );
};

export const isOptimisticConcurrencyMcpError = (error: unknown): boolean => {
  return toMessage(error).toLowerCase().includes("optimisticconcurrencycontrolfailure");
};

const isActionNotFoundMcpError = (error: unknown): boolean => {
  const normalized = toMessage(error).toLowerCase();
  return normalized.includes("action ") && normalized.includes(" not found");
};

export const buildToolPayloadError = (
  toolName: string,
  payload: Record<string, unknown>,
): Error => {
  return new Error(
    `${toolName} returned failed status: ${JSON.stringify({
      error: payload.error,
      message: payload.message,
      details: payload.details,
      reason: payload.reason,
      code: payload.code,
      action_error: payload.action_error,
      status: payload.status,
      action_status: payload.action_status,
    })}`,
  );
};

const coerceReplayStatusAfterOccRetry = (
  payload: Record<string, unknown>,
  sawOccRetry: boolean,
): Record<string, unknown> => {
  if (!sawOccRetry || String(payload.status ?? "") !== "idempotent_replay") {
    return payload;
  }
  const actionStatus = String(payload.action_status ?? "");
  if (actionStatus !== "succeeded" && actionStatus !== "approval_required") {
    return payload;
  }
  return {
    ...payload,
    status: actionStatus,
    replay_status: "idempotent_replay",
  };
};

export const createResilientToolClient = (client: ToolClient): ToolClient => {
  return {
    initialize: () => client.initialize(),
    callTool: async (
      toolName: string,
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      let lastError: unknown = null;
      let sawOccRetry = false;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          const result = await client.callTool(toolName, args);
          if (String(result.status ?? "") === "failed") {
            const failedStatusError = buildToolPayloadError(toolName, result);
            lastError = failedStatusError;
            if (isSessionExpiredMcpError(failedStatusError)) {
              await client.initialize();
              continue;
            }
            if (isOptimisticConcurrencyMcpError(failedStatusError)) {
              sawOccRetry = true;
              await wait(100 * (attempt + 1));
              continue;
            }
            if (attempt < 2) {
              await wait(100 * (attempt + 1));
              continue;
            }
            throw failedStatusError;
          }
          return coerceReplayStatusAfterOccRetry(result, sawOccRetry);
        } catch (error) {
          lastError = error;
          if (isSessionExpiredMcpError(error)) {
            await client.initialize();
            continue;
          }
          if (isOptimisticConcurrencyMcpError(error)) {
            sawOccRetry = true;
            await wait(100 * (attempt + 1));
            continue;
          }
          throw error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
  };
};

export const waitForToolReady = async (
  client: Pick<ToolClient, "callTool">,
  options: WaitForToolReadyOptions,
): Promise<void> => {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  const intervalMs = Math.max(50, options.intervalMs ?? 150);
  while (Date.now() < deadline) {
    try {
      await client.callTool(options.toolName, options.args);
      return;
    } catch {
      await wait(intervalMs);
    }
  }

  throw new Error(
    `Tool ${options.toolName} did not become ready within ${options.timeoutMs ?? 15_000}ms.`,
  );
};

export const waitForSuccessfulAction = async (
  client: Pick<ToolClient, "callTool">,
  options: WaitForSuccessfulActionOptions,
): Promise<Record<string, unknown>> => {
  const actionId = typeof options.response.action_id === "string" ? options.response.action_id : "";
  if (!actionId) {
    return options.response;
  }

  const initialStatus = String(options.response.status ?? "");
  if (!IN_FLIGHT_ACTION_STATUSES.has(initialStatus)) {
    return options.response;
  }

  const deadline = Date.now() + (options.timeoutMs ?? 8_000);
  let latestStatus = initialStatus;
  while (Date.now() < deadline) {
    const status = await client.callTool("keppo.wait_for_action", { action_id: actionId });
    latestStatus = String(status.status ?? "");
    if (latestStatus === "succeeded") {
      return {
        ...status,
        action_id:
          typeof status.action_id === "string" && status.action_id.length > 0
            ? status.action_id
            : actionId,
      };
    }
    if (["failed", "rejected", "expired"].includes(latestStatus)) {
      throw new Error(`${options.scope} action did not succeed after approval (${latestStatus}).`);
    }
    const retryAfterMs = Number(status.retry_after_ms ?? status.recommended_poll_after_ms ?? 100);
    await wait(Math.max(50, Math.min(retryAfterMs, 500)));
  }

  throw new Error(
    `${options.scope} action did not execute successfully (latest: ${latestStatus}).`,
  );
};

export const waitForTerminalActionResult = async (
  client: Pick<ToolClient, "callTool">,
  options: WaitForSuccessfulActionOptions,
): Promise<Record<string, unknown>> => {
  const actionId =
    typeof options.response.action_id === "string" ? options.response.action_id.trim() : "";
  if (!actionId) {
    return options.response;
  }

  const initialStatus = String(options.response.status ?? "");
  if (["succeeded", "failed", "rejected", "expired"].includes(initialStatus)) {
    return options.response;
  }

  const deadline = Date.now() + (options.timeoutMs ?? 8_000);
  let latest: Record<string, unknown> = options.response;
  while (Date.now() < deadline) {
    latest = await client.callTool("keppo.wait_for_action", { action_id: actionId });
    const status = String(latest.status ?? "");
    if (["succeeded", "failed", "rejected", "expired"].includes(status)) {
      return {
        ...latest,
        action_id:
          typeof latest.action_id === "string" && latest.action_id.length > 0
            ? latest.action_id
            : actionId,
      };
    }
    const retryAfterMs = Number(latest.retry_after_ms ?? latest.recommended_poll_after_ms ?? 100);
    await wait(Math.max(50, Math.min(retryAfterMs, 500)));
  }

  throw new Error(
    `${options.scope} action did not reach a terminal state (latest: ${String((latest.status ?? initialStatus) || "unknown")}).`,
  );
};

export class McpClient {
  private readonly baseUrl: string;
  private readonly workspaceId: string;
  private readonly bearerToken: string;
  private readonly extraHeaders: Record<string, string>;
  private sessionId: string | null = null;
  private requestId = 0;

  constructor(params: {
    baseUrl: string;
    workspaceId: string;
    bearerToken: string;
    extraHeaders?: Record<string, string>;
  }) {
    this.baseUrl = params.baseUrl;
    this.workspaceId = params.workspaceId;
    this.bearerToken = params.bearerToken;
    this.extraHeaders = params.extraHeaders ?? {};
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.requestId += 1;
    const maxAttempts = 8;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/mcp/${encodeURIComponent(this.workspaceId)}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.bearerToken}`,
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
            ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
            ...this.extraHeaders,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: this.requestId,
            method,
            params,
          }),
        });
      } catch (error) {
        if (attempt < maxAttempts && isRetryableRpcError(error)) {
          await wait(100 * attempt);
          continue;
        }
        throw error;
      }

      const maybeSessionId = response.headers.get("mcp-session-id");
      if (maybeSessionId) {
        this.sessionId = maybeSessionId;
      }

      const text = await response.text();
      if (!response.ok) {
        if (attempt < maxAttempts && isRetryableAuthResponse(response.status, text)) {
          this.sessionId = null;
          await wait(Math.min(150 * attempt, 1_000));
          continue;
        }
        if (attempt < maxAttempts && response.status >= 500) {
          await wait(Math.min(250 * attempt, 1_500));
          continue;
        }
        throw new Error(text || `MCP request failed with ${response.status}`);
      }

      const payload = parseMcpPayload(text);
      if (payload.error) {
        throw new Error(payload.error.message);
      }

      return payload.result;
    }
    throw new Error(`MCP request failed after ${maxAttempts} attempts`);
  }

  async initialize(): Promise<void> {
    const deadline = Date.now() + 8_000;
    while (true) {
      try {
        await this.rpc("initialize", {
          protocolVersion: "2025-11-05",
          capabilities: {},
          clientInfo: {
            name: "playwright-e2e",
            version: "1.0.0",
          },
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/invalid or revoked credential/i.test(message) || Date.now() >= deadline) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  async listTools(): Promise<Array<{ name: string; description: string }>> {
    const result = await this.rpc("tools/list", {});
    const typed = result as { tools?: Array<{ name: string; description: string }> };
    return typed.tools ?? [];
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = await this.rpc("tools/call", {
      name: toolName,
      arguments: args,
    });
    const typed = result as CallToolRpcResult;
    if (typed.isError) {
      const message = typed.content?.[0]?.text ?? JSON.stringify(typed.structuredContent ?? {});
      throw new Error(message);
    }
    if (typed.structuredContent) {
      return typed.structuredContent;
    }
    return (typed.content?.[0]?.json ?? {}) as Record<string, unknown>;
  }

  async searchTools(
    query: string,
    options?: {
      provider?: string;
      capability?: string;
      limit?: number;
    },
  ): Promise<Array<Record<string, unknown>>> {
    const result = await this.rpc("tools/call", {
      name: "search_tools",
      arguments: {
        query,
        ...(options?.provider ? { provider: options.provider } : {}),
        ...(options?.capability ? { capability: options.capability } : {}),
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
      },
    });
    const typed = result as CallToolRpcResult;
    const structured = typed.structuredContent;
    if (structured && Array.isArray(structured.results)) {
      return structured.results as Array<Record<string, unknown>>;
    }
    return typed.content?.[0]?.json?.results ?? [];
  }

  async executeCode(params: {
    description: string;
    code: string;
  }): Promise<Record<string, unknown> | string> {
    const result = await this.rpc("tools/call", {
      name: "execute_code",
      arguments: {
        description: params.description,
        code: params.code,
      },
    });
    const typed = result as CallToolRpcResult;
    if (typed.structuredContent) {
      return typed.structuredContent;
    }
    const first = typed.content?.[0];
    if (first?.json) {
      return first.json;
    }
    return first?.text ?? "";
  }

  async getAction(actionId: string): Promise<Record<string, unknown>> {
    return await this.callTool("keppo.get_action", { action_id: actionId });
  }

  async waitForAction(actionId: string, timeoutMs = 12_000): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    let waitMs = 300;

    while (Date.now() < deadline) {
      let status: Record<string, unknown>;
      try {
        status = await this.callTool("keppo.wait_for_action", { action_id: actionId });
      } catch (error) {
        if (isTransientServerError(error)) {
          // Transient Convex timeouts or server errors — continue polling
          // rather than aborting the wait loop, since the action may still
          // reach a terminal state once contention subsides.
          await wait(Math.max(200, Math.min(waitMs, 1_000)));
          continue;
        }
        if (
          !toMessage(error).toLowerCase().includes("invalid_request") &&
          !isActionNotFoundMcpError(error)
        ) {
          throw error;
        }
        try {
          status = await this.getAction(actionId);
        } catch (lookupError) {
          if (isTransientServerError(lookupError)) {
            await wait(Math.max(200, Math.min(waitMs, 1_000)));
            continue;
          }
          if (!isActionNotFoundMcpError(lookupError)) {
            throw lookupError;
          }
          await wait(Math.max(100, Math.min(waitMs, 500)));
          continue;
        }
      }
      const state = String(status.status ?? "");
      if (["succeeded", "failed", "rejected", "expired"].includes(state)) {
        return status;
      }
      if (state === "rate_limited") {
        waitMs = Number(status.retry_after_ms ?? waitMs);
      } else {
        waitMs = Number(status.recommended_poll_after_ms ?? waitMs);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(100, Math.min(waitMs, 2_500))));
    }

    return await this.getAction(actionId);
  }

  async close(): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    try {
      await fetch(`${this.baseUrl}/mcp/${encodeURIComponent(this.workspaceId)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
          "Mcp-Session-Id": this.sessionId,
          ...this.extraHeaders,
        },
      });
    } catch {
      // Best-effort teardown: session close should not fail tests when MCP server
      // has already rotated or shut down for this namespace.
    } finally {
      this.sessionId = null;
    }
  }
}
