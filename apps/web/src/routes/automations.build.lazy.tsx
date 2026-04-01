import { createLazyRoute, useNavigate } from "@tanstack/react-router";
import { automationBuildRoute } from "./automations.build";
import { AutomationPromptBox } from "@/components/automations/automation-prompt-box";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useRouteParams } from "@/hooks/use-route-params";
import { useWorkspace } from "@/hooks/use-workspace-context";

export const automationBuildRouteLazy = createLazyRoute(automationBuildRoute.id)({
  component: BuildAutomationPage,
});

function BuildAutomationPage() {
  const navigate = useNavigate();
  const { canManage } = useAuth();
  const { buildWorkspacePath } = useRouteParams();
  const { selectedWorkspaceId } = useWorkspace();

  if (!canManage()) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>You do not have access to build automations.</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Automation authoring is limited to workspace owners and admins. You can still review
              existing automations from the workspace list.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void navigate({ to: buildWorkspacePath("/automations") });
              }}
            >
              Back to automations
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Build automation</h1>
        <p className="max-w-3xl text-muted-foreground">
          Describe the workflow in plain language, review the generated draft, and keep refining it
          in one dedicated builder page.
        </p>
      </div>

      {selectedWorkspaceId ? (
        <AutomationPromptBox workspaceId={selectedWorkspaceId} variant="hero" />
      ) : null}
    </div>
  );
}
