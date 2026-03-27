import type { CanonicalProviderId } from "../provider-catalog.js";
import {
  createErrorTextSignals,
  hasErrorCode,
  hasErrorCodePrefix,
  type ErrorTextSignals,
} from "./error-signals.js";
import {
  ProviderSdkError,
  type ProviderSdkErrorCategory,
  type ProviderSdkErrorShape,
} from "./port.js";

type FakeProviderSdkErrorRule = {
  match: (signals: ErrorTextSignals, message: string) => boolean;
  category: ProviderSdkErrorCategory;
  code: string | ((message: string) => string);
  status?: number;
  retryable: boolean;
};

const DEFAULT_ERROR_RULES: readonly FakeProviderSdkErrorRule[] = [
  {
    match: (signals) => hasErrorCodePrefix(signals, "invalid_", "missing_"),
    category: "validation",
    code: "invalid_request",
    status: 400,
    retryable: false,
  },
];

export const matchErrorCodes =
  (...codes: string[]) =>
  (signals: ErrorTextSignals): boolean => {
    return hasErrorCode(signals, ...codes);
  };

export const matchErrorCodePrefixes =
  (...prefixes: string[]) =>
  (signals: ErrorTextSignals): boolean => {
    return hasErrorCodePrefix(signals, ...prefixes);
  };

export const createFakeProviderSdkErrorFactory = (
  providerId: CanonicalProviderId,
  rules: readonly FakeProviderSdkErrorRule[],
): ((method: string, error: unknown) => ProviderSdkError) => {
  return (method: string, error: unknown): ProviderSdkError => {
    if (error instanceof ProviderSdkError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const messageSignals = createErrorTextSignals(message);
    const shape: ProviderSdkErrorShape = {
      category: "unknown",
      code: "provider_error",
      message,
      retryable: false,
    };

    for (const rule of [...rules, ...DEFAULT_ERROR_RULES]) {
      if (!rule.match(messageSignals, message)) {
        continue;
      }
      shape.category = rule.category;
      shape.code = typeof rule.code === "function" ? rule.code(message) : rule.code;
      shape.retryable = rule.retryable;
      if (typeof rule.status === "number") {
        shape.status = rule.status;
      }
      break;
    }

    return new ProviderSdkError({
      providerId,
      method,
      shape,
      causeData: error,
    });
  };
};
