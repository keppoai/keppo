import { useMemo } from "react";
import { createLazyRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { automationBuildRoute } from "./automations.build";
import { AutomationPromptBox } from "@/components/automations/automation-prompt-box";
import { InlineApiKeySetup } from "@/components/automations/inline-api-key-setup";
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
  const { canManage, getOrgId } = useAuth();
  const { buildWorkspacePath } = useRouteParams();
  const { selectedWorkspaceId } = useWorkspace();
  const orgId = getOrgId();
  const billing = useQuery(
    makeFunctionReference<"query">("billing:getCurrentOrgBilling"),
    orgId ? {} : "skip",
  );
  const orgAiKeys = useQuery(
    makeFunctionReference<"query">("org_ai_keys:listOrgAiKeys"),
    orgId ? { org_id: orgId } : "skip",
  );
  const hasActiveAiKey = useMemo(() => {
    if (!Array.isArray(orgAiKeys)) {
      return false;
    }
    return orgAiKeys.some(
      (entry) =>
        entry && typeof entry === "object" && (entry as { is_active?: unknown }).is_active === true,
    );
  }, [orgAiKeys]);
  const needsInlineKeySetup = billing?.tier === "free" && !hasActiveAiKey;

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

      {needsInlineKeySetup && orgId ? <InlineApiKeySetup orgId={orgId} /> : null}

      {selectedWorkspaceId ? (
        <AutomationPromptBox workspaceId={selectedWorkspaceId} variant="hero" />
      ) : null}
    </div>
  );
}
