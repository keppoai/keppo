import { describe, expect, it } from "vitest";
import { resolveTrustedOriginForRuntime } from "../../convex/auth";
import { resolveAuthClientBaseUrl } from "../../apps/web/src/lib/auth-client";

describe("auth runtime configuration", () => {
  it("fails closed when non-local runtimes omit KEPPO_URL", () => {
    expect(() =>
      resolveTrustedOriginForRuntime({
        NODE_ENV: "production",
        CONVEX_DEPLOYMENT: "prod:keppo",
      } as NodeJS.ProcessEnv),
    ).toThrow("Missing KEPPO_URL");
  });

  it("keeps the localhost fallback for local runtimes without KEPPO_URL", () => {
    expect(
      resolveTrustedOriginForRuntime({
        NODE_ENV: "test",
      } as NodeJS.ProcessEnv),
    ).toBe("http://localhost:3000");
  });

  it("allows an analysis-only placeholder when explicitly requested", () => {
    expect(
      resolveTrustedOriginForRuntime(
        {
          NODE_ENV: "production",
          CONVEX_DEPLOYMENT: "prod:keppo",
        } as NodeJS.ProcessEnv,
        { allowAnalysisPlaceholder: true },
      ),
    ).toBe("https://convex-analysis.invalid");
  });

  it("falls back to the same-origin auth path when the SSR env mirror is unavailable", () => {
    expect(resolveAuthClientBaseUrl()).toBeUndefined();
  });
});
