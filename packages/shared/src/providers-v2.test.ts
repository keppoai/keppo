import { describe, expect, it } from "vitest";
import { providerCatalog } from "./provider-catalog.js";
import { CANONICAL_PROVIDER_IDS } from "./provider-catalog.js";
import { MANAGED_OAUTH_PROVIDER_IDS } from "./providers/boundaries/common.js";
import {
  providerModulesV2,
  WEBHOOK_PROVIDER_IDS,
  AUTOMATION_TRIGGER_PROVIDER_IDS,
} from "./providers/modules/index.js";
import { assertProviderModuleFacetExports } from "./providers/registry/invariants.js";

describe("provider modules v2", () => {
  it("exports exactly one v2 module per canonical provider", () => {
    const declared = providerModulesV2.map((module) => module.providerId).sort();
    const canonical = [...CANONICAL_PROVIDER_IDS].sort();
    expect(declared).toEqual(canonical);
  });

  it("ensures every module exposes required and capability-coupled facets", () => {
    for (const module of providerModulesV2) {
      expect(() => assertProviderModuleFacetExports(module)).not.toThrow();
      for (const toolName of module.metadata.toolOwnership) {
        expect(module.facets.schemas.toolInputSchemas[toolName]).toBeDefined();
      }

      if (module.metadata.capabilities.refreshCredentials) {
        expect(module.facets.refresh?.refreshCredentials).toBeTypeOf("function");
      } else {
        expect(module.facets.refresh).toBeUndefined();
      }

      if (module.metadata.capabilities.webhook) {
        expect(module.facets.webhooks?.verifyWebhook).toBeTypeOf("function");
        expect(module.facets.webhooks?.extractWebhookEvent).toBeTypeOf("function");
      } else {
        expect(module.facets.webhooks).toBeUndefined();
      }

      if (module.metadata.capabilities.automationTriggers) {
        expect(module.facets.automationTriggers).toBeDefined();
        expect(Object.keys(module.facets.automationTriggers?.triggers ?? {})).not.toHaveLength(0);
        for (const trigger of Object.values(module.facets.automationTriggers?.triggers ?? {})) {
          expect(trigger.eventType.length).toBeGreaterThan(0);
          expect(trigger.filterUi.fields.length).toBeGreaterThan(0);
          expect(trigger.matchesEvent).toBeTypeOf("function");
        }
      } else {
        expect(module.facets.automationTriggers).toBeUndefined();
      }
    }
  });

  it("projects provider subsets directly from module metadata", () => {
    expect(MANAGED_OAUTH_PROVIDER_IDS).toEqual(
      providerModulesV2
        .filter((module) => module.metadata.auth.managed)
        .map((module) => module.providerId),
    );
    expect(WEBHOOK_PROVIDER_IDS).toEqual(
      providerModulesV2
        .filter((module) => module.metadata.capabilities.webhook)
        .map((module) => module.providerId),
    );
    expect(AUTOMATION_TRIGGER_PROVIDER_IDS).toEqual(
      providerModulesV2
        .filter((module) => module.metadata.capabilities.automationTriggers)
        .map((module) => module.providerId),
    );
  });

  it("projects provider catalog metadata from the module graph", () => {
    for (const entry of providerCatalog) {
      const module = providerModulesV2.find((candidate) => candidate.providerId === entry.provider);
      expect(module).toBeDefined();
      expect(entry.configuration_requirements ?? []).toEqual(
        module?.metadata.envRequirements ?? [],
      );
      expect(entry.deprecation).toEqual(
        module?.metadata.deprecation
          ? {
              status: module.metadata.deprecation.status,
              message: module.metadata.deprecation.message,
              ...(module.metadata.deprecation.sunsetAt
                ? { sunset_at: module.metadata.deprecation.sunsetAt }
                : {}),
              ...(module.metadata.deprecation.replacementProviderId
                ? { replacement_provider: module.metadata.deprecation.replacementProviderId }
                : {}),
            }
          : undefined,
      );
    }
  });
});
