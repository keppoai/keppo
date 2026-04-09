import { afterEach, describe, expect, it, vi } from "vitest";
import { createRealLinkedInClient } from "./client.js";

describe("linkedin real client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects API paths that escape the configured base", async () => {
    const client = createRealLinkedInClient("token_test");

    await expect(
      client.requestJson({
        method: "GET",
        path: "/../../admin",
      }),
    ).rejects.toThrow(/invalid_request/i);
  });

  it("rejects oversized API responses before buffering them fully", async () => {
    vi.stubEnv("KEPPO_EXTERNAL_FETCH_ALLOWLIST", "api.linkedin.com:443");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: {
          "content-length": String(2 * 1024 * 1024 + 1),
          "content-type": "application/json",
        },
      }),
    );

    const client = createRealLinkedInClient("token_test");

    await expect(
      client.requestJson({
        method: "GET",
        path: "/rest/posts",
      }),
    ).rejects.toThrow(/maximum allowed size/i);
  });
});
