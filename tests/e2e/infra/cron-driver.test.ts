import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CronDriver } from "./cron-driver";

describe("CronDriver auto-loop dedupe", () => {
  const stderrWrites: string[] = [];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrWrites.splice(0, stderrWrites.length);
    vi.useFakeTimers();
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderrWrites.push(String(chunk));
        return true;
      });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.useRealTimers();
  });

  it("suppresses repeated auto-loop failures and flushes on stop", async () => {
    const driver = new CronDriver({
      apiBaseUrl: "http://127.0.0.1:9999",
      queueBrokerBaseUrl: "http://127.0.0.1:9998",
      authorizationHeader: null,
      intervalMs: 50,
      maintenanceIntervalMs: 250,
      autoStart: true,
    });
    vi.spyOn(driver, "advance").mockResolvedValue(undefined);
    vi.spyOn(driver, "drainQueue").mockResolvedValue(undefined);
    vi.spyOn(driver, "triggerMaintenance").mockRejectedValue(new Error("boom"));

    driver.start();
    await vi.advanceTimersByTimeAsync(250);
    await driver.stop();

    const directErrors = stderrWrites.filter((line) => line.includes("auto tick failed: boom"));
    const summaries = stderrWrites.filter((line) => line.includes("suppressed"));
    expect(directErrors).toHaveLength(1);
    expect(summaries.length).toBeGreaterThanOrEqual(1);
  });

  it("flushes suppression summary periodically while repeats continue", async () => {
    const driver = new CronDriver({
      apiBaseUrl: "http://127.0.0.1:9999",
      queueBrokerBaseUrl: "http://127.0.0.1:9998",
      authorizationHeader: null,
      intervalMs: 50,
      maintenanceIntervalMs: 250,
      autoStart: true,
    });
    vi.spyOn(driver, "advance").mockResolvedValue(undefined);
    vi.spyOn(driver, "drainQueue").mockResolvedValue(undefined);
    vi.spyOn(driver, "triggerMaintenance").mockRejectedValue(new Error("boom"));

    driver.start();
    await vi.advanceTimersByTimeAsync(5_200);

    const summaries = stderrWrites.filter((line) => line.includes("suppressed"));
    expect(summaries.length).toBeGreaterThanOrEqual(1);

    await driver.stop();
  });

  it("clears dedupe state after a successful tick", async () => {
    const driver = new CronDriver({
      apiBaseUrl: "http://127.0.0.1:9999",
      queueBrokerBaseUrl: "http://127.0.0.1:9998",
      authorizationHeader: null,
      intervalMs: 50,
      maintenanceIntervalMs: 250,
      autoStart: true,
    });
    vi.spyOn(driver, "advance").mockResolvedValue(undefined);
    vi.spyOn(driver, "drainQueue").mockResolvedValue(undefined);
    let attempt = 0;
    vi.spyOn(driver, "triggerMaintenance").mockImplementation(async () => {
      attempt += 1;
      if (attempt < 3) {
        throw new Error("boom");
      }
    });

    driver.start();
    await vi.advanceTimersByTimeAsync(300);
    await driver.stop();

    expect(driver.getLastError()).toBeNull();
    const directErrors = stderrWrites.filter((line) => line.includes("auto tick failed: boom"));
    expect(directErrors).toHaveLength(1);
  });

  it("still drains the queue when maintenance fails", async () => {
    const driver = new CronDriver({
      apiBaseUrl: "http://127.0.0.1:9999",
      queueBrokerBaseUrl: "http://127.0.0.1:9998",
      authorizationHeader: null,
      intervalMs: 50,
      maintenanceIntervalMs: 250,
      autoStart: false,
    });
    const advanceSpy = vi.spyOn(driver, "advance").mockResolvedValue(undefined);
    const drainSpy = vi.spyOn(driver, "drainQueue").mockResolvedValue(undefined);
    vi.spyOn(driver, "triggerMaintenance").mockRejectedValue(new Error("maintenance occ"));

    await expect(driver.tick()).rejects.toThrow("maintenance occ");

    expect(advanceSpy).toHaveBeenCalledTimes(1);
    expect(drainSpy).toHaveBeenCalledTimes(1);
  });

  it("skips maintenance entirely when the interval is disabled", async () => {
    const driver = new CronDriver({
      apiBaseUrl: "http://127.0.0.1:9999",
      queueBrokerBaseUrl: "http://127.0.0.1:9998",
      authorizationHeader: null,
      intervalMs: 50,
      maintenanceIntervalMs: 0,
      autoStart: false,
    });
    const advanceSpy = vi.spyOn(driver, "advance").mockResolvedValue(undefined);
    const drainSpy = vi.spyOn(driver, "drainQueue").mockResolvedValue(undefined);
    const maintenanceSpy = vi.spyOn(driver, "triggerMaintenance").mockResolvedValue(undefined);

    await driver.tick();

    expect(advanceSpy).toHaveBeenCalledTimes(1);
    expect(drainSpy).toHaveBeenCalledTimes(1);
    expect(maintenanceSpy).not.toHaveBeenCalled();
  });

  it("waits for an in-flight tick before acknowledging pause and resumes afterward", async () => {
    let pauseRequested = false;
    const pausedStates: boolean[] = [];
    let releaseAdvance: (() => void) | null = null;
    const advanceGate = new Promise<void>((resolve) => {
      releaseAdvance = resolve;
    });

    const driver = new CronDriver({
      apiBaseUrl: "http://127.0.0.1:9999",
      queueBrokerBaseUrl: "http://127.0.0.1:9998",
      authorizationHeader: null,
      intervalMs: 50,
      maintenanceIntervalMs: 250,
      autoStart: true,
      pauseRequested: () => pauseRequested,
      setPausedState: (paused) => pausedStates.push(paused),
    });
    const advanceSpy = vi.spyOn(driver, "advance").mockReturnValue(advanceGate);
    vi.spyOn(driver, "drainQueue").mockResolvedValue(undefined);
    vi.spyOn(driver, "triggerMaintenance").mockResolvedValue(undefined);

    driver.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(advanceSpy).toHaveBeenCalledTimes(1);

    pauseRequested = true;
    await vi.advanceTimersByTimeAsync(150);
    expect(pausedStates).toEqual([]);
    expect(advanceSpy).toHaveBeenCalledTimes(1);

    releaseAdvance?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);
    expect(pausedStates).toEqual([true]);
    expect(advanceSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(advanceSpy).toHaveBeenCalledTimes(1);

    pauseRequested = false;
    await vi.advanceTimersByTimeAsync(50);
    expect(pausedStates).toEqual([true, false]);
    expect(advanceSpy).toHaveBeenCalledTimes(2);

    await driver.stop();
  });
});
