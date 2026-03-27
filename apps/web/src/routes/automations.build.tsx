import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

function BuildAutomationPagePending() {
  return (
    <ShellTransitionState
      title="Loading automation builder"
      detail="Preparing the dedicated automation builder for this workspace."
    />
  );
}

export const automationBuildRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: "automations/build",
  pendingComponent: BuildAutomationPagePending,
}).lazy(() => import("./automations.build.lazy").then((d) => d.automationBuildRouteLazy));
