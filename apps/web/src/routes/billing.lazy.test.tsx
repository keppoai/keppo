import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BillingPage } from "./billing.lazy";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, renderDashboard } from "@/test/render-dashboard";

vi.mock("@/lib/server-functions/internal-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server-functions/internal-api")>(
    "@/lib/server-functions/internal-api",
  );
  return {
    ...actual,
    getBillingSubscriptionPending: vi.fn(async () => ({
      cancel_at_period_end: true,
      pending_tier: null,
      pending_effective_at: "2026-04-01T00:00:00.000Z",
    })),
  };
});

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
                reset_period: "one_time",
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

  it.each([
    ["viewer", "viewer@example.com"],
    ["approver", "approver@example.com"],
  ] as const)("hides billing management controls for %s members", async (role, email) => {
    renderDashboard(<BillingPage />, {
      route: "/acme/settings/billing",
      auth: createAuthState({
        isAuthenticated: true,
        session: {
          authenticated: true,
          user: {
            id: `user_${role}`,
            email,
            name: `${role} User`,
          },
          organizationId: "org_1",
          orgSlug: "acme",
          role,
        },
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
        getRole: () => role,
        canManage: () => false,
      }),
      runtime: createFakeDashboardRuntime({
        queryHandlers: {
          "billing:getCurrentOrgBilling": () => ({
            org_id: "org_1",
            tier: "starter",
            status: "active",
            billing_source: "stripe",
            invite_promo: null,
            period_start: "2026-03-01T00:00:00.000Z",
            period_end: "2026-04-01T00:00:00.000Z",
            usage: {
              tool_call_count: 10,
              total_tool_call_time_ms: 1200,
            },
            limits: {
              price_cents_monthly: 4900,
              max_tool_calls_per_month: 75_000,
              max_total_tool_call_time_ms: 72_000_000,
              included_ai_credits: {
                total: 100,
                bundled_runtime_enabled: true,
                reset_period: "monthly",
              },
            },
          }),
          "ai_credits:getAiCreditBalance": () => ({
            allowance_total: 100,
            allowance_used: 10,
            purchased_remaining: 0,
            total_available: 90,
          }),
          "automation_runs:getCurrentOrgAutomationRunUsage": () => ({
            run_count: 3,
            max_runs_per_period: 25,
          }),
          "automation_run_topups:getAutomationRunTopupBalance": () => ({
            purchased_runs_balance: 0,
          }),
        },
      }),
    });

    expect(await screen.findByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByTestId("billing-management-note")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("billing-management-note")).toHaveTextContent(
      "Billing is managed by organization owners and admins. Ask them to handle plan changes, checkout, top-ups, or billing portal access.",
    );
    expect(screen.queryByTestId("billing-change-plan")).not.toBeInTheDocument();
    expect(screen.queryByTestId("billing-manage-subscription")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buy 100 credits ($10)" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("billing-undo-cancel")).not.toBeInTheDocument();
    expect(screen.getByTestId("billing-undo-cancel-note")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("billing-undo-cancel-note")).toHaveTextContent(
      "Ask an owner or admin to keep this subscription active.",
    );
    expect(screen.getByTestId("billing-topups-note")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("billing-topups-note")).toHaveTextContent(
      "Ask an owner or admin to purchase AI credit packs for this organization.",
    );
    expect(screen.getByTestId("billing-automation-topups-note")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("billing-automation-topups-note")).toHaveTextContent(
      "Ask an owner or admin to purchase automation run top-ups for this organization.",
    );
    expect(screen.getByTestId("billing-plan-card-free")).toHaveTextContent(
      "Ask an owner or admin to change plans.",
    );
    expect(screen.getByTestId("billing-plan-card-pro")).toHaveTextContent(
      "Ask an owner or admin to change plans.",
    );
  });

  it("shows current paid-plan management on the active card and hides a free-tier cancel action", async () => {
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
            tier: "starter",
            status: "active",
            billing_source: "stripe",
            invite_promo: null,
            period_start: "2026-03-01T00:00:00.000Z",
            period_end: "2026-04-01T00:00:00.000Z",
            usage: {
              tool_call_count: 10,
              total_tool_call_time_ms: 1200,
            },
            limits: {
              price_cents_monthly: 2500,
              max_tool_calls_per_month: 75_000,
              max_total_tool_call_time_ms: 72_000_000,
              included_ai_credits: {
                total: 100,
                bundled_runtime_enabled: true,
                reset_period: "monthly",
              },
            },
          }),
          "ai_credits:getAiCreditBalance": () => ({
            allowance_total: 100,
            allowance_used: 10,
            purchased_remaining: 0,
            total_available: 90,
          }),
          "automation_runs:getCurrentOrgAutomationRunUsage": () => ({
            run_count: 3,
            max_runs_per_period: 25,
          }),
          "automation_run_topups:getAutomationRunTopupBalance": () => ({
            purchased_runs_balance: 0,
          }),
        },
      }),
    });

    expect(await screen.findByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByTestId("billing-plan-card-starter")).toHaveTextContent("Current");
    expect(screen.getByTestId("billing-manage-subscription")).toBeVisible();
    expect(screen.getByTestId("billing-change-plan")).toHaveTextContent("Upgrade to Pro");
    expect(screen.getByTestId("billing-plan-card-free")).toHaveTextContent(
      "No subscription to manage on the free trial.",
    );
  });

  it("keeps plan cards in a multi-column grid from medium screens upward", async () => {
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
                reset_period: "one_time",
              },
            },
          }),
          "ai_credits:getAiCreditBalance": () => ({
            allowance_total: 5,
            allowance_used: 0,
            purchased_remaining: 0,
            total_available: 5,
          }),
          "automation_runs:getCurrentOrgAutomationRunUsage": () => ({
            run_count: 0,
            max_runs_per_period: 0,
          }),
          "automation_run_topups:getAutomationRunTopupBalance": () => ({
            purchased_runs_balance: 0,
          }),
        },
      }),
    });

    expect(await screen.findByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByTestId("billing-plan-card-grid")).toHaveClass("md:grid-cols-3");
  });

  it("lets pro orgs downgrade from the starter card", async () => {
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
            tier: "pro",
            status: "active",
            billing_source: "stripe",
            invite_promo: null,
            period_start: "2026-03-01T00:00:00.000Z",
            period_end: "2026-04-01T00:00:00.000Z",
            usage: {
              tool_call_count: 10,
              total_tool_call_time_ms: 1200,
            },
            limits: {
              price_cents_monthly: 7500,
              max_tool_calls_per_month: 750_000,
              max_total_tool_call_time_ms: 72_000_000,
              included_ai_credits: {
                total: 300,
                bundled_runtime_enabled: true,
                reset_period: "monthly",
              },
            },
          }),
          "ai_credits:getAiCreditBalance": () => ({
            allowance_total: 300,
            allowance_used: 10,
            purchased_remaining: 0,
            total_available: 290,
          }),
          "automation_runs:getCurrentOrgAutomationRunUsage": () => ({
            run_count: 3,
            max_runs_per_period: 25,
          }),
          "automation_run_topups:getAutomationRunTopupBalance": () => ({
            purchased_runs_balance: 0,
          }),
        },
      }),
    });

    expect(await screen.findByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByTestId("billing-plan-card-pro")).toHaveTextContent("Current");
    expect(screen.getByTestId("billing-change-plan")).toHaveTextContent("Downgrade to Starter");
    expect(screen.queryByTestId("billing-upgrade-pro")).not.toBeInTheDocument();
  });
});
