import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { orgLayoutRoute } from "./_org";

function WorkspacesPagePending() {
  return (
    <ShellTransitionState
      title="Loading workspaces"
      detail="Keppo is restoring workspace management controls for this organization."
    />
  );
}

export const workspacesRoute = createRoute({
  getParentRoute: () => orgLayoutRoute,
  path: "settings/workspaces",
  pendingComponent: WorkspacesPagePending,
}).lazy(() => import("./workspaces.lazy").then((d) => d.workspacesRouteLazy));
