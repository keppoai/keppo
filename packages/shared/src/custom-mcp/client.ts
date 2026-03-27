import { Client } from "@modelcontextprotocol/sdk/client";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createErrorTextSignals, hasAllWords, hasAnyWord } from "../provider-sdk/error-signals.js";
import type { CustomMcpCallResult, DiscoveryResult, RemoteToolDefinition } from "./types.js";

const DEFAULT_DISCOVERY_TIMEOUT_MS = 15_000;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.google.internal.",
]);

type MappedContentItem = {
  type: string;
  text?: string;
  json?: unknown;
};

class CustomMcpTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomMcpTimeoutError";
  }
}

class CustomMcpNetworkPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomMcpNetworkPolicyError";
  }
}

const withTimeout = async <T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new CustomMcpTimeoutError(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
};

const mapErrorMessage = (error: unknown): string => {
  if (error instanceof CustomMcpTimeoutError) {
    return `timeout: ${error.message}`;
  }
  if (error instanceof CustomMcpNetworkPolicyError) {
    return `network_blocked: ${error.message}`;
  }
  if (error instanceof StreamableHTTPError) {
    if (error.code === 401 || error.code === 403) {
      return "auth_failed: remote MCP server rejected credentials";
    }
    if (typeof error.code === "number") {
      return `http_${error.code}: ${error.message}`;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  const messageSignals = createErrorTextSignals(message);
  if (
    hasAnyWord(messageSignals, "econnrefused") ||
    hasAllWords(messageSignals, "connection", "refused")
  ) {
    return "connection_refused: remote MCP server is unreachable";
  }
  if (hasAllWords(messageSignals, "fetch", "failed") || hasAnyWord(messageSignals, "network")) {
    return "network_error: failed to reach remote MCP server";
  }
  if (hasAnyWord(messageSignals, "unauthorized", "forbidden")) {
    return "auth_failed: remote MCP server rejected credentials";
  }
  return message;
};

const inInsecureLocalMode = (): boolean =>
  process.env.KEPPO_ALLOW_INSECURE_CUSTOM_MCP_HTTP === "true" ||
  process.env.KEPPO_E2E_MODE === "true";

const toIPv4Octets = (ip: string): number[] | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number.parseInt(part, 10);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return null;
    }
    octets.push(value);
  }
  return octets;
};

const isLoopbackAddress = (address: string): boolean => {
  if (isIP(address) === 4) {
    const octets = toIPv4Octets(address);
    return (octets?.[0] ?? -1) === 127;
  }
  const normalized = address.trim().toLowerCase();
  return normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
};

const isBlockedIPv4 = (address: string): boolean => {
  const octets = toIPv4Octets(address);
  if (!octets) {
    return true;
  }
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  return a >= 224;
};

const isBlockedIPv6 = (address: string): boolean => {
  const normalized = address.trim().toLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  const mappedIPv4Match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(normalized);
  if (mappedIPv4Match) {
    return isBlockedIPv4(mappedIPv4Match[1] ?? "");
  }

  const noPrefix = normalized.startsWith("::") ? normalized.slice(2) : normalized;
  const firstSegment = (noPrefix.split(":")[0] ?? "").trim();
  if (!firstSegment) {
    return true;
  }
  if (firstSegment.startsWith("fc") || firstSegment.startsWith("fd")) {
    return true;
  }
  if (
    firstSegment.startsWith("fe8") ||
    firstSegment.startsWith("fe9") ||
    firstSegment.startsWith("fea") ||
    firstSegment.startsWith("feb")
  ) {
    return true;
  }
  return false;
};

const isBlockedIpAddress = (address: string): boolean => {
  const version = isIP(address);
  if (version === 4) {
    return isBlockedIPv4(address);
  }
  if (version === 6) {
    return isBlockedIPv6(address);
  }
  return true;
};

const normalizeHost = (hostname: string): string => hostname.trim().toLowerCase();

const assertProtocolAllowed = (target: URL): void => {
  if (target.protocol === "https:") {
    return;
  }

  const localMode = inInsecureLocalMode();
  const host = normalizeHost(target.hostname);
  const loopbackHost = host === "localhost" || isLoopbackAddress(host);
  if (target.protocol === "http:" && localMode && loopbackHost) {
    return;
  }
  throw new CustomMcpNetworkPolicyError(
    "custom_mcp.network_blocked: URL must use https except loopback http in local/e2e mode.",
  );
};

const assertAddressAllowed = (address: string, context: string): void => {
  if (isLoopbackAddress(address) && inInsecureLocalMode()) {
    return;
  }
  if (isBlockedIpAddress(address)) {
    throw new CustomMcpNetworkPolicyError(
      `custom_mcp.network_blocked: ${context} resolves to blocked address ${address}.`,
    );
  }
};

const assertTargetAllowed = async (target: URL, context: string): Promise<void> => {
  assertProtocolAllowed(target);

  const hostname = normalizeHost(target.hostname);
  if (BLOCKED_HOSTNAMES.has(hostname) && !(inInsecureLocalMode() && hostname === "localhost")) {
    throw new CustomMcpNetworkPolicyError(
      `custom_mcp.network_blocked: ${context} hostname ${hostname} is blocked.`,
    );
  }

  if (isIP(hostname)) {
    assertAddressAllowed(hostname, context);
    return;
  }

  let resolved: Array<{ address: string }> = [];
  try {
    resolved = await lookup(hostname, {
      all: true,
      verbatim: true,
    });
  } catch {
    throw new CustomMcpNetworkPolicyError(
      `custom_mcp.network_blocked: ${context} hostname ${hostname} could not be resolved.`,
    );
  }

  if (resolved.length === 0) {
    throw new CustomMcpNetworkPolicyError(
      `custom_mcp.network_blocked: ${context} hostname ${hostname} resolved no addresses.`,
    );
  }

  for (const entry of resolved) {
    assertAddressAllowed(entry.address, context);
  }
};

const isRedirectStatusCode = (status: number): boolean =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
const MAX_REDIRECT_HOPS = 5;

const toTargetUrl = (input: RequestInfo | URL): URL => {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    return new URL(input);
  }
  if (typeof Request !== "undefined" && input instanceof Request) {
    return new URL(input.url);
  }
  throw new CustomMcpNetworkPolicyError(
    "custom_mcp.network_blocked: Unsupported request input for custom MCP fetch.",
  );
};

const createSecureMcpFetch = (): typeof fetch => {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let target = toTargetUrl(input);
    let requestInit: RequestInit = {
      ...init,
      redirect: "manual",
    };

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      await assertTargetAllowed(target, hop === 0 ? "request" : "redirect");
      const response = await fetch(target, requestInit);
      if (!isRedirectStatusCode(response.status)) {
        return response;
      }

      const location = response.headers.get("location");
      if (!location) {
        throw new CustomMcpNetworkPolicyError(
          "custom_mcp.network_blocked: Redirect response missing location header.",
        );
      }
      const nextTarget = new URL(location, target);
      await assertTargetAllowed(nextTarget, "redirect");
      await response.body?.cancel().catch(() => undefined);

      const method = (requestInit.method ?? "GET").toUpperCase();
      const shouldRewriteToGet =
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method === "POST");
      if (shouldRewriteToGet) {
        requestInit = {
          ...requestInit,
          method: "GET",
          body: null,
        };
      }
      target = nextTarget;
    }

    throw new CustomMcpNetworkPolicyError(
      "custom_mcp.network_blocked: Too many redirects from custom MCP server.",
    );
  };
};

const toMappedContent = (content: unknown): MappedContentItem[] => {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.map((entry) => {
    if (!entry || typeof entry !== "object") {
      return {
        type: "json",
        json: entry,
      };
    }

    const candidate = entry as {
      type?: unknown;
      text?: unknown;
    };

    const type = typeof candidate.type === "string" ? candidate.type : "json";
    if (type === "text" && typeof candidate.text === "string") {
      return {
        type,
        text: candidate.text,
      };
    }

    return {
      type,
      json: entry,
    };
  });
};

const buildClient = async (params: {
  url: string;
  bearerToken: string | undefined;
  timeoutMs: number;
}): Promise<{
  client: Client;
  transport: StreamableHTTPClientTransport;
}> => {
  const secureFetch = createSecureMcpFetch();
  const transport = new StreamableHTTPClientTransport(new URL(params.url), {
    requestInit: {
      redirect: "manual",
      headers: params.bearerToken
        ? {
            Authorization: `Bearer ${params.bearerToken}`,
          }
        : {},
    },
    fetch: secureFetch,
  });

  const client = new Client(
    {
      name: "keppo",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  await withTimeout(
    client.connect(transport as unknown as Parameters<Client["connect"]>[0]),
    params.timeoutMs,
    "initialize",
  );
  return { client, transport };
};

const closeTransport = async (transport: StreamableHTTPClientTransport): Promise<void> => {
  try {
    await transport.close();
  } catch {
    // best-effort cleanup
  }
};

export const discoverRemoteTools = async (params: {
  url: string;
  bearerToken?: string;
  timeoutMs?: number;
}): Promise<DiscoveryResult> => {
  const timeoutMs = params.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  let transport: StreamableHTTPClientTransport | null = null;

  try {
    const built = await buildClient({
      url: params.url,
      bearerToken: params.bearerToken,
      timeoutMs,
    });
    transport = built.transport;

    const toolsList = await withTimeout(built.client.listTools(), timeoutMs, "tools/list");
    const tools: RemoteToolDefinition[] = toolsList.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? `Custom MCP tool ${tool.name}`,
      inputSchema:
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? (tool.inputSchema as Record<string, unknown>)
          : { type: "object", properties: {}, additionalProperties: true },
    }));

    const serverVersion = built.client.getServerVersion();

    return {
      success: true,
      tools,
      ...(serverVersion
        ? {
            serverInfo: {
              name: serverVersion.name,
              version: serverVersion.version,
            },
          }
        : {}),
    };
  } catch (error) {
    return {
      success: false,
      tools: [],
      error: mapErrorMessage(error),
    };
  } finally {
    if (transport) {
      await closeTransport(transport);
    }
  }
};

export const callRemoteTool = async (params: {
  url: string;
  bearerToken?: string;
  toolName: string;
  arguments: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<CustomMcpCallResult> => {
  const timeoutMs = params.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  let transport: StreamableHTTPClientTransport | null = null;

  try {
    const built = await buildClient({
      url: params.url,
      bearerToken: params.bearerToken,
      timeoutMs,
    });
    transport = built.transport;

    const result = await withTimeout(
      built.client.callTool({
        name: params.toolName,
        arguments: params.arguments,
      }),
      timeoutMs,
      `tools/call:${params.toolName}`,
    );

    if ("toolResult" in result) {
      return {
        content: [
          {
            type: "json",
            json: result.toolResult,
          },
        ],
      };
    }

    const mappedContent = toMappedContent(result.content);
    if (mappedContent.length > 0) {
      return { content: mappedContent };
    }

    if (result.structuredContent !== undefined) {
      return {
        content: [
          {
            type: "json",
            json: result.structuredContent,
          },
        ],
      };
    }

    return {
      content: [],
    };
  } catch (error) {
    throw new Error(`custom_server_error: ${mapErrorMessage(error)}`);
  } finally {
    if (transport) {
      await closeTransport(transport);
    }
  }
};
