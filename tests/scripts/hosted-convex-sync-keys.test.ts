import { afterEach, describe, expect, it } from "vitest";
import { hostedConvexBaseSyncKeys } from "../../scripts/hosted-convex-sync-keys.mjs";
import {
  listManagedConvexEnvKeys,
  unmanagedConvexEnvKeys,
} from "../../scripts/convex-managed-env.mjs";

describe("scripts/hosted-convex-sync-keys.mjs", () => {
  const originalKeppoEnvironment = process.env.KEPPO_ENVIRONMENT;

  afterEach(() => {
    if (originalKeppoEnvironment === undefined) {
      delete process.env.KEPPO_ENVIRONMENT;
    } else {
      process.env.KEPPO_ENVIRONMENT = originalKeppoEnvironment;
    }
  });

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

  it("keeps the Vercel bypass secret out of hosted production sync", () => {
    expect(listManagedConvexEnvKeys("hosted", "production")).not.toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET",
    );
  });

  it("keeps the Vercel bypass secret in non-production hosted sync", () => {
    expect(listManagedConvexEnvKeys("hosted", "staging")).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET",
    );
  });
});
