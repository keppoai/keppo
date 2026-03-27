import { integrationsRoute } from "./integrations";
import { createLazyRoute, useNavigate } from "@tanstack/react-router";
import { useIntegrations } from "@/hooks/use-integrations";
import { listProviderDeprecations } from "@/lib/provider-view-model";
import { IntegrationGrid } from "@/components/integrations/integration-grid";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusIcon } from "lucide-react";
import { getProviderMeta } from "@/components/integrations/provider-icons";
import { useRouteParams } from "@/hooks/use-route-params";

export const integrationsRouteLazy = createLazyRoute(integrationsRoute.id)({
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { canManage } = useAuth();
  const navigate = useNavigate();
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
