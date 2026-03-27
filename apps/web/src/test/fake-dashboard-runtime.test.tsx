import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { createFakeDashboardRuntime } from "./fake-dashboard-runtime";

describe("createFakeDashboardRuntime", () => {
  it("supports Convex optimistic mutation chaining", async () => {
    const markRead = vi.fn(async () => undefined);
    const runtime = createFakeDashboardRuntime({
      mutationHandlers: {
        "notifications:markRead": markRead,
      },
    });

    const mutation = runtime.useMutation(
      makeFunctionReference<"mutation">("notifications:markRead"),
    ) as unknown as {
      (args: { eventId: string }): Promise<unknown>;
      withOptimisticUpdate: (updater: unknown) => unknown;
    };

    expect(mutation.withOptimisticUpdate(() => undefined)).toBe(mutation);

    await mutation({ eventId: "evt_123" });

    expect(markRead).toHaveBeenCalledWith({ eventId: "evt_123" });
  });
});
