import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { rootRoute } from "./__root";

function AdminLayoutPending() {
  return (
    <ShellTransitionState
      title="Loading admin panel"
      detail="Keppo is restoring platform admin access and opening the standalone control center."
    />
  );
}

export const adminLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  pendingComponent: AdminLayoutPending,
}).lazy(() => import("./_admin.lazy").then((d) => d.adminLayoutRouteLazy));
