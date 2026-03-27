import { describe, expect, it } from "vitest";
import {
  parsePolicyModeSelection,
  parseRuleTestContext,
  readRuleErrorMessage,
} from "./rules-view-model";

describe("rules view-model helpers", () => {
  it("parses rule test contexts deterministically", () => {
    expect(parseRuleTestContext("")).toEqual({ ok: true, value: {} });
    expect(parseRuleTestContext('{"tool":{"name":"stripe.issueRefund"}}')).toEqual({
      ok: true,
      value: { tool: { name: "stripe.issueRefund" } },
    });
    expect(parseRuleTestContext("[]")).toEqual({
      ok: false,
      message: "Test context must be a JSON object",
    });
    expect(parseRuleTestContext("{invalid")).toEqual({
      ok: false,
      message: "Invalid JSON in test context",
    });
  });

  it("normalizes convex/uncaught error wrappers for stable rule UI feedback", () => {
    expect(readRuleErrorMessage(new Error('{"error":"Expression parse failed"}'))).toBe(
      "The rule or policy input could not be validated.",
    );
    expect(
      readRuleErrorMessage(
        new Error(
          "Uncaught ConvexError: CEL parse failure at validator.ts:12\n at stack frame\n Called by client",
        ),
      ),
    ).toBe("The rule or policy input could not be validated.");
    expect(readRuleErrorMessage("plain")).toBe("Rule validation failed.");
  });

  it("accepts only supported policy mode options", () => {
    expect(parsePolicyModeSelection("manual_only")).toBe("manual_only");
    expect(parsePolicyModeSelection("rules_first")).toBe("rules_first");
    expect(parsePolicyModeSelection("rules_plus_agent")).toBe("rules_plus_agent");
    expect(parsePolicyModeSelection("invalid_mode")).toBeNull();
  });
});
