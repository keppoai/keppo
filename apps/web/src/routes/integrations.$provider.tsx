import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

function IntegrationDetailPagePending() {
  return (
    <ShellTransitionState
      title="Loading integration details"
      detail="Loading provider configuration..."
    />
  );
}

export const integrationDetailRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: "integrations/$provider",
  pendingComponent: IntegrationDetailPagePending,
}).lazy(() => import("./integrations.$provider.lazy").then((d) => d.integrationDetailRouteLazy));
