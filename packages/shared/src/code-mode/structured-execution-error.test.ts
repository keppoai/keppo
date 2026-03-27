import { describe, expect, it } from "vitest";
import {
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE,
  createCodeModeStructuredExecutionError,
  formatCodeModeStructuredExecutionError,
  parseCodeModeStructuredExecutionError,
} from "./structured-execution-error.js";

describe("code-mode structured execution errors", () => {
  it("formats and parses approval-required payloads", () => {
    const message = formatCodeModeStructuredExecutionError({
      type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.approvalRequired,
      toolName: "gmail.sendEmail",
      actionId: "act_123",
      reason: "Tool call requires approval.",
      errorCode: "approval_required",
    });

    expect(parseCodeModeStructuredExecutionError(message)).toEqual({
      type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.approvalRequired,
      toolName: "gmail.sendEmail",
      actionId: "act_123",
      reason: "Tool call requires approval.",
      errorCode: "approval_required",
    });
  });

  it("formats and parses blocked payloads", () => {
    const error = createCodeModeStructuredExecutionError({
      type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.blocked,
      toolName: "slack.postMessage",
      reason: "Provider slack is disabled for this workspace.",
      errorCode: "provider_disabled",
    });

    expect(parseCodeModeStructuredExecutionError(error)).toEqual({
      type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.blocked,
      toolName: "slack.postMessage",
      reason: "Provider slack is disabled for this workspace.",
      errorCode: "provider_disabled",
    });
  });

  it("returns null for unrelated errors", () => {
    expect(parseCodeModeStructuredExecutionError(new Error("execution_failed: boom"))).toBeNull();
    expect(parseCodeModeStructuredExecutionError('{"type":"blocked"}')).toBeNull();
  });

  it("formats and parses execution-failed payloads", () => {
    const message = formatCodeModeStructuredExecutionError({
      type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
      toolName: "execute_code",
      reason: "Code execution timed out.",
      errorCode: "timeout",
    });

    expect(parseCodeModeStructuredExecutionError(message)).toEqual({
      type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
      toolName: "execute_code",
      reason: "Code execution timed out.",
      errorCode: "timeout",
    });
  });
});
