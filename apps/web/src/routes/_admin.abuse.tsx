import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { adminLayoutRoute } from "./_admin";

function AdminAbusePending() {
  return (
    <ShellTransitionState
      title="Loading abuse controls"
      detail="Keppo is restoring suspension state and organization-level enforcement controls."
    />
  );
}

export const adminAbuseRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "abuse",
  pendingComponent: AdminAbusePending,
}).lazy(() => import("./_admin.abuse.lazy").then((d) => d.adminAbuseRouteLazy));
