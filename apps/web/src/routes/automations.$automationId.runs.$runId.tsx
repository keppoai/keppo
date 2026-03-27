import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

function RunDetailPagePending() {
  return (
    <ShellTransitionState
      title="Loading run details"
      detail="Keppo is restoring the run timeline and log viewer for this automation execution."
    />
  );
}

export const runDetailRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: "automations/$automationId/runs/$runId",
  pendingComponent: RunDetailPagePending,
}).lazy(() =>
  import("./automations.$automationId.runs.$runId.lazy").then((d) => d.runDetailRouteLazy),
);
