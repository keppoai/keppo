import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { adminLayoutRoute } from "./_admin";

function AdminUsagePending() {
  return (
    <ShellTransitionState
      title="Loading usage"
      detail="Keppo is aggregating per-organization usage, credits, and automation activity."
    />
  );
}

export const adminUsageRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "usage",
  pendingComponent: AdminUsagePending,
}).lazy(() => import("./_admin.usage.lazy").then((d) => d.adminUsageRouteLazy));
