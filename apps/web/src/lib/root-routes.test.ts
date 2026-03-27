import { describe, expect, it } from "vitest";
import { isFailClosedRootPath, isStartOwnedRootPath } from "./root-routes";

describe("start-owned root routes", () => {
  it("claims migrated Start-owned root operational paths", () => {
    expect(isStartOwnedRootPath("/billing/checkout")).toBe(true);
    expect(isStartOwnedRootPath("/billing/extra-usage")).toBe(true);
    expect(isStartOwnedRootPath("/mcp/ws_test")).toBe(true);
    expect(isStartOwnedRootPath("/oauth/integrations/google/callback")).toBe(true);
    expect(isStartOwnedRootPath("/webhooks/stripe")).toBe(true);
    expect(isStartOwnedRootPath("/downloads/oauth-helper/macos/latest")).toBe(true);
    expect(isStartOwnedRootPath("/internal/automations/dispatch")).toBe(true);
    expect(isStartOwnedRootPath("/internal/automations/log")).toBe(true);
    expect(isStartOwnedRootPath("/internal/cron/maintenance")).toBe(true);
    expect(isStartOwnedRootPath("/internal/health/deep")).toBe(true);
    expect(isStartOwnedRootPath("/internal/notifications/deliver")).toBe(true);
    expect(isStartOwnedRootPath("/internal/dlq")).toBe(true);
    expect(isStartOwnedRootPath("/internal/dlq/dlq_123/replay")).toBe(true);
    expect(isStartOwnedRootPath("/internal/queue/dispatch-approved-action")).toBe(true);
  });

  it("fails closed for unowned root protocol paths", () => {
    expect(isFailClosedRootPath("/billing/unknown-surface")).toBe(true);
    expect(isFailClosedRootPath("/downloads/other-artifact")).toBe(true);
    expect(isFailClosedRootPath("/internal/unknown-hook")).toBe(true);
    expect(isFailClosedRootPath("/mcp")).toBe(true);
    expect(isFailClosedRootPath("/oauth/unknown-callback")).toBe(true);
  });

  it("does not fail closed Start-owned root paths", () => {
    expect(isFailClosedRootPath("/billing/checkout")).toBe(false);
    expect(isFailClosedRootPath("/mcp/ws_test")).toBe(false);
    expect(isFailClosedRootPath("/oauth/integrations/google/callback")).toBe(false);
    expect(isFailClosedRootPath("/downloads/oauth-helper/windows/latest")).toBe(false);
    expect(isFailClosedRootPath("/internal/automations/terminate")).toBe(false);
    expect(isFailClosedRootPath("/internal/cron/maintenance")).toBe(false);
    expect(isFailClosedRootPath("/internal/health/deep")).toBe(false);
    expect(isFailClosedRootPath("/internal/notifications/deliver")).toBe(false);
    expect(isFailClosedRootPath("/internal/dlq")).toBe(false);
    expect(isFailClosedRootPath("/webhooks/stripe")).toBe(false);
  });
});
