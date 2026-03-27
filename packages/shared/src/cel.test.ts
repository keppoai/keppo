import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __getCelParseInstrumentationForTests,
  __resetCelParseCacheForTests,
  CEL_EVALUATION_TIMEOUT_MS,
  CEL_EXPRESSION_MAX_BYTES,
  evaluateCel,
  validateCel,
} from "./cel.js";

describe("CEL utilities", () => {
  beforeEach(() => {
    __resetCelParseCacheForTests();
    vi.restoreAllMocks();
  });

  it("validates parseable CEL expressions", () => {
    expect(validateCel('tool.name == "gmail.sendEmail"')).toEqual({ ok: true });
  });

  it("rejects expressions above the max byte size", () => {
    const oversized = "a".repeat(CEL_EXPRESSION_MAX_BYTES + 1);
    expect(validateCel(oversized)).toEqual({
      ok: false,
      error: `CEL expression exceeds max size of ${CEL_EXPRESSION_MAX_BYTES} bytes.`,
    });
    expect(() => evaluateCel(oversized, { now: "2026-01-01T00:00:00.000Z" })).toThrow(
      `CEL expression exceeds max size of ${CEL_EXPRESSION_MAX_BYTES} bytes.`,
    );
  });

  it("accepts expressions at the exact max byte size", () => {
    const exactSizeExpression = `"${"a".repeat(CEL_EXPRESSION_MAX_BYTES - 2)}"`;

    expect(Buffer.byteLength(exactSizeExpression, "utf8")).toBe(CEL_EXPRESSION_MAX_BYTES);
    expect(validateCel(exactSizeExpression)).toEqual({ ok: true });
    expect(
      evaluateCel(exactSizeExpression, {
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("rejects expressions one byte above the max size boundary", () => {
    const oversizedByOne = `"${"a".repeat(CEL_EXPRESSION_MAX_BYTES - 1)}"`;

    expect(Buffer.byteLength(oversizedByOne, "utf8")).toBe(CEL_EXPRESSION_MAX_BYTES + 1);
    expect(validateCel(oversizedByOne)).toEqual({
      ok: false,
      error: `CEL expression exceeds max size of ${CEL_EXPRESSION_MAX_BYTES} bytes.`,
    });
  });

  it("caches parsed expressions for repeated evaluation", () => {
    const expression = 'tool.name == "gmail.sendEmail"';
    const context = {
      tool: { name: "gmail.sendEmail" },
      now: "2026-01-01T00:00:00.000Z",
    };

    expect(evaluateCel(expression, context)).toBe(true);
    expect(evaluateCel(expression, context)).toBe(true);
    expect(__getCelParseInstrumentationForTests()).toEqual({
      parseInvocationCount: 1,
      cacheSize: 1,
    });
  });

  it("caches parse failures for repeated validation", () => {
    const invalidExpression = "tool.name ==";

    expect(validateCel(invalidExpression).ok).toBe(false);
    expect(validateCel(invalidExpression).ok).toBe(false);
    expect(__getCelParseInstrumentationForTests()).toEqual({
      parseInvocationCount: 1,
      cacheSize: 1,
    });
  });

  it("enforces CEL evaluation time budget", () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(1_000 + CEL_EVALUATION_TIMEOUT_MS + 1);

    expect(() =>
      evaluateCel("true", {
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(`CEL evaluation exceeded ${CEL_EVALUATION_TIMEOUT_MS}ms budget.`);
  });

  it("treats nested concatenation expressions as timed out when evaluation exceeds the budget", () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(5_000).mockReturnValueOnce(5_000 + CEL_EVALUATION_TIMEOUT_MS + 1);
    const nestedConcatExpression = `${"(".repeat(24)}"a"${' + "a")'.repeat(24)} == "${"a".repeat(25)}"`;

    expect(() =>
      evaluateCel(nestedConcatExpression, {
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(`CEL evaluation exceeded ${CEL_EVALUATION_TIMEOUT_MS}ms budget.`);
  });
});
