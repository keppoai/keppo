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

type JsonRecord = Record<string, unknown>;

export type MockMcpTool = {
  name: string;
  description: string;
  inputSchema: JsonRecord;
  handler: (args: JsonRecord) => Promise<JsonRecord> | JsonRecord;
};

export type MockMcpCall = {
  toolName: string;
  arguments: JsonRecord;
  calledAt: string;
};

export type MockMcpServer = {
  url: string;
  bearerToken: string | null;
  setTools: (tools: MockMcpTool[]) => void;
  getCalls: () => MockMcpCall[];
  clearCalls: () => void;
  close: () => Promise<void>;
};

const toRecord = (value: unknown): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
};

const asCallToolResult = (payload: JsonRecord): CallToolResult => {
  return {
    content: [],
    structuredContent: payload,
  };
};

const createServerInstance = (params: {
  getTools: () => MockMcpTool[];
  onToolCall: (call: MockMcpCall) => void;
}): McpServer => {
  const server = new McpServer(
    {
      name: "keppo-e2e-custom-mcp",
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
    const tools = params.getTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = params.getTools().find((entry) => entry.name === request.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found.`);
    }

    const args = toRecord(request.params.arguments);
    params.onToolCall({
      toolName: tool.name,
      arguments: args,
      calledAt: new Date().toISOString(),
    });

    const payload = await tool.handler(args);
    return asCallToolResult(payload);
  });

  return server;
};

export const createDefaultMockTools = (): MockMcpTool[] => {
  return [
    {
      name: "searchDocs",
      description: "Search internal documentation by query.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      handler: (args) => {
        const query = typeof args.query === "string" ? args.query : "";
        return {
          query,
          hits: [
            {
              title: "Support Policy",
              snippet: `Result for ${query}`,
            },
          ],
        };
      },
    },
    {
      name: "updateTicket",
      description: "Update an internal support ticket status.",
      inputSchema: {
        type: "object",
        properties: {
          ticketId: { type: "string" },
          status: { type: "string" },
        },
        required: ["ticketId", "status"],
        additionalProperties: false,
      },
      handler: (args) => {
        const ticketId = typeof args.ticketId === "string" ? args.ticketId : "unknown";
        const status = typeof args.status === "string" ? args.status : "unknown";
        return {
          ok: true,
          ticketId,
          status,
        };
      },
    },
    {
      name: "listQueues",
      description: "List deterministic queue names.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      handler: () => {
        return {
          queues: ["support", "billing", "operations"],
        };
      },
    },
  ];
};

export const startMockMcpServer = async (params?: {
  bearerToken?: string | null;
  tools?: MockMcpTool[];
  host?: string;
}): Promise<MockMcpServer> => {
  const host = params?.host ?? "127.0.0.1";
  const bearerToken = params?.bearerToken ?? "e2e-custom-mcp-token";
  let tools = [...(params?.tools ?? createDefaultMockTools())];
  const calls: MockMcpCall[] = [];

  const app = createMcpExpressApp({ host });

  app.post("/mcp", async (req, res) => {
    if (bearerToken) {
      const authHeader = req.header("authorization") ?? "";
      const expected = `Bearer ${bearerToken}`;
      if (authHeader !== expected) {
        res.status(401).json({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32001,
            message: "Unauthorized",
          },
        });
        return;
      }
    }

    const mcpServer = createServerInstance({
      getTools: () => tools,
      onToolCall: (call) => {
        calls.push(call);
      },
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: "Internal server error",
          },
        });
      }
    } finally {
      res.on("close", () => {
        void transport.close();
        void mcpServer.close();
      });
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32000,
        message: "Method not allowed",
      },
    });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32000,
        message: "Method not allowed",
      },
    });
  });

  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, host, () => resolve(server));
    server.on("error", reject);
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("mock_mcp.invalid_server_address");
  }

  const port = (address as AddressInfo).port;

  return {
    url: `http://${host}:${port}/mcp`,
    bearerToken,
    setTools: (nextTools) => {
      tools = [...nextTools];
    },
    getCalls: () => [...calls],
    clearCalls: () => {
      calls.length = 0;
    },
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
