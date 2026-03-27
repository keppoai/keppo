import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

function CustomServersPagePending() {
  return (
    <ShellTransitionState
      title="Loading custom servers"
      detail="Keppo is restoring custom MCP server registrations and discovery state."
    />
  );
}

export const serversRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: "servers",
  pendingComponent: CustomServersPagePending,
}).lazy(() => import("./servers.lazy").then((d) => d.serversRouteLazy));
