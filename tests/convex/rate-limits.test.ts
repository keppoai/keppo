import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enforceRateLimit } from "../../convex/rate_limit_helpers";
import { createConvexTestHarness } from "./harness";

const refs = {
  checkRateLimit: makeFunctionReference<"mutation">("rate_limits:checkRateLimit"),
};

const expectMessage = async (fn: () => Promise<unknown>, text: string): Promise<void> => {
  try {
    await fn();
    throw new Error(`Expected error containing "${text}"`);
  } catch (error) {
    expect(error instanceof Error ? error.message : String(error)).toContain(text);
  }
};

afterEach(() => {
  vi.useRealTimers();
});

describe("convex rate limit primitives", () => {
  it("allows the first request within the limit and reports the remaining budget", async () => {
    const t = createConvexTestHarness();

    const result = await t.mutation(refs.checkRateLimit, {
      key: "test:first-request",
      limit: 3,
      windowMs: 60_000,
    });

    expect(result).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterMs: 0,
    });
  });

  it("rejects requests after the configured limit is reached", async () => {
    const t = createConvexTestHarness();

    await t.mutation(refs.checkRateLimit, {
      key: "test:rejected-after-limit",
      limit: 2,
      windowMs: 60_000,
    });
    await t.mutation(refs.checkRateLimit, {
      key: "test:rejected-after-limit",
      limit: 2,
      windowMs: 60_000,
    });

    const result = await t.mutation(refs.checkRateLimit, {
      key: "test:rejected-after-limit",
      limit: 2,
      windowMs: 60_000,
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("allows requests again after the rate limit window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();

    await t.mutation(refs.checkRateLimit, {
      key: "test:window-reset",
      limit: 1,
      windowMs: 1_000,
    });
    const blocked = await t.mutation(refs.checkRateLimit, {
      key: "test:window-reset",
      limit: 1,
      windowMs: 1_000,
    });

    vi.setSystemTime(new Date("2026-03-22T12:00:01.001Z"));
    const allowedAgain = await t.mutation(refs.checkRateLimit, {
      key: "test:window-reset",
      limit: 1,
      windowMs: 1_000,
    });

    expect(blocked.allowed).toBe(false);
    expect(allowedAgain).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterMs: 0,
    });
  });

  it("throws an operator-facing retry-after message when enforcement blocks a request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();

    await t.run((ctx) =>
      enforceRateLimit(ctx, {
        key: "test:enforce-message",
        limit: 1,
        windowMs: 1_001,
        message: "Too many attempts.",
      }),
    );

    await expectMessage(
      async () =>
        await t.run((ctx) =>
          enforceRateLimit(ctx, {
            key: "test:enforce-message",
            limit: 1,
            windowMs: 1_001,
            message: "Too many attempts.",
          }),
        ),
      "Too many attempts. Try again in 2s.",
    );
  });

  it("clamps the minimum limit and window to one request and one second", async () => {
    const t = createConvexTestHarness();

    const first = await t.mutation(refs.checkRateLimit, {
      key: "test:minimum-clamp",
      limit: 0,
      windowMs: 10,
    });
    const second = await t.mutation(refs.checkRateLimit, {
      key: "test:minimum-clamp",
      limit: 0,
      windowMs: 10,
    });
    const row = await t.run((ctx) =>
      ctx.db
        .query("rate_limits")
        .withIndex("by_key", (q) => q.eq("key", "test:minimum-clamp"))
        .unique(),
    );

    expect(first).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterMs: 0,
    });
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBe(1_000);
    expect(row?.window_ms).toBe(1_000);
  });

  it("rounds retry-after messages up and keeps a one second minimum", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();

    await t.run((ctx) =>
      enforceRateLimit(ctx, {
        key: "test:retry-after-rounding-short",
        limit: 1,
        windowMs: 1_000,
        message: "Too many short attempts.",
      }),
    );
    await expectMessage(
      async () =>
        await t.run((ctx) =>
          enforceRateLimit(ctx, {
            key: "test:retry-after-rounding-short",
            limit: 1,
            windowMs: 1_000,
            message: "Too many short attempts.",
          }),
        ),
      "Too many short attempts. Try again in 1s.",
    );
  });
});
