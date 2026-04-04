import { automationsRoute } from "./automations";
import { useMemo } from "react";
import { createLazyRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AutomationList } from "@/components/automations/automation-list";
import { AutomationPromptBox } from "@/components/automations/automation-prompt-box";
import { useRouteParams } from "@/hooks/use-route-params";
import {
  formatAiCreditAmount,
  isAiCreditBalanceExhausted,
  parseAiCreditBalance,
} from "@/lib/automations-view-model";

export const automationsRouteLazy = createLazyRoute(automationsRoute.id)({
  component: AutomationsPage,
});

function AutomationsPage() {
  const navigate = useNavigate();
  const { canManage, getOrgId } = useAuth();
  const { selectedWorkspaceId } = useWorkspace();
  const { buildOrgPath, buildWorkspacePath } = useRouteParams();
  const orgId = getOrgId();
  const aiCreditBalanceRaw = useQuery(
    makeFunctionReference<"query">("ai_credits:getAiCreditBalance"),
    orgId ? { org_id: orgId } : "skip",
  );
  const aiCreditBalance = useMemo(
    () => parseAiCreditBalance(aiCreditBalanceRaw),
    [aiCreditBalanceRaw],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Automations</h1>
          <p className="text-muted-foreground">
            Create, run, and monitor autonomous workspace automations.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          {canManage() ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="w-full sm:w-auto"
                onClick={() => {
                  void navigate({ to: buildWorkspacePath("/automations/build") });
                }}
                disabled={!selectedWorkspaceId}
              >
                Build automation
              </Button>
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => {
                  void navigate({ to: buildWorkspacePath("/automations/create") });
                }}
                disabled={!selectedWorkspaceId}
              >
                Create manually
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="px-3 py-1 text-sm">
              {aiCreditBalance
                ? `${formatAiCreditAmount(aiCreditBalance.total_available)} credits`
                : "Credits loading"}
            </Badge>
            {isAiCreditBalanceExhausted(aiCreditBalance) ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigate({ to: buildOrgPath("/settings/billing") });
                }}
              >
                Get more credits
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <AutomationList
        workspaceId={selectedWorkspaceId}
        onOpenAutomation={(automationPath) => {
          void navigate({
            to: buildWorkspacePath(`/automations/${automationPath}`),
          });
        }}
      />

      {selectedWorkspaceId && canManage() ? (
        <AutomationPromptBox
          workspaceId={selectedWorkspaceId}
          variant="compact"
          collapseByDefault
          aiCreditBalance={aiCreditBalance}
        />
      ) : null}
    </div>
  );
}
