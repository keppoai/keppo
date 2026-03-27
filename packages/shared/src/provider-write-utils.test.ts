import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyBackoffJitter,
  buildProviderIdempotencyKey,
  safeFetchWithRetry,
} from "./provider-write-utils.js";

describe("provider write utils", () => {
  const originalFetch = globalThis.fetch;
  const originalAllowlist = process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalAllowlist === undefined) {
      delete process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST;
    } else {
      process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST = originalAllowlist;
    }
  });

  it("buildProviderIdempotencyKey is deterministic for equivalent payloads", () => {
    const first = buildProviderIdempotencyKey("stripe.issueRefund", {
      amount: 10,
      currency: "usd",
      nested: { b: 2, a: 1 },
    });
    const second = buildProviderIdempotencyKey("stripe.issueRefund", {
      nested: { a: 1, b: 2 },
      currency: "usd",
      amount: 10,
    });

    expect(first).toBe(second);
    expect(first).toHaveLength(32);
    expect(buildProviderIdempotencyKey("stripe.issueRefund", { amount: 10 }, 8)).toHaveLength(8);
  });

  it("applyBackoffJitter keeps delay within 50%-100% range", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    expect(applyBackoffJitter(200)).toBe(100);
    randomSpy.mockReturnValue(1);
    expect(applyBackoffJitter(200)).toBe(200);
  });

  it("safeFetchWithRetry retries retryable response statuses", async () => {
    process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST = "api.stripe.com:443";
    let attempts = 0;
    globalThis.fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("temporarily unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const response = await safeFetchWithRetry(
      "https://api.stripe.com/v1/refunds",
      { method: "POST" },
      "provider-write-utils.test",
      undefined,
      { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
    );

    expect(response.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it("safeFetchWithRetry retries transient network errors", async () => {
    process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST = "api.github.com:443";
    let attempts = 0;
    globalThis.fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("ECONNRESET");
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const response = await safeFetchWithRetry(
      "https://api.github.com/repos/org/repo/issues",
      { method: "GET" },
      "provider-write-utils.test",
      undefined,
      { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
    );

    expect(response.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it("safeFetchWithRetry exhausts retry budget on persistent timeout responses", async () => {
    process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST = "api.gmail.test:443";
    let attempts = 0;
    globalThis.fetch = vi.fn(async () => {
      attempts += 1;
      return new Response("timeout", { status: 504 });
    });

    const response = await safeFetchWithRetry(
      "https://api.gmail.test/v1/messages/send",
      { method: "POST" },
      "provider-write-utils.test",
      undefined,
      { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
    );

    expect(response.status).toBe(504);
    expect(attempts).toBe(3);
  });

  it("safeFetchWithRetry does not retry blocked outbound requests", async () => {
    process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST = "api.stripe.com:443";
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await expect(
      safeFetchWithRetry(
        "https://api.github.com/repos/org/repo/issues",
        { method: "GET" },
        "provider-write-utils.test",
        undefined,
        { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      ),
    ).rejects.toMatchObject({
      name: "SafeFetchError",
      code: "network_blocked",
    });

    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(globalThis.fetch).toBe(originalFetch);
  });
});
