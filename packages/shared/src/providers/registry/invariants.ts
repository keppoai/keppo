import type { ProviderModuleV2 } from "./types.js";

const REQUIRED_FACET_KEYS = ["metadata", "schemas", "auth", "tools", "ui"] as const;

export const assertProviderModuleFacetExports = (module: ProviderModuleV2): void => {
  for (const facet of REQUIRED_FACET_KEYS) {
    if (!module.facets[facet]) {
      throw new Error(
        `Provider "${module.providerId}" is missing required facet "${facet}" in ProviderModuleV2.`,
      );
    }
  }

  if (module.metadata.providerId !== module.providerId) {
    throw new Error(
      `Provider module id mismatch: module providerId "${module.providerId}" does not match metadata.providerId "${module.metadata.providerId}".`,
    );
  }

  for (const toolName of module.metadata.toolOwnership) {
    if (!module.facets.schemas.toolInputSchemas[toolName]) {
      throw new Error(
        `Provider "${module.providerId}" is missing schema export for tool "${toolName}".`,
      );
    }
  }

  if (module.metadata.capabilities.refreshCredentials && !module.facets.refresh) {
    throw new Error(
      `Provider "${module.providerId}" declares refresh capability but is missing refresh facet.`,
    );
  }

  if (!module.metadata.capabilities.refreshCredentials && module.facets.refresh) {
    throw new Error(
      `Provider "${module.providerId}" defines refresh facet without refresh capability.`,
    );
  }

  if (module.metadata.capabilities.webhook && !module.facets.webhooks) {
    throw new Error(
      `Provider "${module.providerId}" declares webhook capability but is missing webhooks facet.`,
    );
  }

  if (!module.metadata.capabilities.webhook && module.facets.webhooks) {
    throw new Error(
      `Provider "${module.providerId}" defines webhooks facet without webhook capability.`,
    );
  }

  if (module.metadata.capabilities.automationTriggers && !module.facets.automationTriggers) {
    throw new Error(
      `Provider "${module.providerId}" declares automation trigger capability but is missing automationTriggers facet.`,
    );
  }

  if (!module.metadata.capabilities.automationTriggers && module.facets.automationTriggers) {
    throw new Error(
      `Provider "${module.providerId}" defines automationTriggers facet without automation trigger capability.`,
    );
  }

  if (!module.facets.automationTriggers && module.facets.automationTriggerLifecycle) {
    throw new Error(
      `Provider "${module.providerId}" defines automationTriggerLifecycle without automationTriggers.`,
    );
  }

  if (module.facets.automationTriggers) {
    const triggerEntries = Object.entries(module.facets.automationTriggers.triggers);
    if (triggerEntries.length === 0) {
      throw new Error(
        `Provider "${module.providerId}" defines automation trigger capability with no trigger definitions.`,
      );
    }
    for (const [triggerKey, trigger] of triggerEntries) {
      if (trigger.key !== triggerKey) {
        throw new Error(
          `Provider "${module.providerId}" trigger key "${trigger.key}" must match facet map key "${triggerKey}".`,
        );
      }
      if (trigger.eventType.trim().length === 0) {
        throw new Error(
          `Provider "${module.providerId}" trigger "${triggerKey}" must declare a canonical eventType.`,
        );
      }
      if (trigger.scheduler.strategy !== "polling") {
        throw new Error(
          `Provider "${module.providerId}" trigger "${triggerKey}" must declare a supported scheduler strategy.`,
        );
      }
      if (
        !Number.isFinite(trigger.scheduler.cadenceMinutes) ||
        trigger.scheduler.cadenceMinutes < 1
      ) {
        throw new Error(
          `Provider "${module.providerId}" trigger "${triggerKey}" must declare a positive scheduler cadence.`,
        );
      }
      if (
        !Number.isFinite(trigger.scheduler.maxCandidatesPerReconcile) ||
        trigger.scheduler.maxCandidatesPerReconcile < 1
      ) {
        throw new Error(
          `Provider "${module.providerId}" trigger "${triggerKey}" must declare a positive scheduler candidate limit.`,
        );
      }
      if (trigger.filterUi.fields.length === 0) {
        throw new Error(
          `Provider "${module.providerId}" trigger "${triggerKey}" must declare provider-owned filter UI fields.`,
        );
      }
      if (trigger.supportedDeliveryModes.length === 0) {
        throw new Error(
          `Provider "${module.providerId}" trigger "${triggerKey}" must declare at least one delivery mode.`,
        );
      }
      if (!trigger.supportedDeliveryModes.includes(trigger.defaultDeliveryMode)) {
        throw new Error(
          `Provider "${module.providerId}" trigger "${triggerKey}" must include its default delivery mode in supportedDeliveryModes.`,
        );
      }
      if (
        trigger.fallbackDeliveryMode !== undefined &&
        !trigger.supportedDeliveryModes.includes(trigger.fallbackDeliveryMode)
      ) {
        throw new Error(
          `Provider "${module.providerId}" trigger "${triggerKey}" must include its fallback delivery mode in supportedDeliveryModes.`,
        );
      }
      if (typeof trigger.matchesEvent !== "function") {
        throw new Error(
          `Provider "${module.providerId}" trigger "${triggerKey}" must export a matchesEvent evaluator.`,
        );
      }
    }
  }

  if (
    module.facets.automationTriggers &&
    Object.values(module.facets.automationTriggers.triggers).some(
      (trigger) => trigger.scheduler.strategy === "polling",
    ) &&
    !module.facets.automationTriggerLifecycle
  ) {
    throw new Error(
      `Provider "${module.providerId}" declares polling automation triggers without automationTriggerLifecycle support.`,
    );
  }
};

export const assertProviderModulesV2Invariants = (modules: Array<ProviderModuleV2>): void => {
  const seenProviders = new Set<string>();

  for (const module of modules) {
    assertProviderModuleFacetExports(module);
    if (seenProviders.has(module.providerId)) {
      throw new Error(`Duplicate ProviderModuleV2 declaration for "${module.providerId}".`);
    }
    seenProviders.add(module.providerId);
  }
};
