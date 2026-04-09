import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeFetch } from "./network.js";

describe("safeFetch", () => {
  const originalFetch = globalThis.fetch;
  const originalAllowlist = process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST;
  const originalFakeExternalBaseUrl = process.env.KEPPO_FAKE_EXTERNAL_BASE_URL;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST;
    delete process.env.KEPPO_FAKE_EXTERNAL_BASE_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalAllowlist === undefined) {
      delete process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST;
    } else {
      process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST = originalAllowlist;
    }
    if (originalFakeExternalBaseUrl === undefined) {
      delete process.env.KEPPO_FAKE_EXTERNAL_BASE_URL;
    } else {
      process.env.KEPPO_FAKE_EXTERNAL_BASE_URL = originalFakeExternalBaseUrl;
    }
  });

  it("allows loopback fake external hosts injected by runtime context", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const response = await safeFetch(
      "http://127.0.0.1:9901/gmail/oauth/token",
      { method: "POST" },
      "network.test",
      {
        extraAllowedHosts: ["http://127.0.0.1:9901"],
      },
    );

    expect(response.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:9901/gmail/oauth/token"),
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
      }),
    );
  });

  it("revalidates redirect targets before following them", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://169.254.169.254/latest/meta-data",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(
      safeFetch("https://api.github.com/login/oauth/access_token", {}, "network.redirect.test"),
    ).rejects.toMatchObject({
      code: "network_blocked",
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("allows LinkedIn API hosts from the default allowlist", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ sub: "member_100" }), { status: 200 }),
    );

    const response = await safeFetch(
      "https://api.linkedin.com/v2/userinfo",
      { method: "GET" },
      "network.linkedin.test",
    );

    expect(response.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      new URL("https://api.linkedin.com/v2/userinfo"),
      expect.objectContaining({
        method: "GET",
        headers: expect.any(Headers),
      }),
    );
  });
});
