import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { adminLayoutRoute } from "./_admin";

function AdminHealthPending() {
  return (
    <ShellTransitionState
      title="Loading admin health"
      detail="Keppo is restoring platform health, flags, and recovery controls."
    />
  );
}

export const adminHealthRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "health",
  pendingComponent: AdminHealthPending,
}).lazy(() => import("./_admin.health.lazy").then((d) => d.adminHealthRouteLazy));
