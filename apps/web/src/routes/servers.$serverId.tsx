import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

function CustomServerDetailPagePending() {
  return (
    <ShellTransitionState
      title="Loading server details"
      detail="Keppo is restoring this custom server and its discovered tool controls."
    />
  );
}

export const serverDetailRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: "servers/$serverId",
  pendingComponent: CustomServerDetailPagePending,
}).lazy(() => import("./servers.$serverId.lazy").then((d) => d.serverDetailRouteLazy));
