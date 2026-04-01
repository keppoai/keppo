import { useEffect } from "react";
import { integrationsRoute } from "./integrations";
import { createLazyRoute, useNavigate } from "@tanstack/react-router";
import { useIntegrations } from "@/hooks/use-integrations";
import { listProviderDeprecations } from "@/lib/provider-view-model";
import { IntegrationGrid } from "@/components/integrations/integration-grid";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import type { UserFacingError } from "@/lib/user-facing-errors";
import { PlusIcon } from "lucide-react";
import { getProviderMeta } from "@/components/integrations/provider-icons";
import { useRouteParams } from "@/hooks/use-route-params";

export const integrationsRouteLazy = createLazyRoute(integrationsRoute.id)({
  component: IntegrationsPage,
});

const OAUTH_SUCCESS_BANNER_TIMEOUT_MS = 8_000;

const buildOAuthCallbackError = (
  code: "unauthorized" | "forbidden",
  providerLabel: string,
): UserFacingError => {
  if (code === "unauthorized") {
    return {
      code: "oauth.unauthorized",
      title: "Sign in again",
      summary: `${providerLabel} could not finish connecting because your session expired.`,
      nextSteps: [
        "Sign back in to Keppo.",
        "Restart the provider connection from the integrations page.",
      ],
      technicalDetails: "code: oauth.unauthorized",
      publicTechnicalDetails: null,
      status: 401,
      severity: "warning",
      publicSafe: true,
      metadata: null,
      rawMessage: null,
      sourceMessage: "Authentication required.",
    };
  }

  return {
    code: "oauth.forbidden",
    title: "Access blocked",
    summary: `${providerLabel} can only be connected by the same owner or admin who started the flow.`,
    nextSteps: [
      "Restart the connection with the initiating owner or admin account.",
      "If your role changed, ask an owner or admin to restore access before retrying.",
    ],
    technicalDetails: "code: oauth.forbidden",
    publicTechnicalDetails: null,
    status: 403,
    severity: "warning",
    publicSafe: true,
    metadata: null,
    rawMessage: null,
    sourceMessage: "Only the initiating owner or admin can complete this organization integration.",
  };
};

export function IntegrationsPage() {
  const { canManage } = useAuth();
  const navigate = useNavigate();
  const searchNavigate = integrationsRoute.useNavigate();
  const search = integrationsRoute.useSearch();
  const { buildWorkspacePath } = useRouteParams();
  const {
    isLoading,
    providers,
    providerCatalog,
    integrations,
    connectProvider,
    disconnectProvider,
    testConnection,
  } = useIntegrations();
  const visibleProviders = providers.filter((provider) => provider !== "custom");
  const visibleProviderCatalog = providerCatalog.filter((entry) => entry.provider !== "custom");
  const deprecations = listProviderDeprecations(visibleProviderCatalog);
  const browseProvider = visibleProviders[0] ?? visibleProviderCatalog[0]?.provider ?? null;
  const feedbackProviderLabel = search.oauth_provider
    ? getProviderMeta(search.oauth_provider).label
    : "This provider";
  const oauthCallbackError: UserFacingError | null =
    search.oauth_error === "unauthorized"
      ? buildOAuthCallbackError("unauthorized", feedbackProviderLabel)
      : search.oauth_error === "forbidden"
        ? buildOAuthCallbackError("forbidden", feedbackProviderLabel)
        : null;
  const clearFeedback = () => {
    void searchNavigate({
      search: (previous) => ({
        ...previous,
        integration_connected: undefined,
        oauth_error: undefined,
        oauth_provider: undefined,
      }),
      replace: true,
    });
  };
  const clearSuccessFeedback = () => {
    void searchNavigate({
      search: (previous) => ({
        integration_connected: undefined,
        oauth_error: previous.oauth_error,
        oauth_provider: previous.oauth_provider,
      }),
      replace: true,
    });
  };
  const handleSignIn = () => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    void navigate({
      to: "/login",
      search: {
        returnTo,
      },
    });
  };

  useEffect(() => {
    if (!search.integration_connected) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      clearSuccessFeedback();
    }, OAUTH_SUCCESS_BANNER_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [search.integration_connected]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Connect third-party providers to enable automation actions
          </p>
        </div>
        {canManage() ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => {
              void navigate({ to: buildWorkspacePath("/servers") });
            }}
          >
            <PlusIcon className="mr-1.5 size-3.5" />
            Custom
          </Button>
        ) : null}
      </div>

      {search.integration_connected ? (
        <Alert className="border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200">
          <AlertTitle>{getProviderMeta(search.integration_connected).label} connected</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>Keppo can now use this integration in the current workspace.</span>
            <Button variant="outline" size="sm" onClick={clearFeedback}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {oauthCallbackError ? (
        <UserFacingErrorView
          error={oauthCallbackError}
          action={
            search.oauth_error === "unauthorized" ? (
              <Button size="sm" onClick={handleSignIn}>
                Sign in
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={clearFeedback}>
                Dismiss
              </Button>
            )
          }
        />
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <IntegrationGrid
          providers={visibleProviders}
          providerCatalog={visibleProviderCatalog}
          integrations={integrations}
          canManage={canManage()}
          onConnect={connectProvider}
          onDisconnect={disconnectProvider}
          onTest={testConnection}
          onOpen={(provider) => {
            void navigate({
              to: buildWorkspacePath(`/integrations/${provider}`),
            });
          }}
          {...(browseProvider
            ? {
                onBrowse: () => {
                  void navigate({
                    to: buildWorkspacePath(`/integrations/${browseProvider}`),
                  });
                },
              }
            : {})}
        />
      )}

      {!isLoading && deprecations.length > 0 ? (
        <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          <AlertTitle>Provider deprecation notices</AlertTitle>
          <AlertDescription>
            {deprecations.map((notice) => {
              const label = getProviderMeta(notice.provider).label;
              return (
                <p key={notice.provider}>
                  <span className="font-medium">{label}:</span> {notice.message}
                  {notice.sunsetAt ? ` (sunset at ${notice.sunsetAt})` : ""}
                </p>
              );
            })}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
