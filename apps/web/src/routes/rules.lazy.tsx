import { rulesRoute } from "./rules";
import { createLazyRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { useRules } from "@/hooks/use-rules";
import { useAuth } from "@/hooks/use-auth";
import { useFeatureAccess } from "@/hooks/use-feature-flags";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { CelRuleForm } from "@/components/rules/cel-rule-form";
import { CelRuleList } from "@/components/rules/cel-rule-list";
import { PolicyForm } from "@/components/rules/policy-form";
import { PolicyList } from "@/components/rules/policy-list";
import { AutoApprovalList } from "@/components/rules/auto-approval-list";
import { EvaluationOrderCard } from "@/components/rules/evaluation-order-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyIllustration,
  EmptyTitle,
} from "@/components/ui/empty";
import { fullTimestamp } from "@/lib/format";
import { parsePolicyModeSelection } from "@/lib/rules-view-model";
import { getWorkspacePolicyModeMeta } from "@/lib/workspace-view-model";

export const rulesRouteLazy = createLazyRoute(rulesRoute.id)({
  component: RulesPage,
});

function RulesPage() {
  const { canManage } = useAuth();
  const celRulesEnabled = useFeatureAccess("cel_rules");
  const { selectedWorkspaceId, selectedWorkspaceMatchesUrl } = useWorkspace();
  const {
    isLoading,
    rules,
    policies,
    autoApprovals,
    policyMode,
    celRuleMatches,
    policyDecisions,
    createCelRule,
    setCelRuleEnabled,
    updateCelRule,
    deleteCelRule,
    testCelRule,
    createPolicy,
    setPolicyEnabled,
    updatePolicy,
    setAutoApproval,
    setWorkspacePolicyMode,
  } = useRules(selectedWorkspaceId);
  const defaultTab = celRulesEnabled ? "cel-rules" : "policies";
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [showRuleBuilder, setShowRuleBuilder] = useState(false);
  const visibleTab = !celRulesEnabled && activeTab === "cel-rules" ? "policies" : activeTab;
  const hasRuleConfig = rules.length > 0 || policies.length > 0 || autoApprovals.length > 0;
  const shouldShowRuleBuilder = hasRuleConfig || showRuleBuilder;
  const isWorkspacePending =
    !selectedWorkspaceMatchesUrl || (Boolean(selectedWorkspaceId) && isLoading);
  const isSetupMode = showRuleBuilder && !hasRuleConfig;
  const policyModeMeta = getWorkspacePolicyModeMeta(policyMode);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Rules</h1>
        <p className="text-muted-foreground">
          Configure CEL rules, policies, and auto-approval settings
        </p>
      </div>

      {!isWorkspacePending && !hasRuleConfig && !showRuleBuilder ? (
        <Empty className="rounded-xl border py-10">
          <EmptyHeader>
            <EmptyIllustration
              src="/illustrations/empty-rules.png"
              alt="Illustration of configuring rules and policies"
              className="w-[168px]"
            />
            <EmptyTitle>No rules configured</EmptyTitle>
            <EmptyDescription>
              Rules decide what can run automatically, what needs approval, and what should be
              blocked before it reaches a provider.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="max-w-xl gap-3">
            <div className="rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 text-left">
              <p className="text-sm font-medium text-foreground">Start with one simple policy</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Example: require approval for email sends, then allow low-risk read tools to run
                automatically once you trust the workflow.
              </p>
            </div>
          </EmptyContent>
          {canManage() ? (
            <EmptyContent>
              <Button
                onClick={() => {
                  setShowRuleBuilder(true);
                  setActiveTab(celRulesEnabled ? "cel-rules" : "policies");
                }}
              >
                Create the first rule
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : null}

      {isWorkspacePending ? (
        <>
          <EvaluationOrderCard />

          <Card>
            <CardHeader>
              <CardTitle>Policy Mode</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-10 w-full max-w-md" />
              <Skeleton className="h-4 w-full max-w-xl" />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex gap-2">
                <Skeleton className="h-9 w-28" />
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-9 w-32" />
              </div>
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-28 w-full" />
            </CardContent>
          </Card>
        </>
      ) : null}

      {!isWorkspacePending && shouldShowRuleBuilder ? (
        <>
          {isSetupMode ? (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="pb-3">
                <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
                  Setup
                </p>
                <CardTitle className="text-lg">Choose how this workspace makes decisions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-foreground/80">
                  Set the approval mode first, then use the tabs below to add policies,
                  auto-approvals, and a decision trail.
                </p>
                <p className="text-sm text-muted-foreground">
                  Manual review is the safest default. Move into rules-guided automation only after
                  you trust the workflow.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {!isSetupMode ? <EvaluationOrderCard /> : null}

          <Card>
            <CardHeader>
              <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
                {isSetupMode ? "Step 1" : "Policy mode"}
              </p>
              <CardTitle>How should this workspace handle actions by default?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <NativeSelect
                data-testid="rules-policy-mode"
                value={policyMode}
                disabled={!canManage()}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  const mode = parsePolicyModeSelection(value);
                  if (mode) {
                    void setWorkspacePolicyMode(mode);
                  }
                }}
              >
                <option value="manual_only">Manual review only</option>
                <option value="rules_first">Rules guide decisions</option>
                <option value="rules_plus_agent">Rules and policy agent</option>
              </NativeSelect>
              <div className="rounded-lg border border-secondary/35 bg-secondary/10 px-4 py-3">
                <p className="text-xs font-semibold tracking-[0.16em] text-foreground uppercase">
                  Current behavior
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">{policyModeMeta.label}</p>
                <p className="mt-1 text-sm text-foreground/80">{policyModeMeta.description}</p>
              </div>
            </CardContent>
          </Card>

          {isSetupMode ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
                Step 2
              </p>
              <p className="text-sm text-muted-foreground">
                Choose what to configure next. Policies are the safest place to start.
              </p>
            </div>
          ) : null}

          <Tabs
            key={celRulesEnabled ? "cel-enabled" : "cel-disabled"}
            value={visibleTab}
            onValueChange={setActiveTab}
          >
            <TabsList
              variant="line"
              className="h-auto w-full justify-start gap-3 border-b border-border px-0 py-0"
            >
              {celRulesEnabled ? (
                <TabsTrigger
                  className="h-10 flex-none px-0 pb-3 text-foreground/70"
                  value="cel-rules"
                >
                  CEL Rules
                </TabsTrigger>
              ) : null}
              <TabsTrigger className="h-10 flex-none px-0 pb-3 text-foreground/70" value="policies">
                Policies
              </TabsTrigger>
              <TabsTrigger
                className="h-10 flex-none px-0 pb-3 text-foreground/70"
                value="auto-approvals"
              >
                Auto-Approvals
              </TabsTrigger>
              <TabsTrigger className="h-10 flex-none px-0 pb-3 text-foreground/70" value="logs">
                Decision Logs
              </TabsTrigger>
            </TabsList>

            {celRulesEnabled ? (
              <TabsContent value="cel-rules" className="flex flex-col gap-6 mt-4">
                {canManage() && <CelRuleForm onCreate={createCelRule} onTest={testCelRule} />}
                <CelRuleList
                  rules={rules}
                  onToggleEnabled={setCelRuleEnabled}
                  onUpdate={updateCelRule}
                  onDelete={deleteCelRule}
                  onTest={testCelRule}
                />
              </TabsContent>
            ) : null}

            <TabsContent value="policies" className="flex flex-col gap-6 mt-4">
              {canManage() && (
                <PolicyForm
                  onSubmit={async (values) => {
                    await createPolicy({ text: values.text });
                  }}
                />
              )}
              <PolicyList
                policies={policies}
                onToggleEnabled={setPolicyEnabled}
                onUpdate={updatePolicy}
              />
            </TabsContent>

            <TabsContent value="auto-approvals" className="mt-4">
              <AutoApprovalList
                autoApprovals={autoApprovals}
                onToggle={setAutoApproval}
                canManage={canManage()}
              />
            </TabsContent>

            <TabsContent value="logs" className="mt-4 grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>CEL Match Log</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {celRuleMatches.map((match) => (
                    <div key={String(match.id)} className="rounded-md border p-3 text-sm">
                      <div className="mb-2">
                        <Badge
                          variant={String(match.effect) === "deny" ? "destructive" : "secondary"}
                        >
                          {String(match.effect)}
                        </Badge>
                      </div>
                      <div className="mb-1 text-xs text-muted-foreground">
                        action: {String(match.action_id ?? "unknown")} ·{" "}
                        {match.created_at ? fullTimestamp(match.created_at) : ""}
                      </div>
                      <div className="font-mono text-xs">
                        {String(match.expression_snapshot ?? "")}
                      </div>
                    </div>
                  ))}
                  {celRuleMatches.length === 0 && (
                    <p className="text-sm text-muted-foreground">No CEL matches recorded yet.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Policy Decision Log</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {policyDecisions.map((decision) => (
                    <div key={String(decision.id)} className="rounded-md border p-3 text-sm">
                      <div className="mb-2">
                        <Badge
                          variant={String(decision.result) === "deny" ? "destructive" : "secondary"}
                        >
                          {String(decision.result)}
                        </Badge>
                      </div>
                      <div className="mb-1 text-xs text-muted-foreground">
                        action: {String(decision.action_id ?? "unknown")} ·{" "}
                        {decision.created_at ? fullTimestamp(decision.created_at) : ""}
                      </div>
                      <p>{String(decision.explanation ?? "")}</p>
                      <div className="mt-1 text-xs text-muted-foreground">
                        policies:{" "}
                        {Array.isArray(decision.policies_evaluated)
                          ? decision.policies_evaluated.join(" | ")
                          : "n/a"}
                      </div>
                    </div>
                  ))}
                  {policyDecisions.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No policy decisions recorded yet.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

export { RulesPage };
