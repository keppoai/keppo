import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BillingPage } from "./billing.lazy";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, renderDashboard } from "@/test/render-dashboard";

describe("BillingPage", () => {
  it("keeps invite promo controls visible when capacity queries fail", async () => {
    renderDashboard(<BillingPage />, {
      route: "/acme/settings/billing",
      auth: createAuthState({
        isAuthenticated: true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
      }),
      runtime: createFakeDashboardRuntime({
        queryHandlers: {
          "billing:getCurrentOrgBilling": () => ({
            org_id: "org_1",
            tier: "free",
            status: "active",
            billing_source: "free",
            invite_promo: null,
            period_start: "2026-03-01T00:00:00.000Z",
            period_end: "2026-04-01T00:00:00.000Z",
            usage: {
              tool_call_count: 0,
              total_tool_call_time_ms: 0,
            },
            limits: {
              price_cents_monthly: 0,
              max_tool_calls_per_month: 7_500,
              max_total_tool_call_time_ms: 7_200_000,
              included_ai_credits: {
                total: 5,
                bundled_runtime_enabled: false,
              },
            },
          }),
          "ai_credits:getAiCreditBalance": () => {
            throw new Error("ai credits timeout");
          },
        },
      }),
    });

    expect(await screen.findByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByTestId("billing-redeem-invite-code-input")).toBeVisible();
    expect(screen.getByText("Capacity details temporarily unavailable")).toBeInTheDocument();
  });
});
