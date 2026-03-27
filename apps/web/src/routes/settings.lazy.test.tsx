import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./settings.lazy";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, renderDashboard } from "@/test/render-dashboard";

const navigateSpy = vi.fn();
let searchState: { tab?: string } = {};

vi.mock("./settings", () => ({
  settingsRoute: {
    id: "/settings",
    useSearch: () => searchState,
    useNavigate: () => navigateSpy,
  },
}));

vi.mock("@/components/automations/ai-key-manager", () => ({
  AiKeyManager: () => <div>AI manager stub</div>,
}));

vi.mock("@/components/notifications/notification-preferences", () => ({
  NotificationPreferences: () => <div>Notifications stub</div>,
}));

vi.mock("@/components/layout/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Theme toggle</button>,
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    navigateSpy.mockReset();
    searchState = {};
  });

  it("falls back to the default tab for unknown search values", async () => {
    renderDashboard(<SettingsPage />, {
      auth: createAuthState({
        isAuthenticated: true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
      }),
      runtime: createFakeDashboardRuntime(),
    });

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Account" })).toHaveAttribute("aria-selected", "true");
  });

  it("writes the selected tab back to the URL search state", async () => {
    const user = userEvent.setup();
    searchState = { tab: "ai" };

    renderDashboard(<SettingsPage />, {
      auth: createAuthState({
        isAuthenticated: true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
      }),
      runtime: createFakeDashboardRuntime(),
    });

    expect(await screen.findByRole("tab", { name: "AI Configuration" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(screen.getByRole("tab", { name: "Notifications" }));
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith({
        search: expect.any(Function),
      });
    });

    const searchUpdater = navigateSpy.mock.calls[0]?.[0]?.search as
      | ((prev: { tab?: string }) => { tab?: string })
      | undefined;
    expect(searchUpdater?.({ tab: "ai" })).toEqual({ tab: "notifications" });
    expect(searchUpdater?.({ tab: "notifications" })).toEqual({ tab: "notifications" });
    expect(searchUpdater?.({ tab: "account" })).toEqual({ tab: "notifications" });
  });
});
