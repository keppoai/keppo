import { useMemo, useState } from "react";
import { Link, createLazyRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { isAutomationMermaidStale } from "@keppo/shared/automations";
import { ChevronDownIcon, PlayIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { automationDetailRoute } from "./automations.$automationId";
import { AutomationAiEditFlow } from "@/components/automations/automation-ai-edit-flow";
import { AutomationConfigEditor } from "@/components/automations/automation-config-editor";
import {
  AutomationDescriptionContent,
  MermaidDiagram,
} from "@/components/automations/automation-description-content";
import { AutomationExecutionModeCallout } from "@/components/automations/automation-execution-mode-callout";
import { AutomationHomeTab } from "@/components/automations/automation-home-tab";
import { RunList } from "@/components/automations/run-list";
import { VersionHistory } from "@/components/automations/version-history";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { useAuth } from "@/hooks/use-auth";
import { useFeatureAccess } from "@/hooks/use-feature-flags";
import { useRouteParams } from "@/hooks/use-route-params";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { getRuntimeBetterAuthCookieHeader } from "@/lib/better-auth-cookie";
import {
  normalizeMermaidContent,
  splitAutomationDescription,
  validateMermaidContent,
} from "@/lib/automation-mermaid";
import {
  type AiModelProvider,
  type AutomationStatus,
  automationStatusBadgeVariant,
  getAutomationPathSegment,
  parseAiCreditBalance,
  parseAutomationWithConfig,
  parsePaginatedRuns,
  resolveAutomationExecutionState,
} from "@/lib/automations-view-model";
import { generateAutomationPrompt } from "@/lib/server-functions/internal-api";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";

const EMPTY_CURSOR: string | null = null;

export const automationDetailRouteLazy = createLazyRoute(automationDetailRoute.id)({
  component: AutomationDetailPage,
});

type AutomationExecutionSectionProps = {
  orgId: string | null;
  provider: AiModelProvider;
  automationStatus: AutomationStatus;
  billingPath: string;
  settingsPath: string;
  statusDialogOpen: boolean;
  isTogglingStatus: boolean;
  setStatusDialogOpen: (open: boolean) => void;
  onToggleStatus: () => void;
  isTriggering: boolean;
  onRunNow: () => void;
};

function AutomationExecutionSection({
  orgId,
  provider,
  automationStatus,
  billingPath,
  settingsPath,
  statusDialogOpen,
  isTogglingStatus,
  setStatusDialogOpen,
  onToggleStatus,
  isTriggering,
  onRunNow,
}: AutomationExecutionSectionProps) {
  const orgAiKeys = useQuery(
    makeFunctionReference<"query">("org_ai_keys:listOrgAiKeys"),
    orgId ? { org_id: orgId } : "skip",
  );
  const aiCreditBalanceRaw = useQuery(
    makeFunctionReference<"query">("ai_credits:getAiCreditBalance"),
    orgId ? { org_id: orgId } : "skip",
  );

  const aiCreditBalance = useMemo(
    () => parseAiCreditBalance(aiCreditBalanceRaw),
    [aiCreditBalanceRaw],
  );
  const executionState = useMemo(
    () =>
      resolveAutomationExecutionState({
        provider,
        creditBalance: aiCreditBalance,
        orgAiKeys: Array.isArray(orgAiKeys) ? orgAiKeys : [],
      }),
    [provider, aiCreditBalance, orgAiKeys],
  );
  const executionStatePending = aiCreditBalanceRaw === undefined || orgAiKeys === undefined;
  const runBlockedByExecutionState = executionStatePending || !executionState.can_run;
  const runButtonTooltip = executionStatePending
    ? "Checking AI access before enabling manual runs."
    : executionState.mode === "bundled"
      ? "Open Billing to purchase credits or upgrade your plan before running automations."
      : "Add an API key before running automations.";
  const resumeBlockedByExecutionState = automationStatus !== "active" && runBlockedByExecutionState;
  const resumeTooltip = executionStatePending
    ? "Checking AI access before enabling resume."
    : executionState.mode === "bundled"
      ? "Open Billing to purchase credits or upgrade your plan before resuming this automation."
      : "Add an API key before resuming this automation.";

  return (
    <>
      {!executionStatePending && !executionState.can_run ? (
        <AutomationExecutionModeCallout
          provider={provider}
          state={executionState}
          billingPath={billingPath}
          settingsPath={settingsPath}
        />
      ) : null}

      {resumeBlockedByExecutionState ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex">
                <Button variant="outline" disabled>
                  Resume
                </Button>
              </span>
            }
          />
          <TooltipContent>{resumeTooltip}</TooltipContent>
        </Tooltip>
      ) : (
        <AlertDialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
          <AlertDialogTrigger render={<Button variant="outline" />}>
            {automationStatus === "active" ? "Pause" : "Resume"}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {automationStatus === "active"
                  ? "Pause this automation?"
                  : "Resume this automation?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {automationStatus === "active"
                  ? "Scheduled runs and automated triggers will stop until you resume the automation. Existing runs stay available for review."
                  : "Scheduled runs and automated triggers will start again as soon as the automation is resumed."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onToggleStatus} disabled={isTogglingStatus}>
                {isTogglingStatus
                  ? "Updating..."
                  : automationStatus === "active"
                    ? "Pause automation"
                    : "Resume automation"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {runBlockedByExecutionState ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex">
                <Button disabled>
                  <PlayIcon className="size-4" />
                  Run now
                </Button>
              </span>
            }
          />
          <TooltipContent>{runButtonTooltip}</TooltipContent>
        </Tooltip>
      ) : (
        <Button onClick={onRunNow} disabled={isTriggering || automationStatus !== "active"}>
          <PlayIcon className="size-4" />
          {isTriggering ? "Triggering..." : "Run now"}
        </Button>
      )}
    </>
  );
}

function AutomationDetailPage() {
  const navigate = useNavigate();
  const { automationId } = automationDetailRoute.useParams();
  const { getOrgId } = useAuth();
  const { buildOrgPath, buildWorkspacePath } = useRouteParams();
  const { selectedWorkspaceId } = useWorkspace();
  const triggerCelEnabled = useFeatureAccess("trigger_cel");
  const orgId = getOrgId();

  const [tab, setTab] = useState<"home" | "config" | "runs" | "versions">("home");
  const [error, setError] = useState<UserFacingError | null>(null);
  const [showAiEditor, setShowAiEditor] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRegeneratingDiagram, setIsRegeneratingDiagram] = useState(false);
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);

  const automationRaw = useQuery(
    makeFunctionReference<"query">("automations:getAutomation"),
    automationId && selectedWorkspaceId
      ? { automation_id: automationId, workspace_id: selectedWorkspaceId }
      : "skip",
  );

  const updateAutomationStatusMutation = useMutation(
    makeFunctionReference<"mutation">("automations:updateAutomationStatus"),
  );
  const triggerRunMutation = useMutation(
    makeFunctionReference<"mutation">("automation_runs:triggerAutomationRunManual"),
  );
  const deleteAutomationMutation = useMutation(
    makeFunctionReference<"mutation">("automations:deleteAutomation"),
  );
  const regenerateAutomationMermaidMutation = useMutation(
    makeFunctionReference<"mutation">("automations:regenerateAutomationMermaid"),
  );

  const parsed = useMemo(() => parseAutomationWithConfig(automationRaw), [automationRaw]);
  const latestRunsRaw = useQuery(
    makeFunctionReference<"query">("automation_runs:listAutomationRuns"),
    parsed?.automation.id
      ? {
          automation_id: parsed.automation.id,
          paginationOpts: { numItems: 1, cursor: EMPTY_CURSOR },
        }
      : "skip",
  );
  const latestRun = useMemo(
    () => parsePaginatedRuns(latestRunsRaw).page[0] ?? null,
    [latestRunsRaw],
  );

  if (automationRaw === undefined) {
    return (
      <div className="flex flex-col gap-6" data-testid="automation-detail-loading">
        <Card className="border-primary/15 bg-gradient-to-br from-primary/5 via-background to-background">
          <CardHeader className="gap-3">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <ShieldCheckIcon className="size-3.5" />
              Loading workflow summary
            </div>
            <Skeleton className="h-10 w-56" />
            <Skeleton className="h-5 w-full max-w-2xl" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-6 w-44" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Loading controls</CardTitle>
            <p className="text-sm text-muted-foreground">Loading automation details...</p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    );
  }

  if (!parsed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Automation not found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This automation could not be found in the selected workspace.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { automation, current_config_version: currentConfig } = parsed;
  const automationPath = getAutomationPathSegment(automation);
  const diagramChart = splitAutomationDescription(
    automation.description,
    automation.mermaid_content,
  ).mermaidContent;
  const mermaidIsStale = currentConfig
    ? isAutomationMermaidStale({
        prompt: currentConfig.prompt,
        mermaidContent: automation.mermaid_content,
        mermaidPromptHash: automation.mermaid_prompt_hash,
      })
    : false;

  const handleStatusToggle = async () => {
    setError(null);
    setIsTogglingStatus(true);
    try {
      await updateAutomationStatusMutation({
        automation_id: automation.id,
        status: automation.status === "active" ? "paused" : "active",
      });
      setStatusDialogOpen(false);
    } catch (caught) {
      setError(
        toUserFacingError(caught, {
          fallback: "Failed to update automation availability.",
        }),
      );
    } finally {
      setIsTogglingStatus(false);
    }
  };

  const handleRunNow = async () => {
    setError(null);
    setIsTriggering(true);
    try {
      const run = await triggerRunMutation({ automation_id: automation.id });
      await navigate({
        to: buildWorkspacePath(`/automations/${automationPath}/runs/${run.id}`),
        search: {},
      });
    } catch (caught) {
      setError(
        toUserFacingError(caught, {
          fallback: "Failed to trigger run.",
        }),
      );
    } finally {
      setIsTriggering(false);
    }
  };

  const handleDelete = async () => {
    setError(null);
    setIsDeleting(true);
    try {
      await deleteAutomationMutation({ automation_id: automation.id });
      await navigate({ to: buildWorkspacePath("/automations") });
    } catch (caught) {
      setError(
        toUserFacingError(caught, {
          fallback: "Failed to delete automation.",
        }),
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRegenerateDiagram = async () => {
    if (!currentConfig) {
      return;
    }
    setError(null);
    setIsRegeneratingDiagram(true);
    try {
      const result = await generateAutomationPrompt({
        workspace_id: automation.workspace_id,
        user_description: currentConfig.prompt,
        generation_mode: "mermaid_only",
        automation_context: {
          automation_id: automation.id,
          name: automation.name,
          description: automation.description,
          mermaid_content: automation.mermaid_content ?? "",
          trigger_type: currentConfig.trigger_type,
          schedule_cron: currentConfig.schedule_cron,
          event_provider:
            currentConfig.provider_trigger?.provider_id ?? currentConfig.event_provider,
          event_type: currentConfig.provider_trigger?.trigger_key ?? currentConfig.event_type,
          model_class: currentConfig.model_class,
          ai_model_provider: currentConfig.ai_model_provider,
          ai_model_name: currentConfig.ai_model_name,
          network_access: currentConfig.network_access,
          prompt: currentConfig.prompt,
        },
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      const record =
        result && typeof result === "object" && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : null;
      const mermaidContent =
        typeof record?.mermaid_content === "string" ? record.mermaid_content.trim() : "";
      if (!mermaidContent) {
        throw new Error("Mermaid regeneration returned invalid data.");
      }
      const normalizedMermaid = normalizeMermaidContent(mermaidContent);
      const mermaidError = await validateMermaidContent(normalizedMermaid);
      if (mermaidError) {
        throw new Error(mermaidError);
      }
      await regenerateAutomationMermaidMutation({
        automation_id: automation.id,
        mermaid_content: normalizedMermaid,
      });
    } catch (caught) {
      setError(
        toUserFacingError(caught, {
          fallback: "Failed to regenerate the workflow diagram.",
        }),
      );
    } finally {
      setIsRegeneratingDiagram(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-primary/15 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardHeader className="gap-3">
          <div className="space-y-2">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <ShieldCheckIcon className="size-3.5" />
              Workflow summary
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{automation.name}</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Review the plain-language summary and workflow before changing configuration or
              triggering a run.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <AutomationDescriptionContent
            description={automation.description}
            mermaidContent={automation.mermaid_content}
            hideDiagram
          />
          <div className="flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
            {latestRun ? (
              <Link
                to={buildWorkspacePath(`/automations/${automationPath}/runs/${latestRun.id}`)}
                search={{}}
                aria-label="View latest run"
                className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Badge
                  variant={automationStatusBadgeVariant(automation.status)}
                  className="cursor-pointer capitalize underline-offset-4 transition hover:underline"
                >
                  {automation.status}
                </Badge>
              </Link>
            ) : (
              <Badge
                variant={automationStatusBadgeVariant(automation.status)}
                className="capitalize"
              >
                {automation.status}
              </Badge>
            )}
            <span className="text-muted-foreground">Automation ID</span>
            <code className="rounded bg-muted px-2 py-1 text-xs">{automation.id}</code>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {currentConfig ? (
            <Button
              onClick={() => {
                setShowAiEditor((current) => !current);
              }}
            >
              {showAiEditor ? "Hide AI editor" : "Edit with AI"}
            </Button>
          ) : null}
          {currentConfig ? (
            <Button
              variant="outline"
              onClick={() => {
                setTab("config");
              }}
            >
              Edit manually
            </Button>
          ) : null}
          {currentConfig ? (
            <AutomationExecutionSection
              orgId={orgId}
              provider={currentConfig.ai_model_provider}
              automationStatus={automation.status}
              billingPath={buildOrgPath("/settings/billing")}
              settingsPath={buildOrgPath("/settings")}
              statusDialogOpen={statusDialogOpen}
              isTogglingStatus={isTogglingStatus}
              setStatusDialogOpen={setStatusDialogOpen}
              onToggleStatus={() => {
                void handleStatusToggle();
              }}
              isTriggering={isTriggering}
              onRunNow={() => {
                void handleRunNow();
              }}
            />
          ) : null}

          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" />}>
              Delete
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete automation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the automation definition. Run history and config
                  snapshots are retained for audit.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    void handleDelete();
                  }}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Delete Automation"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {currentConfig && showAiEditor ? (
        <AutomationAiEditFlow
          automation={automation}
          config={currentConfig}
          onApplied={() => {
            setError(null);
            setShowAiEditor(false);
          }}
        />
      ) : null}

      {diagramChart ? (
        <Collapsible className="rounded-xl border bg-card">
          <CollapsibleTrigger className="flex w-full items-center justify-between px-5 py-4 text-left">
            <div>
              <p className="font-medium">Workflow diagram</p>
              <p className="text-sm text-muted-foreground">
                Expand the diagram when you want the visual flow.
              </p>
            </div>
            <ChevronDownIcon className="size-4" />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3">
            {mermaidIsStale ? (
              <Alert variant="warning" className="mb-3">
                <AlertTitle>Prompt changed since this diagram was generated</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>Regenerate the Mermaid diagram to bring the visual flow back in sync.</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRegenerateDialogOpen(true);
                    }}
                    disabled={isRegeneratingDiagram}
                  >
                    <RefreshCwIcon className="mr-2 size-4" />
                    {isRegeneratingDiagram ? "Regenerating..." : "Regenerate diagram"}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <div className="mb-3 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRegenerateDialogOpen(true);
                  }}
                  disabled={isRegeneratingDiagram}
                >
                  <RefreshCwIcon className="mr-2 size-4" />
                  {isRegeneratingDiagram ? "Regenerating..." : "Regenerate diagram"}
                </Button>
              </div>
            )}
            <div className="rounded-2xl border p-3">
              <MermaidDiagram chart={diagramChart} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {error ? <UserFacingErrorView error={error} variant="compact" /> : null}

      <AlertDialog open={regenerateDialogOpen} onOpenChange={setRegenerateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate workflow diagram?</AlertDialogTitle>
            <AlertDialogDescription>
              Regenerating the diagram refreshes the visual workflow and uses AI credits. The
              current automation prompt stays the same.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRegeneratingDiagram}>
              Keep current diagram
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isRegeneratingDiagram}
              onClick={() => {
                setRegenerateDialogOpen(false);
                void handleRegenerateDiagram();
              }}
            >
              {isRegeneratingDiagram ? "Regenerating..." : "Regenerate diagram"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as "home" | "config" | "runs" | "versions")}
      >
        <TabsList>
          <TabsTrigger value="home">Home</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        <TabsContent value="home" className="mt-4">
          <AutomationHomeTab
            automation={automation}
            config={currentConfig}
            onNavigateTab={(nextTab, runId) => {
              if (runId) {
                void navigate({
                  to: buildWorkspacePath(`/automations/${automationPath}/runs/${runId}`),
                  search: {},
                });
              } else {
                setTab(nextTab as "home" | "config" | "runs" | "versions");
              }
            }}
          />
        </TabsContent>

        <TabsContent value="config" className="mt-4">
          {currentConfig ? (
            <AutomationConfigEditor
              automation={automation}
              config={currentConfig}
              triggerCelEnabled={triggerCelEnabled}
              onSaved={() => {
                setError(null);
              }}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Config</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Current configuration is unavailable.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <RunList automationId={automation.id} automationPath={automationPath} />
        </TabsContent>

        <TabsContent value="versions" className="mt-4">
          <VersionHistory
            automationId={automation.id}
            currentConfigVersionId={automation.current_config_version_id}
            onVersionChange={() => {
              setError(null);
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
