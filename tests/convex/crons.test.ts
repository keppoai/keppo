import { afterEach, describe, expect, it, vi } from "vitest";

type RegisteredCron = {
  name: string;
  args: unknown[];
  schedule: Record<string, unknown>;
};

type RegisteredCronMap = Record<string, RegisteredCron>;

const expectedNonPreviewCronKeys = [
  "abuse-heuristics",
  "ai-credit-expiry",
  "api-dedupe-expiry-cleanup",
  "automation-cold-log-expiry",
  "automation-hot-log-archival",
  "automation-provider-trigger-reconcile",
  "automation-run-topup-expiry",
  "automation-scheduler-check",
  "automation-stale-run-reaper",
  "automation-trigger-event-processor",
  "dlq-auto-retry",
  "invite-promo-expiry",
  "maintenance-sweep",
  "synthetic-canary",
] as const;

const expectedPreviewCronKeys = expectedNonPreviewCronKeys.filter(
  (key) => key !== "automation-provider-trigger-reconcile" && key !== "maintenance-sweep",
);

const sortedKeys = (value: Iterable<string>): string[] => [...value].sort();

const importRegisteredCrons = async (): Promise<RegisteredCronMap> => {
  vi.resetModules();
  const module = await import("../../convex/crons.ts");
  return (module.default as unknown as { crons: RegisteredCronMap }).crons;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("convex cron registration", () => {
  it("omits only the preview-disabled crons in hosted preview", async () => {
    vi.stubEnv("KEPPO_ENVIRONMENT", " Preview ");

    const registered = await importRegisteredCrons();

    expect(sortedKeys(Object.keys(registered))).toEqual(sortedKeys(expectedPreviewCronKeys));
    expect(registered).not.toHaveProperty("automation-provider-trigger-reconcile");
    expect(registered).not.toHaveProperty("maintenance-sweep");
    expect(registered["automation-scheduler-check"]).toEqual({
      name: "cron_heartbeats:checkScheduledAutomationsWithHeartbeat",
      args: [{ limit: 200 }],
      schedule: { minutes: 1, type: "interval" },
    });
  });

  it("keeps the existing maintenance and provider-trigger crons outside hosted preview", async () => {
    vi.stubEnv("KEPPO_ENVIRONMENT", "staging");

    const registered = await importRegisteredCrons();

    expect(sortedKeys(Object.keys(registered))).toEqual(sortedKeys(expectedNonPreviewCronKeys));
    expect(registered["automation-provider-trigger-reconcile"]).toEqual({
      name: "cron_heartbeats:reconcileProviderTriggerSubscriptionsWithHeartbeat",
      args: [{ limit: 100 }],
      schedule: { minutes: 1, type: "interval" },
    });
    expect(registered["maintenance-sweep"]).toEqual({
      name: "cron_heartbeats:scheduledMaintenanceSweepWithHeartbeat",
      args: [{}],
      schedule: { minutes: 2, type: "interval" },
    });
  });
});
