import type {
  ConformanceOutputValueType,
  ProviderActionGoldenErrorExpectation,
  ProviderActionGoldenResultExpectation,
  ProviderConformanceErrorKind,
} from "./action-matrix";

export type NormalizedConformanceResult = {
  status: string;
  hasActionId: boolean;
  outputShape: Record<string, ConformanceOutputValueType>;
};

export type NormalizedConformanceError = {
  kind: ProviderConformanceErrorKind;
  message: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const toOutputType = (value: unknown): ConformanceOutputValueType => {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  return "object";
};

const normalizeSpace = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

export const normalizeConformanceResult = (
  payload: Record<string, unknown>,
): NormalizedConformanceResult => {
  const output = isRecord(payload.output) ? payload.output : {};
  const outputShape: Record<string, ConformanceOutputValueType> = {};
  for (const [key, value] of Object.entries(output)) {
    outputShape[key] = toOutputType(value);
  }

  return {
    status: String(payload.status ?? ""),
    hasActionId: typeof payload.action_id === "string" && payload.action_id.length > 0,
    outputShape,
  };
};

export const normalizeConformanceError = (error: unknown): NormalizedConformanceError => {
  const raw = error instanceof Error ? error.message : String(error);
  const message = normalizeSpace(raw.toLowerCase());

  if (message.includes("not connected")) {
    return { kind: "not_connected", message };
  }
  if (
    message.includes("invalid input") ||
    message.includes("invalid request") ||
    message.includes("validation")
  ) {
    return { kind: "invalid_input", message };
  }
  if (
    message.includes("missing scopes") ||
    message.includes("access token") ||
    message.includes("auth")
  ) {
    return { kind: "auth", message };
  }
  if (message.includes("rate limit") || message.includes("rate_limited")) {
    return { kind: "rate_limited", message };
  }
  if (message.includes("not found")) {
    return { kind: "not_found", message };
  }
  return { kind: "unknown", message };
};

const toExpectedStatuses = (status: string | string[]): string[] => {
  return Array.isArray(status) ? status : [status];
};

const diffJson = (expected: unknown, actual: unknown): string => {
  return `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`;
};

export const assertGoldenResult = (
  scope: string,
  actual: NormalizedConformanceResult,
  expected: ProviderActionGoldenResultExpectation,
): void => {
  const expectedStatuses = toExpectedStatuses(expected.status);
  if (!expectedStatuses.includes(actual.status)) {
    throw new Error(`${scope} status mismatch (${diffJson(expectedStatuses, actual.status)})`);
  }

  if (typeof expected.hasActionId === "boolean" && expected.hasActionId !== actual.hasActionId) {
    throw new Error(
      `${scope} action_id presence mismatch (${diffJson(expected.hasActionId, actual.hasActionId)})`,
    );
  }

  const expectedShape = expected.outputShape ?? {};
  for (const [key, valueType] of Object.entries(expectedShape)) {
    if (!(key in actual.outputShape)) {
      throw new Error(
        `${scope} output key "${key}" missing (${diffJson(expectedShape, actual.outputShape)})`,
      );
    }
    const expectedTypes = Array.isArray(valueType) ? valueType : [valueType];
    if (!expectedTypes.includes(actual.outputShape[key])) {
      throw new Error(
        `${scope} output key "${key}" type mismatch (${diffJson(expectedTypes, actual.outputShape[key])})`,
      );
    }
  }
};

export const assertGoldenError = (
  scope: string,
  actual: NormalizedConformanceError,
  expected: ProviderActionGoldenErrorExpectation,
): void => {
  if (actual.kind !== expected.kind) {
    throw new Error(`${scope} error kind mismatch (${diffJson(expected.kind, actual.kind)})`);
  }

  const includes = expected.messageIncludes ?? [];
  for (const token of includes) {
    if (!actual.message.includes(token.toLowerCase())) {
      throw new Error(
        `${scope} error message missing token "${token}" (${diffJson(expected.messageIncludes, actual.message)})`,
      );
    }
  }
};
