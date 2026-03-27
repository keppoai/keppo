import { serversRoute } from "./servers";
import { useMemo, useState } from "react";
import { createLazyRoute, Link } from "@tanstack/react-router";
import { EyeIcon, EyeOffIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useCustomMcpMutations, useCustomServers } from "@/hooks/use-custom-mcp";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyIllustration,
  EmptyTitle,
} from "@/components/ui/empty";
import { HelpText } from "@/components/ui/help-text";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sanitizeCustomServerUrl, validateCustomServerUrl } from "@/lib/custom-server-form";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import { useRouteParams } from "@/hooks/use-route-params";

export const serversRouteLazy = createLazyRoute(serversRoute.id)({
  component: CustomServersPage,
});

const deriveSlug = (displayName: string): string => {
  const normalized = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.length >= 3) {
    return normalized.slice(0, 40);
  }
  return "custom-server";
};

function statusVariant(status: "connected" | "disconnected" | "error") {
  if (status === "connected") {
    return "default" as const;
  }
  if (status === "error") {
    return "destructive" as const;
  }
  return "secondary" as const;
}

function CustomServersPage() {
  const { canManage } = useAuth();
  const { buildWorkspacePath } = useRouteParams();
  const servers = useCustomServers();
  const { registerServer, triggerDiscovery } = useCustomMcpMutations();

  const [showForm, setShowForm] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [url, setUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [showBearerToken, setShowBearerToken] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<UserFacingError | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const slugValue = useMemo(() => {
    if (slug.trim().length > 0) {
      return slug;
    }
    return deriveSlug(displayName);
  }, [displayName, slug]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Custom Servers</h1>
          <p className="text-sm text-muted-foreground">
            Register external MCP-compatible servers and manage discovered tools.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          disabled={!canManage()}
          onClick={() => setShowForm((current) => !current)}
        >
          <PlusIcon className="mr-1.5 size-3.5" />
          Add Server
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Add Custom MCP Server</CardTitle>
          </CardHeader>
          <CardContent>
            {formError ? <UserFacingErrorView error={formError} className="mb-4" /> : null}
            <form
              className="grid gap-3"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!canManage() || isSubmitting) {
                  return;
                }
                setIsSubmitting(true);
                try {
                  setFormError(null);
                  const nextUrl = sanitizeCustomServerUrl(url);
                  const validationError = validateCustomServerUrl(nextUrl);
                  if (validationError) {
                    setUrlError(validationError);
                    setIsSubmitting(false);
                    return;
                  }
                  setUrlError(null);
                  const created = await registerServer({
                    url: nextUrl,
                    display_name: displayName,
                    slug: slugValue,
                    ...(bearerToken.trim() ? { bearer_token: bearerToken.trim() } : {}),
                  });
                  await triggerDiscovery({ serverId: created.id });
                  setDisplayName("");
                  setUrl("");
                  setSlug("");
                  setBearerToken("");
                  setShowForm(false);
                } catch (error) {
                  setFormError(
                    toUserFacingError(error, {
                      fallback: "Failed to register custom MCP server.",
                    }),
                  );
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="custom-server-name">Display Name</Label>
                  <Input
                    id="custom-server-name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.currentTarget.value)}
                    placeholder="Support Internal Tools"
                    disabled={!canManage() || isSubmitting}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="custom-server-slug">Slug</Label>
                  <Input
                    id="custom-server-slug"
                    value={slugValue}
                    onChange={(event) => setSlug(event.currentTarget.value.toLowerCase())}
                    placeholder="support-tools"
                    disabled={!canManage() || isSubmitting}
                    required
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="custom-server-url">Server URL</Label>
                  <Input
                    id="custom-server-url"
                    type="url"
                    value={url}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      setUrl(nextValue);
                      if (urlError) {
                        setUrlError(validateCustomServerUrl(nextValue));
                      }
                    }}
                    placeholder="https://internalmcp.dyad.sh"
                    disabled={!canManage() || isSubmitting}
                    required
                    aria-invalid={urlError ? true : undefined}
                  />
                  <HelpText>
                    Use the full MCP endpoint URL. Local development URLs are fine, but the address
                    must include `http://` or `https://`.
                  </HelpText>
                  {urlError ? <p className="text-destructive text-xs">{urlError}</p> : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="custom-server-token">Bearer Token</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => setShowBearerToken((current) => !current)}
                      disabled={!canManage() || isSubmitting}
                    >
                      {showBearerToken ? (
                        <EyeOffIcon className="size-4" />
                      ) : (
                        <EyeIcon className="size-4" />
                      )}
                      {showBearerToken ? "Hide" : "Show"}
                    </Button>
                  </div>
                  <Input
                    id="custom-server-token"
                    type={showBearerToken ? "text" : "password"}
                    value={bearerToken}
                    onChange={(event) => setBearerToken(event.currentTarget.value)}
                    placeholder="Optional"
                    disabled={!canManage() || isSubmitting}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <HelpText>
                    Optional. Keppo stores the token securely and only sends it to this server.
                  </HelpText>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={!canManage() || isSubmitting}>
                  {isSubmitting ? "Saving..." : "Register"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {servers.map((server) => (
          <Card key={server.id}>
            <CardHeader className="space-y-1">
              <CardTitle className="flex items-center justify-between text-base">
                <span>{server.display_name}</span>
                <Badge variant={statusVariant(server.status)}>{server.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm text-muted-foreground">
              <div className="truncate font-mono text-xs">{server.url}</div>
              <div className="flex items-center justify-between">
                <span>Tools</span>
                <span>{server.tool_count}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Last discovery</span>
                <span>{server.last_discovery_at ?? "Never"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Token</span>
                <span>{server.has_bearer_token ? "Configured" : "Not set"}</span>
              </div>
              <div className="pt-2">
                <Link
                  to={buildWorkspacePath(`/servers/${server.id}`)}
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                    className: "w-full",
                  })}
                >
                  <RefreshCwIcon className="mr-1.5 size-3.5" />
                  Manage
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}

        {servers.length === 0 ? (
          <Empty className="col-span-full rounded-xl border py-10">
            <EmptyHeader>
              <EmptyIllustration
                src="/illustrations/empty-servers.png"
                alt="Illustration of a person setting up a server"
                className="w-[170px]"
              />
              <EmptyTitle>No custom servers</EmptyTitle>
              <EmptyDescription>Register an external MCP server to extend Keppo.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>
    </div>
  );
}
