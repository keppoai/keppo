import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPublicHealthPayload,
  createPublicHealthResponse,
} from "../../app/lib/server/public-health-api";

describe("public health api", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a minimal public readiness payload with hardened headers", async () => {
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_test_current");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "sha_test_current");

    expect(createPublicHealthPayload()).toEqual({
      ok: true,
      runtime: "tanstack-start",
      app: "@keppo/web",
    });

    const response = createPublicHealthResponse(new Request("https://app.example.com/api/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      runtime: "tanstack-start",
      app: "@keppo/web",
    });
  });
});
