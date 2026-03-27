import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { orgLayoutRoute } from "./_org";

function MembersPagePending() {
  return (
    <ShellTransitionState
      title="Loading members"
      detail="Keppo is restoring membership, invites, and seat usage details."
    />
  );
}

export const membersRoute = createRoute({
  getParentRoute: () => orgLayoutRoute,
  path: "settings/members",
  pendingComponent: MembersPagePending,
}).lazy(() => import("./members.lazy").then((d) => d.membersRouteLazy));
