import { describe, expect, it } from "vitest";
import { CANONICAL_PROVIDER_IDS } from "./provider-catalog.js";
import { providerModulesV2 } from "./providers/modules/index.js";
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
});
