import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { callRemoteTool, discoverRemoteTools } from "./client.js";

type JsonRecord = Record<string, unknown>;

type MockTool = {
  name: string;
  description: string;
  inputSchema: JsonRecord;
  handler: (args: JsonRecord) => Promise<JsonRecord> | JsonRecord;
};

const toRecord = (value: unknown): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
};

const asToolResult = (payload: JsonRecord): CallToolResult => ({
  content: [],
  structuredContent: payload,
});

const startMockServer = async (params?: {
  bearerToken?: string;
  tools?: MockTool[];
  delayMs?: number;
}): Promise<{
  url: string;
  bearerToken: string;
  close: () => Promise<void>;
}> => {
  const bearerToken = params?.bearerToken ?? "custom-mcp-test-token";
  const tools = params?.tools ?? [
    {
      name: "searchDocs",
      description: "Search docs",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      handler: (args) => ({
        query: typeof args.query === "string" ? args.query : "",
        ok: true,
      }),
    },
  ];

  const app = createMcpExpressApp({ host: "127.0.0.1" });

  app.post("/mcp", async (req: unknown, res: unknown) => {
    const request = req as {
      header: (name: string) => string | undefined;
      body?: unknown;
    };
    const response = res as {
      status: (code: number) => {
        json: (payload: unknown) => void;
      };
    };

    if (request.header("authorization") !== `Bearer ${bearerToken}`) {
      response.status(401).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Unauthorized" },
      });
      return;
    }

    const server = new McpServer(
      {
        name: "custom-mcp-unit-test",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (typeof params?.delayMs === "number" && params.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, params.delayMs));
      }
      return {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (typeof params?.delayMs === "number" && params.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, params.delayMs));
      }
      const tool = tools.find((entry) => entry.name === request.params.name);
      if (!tool) {
        throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found.`);
      }

      const payload = await tool.handler(toRecord(request.params.arguments));
      return asToolResult(payload);
    });

    const transport = new StreamableHTTPServerTransport();

    try {
      await server.connect(transport as unknown as Parameters<McpServer["connect"]>[0]);
      await transport.handleRequest(
        request as unknown as Parameters<typeof transport.handleRequest>[0],
        response as unknown as Parameters<typeof transport.handleRequest>[1],
        request.body,
      );
    } finally {
      (response as unknown as { on: (event: string, handler: () => void) => void }).on(
        "close",
        () => {
          void transport.close();
          void server.close();
        },
      );
    }
  });

  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("mock_server.invalid_address");
  }

  const port = (address as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    bearerToken,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
};

const activeServers: Array<{ close: () => Promise<void> }> = [];
const originalAllowInsecure = process.env.KEPPO_ALLOW_INSECURE_CUSTOM_MCP_HTTP;
const originalE2EMode = process.env.KEPPO_E2E_MODE;

const startRedirectServer = async (
  location: string,
): Promise<{
  url: string;
  close: () => Promise<void>;
}> => {
  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const server = createServer((request, response) => {
      if ((request.url ?? "/") === "/mcp") {
        response.statusCode = 302;
        response.setHeader("location", location);
        response.end();
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("redirect_server.invalid_address");
  }

  const port = (address as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
};

beforeEach(() => {
  process.env.KEPPO_ALLOW_INSECURE_CUSTOM_MCP_HTTP = "true";
  delete process.env.KEPPO_E2E_MODE;
});

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
  if (originalAllowInsecure === undefined) {
    delete process.env.KEPPO_ALLOW_INSECURE_CUSTOM_MCP_HTTP;
  } else {
    process.env.KEPPO_ALLOW_INSECURE_CUSTOM_MCP_HTTP = originalAllowInsecure;
  }
  if (originalE2EMode === undefined) {
    delete process.env.KEPPO_E2E_MODE;
  } else {
    process.env.KEPPO_E2E_MODE = originalE2EMode;
  }
});

describe("custom MCP client", () => {
  it("discovers tools from a remote MCP server", async () => {
    const server = await startMockServer();
    activeServers.push(server);

    const result = await discoverRemoteTools({
      url: server.url,
      bearerToken: server.bearerToken,
      timeoutMs: 5_000,
    });

    expect(result.success).toBe(true);
    expect(result.tools.map((tool) => tool.name)).toEqual(["searchDocs"]);
    expect(result.tools[0]?.inputSchema).toEqual({
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    });
  });

  it("maps discovery auth failures", async () => {
    const server = await startMockServer({ bearerToken: "expected-token" });
    activeServers.push(server);

    const result = await discoverRemoteTools({
      url: server.url,
      bearerToken: "wrong-token",
      timeoutMs: 5_000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("auth_failed");
  });

  it("maps discovery connection-refused failures", async () => {
    const result = await discoverRemoteTools({
      url: "http://127.0.0.1:9/mcp",
      bearerToken: "ignored",
      timeoutMs: 5_000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/connection_refused|network_error/);
  });

  it("maps discovery timeouts", async () => {
    const server = await startMockServer({ delayMs: 120 });
    activeServers.push(server);

    const result = await discoverRemoteTools({
      url: server.url,
      bearerToken: server.bearerToken,
      timeoutMs: 20,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
  });

  it("calls a remote tool and returns structured content", async () => {
    const server = await startMockServer();
    activeServers.push(server);

    const result = await callRemoteTool({
      url: server.url,
      bearerToken: server.bearerToken,
      toolName: "searchDocs",
      arguments: {
        query: "billing",
      },
      timeoutMs: 5_000,
    });

    expect(result.content).toEqual([
      {
        type: "json",
        json: {
          query: "billing",
          ok: true,
        },
      },
    ]);
  });

  it("throws structured error when remote tool is missing", async () => {
    const server = await startMockServer();
    activeServers.push(server);

    await expect(
      callRemoteTool({
        url: server.url,
        bearerToken: server.bearerToken,
        toolName: "missingTool",
        arguments: {},
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/custom_server_error/i);
  });

  it("blocks loopback custom MCP targets when insecure-local mode is disabled", async () => {
    const server = await startMockServer();
    activeServers.push(server);
    delete process.env.KEPPO_ALLOW_INSECURE_CUSTOM_MCP_HTTP;

    const result = await discoverRemoteTools({
      url: server.url,
      bearerToken: server.bearerToken,
      timeoutMs: 5_000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("network_blocked");
  });

  it("rejects redirect responses that resolve to blocked addresses", async () => {
    const redirectServer = await startRedirectServer("http://169.254.169.254/latest/meta-data");
    activeServers.push(redirectServer);

    const result = await discoverRemoteTools({
      url: redirectServer.url,
      bearerToken: "ignored",
      timeoutMs: 5_000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("network_blocked");
  });

  it("rejects redirect responses that hop into private RFC1918 space", async () => {
    const redirectServer = await startRedirectServer("http://10.0.0.7/internal");
    activeServers.push(redirectServer);

    const result = await discoverRemoteTools({
      url: redirectServer.url,
      bearerToken: "ignored",
      timeoutMs: 5_000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("network_blocked");
  });

  it("rejects redirect responses that hop into 192.168 RFC1918 space", async () => {
    const redirectServer = await startRedirectServer("http://192.168.1.8/internal");
    activeServers.push(redirectServer);

    const result = await discoverRemoteTools({
      url: redirectServer.url,
      bearerToken: "ignored",
      timeoutMs: 5_000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("network_blocked");
  });
});
