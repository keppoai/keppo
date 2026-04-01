import { createRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

const optionalSearchString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

export const integrationsSearchSchema = z.object({
  integration_connected: optionalSearchString,
  oauth_error: optionalSearchString,
  oauth_provider: optionalSearchString,
});

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
  validateSearch: integrationsSearchSchema,
  pendingComponent: IntegrationsPagePending,
}).lazy(() => import("./integrations.lazy").then((d) => d.integrationsRouteLazy));
