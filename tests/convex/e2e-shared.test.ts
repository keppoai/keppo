import { afterEach, describe, expect, it, vi } from "vitest";
import { requireE2EIdentity, storageIdsForResetRow } from "../../convex/e2e_shared";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireE2EIdentity", () => {
  it("rejects when KEPPO_E2E_MODE is disabled", async () => {
    vi.stubEnv("KEPPO_E2E_MODE", "false");
    vi.stubEnv("NODE_ENV", "test");

    await expect(requireE2EIdentity({} as never)).rejects.toThrow("KEPPO_E2E_MODE=true");
  });

  it("rejects when the runtime is not local or test", async () => {
    vi.stubEnv("KEPPO_E2E_MODE", "true");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CONVEX_DEPLOYMENT", "prod:keppo");

    await expect(requireE2EIdentity({} as never)).rejects.toThrow("local/test Convex runtime");
  });

  it("allows local Convex runtimes", async () => {
    vi.stubEnv("KEPPO_E2E_MODE", "true");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:keppo");

    await expect(requireE2EIdentity({} as never)).resolves.toBeUndefined();
  });

  it("allows loopback Convex runtime URLs", async () => {
    vi.stubEnv("KEPPO_E2E_MODE", "true");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CONVEX_DEPLOYMENT", "prod:keppo");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");

    await expect(requireE2EIdentity({} as never)).resolves.toBeUndefined();
  });
});

describe("storageIdsForResetRow", () => {
  it("returns automation run storage ids", () => {
    expect(
      storageIdsForResetRow("automation_runs", {
        _id: "doc_1" as never,
        log_storage_id: "storage_1",
      }),
    ).toEqual(["storage_1"]);
  });

  it("ignores non-storage-backed tables", () => {
    expect(
      storageIdsForResetRow("workspaces", {
        _id: "doc_2" as never,
        log_storage_id: "storage_ignored",
      }),
    ).toEqual([]);
  });
});
