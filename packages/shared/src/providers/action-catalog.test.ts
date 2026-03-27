import { describe, expect, it } from "vitest";
import { CANONICAL_PROVIDER_IDS } from "../provider-ids.js";
import { allTools } from "../tool-definitions.js";
import {
  getProviderActionCatalogValidationErrors,
  providerActionCatalog,
  providerLifecycleActionMatrix,
} from "./action-catalog.js";

describe("provider action catalog", () => {
  it("tracks all planned actions", () => {
    expect(providerActionCatalog.length).toBeGreaterThan(0);
    const providerIds = new Set(providerActionCatalog.map((entry) => entry.providerId));
    for (const providerId of CANONICAL_PROVIDER_IDS) {
      expect(providerIds.has(providerId)).toBe(true);
    }
  });

  it("stays in sync with currently implemented tool definitions", () => {
    const implementedTools = allTools
      .filter((tool) => tool.provider !== "keppo")
      .map((tool) => tool.name);
    const implementedActions = providerActionCatalog
      .filter((entry) => entry.implementationStatus === "implemented")
      .map((entry) => entry.toolName);

    expect(implementedActions.sort()).toEqual(implementedTools.sort());
    expect(implementedActions).toHaveLength(implementedTools.length);
  });

  it("defines required outcomes by capability", () => {
    for (const entry of providerActionCatalog) {
      expect(entry.requiredOutcomes).toContain("success");
      expect(entry.requiredOutcomes).toContain("invalid_input");
      expect(entry.requiredOutcomes).toContain("auth_or_scope_error");

      if (entry.capability === "write") {
        expect(entry.requiredOutcomes).toContain("idempotent_replay");
      } else {
        expect(entry.requiredOutcomes).not.toContain("idempotent_replay");
      }
    }
  });

  it("declares lifecycle matrix coverage for oauth/refresh/webhooks", () => {
    expect(providerLifecycleActionMatrix.google.refresh).toBe(true);
    expect(providerLifecycleActionMatrix.stripe.webhook).toBe(true);
    expect(providerLifecycleActionMatrix.github.webhook).toBe(true);
    expect(providerLifecycleActionMatrix.custom.oauth_connect).toBe(false);
  });

  it("passes internal validation checks", () => {
    expect(getProviderActionCatalogValidationErrors()).toEqual([]);
  });
});
