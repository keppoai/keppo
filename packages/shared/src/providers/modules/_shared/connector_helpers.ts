import { z } from "zod";
import type { ConnectorContext } from "../../../connectors/base.js";
import { toolMap } from "../../../tool-definitions.js";

export const ensureScopes = (
  toolName: string,
  scopes: string[],
  requiredScopesByTool: Record<string, string[]>,
): void => {
  const required = requiredScopesByTool[toolName] ?? [];
  const missing = required.filter((scope) => !scopes.includes(scope));
  if (missing.length > 0) {
    throw new Error(`Missing scopes for ${toolName}: ${missing.join(", ")}. Re-auth is required.`);
  }
};

export const assertInput = (
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> => {
  const definition = toolMap.get(toolName);
  if (!definition) {
    throw new Error(`Unknown tool ${toolName}`);
  }
  const parsed = definition.input_schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid input for ${toolName}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data as Record<string, unknown>;
};

export const resolveNamespaceFromContext = (context: ConnectorContext): string | undefined => {
  const value = context.metadata?.e2e_namespace;
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};
