import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  isAuthApiPath,
  proxyAuthApiRequest,
  resolveAuthProxyBaseUrl,
  resolveAuthProxyBaseUrlFromEnv,
} from "./auth-api-proxy";

describe("auth api proxy", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.VITE_CONVEX_SITE_URL;
    delete process.env.CONVEX_SITE_URL;
    delete process.env.AUTH_BASE_URL;
    delete process.env.VITE_CONVEX_URL;
    delete process.env.CONVEX_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("claims same-origin Better Auth endpoints", () => {
    expect(isAuthApiPath("/api/auth")).toBe(true);
    expect(isAuthApiPath("/api/auth/sign-in/email")).toBe(true);
    expect(isAuthApiPath("/api/auth/get-session")).toBe(true);
    expect(isAuthApiPath("/api/oauth/integrations/google/connect")).toBe(false);
  });

  it("derives the auth site URL from the local Convex URL when needed", () => {
    process.env.CONVEX_URL = "http://localhost:3210";
    expect(resolveAuthProxyBaseUrl()).toBe("http://localhost:3211");
  });

  it("falls back to build-time hosted Convex env when runtime env is unavailable", () => {
    expect(
      resolveAuthProxyBaseUrlFromEnv(
        {},
        {
          VITE_CONVEX_SITE_URL: "https://secret-starfish-833.convex.site",
        },
      ),
    ).toBe("https://secret-starfish-833.convex.site");
  });

  it("proxies auth requests to the resolved auth base URL and preserves Better Auth headers", async () => {
    process.env.CONVEX_SITE_URL = "http://localhost:3211";
    const fetchImpl = vi.fn(async () => {
      return new Response(null, {
        status: 200,
        headers: {
          "set-better-auth-cookie": "better-auth.session_token=token; Path=/; HttpOnly",
        },
      });
    });

    const request = new Request("http://localhost:3000/api/auth/sign-in/email?foo=bar", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "e2e@example.com", password: "KeppoE2E!123" }),
    });

    const response = await proxyAuthApiRequest(request, fetchImpl as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("/api/auth/sign-in/email?foo=bar", "http://localhost:3211/"),
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
        redirect: "manual",
        duplex: "half",
      }),
    );
    const calls = fetchImpl.mock.calls as unknown as Array<[URL, RequestInit?]>;
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    const init = firstCall?.[1];
    expect(new Headers(init?.headers).get("accept-encoding")).toBeNull();
    expect(response.headers.get("set-better-auth-cookie")).toContain("better-auth.session_token");
  });

  it("strips stale compression headers from proxied auth responses", async () => {
    process.env.CONVEX_SITE_URL = "https://secret-starfish-833.convex.site";
    const fetchImpl = vi.fn(async () => {
      return new Response("null", {
        status: 200,
        headers: {
          "content-encoding": "gzip",
          "content-length": "24",
          "content-type": "application/json",
        },
      });
    });

    const response = await proxyAuthApiRequest(
      new Request("https://staging.keppo.ai/api/auth/get-session"),
      fetchImpl as typeof fetch,
    );

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    await expect(response.text()).resolves.toBe("null");
  });
});
