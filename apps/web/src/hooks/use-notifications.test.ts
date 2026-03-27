import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, renderDashboardHook } from "@/test/render-dashboard";
import { useNotifications } from "./use-notifications";

describe("useNotifications", () => {
  it("skips inbox queries when callers only need settings data", async () => {
    const countUnread = vi.fn(() => {
      throw new Error("countUnread should be skipped");
    });
    const listInAppNotifications = vi.fn(() => {
      throw new Error("listInAppNotifications should be skipped");
    });
    const listEndpoints = vi.fn(() => []);
    const listEventDefinitions = vi.fn(() => []);
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "notifications:countUnread": countUnread,
        "notifications:listInAppNotifications": listInAppNotifications,
        "notifications:listEndpoints": listEndpoints,
        "notifications:listEventDefinitions": listEventDefinitions,
      },
    });

    const { result } = renderDashboardHook(() => useNotifications(10, { includeInbox: false }), {
      runtime,
      auth: createAuthState({
        isAuthenticated: true,
        getOrgId: () => "org_1",
      }),
    });

    await waitFor(() => {
      expect(result.current.endpoints).toEqual([]);
    });

    expect(listEndpoints).toHaveBeenCalledWith({ orgId: "org_1" });
    expect(listEventDefinitions).toHaveBeenCalledWith({});
    expect(countUnread).not.toHaveBeenCalled();
    expect(listInAppNotifications).not.toHaveBeenCalled();
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });
});
