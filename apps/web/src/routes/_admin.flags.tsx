import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { adminLayoutRoute } from "./_admin";

function AdminFlagsPending() {
  return (
    <ShellTransitionState
      title="Loading feature flags"
      detail="Keppo is restoring platform rollout controls and dogfood-organization settings."
    />
  );
}

export const adminFlagsRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "flags",
  pendingComponent: AdminFlagsPending,
}).lazy(() => import("./_admin.flags.lazy").then((d) => d.adminFlagsRouteLazy));
