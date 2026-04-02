import { createLazyRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { automationBuildRoute } from "./automations.build";
import { AutomationPromptBox } from "@/components/automations/automation-prompt-box";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseAiCreditBalance, parseOrgAiKeys } from "@/lib/automations-view-model";
import { useAuth } from "@/hooks/use-auth";
import { useRouteParams } from "@/hooks/use-route-params";
import { useWorkspace } from "@/hooks/use-workspace-context";

export const automationBuildRouteLazy = createLazyRoute(automationBuildRoute.id)({
  component: BuildAutomationPage,
});

function BuildAutomationPage() {
  const navigate = useNavigate();
  const { canManage, getOrgId } = useAuth();
  const { buildWorkspacePath } = useRouteParams();
  const { selectedWorkspaceId } = useWorkspace();
  const orgId = getOrgId();
  const creditBalance = parseAiCreditBalance(
    useQuery(
      makeFunctionReference<"query">("ai_credits:getAiCreditBalance"),
      orgId ? { org_id: orgId } : "skip",
    ),
  );
  const orgAiKeys = parseOrgAiKeys(
    useQuery(
      makeFunctionReference<"query">("org_ai_keys:listOrgAiKeys"),
      orgId ? { org_id: orgId } : "skip",
    ),
  );
  const showSelfManagedAiAccessWarning =
    creditBalance?.bundled_runtime_enabled === false && !orgAiKeys.some((key) => key.is_active);

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

      {showSelfManagedAiAccessWarning ? (
        <Alert variant="warning">
          <AlertTitle>Self-managed AI access still needs one active provider key</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Prompt generation can continue here, but automation runs will stay blocked until this
              org adds an active provider key in AI Configuration.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void navigate({
                  to: buildWorkspacePath("/settings"),
                  search: { tab: "ai" },
                });
              }}
            >
              Open AI Configuration
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {selectedWorkspaceId ? (
        <AutomationPromptBox workspaceId={selectedWorkspaceId} variant="hero" />
      ) : null}
    </div>
  );
}
