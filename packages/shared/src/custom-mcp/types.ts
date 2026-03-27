export type RemoteToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type DiscoveryResult = {
  success: boolean;
  tools: RemoteToolDefinition[];
  error?: string;
  serverInfo?: {
    name: string;
    version: string;
  };
};

export type CustomMcpCallResult = {
  content: Array<{
    type: string;
    text?: string;
    json?: unknown;
  }>;
};
