import { serverDetailRoute } from "./servers.$serverId";
import { useState } from "react";
import { createLazyRoute, Link, useNavigate } from "@tanstack/react-router";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  useCustomMcpMutations,
  useCustomServer,
  useCustomServerTools,
} from "@/hooks/use-custom-mcp";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpText } from "@/components/ui/help-text";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useRouteParams } from "@/hooks/use-route-params";
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyIllustration,
  EmptyTitle,
} from "@/components/ui/empty";
import { sanitizeCustomServerUrl, validateCustomServerUrl } from "@/lib/custom-server-form";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";

export const serverDetailRouteLazy = createLazyRoute(serverDetailRoute.id)({
  component: CustomServerDetailPage,
});

function statusVariant(status: "connected" | "disconnected" | "error") {
  if (status === "connected") {
    return "default" as const;
  }
  if (status === "error") {
    return "destructive" as const;
  }
  return "secondary" as const;
}

const normalizeStoredDiscoveryError = (message: string): UserFacingError => {
  const trimmed = message.trim();
  if (trimmed.startsWith("custom_mcp.")) {
    return toUserFacingError(trimmed, {
      fallback: "Failed to rediscover custom MCP tools.",
    });
  }
  if (/^[a-z0-9_.-]+:/i.test(trimmed)) {
    return toUserFacingError(`custom_mcp.${trimmed}`, {
      fallback: "Failed to rediscover custom MCP tools.",
    });
  }
  return toUserFacingError(`custom_mcp.discovery_failed: ${trimmed}`, {
    fallback: "Failed to rediscover custom MCP tools.",
  });
};

function CustomServerDetailPage() {
  const { serverId } = serverDetailRoute.useParams();
  const navigate = useNavigate();
  const { buildWorkspacePath } = useRouteParams();
  const { canManage } = useAuth();
  const server = useCustomServer(serverId);
  const tools = useCustomServerTools(serverId) ?? [];
  const { updateServer, deleteServer, triggerDiscovery, updateToolConfig, bulkUpdateToolConfig } =
    useCustomMcpMutations();

  const [displayName, setDisplayName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pageError, setPageError] = useState<UserFacingError | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  if (!server) {
    return (
      <Empty className="rounded-xl border py-12">
        <EmptyHeader>
          <EmptyIllustration
            src="/illustrations/not-found.png"
            alt="Illustration for a missing custom server"
          />
          <EmptyTitle>Custom server not found</EmptyTitle>
          <EmptyDescription>
            This server may have been removed or the current workspace no longer has access to it.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link
            to={buildWorkspacePath("/servers")}
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "w-fit",
            })}
          >
            Back to custom servers
          </Link>
        </EmptyContent>
      </Empty>
    );
  }

  const effectiveDisplayName = displayName.trim().length > 0 ? displayName : server.display_name;
  const effectiveUrl = url.trim().length > 0 ? url : server.url;
  const visibleError =
    pageError ??
    (server.last_discovery_error
      ? normalizeStoredDiscoveryError(server.last_discovery_error)
      : null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{server.display_name}</h1>
          <p className="text-sm text-muted-foreground">{server.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge data-testid="custom-server-status-badge" variant={statusVariant(server.status)}>
            {server.status}
          </Badge>
          <Link
            to={buildWorkspacePath("/servers")}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Back
          </Link>
        </div>
      </div>

      {visibleError ? <UserFacingErrorView error={visibleError} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Server Info</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="custom-server-display-name">Display Name</Label>
              <Input
                id="custom-server-display-name"
                value={effectiveDisplayName}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
                disabled={!canManage() || isSaving}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="custom-server-url-edit">Server URL</Label>
              <Input
                id="custom-server-url-edit"
                type="url"
                value={effectiveUrl}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  setUrl(nextValue);
                  if (urlError) {
                    setUrlError(validateCustomServerUrl(nextValue));
                  }
                }}
                disabled={!canManage() || isSaving}
                aria-invalid={urlError ? true : undefined}
              />
              <HelpText>
                Keep this pointed at the MCP endpoint that responds to discovery and tool calls.
              </HelpText>
              {urlError ? <p className="text-destructive text-xs">{urlError}</p> : null}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="custom-server-token-edit">
                Bearer Token (set to rotate, empty to keep)
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => setShowToken((current) => !current)}
                disabled={!canManage() || isSaving}
              >
                {showToken ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                {showToken ? "Hide" : "Show"}
              </Button>
            </div>
            <Input
              id="custom-server-token-edit"
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(event) => setToken(event.currentTarget.value)}
              disabled={!canManage() || isSaving}
              placeholder={server.has_bearer_token ? "Configured" : "Not set"}
              autoComplete="off"
              spellCheck={false}
            />
            <HelpText>
              Leave this blank to keep the current token. Enter a new one only when rotating
              credentials.
            </HelpText>
          </div>
          <div className="grid gap-1 text-sm text-muted-foreground">
            <span>Last discovery: {server.last_discovery_at ?? "Never"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!canManage() || isSaving}
              onClick={async () => {
                setIsSaving(true);
                try {
                  setPageError(null);
                  const nextUrl = sanitizeCustomServerUrl(effectiveUrl);
                  const validationError = validateCustomServerUrl(nextUrl);
                  if (validationError) {
                    setUrlError(validationError);
                    setIsSaving(false);
                    return;
                  }
                  setUrlError(null);
                  await updateServer({
                    serverId,
                    display_name: effectiveDisplayName,
                    url: nextUrl,
                    ...(token.length > 0 ? { bearer_token: token } : {}),
                  });
                  setToken("");
                } catch (error) {
                  setPageError(
                    toUserFacingError(error, {
                      fallback: "Failed to update the custom MCP server.",
                    }),
                  );
                } finally {
                  setIsSaving(false);
                }
              }}
            >
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!canManage() || isSaving}
              onClick={async () => {
                try {
                  setPageError(null);
                  await triggerDiscovery({ serverId });
                } catch (error) {
                  setPageError(
                    toUserFacingError(error, {
                      fallback: "Failed to rediscover custom MCP tools.",
                    }),
                  );
                }
              }}
            >
              Rediscover Tools
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!canManage() || isSaving}
              onClick={async () => {
                try {
                  setPageError(null);
                  await triggerDiscovery({ serverId });
                } catch (error) {
                  setPageError(
                    toUserFacingError(error, {
                      fallback: "Failed to test the custom MCP server connection.",
                    }),
                  );
                }
              }}
            >
              Test Connection
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Discovered Tools</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canManage()}
              onClick={async () => {
                try {
                  setPageError(null);
                  await bulkUpdateToolConfig({ serverId, risk_level: "high" });
                } catch (error) {
                  setPageError(
                    toUserFacingError(error, {
                      fallback: "Failed to update custom MCP tool settings.",
                    }),
                  );
                }
              }}
            >
              Set all high risk
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canManage()}
              onClick={async () => {
                try {
                  setPageError(null);
                  await bulkUpdateToolConfig({
                    serverId,
                    requires_approval: true,
                  });
                } catch (error) {
                  setPageError(
                    toUserFacingError(error, {
                      fallback: "Failed to update custom MCP tool settings.",
                    }),
                  );
                }
              }}
            >
              Require approval for all
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canManage()}
              onClick={async () => {
                try {
                  setPageError(null);
                  await bulkUpdateToolConfig({ serverId, enabled: true });
                } catch (error) {
                  setPageError(
                    toUserFacingError(error, {
                      fallback: "Failed to update custom MCP tool settings.",
                    }),
                  );
                }
              }}
            >
              Enable all
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canManage()}
              onClick={async () => {
                try {
                  setPageError(null);
                  await bulkUpdateToolConfig({ serverId, enabled: false });
                } catch (error) {
                  setPageError(
                    toUserFacingError(error, {
                      fallback: "Failed to update custom MCP tool settings.",
                    }),
                  );
                }
              }}
            >
              Disable all
            </Button>
          </div>

          {tools.map((tool) => (
            <div
              key={tool.id}
              data-testid="custom-server-tool-row"
              data-tool-id={tool.id}
              data-tool-name={tool.tool_name}
              className="grid gap-2 rounded-md border p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium" data-testid="custom-server-tool-name">
                    {tool.tool_name}
                  </p>
                  <p className="text-muted-foreground">{tool.description}</p>
                </div>
                <Badge variant={tool.enabled ? "default" : "secondary"}>
                  {tool.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`risk-${tool.id}`}>Risk</Label>
                  <NativeSelect
                    id={`risk-${tool.id}`}
                    aria-label={`${tool.tool_name} risk`}
                    value={tool.risk_level}
                    disabled={!canManage()}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      if (
                        value === "low" ||
                        value === "medium" ||
                        value === "high" ||
                        value === "critical"
                      ) {
                        void updateToolConfig({
                          toolId: tool.id,
                          risk_level: value,
                        }).catch((error) => {
                          setPageError(
                            toUserFacingError(error, {
                              fallback: "Failed to update custom MCP tool settings.",
                            }),
                          );
                        });
                      }
                    }}
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                  </NativeSelect>
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <Label htmlFor={`approval-${tool.id}`}>Requires Approval</Label>
                  <Switch
                    id={`approval-${tool.id}`}
                    aria-label={`${tool.tool_name} requires approval`}
                    checked={tool.requires_approval}
                    disabled={!canManage()}
                    onCheckedChange={(checked) => {
                      void updateToolConfig({
                        toolId: tool.id,
                        requires_approval: checked,
                      }).catch((error) => {
                        setPageError(
                          toUserFacingError(error, {
                            fallback: "Failed to update custom MCP tool settings.",
                          }),
                        );
                      });
                    }}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <Label htmlFor={`enabled-${tool.id}`}>Enabled</Label>
                  <Switch
                    id={`enabled-${tool.id}`}
                    aria-label={`${tool.tool_name} enabled`}
                    checked={tool.enabled}
                    disabled={!canManage()}
                    onCheckedChange={(checked) => {
                      void updateToolConfig({
                        toolId: tool.id,
                        enabled: checked,
                      }).catch((error) => {
                        setPageError(
                          toUserFacingError(error, {
                            fallback: "Failed to update custom MCP tool settings.",
                          }),
                        );
                      });
                    }}
                  />
                </div>
              </div>
            </div>
          ))}

          {tools.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center">
              <p className="text-sm font-medium text-foreground">No tools discovered yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Run a connection test or rediscover tools after confirming the server URL and bearer
                token.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            size="sm"
            disabled={!canManage() || isSaving}
            onClick={() => {
              setDeleteDialogOpen(true);
            }}
          >
            Delete Server
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete custom server?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete {server.display_name} and remove every discovered tool from this workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSaving}
              onClick={(event) => {
                event.preventDefault();
                setIsSaving(true);
                void deleteServer({ serverId })
                  .then(async () => {
                    setDeleteDialogOpen(false);
                    await navigate({ to: buildWorkspacePath("/servers") });
                  })
                  .finally(() => {
                    setIsSaving(false);
                  });
              }}
            >
              {isSaving ? "Deleting..." : "Delete Server"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
