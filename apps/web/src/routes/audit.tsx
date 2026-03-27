import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { orgLayoutRoute } from "./_org";

function AuditPagePending() {
  return (
    <ShellTransitionState
      title="Loading audit log"
      detail="Keppo is restoring organization-wide audit events and filters."
    />
  );
}

export const auditRoute = createRoute({
  getParentRoute: () => orgLayoutRoute,
  path: "settings/audit",
  pendingComponent: AuditPagePending,
}).lazy(() => import("./audit.lazy").then((d) => d.auditRouteLazy));
