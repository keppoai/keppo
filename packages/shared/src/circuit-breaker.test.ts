import { describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
  createProviderCircuitBreaker,
  wrapObjectWithCircuitBreaker,
} from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("opens after reaching the failure threshold and fails fast while open", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 2,
      cooldownMs: 10_000,
      now: () => now,
    });
    const action = vi.fn(async () => "ok");

    await expect(breaker.execute(async () => Promise.reject(new Error("boom-1")))).rejects.toThrow(
      "boom-1",
    );
    expect(breaker.getState()).toBe("CLOSED");
    await expect(breaker.execute(async () => Promise.reject(new Error("boom-2")))).rejects.toThrow(
      "boom-2",
    );
    expect(breaker.getState()).toBe("OPEN");

    now = 5_000;
    await expect(breaker.execute(action)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(action).not.toHaveBeenCalled();
  });

  it("moves to HALF_OPEN after cooldown and closes on successful probe", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 1,
      cooldownMs: 1_000,
      now: () => now,
    });

    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    expect(breaker.getState()).toBe("OPEN");

    now = 1_000;
    await expect(breaker.execute(async () => "healthy")).resolves.toBe("healthy");
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("re-opens when half-open probe fails", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 1,
      cooldownMs: 1_000,
      now: () => now,
    });

    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    expect(breaker.getState()).toBe("OPEN");

    now = 1_000;
    await expect(
      breaker.execute(async () => Promise.reject(new Error("still-broken"))),
    ).rejects.toThrow("still-broken");
    expect(breaker.getState()).toBe("OPEN");
  });

  it("wraps SDK objects so all method calls share the same breaker", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      name: "sdk",
      failureThreshold: 2,
      cooldownMs: 1_000,
      now: () => now,
    });
    const sdk = {
      calls: 0,
      async request(shouldFail: boolean): Promise<string> {
        this.calls += 1;
        if (shouldFail) {
          throw new Error("request_failed");
        }
        return "ok";
      },
    };

    const wrapped = wrapObjectWithCircuitBreaker(sdk, breaker);
    await expect(wrapped.request(true)).rejects.toThrow("request_failed");
    await expect(wrapped.request(true)).rejects.toThrow("request_failed");
    expect(breaker.getState()).toBe("OPEN");

    await expect(wrapped.request(false)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(sdk.calls).toBe(2);

    now = 1_000;
    await expect(wrapped.request(false)).resolves.toBe("ok");
    expect(breaker.getState()).toBe("CLOSED");
  });
});

describe("createProviderCircuitBreaker", () => {
  it("applies provider-specific thresholds", () => {
    const stripe = createProviderCircuitBreaker("stripe");
    const reddit = createProviderCircuitBreaker("reddit");

    expect(stripe.failureThreshold).toBeGreaterThan(reddit.failureThreshold);
  });
});
