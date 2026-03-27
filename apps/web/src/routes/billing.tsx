import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { orgLayoutRoute } from "./_org";

function BillingPagePending() {
  return (
    <ShellTransitionState
      title="Loading billing"
      detail="Keppo is restoring plan, usage, and subscription controls for this organization."
    />
  );
}

export const billingRoute = createRoute({
  getParentRoute: () => orgLayoutRoute,
  path: "settings/billing",
  pendingComponent: BillingPagePending,
}).lazy(() => import("./billing.lazy").then((d) => d.billingRouteLazy));
