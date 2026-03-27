import { describe, expect, it } from "vitest";
import { sanitizeMcpClientErrorMessage } from "./mcp";

describe("sanitizeMcpClientErrorMessage", () => {
  it("returns plain error messages when they are safe", () => {
    const result = sanitizeMcpClientErrorMessage(
      "provider_capability_mismatch: Provider github does not support write.",
      "Unknown tool failure",
    );

    expect(result).toEqual({
      message: "provider_capability_mismatch: Provider github does not support write.",
      redacted: false,
      referenceId: null,
    });
  });

  it("redacts token-like messages and returns a reference id", () => {
    const result = sanitizeMcpClientErrorMessage(
      "custom_server_error: Authorization: Bearer ghp_1234567890abcdefghijklmnop",
      "Unknown tool failure",
    );

    expect(result.redacted).toBe(true);
    expect(result.referenceId).toMatch(/^mcp_err_[a-f0-9]{12}$/);
    expect(result.message).toMatch(/^Unknown tool failure \(ref: mcp_err_[a-f0-9]{12}\)$/);
  });

  it("redacts messages that include tokenized URLs", () => {
    const result = sanitizeMcpClientErrorMessage(
      "oauth failed at https://example.com/callback?access_token=secret123&state=abc",
      "Tool execution failed.",
    );

    expect(result.redacted).toBe(true);
    expect(result.message).toMatch(/^Tool execution failed\. \(ref: mcp_err_[a-f0-9]{12}\)$/);
  });

  it("redacts oversized error messages", () => {
    const longMessage = `provider failure: ${"x".repeat(300)}`;
    const result = sanitizeMcpClientErrorMessage(longMessage, "execute_code failed");

    expect(result.redacted).toBe(true);
    expect(result.message).toMatch(/^execute_code failed \(ref: mcp_err_[a-f0-9]{12}\)$/);
  });

  it("extracts uncaught convex error text before redaction checks", () => {
    const result = sanitizeMcpClientErrorMessage(
      [
        "[Request ID: abc123] Server Error",
        "Uncaught Error: provider_disabled: custom_server_not_available: Server is disabled, missing, or out of scope.",
        "    at handler (../convex/custom_mcp_node.ts:467:8)",
      ].join("\n"),
      "Unknown tool failure",
    );

    expect(result).toEqual({
      message:
        "provider_disabled: custom_server_not_available: Server is disabled, missing, or out of scope.",
      redacted: false,
      referenceId: null,
    });
  });
});
