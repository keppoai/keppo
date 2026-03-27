import { z } from "zod";
import {
  parseApiBoundary,
  parseConnectorEnvelope,
  parseConvexPayload,
  parseWorkerPayload,
} from "./error-boundary.js";

type ParseJsonValueOptions = {
  message?: string;
};

type ParseJsonBoundaryOptions = ParseJsonValueOptions & {
  defaultCode?: string;
};

export const isJsonRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const parseJsonValue = (raw: string, options: ParseJsonValueOptions = {}): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(options.message ?? "Value must be valid JSON.");
  }
};

export const parseJsonRecord = (
  raw: string,
  options: ParseJsonValueOptions & { recordMessage?: string } = {},
): Record<string, unknown> => {
  const parsed = parseJsonValue(raw, options);
  if (!isJsonRecord(parsed)) {
    throw new Error(options.recordMessage ?? "JSON value must be an object.");
  }
  return parsed;
};

export const tryParseJsonValue = (raw: string): unknown | null => {
  try {
    return parseJsonValue(raw);
  } catch {
    return null;
  }
};

export const tryParseJsonRecord = (raw: string): Record<string, unknown> | null => {
  try {
    return parseJsonRecord(raw);
  } catch {
    return null;
  }
};

const parseJsonBoundary = <TSchema extends z.ZodTypeAny>(
  raw: string,
  parseBoundary: (
    schema: TSchema,
    payload: unknown,
    options?: ParseJsonBoundaryOptions,
  ) => z.infer<TSchema>,
  schema: TSchema,
  options: ParseJsonBoundaryOptions = {},
): z.infer<TSchema> => {
  return parseBoundary(
    schema,
    parseJsonValue(raw, {
      message: options.message ?? "Value must be valid JSON.",
    }),
    options,
  );
};

export const parseApiJsonBoundary = <TSchema extends z.ZodTypeAny>(
  raw: string,
  schema: TSchema,
  options: ParseJsonBoundaryOptions = {},
): z.infer<TSchema> => {
  return parseJsonBoundary(raw, parseApiBoundary, schema, options);
};

export const parseWorkerJsonBoundary = <TSchema extends z.ZodTypeAny>(
  raw: string,
  schema: TSchema,
  options: ParseJsonBoundaryOptions = {},
): z.infer<TSchema> => {
  return parseJsonBoundary(raw, parseWorkerPayload, schema, options);
};

export const parseConnectorJsonBoundary = <TSchema extends z.ZodTypeAny>(
  raw: string,
  schema: TSchema,
  options: ParseJsonBoundaryOptions = {},
): z.infer<TSchema> => {
  return parseJsonBoundary(raw, parseConnectorEnvelope, schema, options);
};

export const parseConvexJsonBoundary = <TSchema extends z.ZodTypeAny>(
  raw: string,
  schema: TSchema,
  options: ParseJsonBoundaryOptions = {},
): z.infer<TSchema> => {
  return parseJsonBoundary(raw, parseConvexPayload, schema, options);
};
