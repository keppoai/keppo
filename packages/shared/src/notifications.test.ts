import { describe, expect, it } from "vitest";
import {
  buildNotificationPayload,
  getDefaultChannels,
  NOTIFICATION_EVENTS,
} from "./notifications.js";

describe("notifications", () => {
  it("builds templated payloads", () => {
    const payload = buildNotificationPayload("approval_needed", {
      orgId: "org_123",
      orgName: "Acme",
      workspaceName: "Payments",
      toolName: "stripe.refund",
      riskLevel: "high",
      metadata: {
        actionId: "act_123",
      },
    });

    expect(payload.title).toBe(NOTIFICATION_EVENTS.approval_needed.title);
    expect(payload.body).toContain("stripe.refund");
    expect(payload.body).toContain("Payments");
    expect(payload.body).toContain("high");
    expect(payload.ctaUrl).toBe("/approvals");
    expect(payload.metadata.actionId).toBe("act_123");
  });

  it("allows explicit title/body overrides", () => {
    const payload = buildNotificationPayload("tool_call_limit_warning", {
      orgId: "org_123",
      orgName: "Acme",
      title: "Custom Title",
      body: "Custom Body",
      ctaLabel: "Custom CTA",
      ctaUrl: "/custom",
    });

    expect(payload.title).toBe("Custom Title");
    expect(payload.body).toBe("Custom Body");
    expect(payload.ctaLabel).toBe("Custom CTA");
    expect(payload.ctaUrl).toBe("/custom");
  });

  it("returns event default channels", () => {
    expect(getDefaultChannels("approval_needed")).toEqual(["email", "push", "in_app"]);
    expect(getDefaultChannels("subscription_downgraded")).toEqual(["email", "in_app"]);
    expect(getDefaultChannels("automation_run_limit_reached")).toEqual(["in_app"]);
  });
});
