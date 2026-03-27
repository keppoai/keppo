import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

function IntegrationsPagePending() {
  return (
    <ShellTransitionState
      title="Loading integrations"
      detail="Keppo is reconnecting provider status and available integration actions."
    />
  );
}

export const integrationsRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: "integrations",
  pendingComponent: IntegrationsPagePending,
}).lazy(() => import("./integrations.lazy").then((d) => d.integrationsRouteLazy));
