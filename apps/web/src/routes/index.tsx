import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

function DashboardPagePending() {
  return (
    <ShellTransitionState title="Loading dashboard overview" detail="Loading your dashboard..." />
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: "/",
  pendingComponent: DashboardPagePending,
}).lazy(() => import("./index.lazy").then((d) => d.indexRouteLazy));
