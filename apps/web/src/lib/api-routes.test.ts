import { describe, expect, it } from "vitest";
import { isStartOwnedApiPath } from "./api-routes";

describe("start-owned api paths", () => {
  it("claims Start-routed health endpoints", () => {
    expect(isStartOwnedApiPath("/api/health")).toBe(true);
    expect(isStartOwnedApiPath("/api/health/deep")).toBe(true);
    expect(isStartOwnedApiPath("/api/health/dlq/abc/replay")).toBe(true);
  });

  it("claims the migrated Start-routed app boundary endpoints", () => {
    expect(isStartOwnedApiPath("/api/invites/create")).toBe(true);
    expect(isStartOwnedApiPath("/api/invites/accept")).toBe(true);
    expect(isStartOwnedApiPath("/api/search")).toBe(true);
    expect(isStartOwnedApiPath("/api/billing/checkout")).toBe(true);
    expect(isStartOwnedApiPath("/api/billing/credits/checkout")).toBe(true);
    expect(isStartOwnedApiPath("/api/automations/generate-questions")).toBe(true);
    expect(isStartOwnedApiPath("/api/automations/generate-prompt")).toBe(true);
    expect(isStartOwnedApiPath("/api/automations/openai/connect")).toBe(true);
    expect(isStartOwnedApiPath("/api/automations/openai/complete")).toBe(true);
    expect(isStartOwnedApiPath("/api/automations/openai/callback")).toBe(true);
    expect(isStartOwnedApiPath("/api/mcp/test")).toBe(true);
    expect(isStartOwnedApiPath("/api/oauth/integrations/google/connect")).toBe(true);
    expect(isStartOwnedApiPath("/api/notifications/push/subscribe")).toBe(true);
  });

  it("does not claim non-api app paths", () => {
    expect(isStartOwnedApiPath("/health")).toBe(false);
  });
});
