import { describe, expect, it } from "vitest";
import {
  formatIntegrationCredentialExpiry,
  getIntegrationUnhealthyReason,
  isIntegrationCredentialExpired,
  isIntegrationReconnectRequired,
} from "./integration-health";

describe("integration health helpers", () => {
  it("does not treat refreshable expired credentials as expired", () => {
    expect(
      isIntegrationCredentialExpired({
        credentialExpiresAt: "2000-01-01T00:00:00.000Z",
        hasRefreshToken: true,
      }),
    ).toBe(false);

    expect(
      isIntegrationReconnectRequired({
        status: "connected",
        credentialExpiresAt: "2000-01-01T00:00:00.000Z",
        hasRefreshToken: true,
      }),
    ).toBe(false);
  });

  it("keeps expired access tokens with refresh tokens out of unhealthy expiry messaging", () => {
    const isExpired = isIntegrationCredentialExpired({
      credentialExpiresAt: "2000-01-01T00:00:00.000Z",
      hasRefreshToken: true,
    });

    expect(
      getIntegrationUnhealthyReason({
        isExpired,
        degradedReason: null,
        lastErrorCode: null,
        lastErrorCategory: null,
        hasRecentHealthFailure: false,
      }),
    ).toBeNull();
  });

  it("adds an auto-refresh qualifier when a refreshable access token timestamp is already past", () => {
    expect(
      formatIntegrationCredentialExpiry({
        credentialExpiresAt: "2000-01-01T00:00:00.000Z",
        hasRefreshToken: true,
      }),
    ).toBe("2000-01-01T00:00:00.000Z (access token expired, auto-refresh available)");
  });

  it("still requires reconnect when an expired credential has no refresh token", () => {
    expect(
      isIntegrationCredentialExpired({
        credentialExpiresAt: "2000-01-01T00:00:00.000Z",
        hasRefreshToken: false,
      }),
    ).toBe(true);

    expect(
      isIntegrationReconnectRequired({
        status: "connected",
        credentialExpiresAt: "2000-01-01T00:00:00.000Z",
        hasRefreshToken: false,
      }),
    ).toBe(true);
  });
});
