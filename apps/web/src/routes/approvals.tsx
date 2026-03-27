import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

function ApprovalsPagePending() {
  return (
    <ShellTransitionState
      title="Loading approvals"
      detail="Keppo is preparing the live approvals queue for this workspace."
    />
  );
}

export const approvalsRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: "approvals",
  pendingComponent: ApprovalsPagePending,
}).lazy(() => import("./approvals.lazy").then((d) => d.approvalsRouteLazy));
