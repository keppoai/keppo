import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

function CreateAutomationPagePending() {
  return (
    <ShellTransitionState
      title="Loading manual automation setup"
      detail="Preparing the manual automation form for this workspace."
    />
  );
}

export const automationCreateRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: "automations/create",
  pendingComponent: CreateAutomationPagePending,
}).lazy(() => import("./automations.create.lazy").then((d) => d.automationCreateRouteLazy));
