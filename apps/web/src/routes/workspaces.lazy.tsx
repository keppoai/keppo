import { workspacesRoute } from "./workspaces";
import { useEffect, useState } from "react";
import { createLazyRoute } from "@tanstack/react-router";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { useAuth } from "@/hooks/use-auth";
import { useIntegrations } from "@/hooks/use-integrations";
import { useCustomMcpMutations, useWorkspaceCustomServers } from "@/hooks/use-custom-mcp";
import { useRouteParams } from "@/hooks/use-route-params";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { testWorkspaceMcp } from "@/lib/server-functions/internal-api";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import { getRuntimeBetterAuthCookieHeader } from "@/lib/better-auth-cookie";
import { ErrorBoundary } from "@/components/error-boundary";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { WorkspaceCard } from "@/components/workspaces/workspace-card";
import { WorkspaceCreateForm } from "@/components/workspaces/workspace-create-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { TierLimitBanner } from "@/components/ui/tier-limit-banner";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { parseTierLimitError, type TierLimitError } from "@/lib/convex-errors";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { getWorkspacePolicyModeMeta } from "@/lib/workspace-view-model";

export const workspacesRouteLazy = createLazyRoute(workspacesRoute.id)({
  component: WorkspacesPage,
});

function WorkspaceIntegrationsCard({
  canManage,
  selectedWorkspaceIntegrations,
  setSelectedWorkspaceIntegrations,
}: {
  canManage: boolean;
  selectedWorkspaceIntegrations: Array<{ provider: string; enabled: boolean }>;
  setSelectedWorkspaceIntegrations: (providers: string[]) => Promise<void>;
}) {
  const { integrations } = useIntegrations();
  const enabledProviders = new Set(
    selectedWorkspaceIntegrations.filter((item) => item.enabled).map((item) => item.provider),
  );
  const connectedProviders = integrations
    .filter((integration) => integration.connected)
    .map((integration) => integration.provider);
  const providerOptions = Array.from(
    new Set([...connectedProviders, ...selectedWorkspaceIntegrations.map((item) => item.provider)]),
  ).sort();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace Integrations</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {providerOptions.map((provider) => {
          const checked = enabledProviders.size === 0 ? true : enabledProviders.has(provider);
          return (
            <div key={provider} className="flex items-center justify-between rounded-md border p-3">
              <div className="grid gap-1">
                <Label htmlFor={`workspace-provider-${provider}`}>{provider}</Label>
                <p className="text-xs text-muted-foreground">
                  Turn this on only if automations in this workspace should use it.
                </p>
              </div>
              <Switch
                id={`workspace-provider-${provider}`}
                checked={checked}
                disabled={!canManage}
                onCheckedChange={(nextChecked) => {
                  const current = new Set(
                    enabledProviders.size === 0 ? providerOptions : [...enabledProviders],
                  );
                  if (nextChecked) {
                    current.add(provider);
                  } else {
                    current.delete(provider);
                  }
                  void setSelectedWorkspaceIntegrations([...current]);
                }}
              />
            </div>
          );
        })}
        {providerOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Connect integrations first, then choose which ones are available for this workspace.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function WorkspaceIntegrationsFallbackCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace Integrations</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Integration availability is temporarily unavailable. The rest of this workspace settings
          page is still ready.
        </p>
      </CardContent>
    </Card>
  );
}

function WorkspacesPage() {
  const runtime = useDashboardRuntime();
  const { canManage } = useAuth();
  const { buildOrgPath } = useRouteParams();
  const { setWorkspaceServerEnabled } = useCustomMcpMutations();
  const {
    workspaces,
    selectedWorkspace,
    selectedWorkspaceId,
    selectedWorkspaceCredentialSecret,
    selectedWorkspaceIntegrations,
    setSelectedWorkspaceId,
    createWorkspace,
    deleteSelectedWorkspace,
    rotateSelectedWorkspaceCredential,
    setSelectedWorkspacePolicyMode,
    setSelectedWorkspaceCodeMode,
    setSelectedWorkspaceIntegrations,
  } = useWorkspace();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pageError, setPageError] = useState<UserFacingError | null>(null);
  const [tierLimitError, setTierLimitError] = useState<TierLimitError | null>(null);
  const [mcpTestState, setMcpTestState] = useState<{
    status: "idle" | "pending" | "success" | "error";
    message: string | null;
    error: UserFacingError | null;
  }>({
    status: "idle",
    message: null,
    error: null,
  });
  const [isCredentialVisible, setIsCredentialVisible] = useState(false);
  const [rotateCredentialDialogOpen, setRotateCredentialDialogOpen] = useState(false);
  const [deleteWorkspaceDialogOpen, setDeleteWorkspaceDialogOpen] = useState(false);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [pendingWorkspaceServerEnabled, setPendingWorkspaceServerEnabled] = useState<
    Record<string, boolean | undefined>
  >({});
  const workspaceCustomServersRaw = useWorkspaceCustomServers(selectedWorkspaceId);
  const workspaceCustomServers = workspaceCustomServersRaw ?? [];
  const isWorkspaceCustomServersLoading =
    Boolean(selectedWorkspaceId) && workspaceCustomServersRaw === undefined;
  useEffect(() => {
    setPendingWorkspaceServerEnabled((current) => {
      let changed = false;
      const next = { ...current };
      for (const entry of workspaceCustomServers) {
        if (next[entry.server.id] === entry.enabled) {
          delete next[entry.server.id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [workspaceCustomServers]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workspaces</h1>
          <p className="text-muted-foreground">Manage your workspace environments</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button disabled={!canManage()} />}>
            <PlusIcon className="mr-2 size-4" />
            Create Workspace
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a new Workspace</DialogTitle>
            </DialogHeader>
            <WorkspaceCreateForm
              onSubmit={async (values) => {
                try {
                  setPageError(null);
                  setTierLimitError(null);
                  await createWorkspace(values);
                  setDialogOpen(false);
                } catch (error) {
                  const limit = parseTierLimitError(error);
                  if (limit) {
                    setTierLimitError(limit);
                    return;
                  }
                  setPageError(
                    toUserFacingError(error, {
                      fallback: "Failed to create workspace.",
                    }),
                  );
                }
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {tierLimitError ? (
        <TierLimitBanner limit={tierLimitError} billingPath={buildOrgPath("/settings/billing")} />
      ) : null}
      {pageError ? <UserFacingErrorView error={pageError} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {workspaces.map((workspace) => (
          <WorkspaceCard
            key={workspace.id}
            workspace={workspace}
            isSelected={workspace.id === selectedWorkspaceId}
            onSelect={() => setSelectedWorkspaceId(workspace.id)}
          />
        ))}
        {workspaces.length === 0 && (
          <p className="col-span-full text-sm text-muted-foreground">
            No workspaces yet. Create one to get started.
          </p>
        )}
      </div>

      {selectedWorkspace && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Automation mode</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <NativeSelect
                data-testid="workspace-policy-mode"
                value={selectedWorkspace.policy_mode}
                disabled={!canManage()}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (
                    value === "manual_only" ||
                    value === "rules_first" ||
                    value === "rules_plus_agent"
                  ) {
                    void setSelectedWorkspacePolicyMode(value);
                  }
                }}
              >
                <option value="manual_only">Manual review only</option>
                <option value="rules_first">Rules guide decisions</option>
                <option value="rules_plus_agent">Rules and policy agent</option>
              </NativeSelect>
              <p className="text-sm text-muted-foreground">
                {getWorkspacePolicyModeMeta(selectedWorkspace.policy_mode).description}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Compact tool mode</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <div className="text-sm text-muted-foreground">
                Bundle code and search tools into a leaner runtime profile when you want lower token
                overhead.
              </div>
              <Switch
                id="workspace-code-mode"
                aria-label="Code Mode"
                checked={selectedWorkspace.code_mode_enabled}
                disabled={!canManage()}
                onCheckedChange={(checked) => {
                  void setSelectedWorkspaceCodeMode(checked);
                }}
              />
            </CardContent>
          </Card>

          <ErrorBoundary boundary="layout" fallback={<WorkspaceIntegrationsFallbackCard />}>
            <WorkspaceIntegrationsCard
              canManage={canManage()}
              selectedWorkspaceIntegrations={selectedWorkspaceIntegrations}
              setSelectedWorkspaceIntegrations={setSelectedWorkspaceIntegrations}
            />
          </ErrorBoundary>

          <Card>
            <CardHeader>
              <CardTitle>Custom MCP Servers</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {isWorkspaceCustomServersLoading ? (
                <>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </>
              ) : null}
              {!isWorkspaceCustomServersLoading
                ? workspaceCustomServers.map((entry) => (
                    <div
                      key={entry.server.id}
                      data-testid="workspace-custom-server-row"
                      data-custom-server-id={entry.server.id}
                      data-custom-server-name={entry.server.display_name}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div className="grid gap-1">
                        <Label htmlFor={`workspace-custom-server-${entry.server.id}`}>
                          {entry.server.display_name}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {entry.server.tool_count} tools · {entry.server.status}
                        </p>
                      </div>
                      <Switch
                        id={`workspace-custom-server-${entry.server.id}`}
                        aria-label={`${entry.server.display_name} workspace availability`}
                        checked={pendingWorkspaceServerEnabled[entry.server.id] ?? entry.enabled}
                        disabled={!canManage()}
                        onCheckedChange={(checked) => {
                          setPendingWorkspaceServerEnabled((current) => ({
                            ...current,
                            [entry.server.id]: checked,
                          }));
                          void (async () => {
                            try {
                              await setWorkspaceServerEnabled({
                                workspaceId: selectedWorkspaceId,
                                serverId: entry.server.id,
                                enabled: checked,
                              });
                            } catch (error) {
                              setPendingWorkspaceServerEnabled((current) => {
                                const next = { ...current };
                                delete next[entry.server.id];
                                return next;
                              });
                              toast.error(
                                toUserFacingError(error, {
                                  fallback: "Failed to update custom server availability.",
                                }).summary,
                              );
                            }
                          })();
                        }}
                      />
                    </div>
                  ))
                : null}
              {!isWorkspaceCustomServersLoading && workspaceCustomServers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No custom MCP servers registered. Go to Custom Servers to add one.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Workspace MCP credential</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Keppo manages the MCP transport boundary internally. Use this credential only for
                workspace-level status, rotation, and support workflows.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <AlertDialog
                  open={rotateCredentialDialogOpen}
                  onOpenChange={setRotateCredentialDialogOpen}
                >
                  <Button
                    variant="outline"
                    disabled={!canManage()}
                    onClick={() => {
                      setRotateCredentialDialogOpen(true);
                    }}
                  >
                    Rotate Credential
                  </Button>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Rotate workspace credential?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Rotating this secret immediately invalidates the current workspace
                        credential. Only rotate when you are ready to re-run Keppo-managed setup or
                        support recovery steps that depend on a fresh token.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep current token</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          setRotateCredentialDialogOpen(false);
                          void rotateSelectedWorkspaceCredential();
                        }}
                      >
                        Rotate token
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {selectedWorkspaceCredentialSecret && (
                  <>
                    <code className="max-w-full break-all rounded bg-muted px-2 py-1 text-xs">
                      {isCredentialVisible
                        ? selectedWorkspaceCredentialSecret
                        : `${selectedWorkspaceCredentialSecret.slice(0, 6)}••••${selectedWorkspaceCredentialSecret.slice(-6)}`}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsCredentialVisible(true);
                        window.setTimeout(() => setIsCredentialVisible(false), 10_000);
                      }}
                    >
                      {isCredentialVisible ? "Visible for 10s" : "Click to reveal"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        setMcpTestState({
                          status: "pending",
                          message: "Testing connection...",
                          error: null,
                        });
                        try {
                          const payload = await testWorkspaceMcp({
                            workspaceId: selectedWorkspace.id,
                            betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
                          });
                          const result = payload ?? {};
                          setMcpTestState({
                            status: result.ok ? "success" : "error",
                            message:
                              result.message ??
                              (result.ok
                                ? "Workspace MCP credential is active."
                                : "MCP test failed."),
                            error: null,
                          });
                        } catch (error) {
                          setMcpTestState({
                            status: "error",
                            message: null,
                            error: toUserFacingError(error, {
                              fallback: "Failed to test the workspace MCP credential.",
                            }),
                          });
                        }
                      }}
                    >
                      Test Connection
                    </Button>
                  </>
                )}
              </div>
              {mcpTestState.message ? (
                <p
                  className={
                    mcpTestState.status === "error"
                      ? "text-sm text-destructive"
                      : "text-sm text-muted-foreground"
                  }
                >
                  {mcpTestState.message}
                </p>
              ) : null}
              {mcpTestState.error ? (
                <UserFacingErrorView error={mcpTestState.error} variant="compact" />
              ) : null}
              <div className="text-sm text-muted-foreground">
                Keppo manages the endpoint and client configuration details internally. This page
                intentionally does not expose the raw MCP URL or client-specific setup instructions.
              </div>
            </CardContent>
          </Card>

          <Card className="border-destructive/20">
            <CardHeader>
              <CardTitle>Delete workspace</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Remove this workspace from the active dashboard, revoke its credential, and switch
                the team to another remaining workspace.
              </p>
              {workspaces.length <= 1 ? (
                <p className="text-sm text-muted-foreground">
                  Keep at least one workspace active in the organization.
                </p>
              ) : null}
              <AlertDialog
                open={deleteWorkspaceDialogOpen}
                onOpenChange={setDeleteWorkspaceDialogOpen}
              >
                <Button
                  variant="destructive"
                  data-testid="delete-workspace-trigger"
                  disabled={!canManage() || workspaces.length <= 1 || isDeletingWorkspace}
                  onClick={() => {
                    setDeleteWorkspaceDialogOpen(true);
                  }}
                >
                  Delete Workspace
                </Button>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selectedWorkspace.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the workspace from active use immediately, revokes its current
                      credential, and sends you to another workspace.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeletingWorkspace}>
                      Keep workspace
                    </AlertDialogCancel>
                    <AlertDialogAction
                      data-testid="confirm-delete-workspace"
                      disabled={isDeletingWorkspace}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={(event) => {
                        event.preventDefault();
                        setIsDeletingWorkspace(true);
                        void (async () => {
                          try {
                            setPageError(null);
                            await deleteSelectedWorkspace();
                            setDeleteWorkspaceDialogOpen(false);
                          } catch (error) {
                            setPageError(
                              toUserFacingError(error, {
                                fallback: "Failed to delete workspace.",
                              }),
                            );
                            setDeleteWorkspaceDialogOpen(false);
                          } finally {
                            setIsDeletingWorkspace(false);
                          }
                        })();
                      }}
                    >
                      {isDeletingWorkspace ? "Deleting..." : "Delete workspace"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export { WorkspacesPage };
