import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AdminInviteCodesPage } from "./_admin.invite-codes.lazy";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { renderDashboard } from "@/test/render-dashboard";

describe("AdminInviteCodesPage", () => {
  it("creates new invite codes and toggles existing ones", async () => {
    const inviteCodes = [
      {
        id: "icode_existing",
        code: "ZXCV12",
        label: "Existing cohort",
        active: true,
        use_count: 3,
        created_by: "usr_admin",
        created_at: "2026-03-20T00:00:00.000Z",
      },
    ];
    const createInviteCode = vi.fn(async () => {
      const created = {
        id: "icode_new",
        code: "ABC123",
        label: "Beta batch 1",
        grant_tier: "starter",
        active: true,
        use_count: 0,
        created_by: "usr_admin",
        created_at: new Date().toISOString(),
      };
      inviteCodes.unshift(created);
      return created;
    });
    const setInviteCodeActive = vi.fn(async () => undefined);
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "admin:getAccess": () => ({
          canAccessAdminPage: true,
          canAccessAdminHealth: true,
          isPlatformAdmin: true,
        }),
        "admin:listFeatureFlags": () => [],
        "admin:listDogfoodOrgs": () => [],
        "admin:listInviteCodes": () => inviteCodes,
        "admin:listOrgsWithUsage": () => [],
        "admin:listOrgsForAbuse": () => [],
        "admin:listAllSuspensions": () => [],
      },
      mutationHandlers: {
        "admin:createInviteCode": createInviteCode,
        "admin:setInviteCodeActive": setInviteCodeActive,
      },
    });

    const { rerender } = renderDashboard(<AdminInviteCodesPage />, {
      route: "/admin/invite-codes",
      runtime,
    });

    expect(await screen.findByRole("heading", { name: "Invite Codes" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Label"), "Beta batch 1");
    await user.selectOptions(screen.getByLabelText("Grant tier"), "starter");
    await user.click(screen.getByRole("button", { name: "Generate code" }));

    await waitFor(() => {
      expect(createInviteCode).toHaveBeenCalledWith({
        label: "Beta batch 1",
        grantTier: "starter",
      });
    });
    rerender(<AdminInviteCodesPage />);
    expect(await screen.findByText("Most recent code")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Toggle ZXCV12" }));
    await waitFor(() => {
      expect(setInviteCodeActive).toHaveBeenCalledWith({
        inviteCodeId: "icode_existing",
        active: false,
      });
    });
  });
});
