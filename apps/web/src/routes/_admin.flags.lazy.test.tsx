import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AdminFlagsPage } from "./_admin.flags.lazy";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { renderDashboard } from "@/test/render-dashboard";

describe("AdminFlagsPage", () => {
  it("seeds default flags when an admin can access an empty flag list", async () => {
    const seedDefaultFlags = vi.fn(async () => undefined);
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "admin:getAccess": () => ({
          canAccessAdminPage: true,
          canAccessAdminHealth: true,
          isPlatformAdmin: true,
        }),
        "admin:listFeatureFlags": () => [],
        "admin:listDogfoodOrgs": () => [],
        "admin:listOrgsWithUsage": () => [],
        "admin:listOrgsForAbuse": () => [],
        "admin:listAllSuspensions": () => [],
      },
      mutationHandlers: {
        "admin:seedDefaultFlags": seedDefaultFlags,
      },
    });

    renderDashboard(<AdminFlagsPage />, {
      route: "/admin/flags",
      runtime,
    });

    expect(await screen.findByRole("heading", { name: "Feature Flags" })).toBeInTheDocument();
    await waitFor(() => {
      expect(seedDefaultFlags).toHaveBeenCalledWith({});
    });
    expect(screen.getByText("No feature flags configured yet.")).toBeInTheDocument();
  });

  it("adds and removes dogfood organizations through the rendered form", async () => {
    const addDogfoodOrg = vi.fn(async () => undefined);
    const removeDogfoodOrg = vi.fn(async () => undefined);
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "admin:getAccess": () => ({
          canAccessAdminPage: true,
          canAccessAdminHealth: true,
          isPlatformAdmin: true,
        }),
        "admin:listFeatureFlags": () => [
          {
            id: "flag_1",
            key: "beta-ui",
            label: "Beta UI",
            description: "Expose the beta dashboard shell.",
            enabled: true,
          },
        ],
        "admin:listDogfoodOrgs": () => [
          {
            id: "dogfood_1",
            org_id: "org_existing",
          },
        ],
        "admin:listOrgsWithUsage": () => [],
        "admin:listOrgsForAbuse": () => [],
        "admin:listAllSuspensions": () => [],
      },
      mutationHandlers: {
        "admin:addDogfoodOrg": addDogfoodOrg,
        "admin:removeDogfoodOrg": removeDogfoodOrg,
      },
    });

    renderDashboard(<AdminFlagsPage />, {
      route: "/admin/flags",
      runtime,
    });

    expect(await screen.findByText("Beta UI")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Organization ID"), "  org_new  ");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(addDogfoodOrg).toHaveBeenCalledWith({ orgId: "org_new" });
    });

    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(removeDogfoodOrg).toHaveBeenCalledWith({ orgId: "org_existing" });
    });
  });
});
