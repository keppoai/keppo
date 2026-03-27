import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildHostedConvexEnvValues } from "../../scripts/hosted-convex-env.mjs";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("scripts/hosted-convex-env.mjs", () => {
  it("lets deployment env override staging file values and propagate deployment-only secrets", () => {
    const dir = mkdtempSync(join(tmpdir(), "hosted-convex-env-"));
    cleanupPaths.push(dir);
    const envFile = join(dir, ".env.staging");
    writeFileSync(
      envFile,
      [
        "KEPPO_URL=https://staging-file.keppo.ai",
        "KEPPO_API_INTERNAL_BASE_URL=https://staging-file.keppo.ai/api",
      ].join("\n"),
    );

    const values = buildHostedConvexEnvValues({
      mode: "staging",
      envFile,
      env: {
        KEPPO_URL: "https://staging-runtime.keppo.ai",
        VERCEL_AUTOMATION_BYPASS_SECRET: "bypass_secret_test",
      },
    });

    expect(values.KEPPO_URL).toBe("https://staging-runtime.keppo.ai");
    expect(values.KEPPO_API_INTERNAL_BASE_URL).toBe("https://staging-file.keppo.ai/api");
    expect(values.VERCEL_AUTOMATION_BYPASS_SECRET).toBe("bypass_secret_test");
  });

  it("derives hosted URLs from deployment env when staging file leaves them unset", () => {
    const dir = mkdtempSync(join(tmpdir(), "hosted-convex-env-"));
    cleanupPaths.push(dir);
    const envFile = join(dir, ".env.staging");
    writeFileSync(envFile, "ALLOWED_EMAIL_DOMAINS=example.com\n");

    const values = buildHostedConvexEnvValues({
      mode: "staging",
      envFile,
      env: {
        VERCEL_URL: "staging-runtime.keppo.ai",
        VERCEL_AUTOMATION_BYPASS_SECRET: "bypass_secret_test",
      },
    });

    expect(values.KEPPO_DASHBOARD_ORIGIN).toBe("https://staging-runtime.keppo.ai");
    expect(values.KEPPO_URL).toBe("https://staging-runtime.keppo.ai");
    expect(values.KEPPO_API_INTERNAL_BASE_URL).toBe("https://staging-runtime.keppo.ai/api");
    expect(values.VERCEL_AUTOMATION_BYPASS_SECRET).toBe("bypass_secret_test");
  });

  it("derives preview origin values while preserving Convex-provided URLs", () => {
    const values = buildHostedConvexEnvValues({
      mode: "preview",
      envFile: "",
      env: {
        CONVEX_URL: "https://careful-otter-123.convex.cloud",
        CONVEX_SITE_URL: "https://careful-otter-123.convex.site",
        VERCEL_BRANCH_URL: "feature-branch-keppo.vercel.app",
      },
    });

    expect(values.CONVEX_URL).toBe("https://careful-otter-123.convex.cloud");
    expect(values.CONVEX_SITE_URL).toBe("https://careful-otter-123.convex.site");
    expect(values.KEPPO_URL).toBe("https://feature-branch-keppo.vercel.app");
    expect(values.KEPPO_API_INTERNAL_BASE_URL).toBe("https://feature-branch-keppo.vercel.app/api");
    expect(values.BETTER_AUTH_TRUSTED_ORIGINS).toBe("https://feature-branch-keppo.vercel.app");
    expect(values.ENABLE_EMAIL_PASSWORD).toBe("true");
  });

  it("preserves hosted provider runtime secrets alongside managed keys", () => {
    const values = buildHostedConvexEnvValues({
      mode: "staging",
      envFile: "",
      env: {
        KEPPO_URL: "https://staging-runtime.keppo.ai",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
        STRIPE_SECRET_KEY: "stripe-secret",
      },
    });

    expect(values.KEPPO_URL).toBe("https://staging-runtime.keppo.ai");
    expect(values.GOOGLE_CLIENT_ID).toBe("google-client-id");
    expect(values.GOOGLE_CLIENT_SECRET).toBe("google-client-secret");
    expect(values.STRIPE_SECRET_KEY).toBe("stripe-secret");
  });
});
