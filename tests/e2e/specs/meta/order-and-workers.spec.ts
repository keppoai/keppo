import { test, expect } from "../../fixtures/golden.fixture";
import { readActiveE2ERunOwnership } from "../../infra/stack-manager";

test.describe("meta-infra-contract", () => {
  test("namespace format contract", async ({ app }) => {
    const expected = new RegExp(
      `^${app.metadata.runId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.${app.metadata.workerIndex}\\.${app.metadata.testId}\\.${app.metadata.retryIndex}\\.${app.metadata.repeatEachIndex}$`,
    );
    expect(app.namespace).toMatch(expected);
  });

  test("worker-count profile contract", async ({}, testInfo) => {
    expect(testInfo.config.workers).toBe(1);
  });

  test("stack no longer requires standalone worker service", async ({ app }) => {
    const serviceNames = app.runtime.services.map((service) => service.name);
    expect(serviceNames.some((name) => name.includes("worker:"))).toBe(false);
    expect(serviceNames).toContain("queue-broker");
  });

  test("active-run ownership and runtime readiness are recorded", async ({ app }) => {
    const ownership = await readActiveE2ERunOwnership();
    expect(ownership?.runId).toBe(app.runtime.runId);
    expect(ownership?.ownerPid).toBeGreaterThan(0);
    expect(app.runtime.status).toBe("ready");
    expect(app.runtime.ownerPid).toBeGreaterThan(0);
    expect(app.runtime.readyServices.map((service) => service.name).sort()).toEqual([
      "dashboard",
      "fake-gateway",
      "queue-broker",
    ]);
    expect(app.runtime.readyServices.every((service) => service.readyAt !== null)).toBe(true);
  });
});
