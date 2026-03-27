import { describe, expect, it } from "vitest";
import { buildApprovedActionFailureLogMetadata } from "../../convex/mcp_node/approved_actions_execution";

describe("buildApprovedActionFailureLogMetadata", () => {
  it("includes provider classification and response details for provider failures", () => {
    const error = Object.assign(new Error("Gmail API request failed: 403"), {
      shape: {
        category: "unknown",
        code: "provider_error",
        status: 403,
        retryable: false,
        message: "Gmail API request failed: 403",
      },
      causeData: {
        response: {
          status: 403,
          data: {
            error: {
              code: 403,
              status: "PERMISSION_DENIED",
              message: "Request had insufficient authentication scopes.",
              errors: [{ reason: "insufficientPermissions" }],
            },
          },
        },
      },
    });

    expect(
      buildApprovedActionFailureLogMetadata({
        actionId: "act_123",
        toolName: "gmail.sendEmail",
        provider: "google",
        providerModuleVersion: 1,
        workspaceId: "ws_123",
        orgId: "org_123",
        error,
        classification: {
          errorCode: "execution_failed",
          errorCategory: "provider_api",
        },
      }),
    ).toEqual({
      actionId: "act_123",
      toolName: "gmail.sendEmail",
      provider: "google",
      providerModuleVersion: 1,
      workspaceId: "ws_123",
      orgId: "org_123",
      errorMessage: "Gmail API request failed: 403",
      errorCode: "execution_failed",
      errorCategory: "provider_api",
      providerError: {
        category: "unknown",
        code: "provider_error",
        status: 403,
        retryable: false,
        message: "Gmail API request failed: 403",
      },
      providerResponseStatus: 403,
      providerResponseData: {
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          message: "Request had insufficient authentication scopes.",
          errors: ["[object]"],
        },
      },
    });
  });

  it("truncates oversized nested response payloads to keep logs readable", () => {
    const error = {
      response: {
        status: 403,
        data: {
          message: "x".repeat(1105),
          nested: {
            keep: true,
            deep: {
              hidden: "value",
            },
          },
        },
      },
    };

    const metadata = buildApprovedActionFailureLogMetadata({
      actionId: "act_456",
      toolName: "gmail.sendEmail",
      provider: "google",
      providerModuleVersion: 1,
      workspaceId: "ws_456",
      orgId: "org_456",
      error,
      classification: {
        errorCode: "execution_failed",
        errorCategory: "provider_api",
      },
    });

    expect(metadata.providerResponseStatus).toBe(403);
    expect(metadata.providerResponseData).toEqual({
      message: `${"x".repeat(1000)}…`,
      nested: {
        keep: true,
        deep: {
          hidden: "value",
        },
      },
    });
  });
});
