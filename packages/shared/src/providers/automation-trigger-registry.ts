import type { CanonicalProviderId } from "../providers.js";
import type {
  ProviderAutomationTriggerDefinition,
  ProviderAutomationTriggersFacet,
  RegisteredProviderAutomationTrigger,
} from "./registry/types.js";
import { providerModulesV2 } from "./modules/index.js";

let cachedAutomationTriggerRegistry: Partial<
  Record<CanonicalProviderId, ProviderAutomationTriggersFacet>
> | null = null;

const getAutomationTriggerRegistry = (): Partial<
  Record<CanonicalProviderId, ProviderAutomationTriggersFacet>
> => {
  if (cachedAutomationTriggerRegistry) {
    return cachedAutomationTriggerRegistry;
  }

  const registry: Partial<Record<CanonicalProviderId, ProviderAutomationTriggersFacet>> = {};
  for (const module of providerModulesV2) {
    if (!module.facets.automationTriggers) {
      continue;
    }
    registry[module.providerId] = module.facets.automationTriggers;
  }

  cachedAutomationTriggerRegistry = registry;
  return registry;
};

export const getProviderAutomationTriggers = (
  providerId: string,
): ProviderAutomationTriggersFacet | null => {
  const registry = getAutomationTriggerRegistry();
  return registry[providerId as keyof typeof registry] ?? null;
};

export const getProviderAutomationTriggerDefinition = (
  providerId: string,
  triggerKey: string,
): ProviderAutomationTriggerDefinition | null => {
  return getProviderAutomationTriggers(providerId)?.triggers[triggerKey] ?? null;
};

export const resolveProviderAutomationTriggerDefinition = (
  providerId: string,
  value: string,
): ProviderAutomationTriggerDefinition | null => {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }
  const facet = getProviderAutomationTriggers(providerId);
  if (!facet) {
    return null;
  }
  return (
    facet.triggers[normalizedValue] ??
    Object.values(facet.triggers).find((trigger) => trigger.eventType === normalizedValue) ??
    null
  );
};

export const listRegisteredAutomationTriggers = (): RegisteredProviderAutomationTrigger[] => {
  return providerModulesV2.flatMap((module) =>
    Object.values(module.facets.automationTriggers?.triggers ?? {}).map((trigger) => ({
      providerId: module.providerId,
      trigger,
    })),
  );
};

export const listPollingAutomationTriggers = (): RegisteredProviderAutomationTrigger[] => {
  return listRegisteredAutomationTriggers().filter(
    ({ trigger }) => trigger.scheduler.strategy === "polling",
  );
};
