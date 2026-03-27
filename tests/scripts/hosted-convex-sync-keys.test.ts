import { describe, expect, it } from "vitest";
import { hostedConvexBaseSyncKeys } from "../../scripts/hosted-convex-sync-keys.mjs";
import { unmanagedConvexEnvKeys } from "../../scripts/convex-managed-env.mjs";

describe("scripts/hosted-convex-sync-keys.mjs", () => {
  it("includes the dashboard origin needed by Convex auth", () => {
    expect(hostedConvexBaseSyncKeys).toContain("KEPPO_URL");
  });

  it("includes hosted cron runtime knobs consumed by Convex", () => {
    expect(hostedConvexBaseSyncKeys).toContain("KEPPO_ACTION_TTL_MINUTES");
    expect(hostedConvexBaseSyncKeys).toContain("KEPPO_RUN_INACTIVITY_MINUTES");
  });

  it("classifies test-only decrypt as unmanaged", () => {
    expect(unmanagedConvexEnvKeys).toContain("KEPPO_ENABLE_TEST_ONLY_DECRYPT");
  });
});
