import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { adminLayoutRoute } from "./_admin";

function AdminInviteCodesPending() {
  return (
    <ShellTransitionState
      title="Loading invite codes"
      detail="Keppo is restoring invite code controls for the admin panel."
    />
  );
}

export const adminInviteCodesRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: "invite-codes",
  pendingComponent: AdminInviteCodesPending,
}).lazy(() => import("./_admin.invite-codes.lazy").then((d) => d.adminInviteCodesRouteLazy));
