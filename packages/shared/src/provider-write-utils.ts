import { stableIdempotencyKey } from "./ids.js";
import { SafeFetchError, safeFetch } from "./network.js";

const DEFAULT_RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

const hasSafeFetchErrorCode = (
  error: unknown,
): error is {
  code: "network_blocked" | "network_request_failed";
} => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? error.code : undefined;
  return code === "network_blocked" || code === "network_request_failed";
};

const isRetryableError = (error: unknown): boolean => {
  if (error instanceof SafeFetchError && error.code === "network_blocked") {
    return false;
  }
  if (hasSafeFetchErrorCode(error) && error.code === "network_blocked") {
    return false;
  }
  return true;
};

const parseRetryAfterMs = (response: Response): number | null => {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) {
    return null;
  }

  const seconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const asDate = Date.parse(retryAfter);
  if (!Number.isFinite(asDate)) {
    return null;
  }

  const delta = asDate - Date.now();
  return delta > 0 ? delta : 0;
};

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
};

export const applyBackoffJitter = (backoffMs: number): number => {
  if (!Number.isFinite(backoffMs) || backoffMs <= 0) {
    return 0;
  }
  const multiplier = 0.5 + Math.random() * 0.5;
  return Math.max(0, Math.floor(backoffMs * multiplier));
};

export const buildProviderIdempotencyKey = (
  toolName: string,
  payload: Record<string, unknown>,
  maxLength = 32,
): string => {
  const key = stableIdempotencyKey(toolName, payload);
  if (!Number.isInteger(maxLength) || maxLength <= 0) {
    return key;
  }
  return key.slice(0, maxLength);
};

export const safeFetchWithRetry = async (
  input: string | URL,
  init: RequestInit | undefined,
  context: string,
  options?: {
    namespace?: string;
    workerIndex?: string | number;
    headers?: Record<string, string>;
  },
  retry?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    retryableStatusCodes?: ReadonlySet<number>;
  },
): Promise<Response> => {
  const maxAttempts = Math.max(1, retry?.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, retry?.baseDelayMs ?? 150);
  const maxDelayMs = Math.max(baseDelayMs, retry?.maxDelayMs ?? 2000);
  const retryableStatusCodes = retry?.retryableStatusCodes ?? DEFAULT_RETRYABLE_STATUS_CODES;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await safeFetch(input, init, context, options);
      const retryable = retryableStatusCodes.has(response.status);
      if (!retryable || attempt === maxAttempts) {
        return response;
      }

      const retryAfterMs = parseRetryAfterMs(response);
      const backoffMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await wait(retryAfterMs ?? applyBackoffJitter(backoffMs));
      continue;
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableError(error)) {
        throw error;
      }
      const backoffMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await wait(applyBackoffJitter(backoffMs));
    }
  }

  throw new Error(`Exceeded retry budget for ${context}`);
};
