import type { Provider } from "../types.js";
import type { ToolDefinition } from "../tool-definitions.js";

export interface ConnectorContext {
  workspaceId: string;
  orgId: string;
  scopes: string[];
  access_token?: string;
  refresh_token?: string | null;
  access_token_expires_at?: string | null;
  integration_account_id?: string | null;
  external_account_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PreparedWrite {
  normalized_payload: Record<string, unknown>;
  payload_preview: Record<string, unknown>;
}

export interface Connector {
  provider: Provider;
  listTools(context: ConnectorContext): ToolDefinition[];
  executeRead(
    toolName: string,
    input: Record<string, unknown>,
    context: ConnectorContext,
  ): Promise<Record<string, unknown>>;
  prepareWrite(
    toolName: string,
    input: Record<string, unknown>,
    context: ConnectorContext,
  ): Promise<PreparedWrite>;
  executeWrite(
    toolName: string,
    normalizedPayload: Record<string, unknown>,
    context: ConnectorContext,
  ): Promise<Record<string, unknown>>;
  redact(toolName: string, data: Record<string, unknown>): Record<string, unknown>;
}
