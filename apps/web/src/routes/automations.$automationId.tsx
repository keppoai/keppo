import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

function AutomationDetailPagePending() {
  return (
    <ShellTransitionState
      title="Loading automation details"
      detail="Keppo is opening the selected automation and preserving the workspace context around it."
    />
  );
}

export const automationDetailRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: "automations/$automationId",
  pendingComponent: AutomationDetailPagePending,
}).lazy(() => import("./automations.$automationId.lazy").then((d) => d.automationDetailRouteLazy));
