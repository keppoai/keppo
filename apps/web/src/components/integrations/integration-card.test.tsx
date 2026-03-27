import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntegrationCard } from "./integration-card";

describe("IntegrationCard", () => {
  it("shows the unhealthy reason and diagnostic on degraded integrations", () => {
    render(
      <IntegrationCard
        provider="google"
        integration={{
          id: "integration_1",
          org_id: "org_1",
          provider: "google",
          display_name: "Google",
          status: "degraded",
          connected: true,
          created_at: "2026-03-08T00:00:00.000Z",
          scopes: ["gmail.send"],
          external_account_id: "automation@example.com",
          credential_expires_at: null,
          has_refresh_token: true,
          last_health_check_at: "2026-03-08T00:08:00.000Z",
          last_successful_health_check_at: "2026-03-08T00:05:00.000Z",
          last_error_code: "missing_scopes",
          last_error_category: "auth",
          last_webhook_at: null,
          degraded_reason: null,
          provider_module_version: 1,
          metadata: {},
        }}
        canManage
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onOpen={vi.fn()}
        onTest={vi.fn(async () => ({ ok: true, detail: "ok" }))}
      />,
    );

    expect(
      screen.getByText("Missing required provider scopes. Reconnect with required permissions."),
    ).toBeInTheDocument();
    expect(screen.getByText("Diagnostic: Auth / Missing scopes")).toBeInTheDocument();
  });
});
