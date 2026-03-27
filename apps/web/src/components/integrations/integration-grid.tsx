import {
  IntegrationCard,
  UnconfiguredIntegrationCard,
} from "@/components/integrations/integration-card";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyIllustration,
  EmptyTitle,
} from "@/components/ui/empty";
import type { CanonicalProviderId } from "@keppo/shared/provider-ids";
import type { IntegrationDetail, ProviderCatalogEntry } from "@/lib/types";

interface IntegrationGridProps {
  providers: CanonicalProviderId[];
  providerCatalog: ProviderCatalogEntry[];
  integrations: IntegrationDetail[];
  canManage: boolean;
  onConnect: (provider: CanonicalProviderId) => void;
  onDisconnect: (provider: CanonicalProviderId) => void;
  onTest: (provider: CanonicalProviderId) => Promise<{ ok: boolean; detail: string }>;
  onOpen: (provider: CanonicalProviderId) => void;
  onBrowse?: () => void;
}

export function IntegrationGrid({
  providers,
  providerCatalog,
  integrations,
  canManage,
  onConnect,
  onDisconnect,
  onTest,
  onOpen,
  onBrowse,
}: IntegrationGridProps) {
  const integrationByProvider = new Map(integrations.map((i) => [i.provider, i]));
  const catalogByProvider = new Map(providerCatalog.map((entry) => [entry.provider, entry]));
  const providerList = providers.length > 0 ? providers : [...integrationByProvider.keys()];

  // Configured = has an integration record (connected or previously connected)
  const configured: CanonicalProviderId[] = [];
  const unconfigured: CanonicalProviderId[] = [];

  for (const provider of providerList) {
    const integration = integrationByProvider.get(provider);
    if (integration) {
      configured.push(provider);
    } else {
      unconfigured.push(provider);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {configured.length > 0 && (
        <div className="flex flex-col gap-3">
          {configured.map((provider) => (
            <IntegrationCard
              key={provider}
              provider={provider}
              integration={integrationByProvider.get(provider) ?? null}
              configuration={catalogByProvider.get(provider)?.configuration}
              deprecation={catalogByProvider.get(provider)?.deprecation}
              canManage={canManage}
              onConnect={() => onConnect(provider)}
              onDisconnect={() => onDisconnect(provider)}
              onTest={() => onTest(provider)}
              onOpen={() => onOpen(provider)}
            />
          ))}
        </div>
      )}

      {configured.length === 0 && (
        <Empty className="rounded-xl border py-10">
          <EmptyHeader>
            <EmptyIllustration
              src="/illustrations/empty-integrations.png"
              alt="Illustration of services being connected"
              className="w-[168px]"
            />
            <EmptyTitle>No integrations connected</EmptyTitle>
            <EmptyDescription>Connect a provider below to get started.</EmptyDescription>
          </EmptyHeader>
          {onBrowse ? (
            <EmptyContent>
              <Button variant="outline" onClick={onBrowse} disabled={!canManage}>
                Browse Integrations
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}

      {unconfigured.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Available Integrations</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {unconfigured.map((provider) => (
              <UnconfiguredIntegrationCard
                key={provider}
                provider={provider}
                configuration={catalogByProvider.get(provider)?.configuration}
                deprecation={catalogByProvider.get(provider)?.deprecation}
                canManage={canManage}
                onConnect={() => onConnect(provider)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
