import { describe, expect, it } from "vitest";
import { runBatchedSettled } from "./run-batched-settled";

describe("runBatchedSettled", () => {
  it("limits concurrent work to the requested batch size while preserving item order", async () => {
    let activeCalls = 0;
    let maxActiveCalls = 0;
    const resolvers: Array<() => void> = [];

    const promise = runBatchedSettled(
      Array.from({ length: 12 }, (_, index) => `action_${index + 1}`),
      10,
      async (item) =>
        await new Promise<string>((resolve) => {
          activeCalls += 1;
          maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
          resolvers.push(() => {
            activeCalls -= 1;
            resolve(item);
          });
        }),
    );

    await Promise.resolve();

    expect(maxActiveCalls).toBe(10);
    expect(activeCalls).toBe(10);

    resolvers.splice(0, 10).forEach((resolve) => resolve());

    for (let index = 0; index < 5 && resolvers.length < 2; index += 1) {
      await Promise.resolve();
    }

    expect(resolvers).toHaveLength(2);

    resolvers.splice(0, 2).forEach((resolve) => resolve());

    await expect(promise).resolves.toEqual(
      Array.from({ length: 12 }, (_, index) => ({
        status: "fulfilled" as const,
        value: `action_${index + 1}`,
      })),
    );
  });
});
