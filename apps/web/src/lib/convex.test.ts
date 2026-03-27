import { describe, expect, it } from "vitest";
import { resolveConvexUrl } from "./convex-url";

describe("resolveConvexUrl", () => {
  it("returns the configured hosted Convex URL", () => {
    expect(
      resolveConvexUrl({
        VITE_CONVEX_URL: "https://careful-otter-123.convex.cloud",
      }),
    ).toBe("https://careful-otter-123.convex.cloud");
  });

  it("rejects missing Convex URLs instead of falling back to localhost", () => {
    expect(() => resolveConvexUrl({})).toThrow("Missing VITE_CONVEX_URL");
  });
});
