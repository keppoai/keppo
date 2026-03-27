import { describe, expect, it } from "vitest";
import {
  requireBoundedEmail,
  requireBoundedString,
  sanitizePolicyContext,
} from "../../../convex/validators.js";

describe("shared validator contracts", () => {
  it("trims bounded strings by default and rejects empty values after trimming", () => {
    expect(
      requireBoundedString("  hello world  ", {
        field: "name",
        maxLength: 20,
      }),
    ).toBe("hello world");
    expect(() =>
      requireBoundedString("   ", {
        field: "name",
        maxLength: 20,
      }),
    ).toThrow("name is required.");
  });

  it("allows empty strings when explicitly configured", () => {
    expect(
      requireBoundedString("", {
        field: "description",
        maxLength: 20,
        allowEmpty: true,
      }),
    ).toBe("");
  });

  it("rejects strings longer than the configured max length", () => {
    expect(() =>
      requireBoundedString("toolong", {
        field: "slug",
        maxLength: 6,
      }),
    ).toThrow("slug must be 6 characters or fewer.");
  });

  it("accepts the exact max length boundary and rejects one character above it", () => {
    expect(
      requireBoundedString("12345", {
        field: "code",
        maxLength: 5,
      }),
    ).toBe("12345");
    expect(() =>
      requireBoundedString("123456", {
        field: "code",
        maxLength: 5,
      }),
    ).toThrow("code must be 5 characters or fewer.");
  });

  it("normalizes emails and rejects malformed addresses", () => {
    expect(requireBoundedEmail("  Mixed.Case@Example.COM  ")).toBe("mixed.case@example.com");
    expect(() => requireBoundedEmail("missing-at.example.com")).toThrow(
      "Please enter a valid email address.",
    );
    expect(() => requireBoundedEmail("@example.com")).toThrow(
      "Please enter a valid email address.",
    );
    expect(() => requireBoundedEmail("user@")).toThrow("Please enter a valid email address.");
  });

  it("rejects policy context objects nested deeper than four levels", () => {
    expect(() =>
      sanitizePolicyContext({
        one: {
          two: {
            three: {
              four: {
                five: "too-deep",
              },
            },
          },
        },
      }),
    ).toThrow("context exceeds the supported nesting depth.");
  });

  it("rejects policy context arrays longer than twenty-five entries", () => {
    expect(() =>
      sanitizePolicyContext({
        items: Array.from({ length: 26 }, (_, index) => index),
      }),
    ).toThrow("context exceeds the supported array length.");
  });

  it("rejects policy context objects with more than thirty-two keys", () => {
    expect(() =>
      sanitizePolicyContext({
        oversize: Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [`key_${index}`, index]),
        ),
      }),
    ).toThrow("context exceeds the supported object size.");
  });

  it("rejects policy context strings longer than five hundred characters", () => {
    expect(() =>
      sanitizePolicyContext({
        payload: "x".repeat(501),
      }),
    ).toThrow("context contains a string that exceeds 500 chars.");
  });
});
