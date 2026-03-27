import { describe, expect, it } from "vitest";
import {
  AUTH_CREDENTIAL_REVOKED,
  ERROR_CATALOG,
  INTERNAL_UNEXPECTED,
  NETWORK_TIMEOUT,
  PROVIDER_RATE_LIMITED,
  QUEUE_DUPLICATE,
  classifyErrorCode,
  isRetryableError,
} from "./error-codes.js";

describe("error code catalog", () => {
  it("registers retryability metadata for canonical codes", () => {
    expect(ERROR_CATALOG.get(PROVIDER_RATE_LIMITED)?.retryable).toBe(true);
    expect(ERROR_CATALOG.get(AUTH_CREDENTIAL_REVOKED)?.retryable).toBe(false);
    expect(isRetryableError(PROVIDER_RATE_LIMITED)).toBe(true);
    expect(isRetryableError(AUTH_CREDENTIAL_REVOKED)).toBe(false);
  });

  it("classifies sample free-text reasons into canonical codes", () => {
    expect(classifyErrorCode("rate_limited: upstream 429 from provider")).toBe(
      PROVIDER_RATE_LIMITED,
    );
    expect(classifyErrorCode("queue duplicate delivery already processed")).toBe(QUEUE_DUPLICATE);
    expect(classifyErrorCode("request timed out after 10s")).toBe(NETWORK_TIMEOUT);
    expect(classifyErrorCode("integration_not_connected during refresh")).toBe(
      AUTH_CREDENTIAL_REVOKED,
    );
  });

  it("falls back to internal unexpected for unknown reasons", () => {
    expect(classifyErrorCode("weird uncategorized blow up")).toBe(INTERNAL_UNEXPECTED);
  });
});
