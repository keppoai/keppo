import { afterEach, describe, expect, it, vi } from "vitest";
import { isInternalBearerAuthorized } from "./internal-auth.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isInternalBearerAuthorized", () => {
  it("authorizes a valid bearer token", () => {
    vi.stubEnv("KEPPO_CRON_SECRET", "cron-secret-value");

    expect(
      isInternalBearerAuthorized({
        authorizationHeader: "Bearer cron-secret-value",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects invalid bearer tokens with a length guard", () => {
    vi.stubEnv("KEPPO_CRON_SECRET", "cron-secret-value");

    expect(
      isInternalBearerAuthorized({
        authorizationHeader: "Bearer wrong-secret-value",
      }),
    ).toEqual({ ok: false, reason: "invalid_secret" });
    expect(
      isInternalBearerAuthorized({
        authorizationHeader: "Bearer short",
      }),
    ).toEqual({ ok: false, reason: "invalid_secret" });
  });

  it("fails closed when no internal secret is configured", () => {
    vi.stubEnv("KEPPO_CRON_SECRET", "");
    vi.stubEnv("KEPPO_QUEUE_SECRET", "");
    vi.stubEnv("VERCEL_CRON_SECRET", "");

    expect(
      isInternalBearerAuthorized({
        authorizationHeader: "Bearer anything",
      }),
    ).toEqual({ ok: false, reason: "missing_secret" });
  });
});
