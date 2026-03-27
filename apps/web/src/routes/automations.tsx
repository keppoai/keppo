import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

function AutomationsPagePending() {
  return (
    <ShellTransitionState
      title="Loading automations"
      detail="Keppo is restoring automation status, drafts, and workspace automation controls."
    />
  );
}

export const automationsRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: "automations",
  pendingComponent: AutomationsPagePending,
}).lazy(() => import("./automations.lazy").then((d) => d.automationsRouteLazy));
