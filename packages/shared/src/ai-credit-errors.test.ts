import { describe, expect, it } from "vitest";
import {
  AI_CREDIT_ERROR_CODE,
  formatAiCreditErrorPayload,
  parseAiCreditErrorCode,
} from "./ai-credit-errors.js";

describe("ai-credit-errors", () => {
  it("parses legacy plain-text errors", () => {
    expect(parseAiCreditErrorCode(new Error(AI_CREDIT_ERROR_CODE.limitReached))).toBe(
      AI_CREDIT_ERROR_CODE.limitReached,
    );
  });

  it("parses structured JSON errors", () => {
    const payload = formatAiCreditErrorPayload({
      code: AI_CREDIT_ERROR_CODE.limitReached,
      org_id: "org_test",
    });
    expect(parseAiCreditErrorCode(new Error(payload))).toBe(AI_CREDIT_ERROR_CODE.limitReached);
  });

  it("parses uncaught convex-prefixed structured errors", () => {
    const payload = formatAiCreditErrorPayload({
      code: AI_CREDIT_ERROR_CODE.limitReached,
      org_id: "org_test",
    });
    expect(parseAiCreditErrorCode(`Uncaught Error: ${payload}`)).toBe(
      AI_CREDIT_ERROR_CODE.limitReached,
    );
  });

  it("parses generic error objects with prefixed messages", () => {
    const payload = formatAiCreditErrorPayload({
      code: AI_CREDIT_ERROR_CODE.limitReached,
      org_id: "org_test",
    });
    expect(parseAiCreditErrorCode({ message: `Uncaught ConvexError: ${payload}` })).toBe(
      AI_CREDIT_ERROR_CODE.limitReached,
    );
  });

  it("returns null for unrelated errors", () => {
    expect(parseAiCreditErrorCode(new Error("other_error"))).toBeNull();
  });
});
