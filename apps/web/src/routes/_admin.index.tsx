import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { adminLayoutRoute } from "./_admin";

function AdminOverviewPending() {
  return (
    <ShellTransitionState
      title="Loading admin overview"
      detail="Keppo is assembling platform-wide organization, usage, and suspension counts."
    />
  );
}

export const adminIndexRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "/",
  pendingComponent: AdminOverviewPending,
}).lazy(() => import("./_admin.index.lazy").then((d) => d.adminIndexRouteLazy));
