import { describe, expect, it } from "vitest";
import { isUserFacingErrorEnvelope, parseUserFacingErrorEnvelope } from "./user-facing-errors.js";

describe("user-facing error envelope", () => {
  it("parses a serializable envelope", () => {
    expect(
      parseUserFacingErrorEnvelope({
        code: "workspace.limit_reached",
        message: "Workspace limit reached.",
        status: 403,
        metadata: { current: 3, max: 3, plan: "starter" },
        technical_details: "workspace.limit_reached",
        technical_details_safe_for_public: false,
      }),
    ).toEqual({
      code: "workspace.limit_reached",
      message: "Workspace limit reached.",
      status: 403,
      metadata: { current: 3, max: 3, plan: "starter" },
      technical_details: "workspace.limit_reached",
      technical_details_safe_for_public: false,
    });
  });

  it("rejects invalid envelopes", () => {
    expect(isUserFacingErrorEnvelope({ code: "x" })).toBe(false);
    expect(parseUserFacingErrorEnvelope({ message: "x" })).toBeNull();
  });
});
