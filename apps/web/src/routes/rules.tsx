import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

function RulesPagePending() {
  return (
    <ShellTransitionState
      title="Loading rules"
      detail="Keppo is restoring workspace policy and approval rule controls."
    />
  );
}

export const rulesRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: "rules",
  pendingComponent: RulesPagePending,
}).lazy(() => import("./rules.lazy").then((d) => d.rulesRouteLazy));
