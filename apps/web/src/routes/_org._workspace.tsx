import { Outlet, createRoute } from "@tanstack/react-router";
import { orgLayoutRoute } from "./_org";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { useWorkspace } from "@/hooks/use-workspace-context";

export const workspaceLayoutRoute = createRoute({
  getParentRoute: () => orgLayoutRoute,
  path: "$workspaceSlug",
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  const { workspacesLoaded, selectedWorkspace, selectedWorkspaceMatchesUrl } = useWorkspace();

  if (!workspacesLoaded) {
    return <ShellTransitionState title="Loading workspace" detail="Loading your workspace..." />;
  }

  if (!selectedWorkspace || !selectedWorkspaceMatchesUrl) {
    return <ShellTransitionState title="Switching workspaces" detail="Loading your workspace..." />;
  }

  return <Outlet />;
}
