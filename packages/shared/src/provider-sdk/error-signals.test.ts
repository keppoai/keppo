import { describe, expect, it } from "vitest";
import {
  createErrorTextSignals,
  hasAllWords,
  hasAnyWord,
  hasErrorCode,
  hasErrorCodePrefix,
} from "./error-signals.js";

describe("provider sdk error signals", () => {
  it("extracts explicit code tokens", () => {
    const signals = createErrorTextSignals("invalid_access_token");
    expect(hasErrorCode(signals, "invalid_access_token")).toBe(true);
    expect(hasErrorCode(signals, "invalid_token")).toBe(true);
  });

  it("derives well-known aliases from plain text phrases", () => {
    const signals = createErrorTextSignals("Bad credentials. Too many requests; gateway timeout.");
    expect(hasErrorCode(signals, "invalid_token")).toBe(true);
    expect(hasErrorCode(signals, "rate_limited")).toBe(true);
    expect(hasErrorCode(signals, "timeout", "gateway_timeout")).toBe(true);
  });

  it("supports code prefix and word checks for validation buckets", () => {
    const signals = createErrorTextSignals("missing_field: name is required");
    expect(hasErrorCodePrefix(signals, "missing_")).toBe(true);
    expect(hasAnyWord(signals, "required")).toBe(true);
    expect(hasAllWords(signals, "name", "required")).toBe(true);
  });
});
