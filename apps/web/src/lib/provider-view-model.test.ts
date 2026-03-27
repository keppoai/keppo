import { describe, expect, it } from "vitest";
import {
  getActionStatusView,
  getProviderCatalogEntry,
  getProviderDeprecation,
  getProviderWriteTools,
  isWorkspaceProviderEnabled,
  listProviderDeprecations,
  resolveIntegrationProviderRoute,
} from "./provider-view-model";
import type { ProviderCatalogEntry, WorkspaceIntegration } from "./types";

const providerCatalogFixture: ProviderCatalogEntry[] = [
  {
    provider: "google",
    supported_tools: [
      {
        name: "gmail.listUnread",
        capability: "read",
        risk_level: "low",
        requires_approval: false,
      },
      {
        name: "gmail.sendEmail",
        capability: "write",
        risk_level: "high",
        requires_approval: true,
      },
    ],
  },
  {
    provider: "stripe",
    supported_tools: [
      {
        name: "stripe.lookupCustomer",
        capability: "read",
        risk_level: "low",
        requires_approval: false,
      },
      {
        name: "stripe.issueRefund",
        capability: "write",
        risk_level: "critical",
        requires_approval: true,
      },
    ],
    deprecation: {
      status: "deprecated",
      message: "Stripe v1 module is deprecated.",
      replacement_provider: "stripe",
    },
  },
];

describe("provider view-model helpers", () => {
  it("resolves canonical route providers", () => {
    const result = resolveIntegrationProviderRoute("google", ["google", "stripe"]);
    expect(result).toEqual({
      status: "canonical",
      providerId: "google",
    });
  });

  it("flags alias route providers as non-canonical", () => {
    const result = resolveIntegrationProviderRoute("gmail", ["google", "stripe"]);
    expect(result).toEqual({
      status: "non_canonical",
      input: "gmail",
      canonicalProviderId: "google",
    });
  });

  it("rejects unknown route providers", () => {
    const result = resolveIntegrationProviderRoute("unknown", ["google", "stripe"]);
    expect(result).toEqual({
      status: "unknown",
      input: "unknown",
    });
  });

  it("returns only write-capable tools", () => {
    const catalogEntry = getProviderCatalogEntry(providerCatalogFixture, "google");
    expect(getProviderWriteTools(catalogEntry).map((tool) => tool.name)).toEqual([
      "gmail.sendEmail",
    ]);
  });

  it("returns provider deprecation details when present", () => {
    const catalogEntry = getProviderCatalogEntry(providerCatalogFixture, "stripe");
    expect(getProviderDeprecation(catalogEntry)).toEqual({
      provider: "stripe",
      status: "deprecated",
      message: "Stripe v1 module is deprecated.",
      replacementProvider: "stripe",
    });
  });

  it("lists all deprecated providers from catalog", () => {
    expect(listProviderDeprecations(providerCatalogFixture).map((entry) => entry.provider)).toEqual(
      ["stripe"],
    );
  });

  it("treats provider as enabled when workspace integration allowlist is empty", () => {
    expect(isWorkspaceProviderEnabled([], "google")).toBe(true);
  });

  it("enforces explicit workspace integration enablement", () => {
    const workspaceIntegrations: WorkspaceIntegration[] = [
      {
        id: "wsi_1",
        workspace_id: "ws_1",
        provider: "google",
        enabled: false,
        created_by: "usr_1",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "wsi_2",
        workspace_id: "ws_1",
        provider: "stripe",
        enabled: true,
        created_by: "usr_1",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(isWorkspaceProviderEnabled(workspaceIntegrations, "google")).toBe(false);
    expect(isWorkspaceProviderEnabled(workspaceIntegrations, "stripe")).toBe(true);
  });

  it("maps action statuses with explicit UI labels and badge variants", () => {
    expect(getActionStatusView("pending")).toEqual({
      label: "pending approval",
      badgeVariant: "secondary",
    });
    expect(getActionStatusView("succeeded")).toEqual({
      label: "succeeded",
      badgeVariant: "secondary",
    });
    expect(getActionStatusView("failed")).toEqual({
      label: "failed",
      badgeVariant: "destructive",
    });
  });
});
