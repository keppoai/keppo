import { describe, expect, it } from "vitest";
import { createProtocolNotFoundResponse, isFailClosedProtocolPath } from "./protocol-boundary";

describe("protocol boundary", () => {
  it("fails closed for unowned api and root protocol paths", () => {
    expect(isFailClosedProtocolPath("/api/unhandled")).toBe(true);
    expect(isFailClosedProtocolPath("/api")).toBe(true);
    expect(isFailClosedProtocolPath("/downloads/other-artifact")).toBe(true);
  });

  it("keeps migrated protocol paths Start-owned", () => {
    expect(isFailClosedProtocolPath("/api/billing/checkout")).toBe(false);
    expect(isFailClosedProtocolPath("/api/auth/sign-in/email")).toBe(false);
    expect(isFailClosedProtocolPath("/internal/cron/maintenance")).toBe(false);
    expect(isFailClosedProtocolPath("/mcp/ws_test")).toBe(false);
  });

  it("returns a hardened json 404 response", async () => {
    const response = createProtocolNotFoundResponse(
      new Request("https://app.example.com/api/unhandled"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "route_not_found",
        message: "Route not found.",
      },
    });
  });
});
