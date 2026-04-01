import { describe, expect, it } from "vitest";
import { ApiError } from "./api-errors";
import {
  extractSafeErrorDetail,
  toUserFacingError,
  toUserFacingErrorMessage,
} from "./user-facing-errors";

describe("user-facing dashboard errors", () => {
  it("normalizes auth and network failures into stable copy", () => {
    expect(toUserFacingErrorMessage(new Error("Invalid email or password"))).toBe(
      "Sign-in failed. Check your credentials and try again.",
    );
    expect(toUserFacingErrorMessage(new ApiError("Forbidden", 403))).toBe(
      "You do not have access to do that.",
    );
    expect(toUserFacingErrorMessage(new Error("Failed to fetch"))).toBe(
      "Keppo could not reach the server. Try again.",
    );
  });

  it("prefers structured payloads before code prefixes and generic fallback", () => {
    const structured = new ApiError("Request failed", 400, {
      payload: {
        error: {
          code: "invite.member_limit_reached",
          message: "Member limit reached for this organization.",
        },
      },
      responseText:
        '{"error":{"code":"invite.member_limit_reached","message":"Member limit reached for this organization."}}',
    });
    const prefixed = new Error("custom_mcp.slug_conflict: This slug already exists.");
    const generic = new Error("backend stack trace omitted");

    expect(toUserFacingError(structured).code).toBe("invite.member_limit_reached");
    expect(toUserFacingError(prefixed).code).toBe("custom_mcp.slug_conflict");
    expect(toUserFacingError(generic).code).toBe("internal_error");
  });

  it("preserves already-normalized user-facing errors", () => {
    const normalized = toUserFacingError(
      {
        code: "push.subscription_failed",
        title: "Push notification setup failed",
        summary: "Browser push setup did not complete for this device.",
        nextSteps: ["Retry."],
        technicalDetails: "code: push.subscription_failed\nstatus: 503",
        publicTechnicalDetails: "code: push.subscription_failed",
        status: 503,
        severity: "error",
        publicSafe: true,
        metadata: null,
        rawMessage: "Push registration failed.",
        sourceMessage: "Push registration failed.",
      },
      { audience: "public" },
    );

    expect(normalized.code).toBe("push.subscription_failed");
    expect(normalized.technicalDetails).toBe("code: push.subscription_failed");
  });

  it("uses fallback codes to preserve push guidance for raw browser errors", () => {
    const normalized = toUserFacingError(
      new Error("Push gateway rejected the subscription handshake after policy validation."),
      {
        fallback: "Failed to enable push notifications.",
        fallbackCode: "push.subscription_failed",
      },
    );

    expect(normalized.code).toBe("push.subscription_failed");
    expect(normalized.title).toBe("Push notification setup failed");
    expect(normalized.summary).toBe("Browser push setup did not complete for this device.");
    expect(normalized.technicalDetails).toContain(
      "message: Push gateway rejected the subscription handshake after policy validation.",
    );
  });

  it("keeps fallback copy for unexpected backend strings while preserving safe detail", () => {
    const error = new Error("provider_disabled: backend stack trace omitted");

    expect(toUserFacingErrorMessage(error, "Checkout failed.")).toBe("Checkout failed.");
    expect(extractSafeErrorDetail(error)).toBe("provider_disabled");
  });

  it("keeps public output sanitized for unsafe backend errors", () => {
    const error = new Error("custom_mcp.slug_conflict: stack trace omitted");

    expect(toUserFacingError(error, { audience: "public" })).toMatchObject({
      code: "custom_mcp.slug_conflict",
      summary: "Keppo could not finish that custom MCP action.",
    });
  });

  it("preserves safe invite expiry guidance on public routes", () => {
    const error = new Error("Invitation is invalid or no longer available.");

    expect(toUserFacingError(error, { audience: "public" })).toMatchObject({
      title: "Invitation no longer valid",
      summary: "This invite link has expired or is no longer available.",
    });
  });

  it("uses billing-specific guidance for billing permission failures", () => {
    const error = new ApiError("Forbidden", 403, {
      payload: {
        error: {
          code: "forbidden",
          message: "Only owners and admins can manage billing.",
        },
      },
      responseText:
        '{"error":{"code":"forbidden","message":"Only owners and admins can manage billing."}}',
    });

    expect(toUserFacingError(error, { audience: "public" })).toMatchObject({
      title: "Billing admin access required",
      summary: "Only organization owners and admins can manage billing for this organization.",
      nextSteps: [
        "Ask an owner or admin to complete the billing action.",
        "If you should manage billing, ask an owner to update your role.",
      ],
    });
  });
});
