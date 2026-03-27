import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { renderDashboardHook } from "@/test/render-dashboard";
import { useAdmin } from "./use-admin";

describe("useAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads admin page data for local-dev bypass users while preserving platform-admin state", async () => {
    const setFeatureFlagEnabled = vi.fn(async () => undefined);
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "admin:getAccess": () => ({
          canAccessAdminPage: true,
          canAccessAdminHealth: true,
          isPlatformAdmin: false,
        }),
        "admin:listFeatureFlags": () => [],
        "admin:listDogfoodOrgs": () => [],
      },
      mutationHandlers: {
        "admin:setFeatureFlagEnabled": setFeatureFlagEnabled,
      },
    });

    const { result } = renderDashboardHook(() => useAdmin(), {
      runtime,
    });

    expect(result.current.canAccessAdminPage).toBe(true);
    expect(result.current.canAccessAdminHealth).toBe(true);
    expect(result.current.isPlatformAdmin).toBe(false);
    expect(result.current.flagsLoaded).toBe(true);
    expect(result.current.dogfoodOrgsLoaded).toBe(true);

    await act(async () => {
      await result.current.setFlagEnabled("beta-ui", true);
    });

    expect(setFeatureFlagEnabled).toHaveBeenCalledWith({
      key: "beta-ui",
      enabled: true,
    });
  });

  it("skips admin page data and blocks mutations when the user cannot access the admin page", async () => {
    const addDogfoodOrg = vi.fn(async () => undefined);
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "admin:getAccess": () => ({
          canAccessAdminPage: false,
          canAccessAdminHealth: false,
          isPlatformAdmin: false,
        }),
      },
      mutationHandlers: {
        "admin:addDogfoodOrg": addDogfoodOrg,
      },
    });

    const { result } = renderDashboardHook(() => useAdmin(), {
      runtime,
    });

    expect(result.current.canAccessAdminPage).toBe(false);
    expect(result.current.canAccessAdminHealth).toBe(false);
    expect(result.current.flags).toEqual([]);
    expect(result.current.dogfoodOrgs).toEqual([]);
    expect(result.current.flagsLoaded).toBe(false);
    expect(result.current.dogfoodOrgsLoaded).toBe(false);

    await act(async () => {
      await result.current.addDogfoodOrg("org_1");
    });

    expect(addDogfoodOrg).not.toHaveBeenCalled();
  });
});
