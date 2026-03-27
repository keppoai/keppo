import { createRoute } from "@tanstack/react-router";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { workspaceLayoutRoute } from "./_org._workspace";

function PromptBuilderPagePending() {
  return (
    <ShellTransitionState
      title="Loading prompt builder"
      detail="Keppo is restoring the provider-aware prompt drafting workspace."
    />
  );
}

export const promptBuilderRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: "prompt-builder",
  pendingComponent: PromptBuilderPagePending,
}).lazy(() => import("./prompt-builder.lazy").then((d) => d.promptBuilderRouteLazy));
