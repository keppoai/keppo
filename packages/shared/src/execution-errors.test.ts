import { describe, expect, it } from "vitest";
import {
  createWorkerExecutionError,
  formatWorkerExecutionErrorMessage,
  INTEGRATION_ERROR_CLASSIFICATIONS,
  isIntegrationErrorCategory,
  isIntegrationErrorCode,
  isWorkerExecutionErrorCode,
  parseWorkerExecutionErrorCode,
  toWorkerExecutionError,
  toIntegrationErrorCodeFromWorkerCode,
  toIntegrationErrorClassification,
  toWorkerExecutionErrorCode,
  WORKER_EXECUTION_ERROR_CODES,
} from "./execution-errors.js";

describe("execution error helpers", () => {
  it("formats messages with a stable code prefix", () => {
    expect(formatWorkerExecutionErrorMessage("provider_disabled", "Provider is disabled")).toBe(
      "provider_disabled: Provider is disabled",
    );
  });

  it("creates typed worker execution Error instances", () => {
    expect(createWorkerExecutionError("network_blocked", "Outbound request denied").message).toBe(
      "network_blocked: Outbound request denied",
    );
  });

  it("parses known worker execution error codes", () => {
    expect(
      parseWorkerExecutionErrorCode(
        "provider_capability_mismatch: Provider capability policy blocked the requested operation.",
      ),
    ).toBe("provider_capability_mismatch");
    expect(
      parseWorkerExecutionErrorCode("  network_blocked: Outbound provider request blocked.  "),
    ).toBe("network_blocked");
  });

  it("ignores unknown or malformed code prefixes", () => {
    expect(parseWorkerExecutionErrorCode("not_a_registered_code: Something happened")).toBeNull();
    expect(parseWorkerExecutionErrorCode("Execution failed without prefix")).toBeNull();
    expect(parseWorkerExecutionErrorCode(undefined)).toBeNull();
  });

  it("normalizes unknown errors to typed worker execution errors", () => {
    const unknown = toWorkerExecutionError(new Error("untyped failure"));
    expect(unknown.message).toBe("execution_failed: untyped failure");

    const typed = toWorkerExecutionError(
      new Error("provider_disabled: Provider is disabled by policy."),
    );
    expect(typed.message).toBe("provider_disabled: Provider is disabled by policy.");
  });

  it("recognizes only registered worker error codes", () => {
    expect(isWorkerExecutionErrorCode("provider_disabled")).toBe(true);
    expect(isWorkerExecutionErrorCode("provider.metric")).toBe(false);
    expect(WORKER_EXECUTION_ERROR_CODES).toContain("rate_limited");
    expect(WORKER_EXECUTION_ERROR_CODES).toContain("execution_failed");
  });

  it("maps worker and integration error codes deterministically", () => {
    expect(toIntegrationErrorCodeFromWorkerCode("provider_capability_mismatch")).toBe(
      "capability_mismatch",
    );
    expect(toWorkerExecutionErrorCode("capability_mismatch")).toBe("provider_capability_mismatch");
    expect(toWorkerExecutionErrorCode("execution_failed")).toBe("execution_failed");
  });

  it("builds stable integration error classifications", () => {
    const classification = toIntegrationErrorClassification("credential_error");
    expect(classification.errorCode).toBe("credential_error");
    expect(classification.errorCategory).toBe("auth");
    expect(classification.degradedReason).toContain("Reconnect integration");
    expect(INTEGRATION_ERROR_CLASSIFICATIONS.execution_failed.errorCategory).toBe("provider_api");
  });

  it("recognizes integration code/category literals", () => {
    expect(isIntegrationErrorCode("network_blocked")).toBe(true);
    expect(isIntegrationErrorCode("totally_unknown")).toBe(false);
    expect(isIntegrationErrorCategory("policy")).toBe(true);
    expect(isIntegrationErrorCategory("database")).toBe(false);
  });
});
