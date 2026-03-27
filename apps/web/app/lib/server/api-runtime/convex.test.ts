import { afterEach, describe, expect, it, vi } from "vitest";
import { fireAndForgetWithDlq, resilientConvexCall } from "./convex.js";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("resilientConvexCall", () => {
  it("retries transient convex errors before succeeding", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("convex call timed out during retry window"))
      .mockResolvedValueOnce("ok");

    const result = await resilientConvexCall(fn, {
      timeoutMs: 50,
      retries: 1,
      label: "query:test",
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("fireAndForgetWithDlq", () => {
  it("enqueues a fire-and-forget dead-letter entry after final failure", async () => {
    const enqueueDeadLetter = vi.fn().mockResolvedValue(undefined);

    await fireAndForgetWithDlq(
      "provider.metric.record",
      async () => {
        throw new Error("convex unavailable: maintenance window");
      },
      {
        enqueueDeadLetter,
      },
      {
        payload: {
          metric: "provider_resolution_failure",
        },
      },
    );

    expect(enqueueDeadLetter).toHaveBeenCalledWith({
      sourceTable: "fire_and_forget",
      sourceId: "provider.metric.record",
      failureReason: "convex unavailable: maintenance window",
      errorCode: "convex_unavailable",
      payload: {
        metric: "provider_resolution_failure",
      },
    });
  });
});

describe("ConvexInternalClient", () => {
  it("configures admin auth before invoking internal DLQ functions", async () => {
    vi.resetModules();
    const setAdminAuth = vi.fn();
    const query = vi.fn().mockResolvedValue([]);
    const mutation = vi.fn().mockResolvedValue({ replayed: true, status: "replayed" });
    const action = vi.fn();
    const ConvexHttpClient = vi.fn(function MockConvexHttpClient() {
      return {
        setAdminAuth,
        query,
        mutation,
        action,
      };
    });

    vi.doMock("convex/browser", () => ({ ConvexHttpClient }));
    vi.doMock("./env.js", () => ({
      getEnv: () => ({
        CONVEX_URL: "https://example.convex.cloud",
        KEPPO_CONVEX_ADMIN_KEY: "convex-admin-key",
      }),
    }));

    const { ConvexInternalClient } = await import("./convex.js");

    const client = new ConvexInternalClient();
    await client.listPendingDeadLetters({ limit: 5 });
    await client.replayDeadLetter({ dlqId: "dlq_123" });
    await client.abandonDeadLetter({ dlqId: "dlq_123" });

    expect(ConvexHttpClient).toHaveBeenCalledWith("https://example.convex.cloud");
    expect(setAdminAuth).toHaveBeenCalledWith("convex-admin-key");
    expect(query).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledTimes(2);
  });
});
