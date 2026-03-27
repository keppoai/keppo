import { describe, expect, it, vi } from "vitest";
import {
  createMemoizedReadinessCheck,
  parseLocalConvexTarget,
  readLocalConvexTargetFromEnv,
  waitForLocalConvexReady,
} from "./convex-readiness";

describe("parseLocalConvexTarget", () => {
  it("parses localhost and loopback targets", () => {
    expect(parseLocalConvexTarget("http://127.0.0.1:3210")).toEqual({
      host: "127.0.0.1",
      port: 3210,
    });
    expect(parseLocalConvexTarget("https://localhost:9443")).toEqual({
      host: "localhost",
      port: 9443,
    });
  });

  it("ignores non-local or invalid targets", () => {
    expect(parseLocalConvexTarget("https://example.convex.cloud")).toBeNull();
    expect(parseLocalConvexTarget("not-a-url")).toBeNull();
    expect(parseLocalConvexTarget("http://localhost")).toBeNull();
  });
});

describe("readLocalConvexTargetFromEnv", () => {
  it("reads the canonical CONVEX_URL", () => {
    const target = readLocalConvexTargetFromEnv({
      CONVEX_URL: "http://localhost:3210",
    });
    expect(target).toEqual({
      host: "localhost",
      port: 3210,
    });
  });
});

describe("waitForLocalConvexReady", () => {
  it("returns true immediately when no local convex target exists", async () => {
    const canConnect = vi.fn();

    const ready = await waitForLocalConvexReady({
      env: { CONVEX_URL: "https://example.convex.cloud" },
      canConnect,
    });

    expect(ready).toBe(true);
    expect(canConnect).not.toHaveBeenCalled();
  });

  it("retries until connectivity succeeds", async () => {
    let now = 0;
    const canConnect = vi
      .fn<(target: { host: string; port: number }, timeoutMs: number) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const ready = await waitForLocalConvexReady({
      target: { host: "localhost", port: 3210 },
      timeoutMs: 1000,
      retryMs: 100,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      canConnect,
    });

    expect(ready).toBe(true);
    expect(canConnect).toHaveBeenCalledTimes(3);
  });

  it("returns false when timeout elapses before connectivity", async () => {
    let now = 0;
    const canConnect = vi
      .fn<(target: { host: string; port: number }, timeoutMs: number) => Promise<boolean>>()
      .mockResolvedValue(false);

    const ready = await waitForLocalConvexReady({
      target: { host: "localhost", port: 3210 },
      timeoutMs: 250,
      retryMs: 100,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      canConnect,
    });

    expect(ready).toBe(false);
    expect(canConnect).toHaveBeenCalledTimes(3);
  });
});

describe("createMemoizedReadinessCheck", () => {
  it("shares in-flight readiness checks", async () => {
    let resolveReady!: (value: boolean) => void;
    const waitForReadiness = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveReady = resolve;
        }),
    );
    const isReady = createMemoizedReadinessCheck(waitForReadiness);

    const first = isReady();
    const second = isReady();
    expect(waitForReadiness).toHaveBeenCalledTimes(1);

    resolveReady(true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it("resets cache after false and after errors", async () => {
    const waitForReadiness = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(true);
    const isReady = createMemoizedReadinessCheck(waitForReadiness);

    await expect(isReady()).resolves.toBe(false);
    await expect(isReady()).resolves.toBe(false);
    await expect(isReady()).resolves.toBe(true);
    expect(waitForReadiness).toHaveBeenCalledTimes(3);
  });
});
