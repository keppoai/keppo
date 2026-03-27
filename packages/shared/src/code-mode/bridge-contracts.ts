import { z } from "zod";
import { jsonObjectSchema, jsonValueSchema, type JsonObject } from "../json-types.js";
import { parseWorkerJsonBoundary } from "../providers/boundaries/json.js";

const nonEmptyStringSchema = z.string().trim().min(1);

const bridgeToolRequestSchema = z
  .object({
    requestId: nonEmptyStringSchema,
    responsePath: nonEmptyStringSchema,
    kind: z.literal("tool"),
    toolName: nonEmptyStringSchema,
    input: jsonObjectSchema.optional(),
  })
  .strict();

const bridgeSearchRequestSchema = z
  .object({
    requestId: nonEmptyStringSchema,
    responsePath: nonEmptyStringSchema,
    kind: z.literal("search"),
    query: nonEmptyStringSchema,
    options: jsonObjectSchema.optional(),
  })
  .strict();

const httpBridgeToolRequestSchema = z
  .object({
    requestId: nonEmptyStringSchema,
    kind: z.literal("tool"),
    toolName: nonEmptyStringSchema,
    input: jsonObjectSchema.optional(),
  })
  .strict();

const httpBridgeSearchRequestSchema = z
  .object({
    requestId: nonEmptyStringSchema,
    kind: z.literal("search"),
    query: nonEmptyStringSchema,
    options: jsonObjectSchema.optional(),
  })
  .strict();

export const codeModeBridgeRequestSchema = z.union([
  bridgeToolRequestSchema,
  bridgeSearchRequestSchema,
]);
export const codeModeHttpBridgeRequestSchema = z.union([
  httpBridgeToolRequestSchema,
  httpBridgeSearchRequestSchema,
]);

export const codeModeBridgeResultSchema = z
  .object({
    success: z.boolean(),
    logs: jsonValueSchema.optional(),
    hasReturnValue: z.boolean().optional(),
    returnValue: jsonValueSchema.optional(),
    toolCallsExecuted: jsonValueSchema.optional(),
    error: z.string().optional(),
  })
  .strict();

export const codeModeBridgeResponseFileSchema = z
  .object({
    ok: z.boolean(),
    value: jsonValueSchema.optional(),
    error: z.string().optional(),
  })
  .strict();

export type CodeModeBridgeRequest = z.infer<typeof codeModeBridgeRequestSchema>;
export type CodeModeHttpBridgeRequest = z.infer<typeof codeModeHttpBridgeRequestSchema>;
export type CodeModeBridgeResult = z.infer<typeof codeModeBridgeResultSchema>;
export type CodeModeBridgeResponseFile = z.infer<typeof codeModeBridgeResponseFileSchema>;

export const parseCodeModeBridgeRequest = (raw: string): CodeModeBridgeRequest => {
  return parseWorkerJsonBoundary(raw, codeModeBridgeRequestSchema, {
    defaultCode: "invalid_code_mode_bridge_request",
    message: "Invalid Code Mode bridge request payload.",
  });
};

export const tryParseCodeModeBridgeRequest = (raw: string): CodeModeBridgeRequest | null => {
  try {
    return parseCodeModeBridgeRequest(raw);
  } catch {
    return null;
  }
};

export const parseCodeModeHttpBridgeRequest = (raw: string): CodeModeHttpBridgeRequest => {
  return parseWorkerJsonBoundary(raw, codeModeHttpBridgeRequestSchema, {
    defaultCode: "invalid_code_mode_http_bridge_request",
    message: "Invalid Code Mode HTTP bridge request payload.",
  });
};

export const tryParseCodeModeHttpBridgeRequest = (
  raw: string,
): CodeModeHttpBridgeRequest | null => {
  try {
    return parseCodeModeHttpBridgeRequest(raw);
  } catch {
    return null;
  }
};

export const parseCodeModeBridgeResult = (raw: string): CodeModeBridgeResult => {
  return parseWorkerJsonBoundary(raw, codeModeBridgeResultSchema, {
    defaultCode: "invalid_code_mode_bridge_result",
    message: "Invalid Code Mode bridge result payload.",
  });
};

export const tryParseCodeModeBridgeResult = (raw: string): CodeModeBridgeResult | null => {
  try {
    return parseCodeModeBridgeResult(raw);
  } catch {
    return null;
  }
};

export const serializeCodeModeBridgeResponseFile = (
  payload: CodeModeBridgeResponseFile,
): string => {
  return JSON.stringify(codeModeBridgeResponseFileSchema.parse(payload));
};

export const parseCodeModeBridgeResponseFile = (raw: string): CodeModeBridgeResponseFile => {
  return parseWorkerJsonBoundary(raw, codeModeBridgeResponseFileSchema, {
    defaultCode: "invalid_code_mode_bridge_response",
    message: "Invalid Code Mode bridge response payload.",
  });
};

export const toBridgeRequestObject = (value: JsonObject | undefined): JsonObject => value ?? {};
