import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConvexTestHarness } from "./harness";

const refs = {
  getAccess: makeFunctionReference<"query">("admin:getAccess"),
  listFeatureFlags: makeFunctionReference<"query">("admin:listFeatureFlags"),
};

describe("admin local dev access", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires explicit local admin bypass before local runtimes can access admin routes", async () => {
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:keppo");
    vi.stubEnv("KEPPO_URL", "http://localhost:3000");
    delete process.env.KEPPO_ADMIN_USER_IDS;

    const t = createConvexTestHarness().withIdentity({
      subject: "user_local_dev",
      email: "local-dev@example.com",
      name: "Local Dev",
      activeOrganizationId: "org_local_dev",
    });

    await expect(t.query(refs.getAccess, {})).resolves.toEqual({
      canAccessAdminPage: false,
      canAccessAdminHealth: false,
      isPlatformAdmin: false,
    });
    await expect(t.query(refs.listFeatureFlags, {})).rejects.toThrow("Forbidden");
  });

  it("allows local admin bypass on local runtimes when explicitly enabled", async () => {
    vi.stubEnv("KEPPO_LOCAL_ADMIN_BYPASS", "true");
    vi.stubEnv("CONVEX_DEPLOYMENT", "local:keppo");
    delete process.env.KEPPO_ADMIN_USER_IDS;

    const t = createConvexTestHarness();

    await expect(t.query(refs.getAccess, {})).resolves.toEqual({
      canAccessAdminPage: true,
      canAccessAdminHealth: true,
      isPlatformAdmin: false,
    });
    await expect(t.query(refs.listFeatureFlags, {})).resolves.toEqual([]);
  });

  it("allows explicit local admin bypass from loopback convex runtime URLs", async () => {
    vi.stubEnv("KEPPO_LOCAL_ADMIN_BYPASS", "true");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
    delete process.env.KEPPO_ADMIN_USER_IDS;

    const t = createConvexTestHarness();

    await expect(t.query(refs.getAccess, {})).resolves.toEqual({
      canAccessAdminPage: true,
      canAccessAdminHealth: true,
      isPlatformAdmin: false,
    });
    await expect(t.query(refs.listFeatureFlags, {})).resolves.toEqual([]);
  });

  it("fails closed when the explicit local admin bypass is enabled outside local runtime signals", async () => {
    vi.stubEnv("KEPPO_LOCAL_ADMIN_BYPASS", "true");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CONVEX_DEPLOYMENT", "prod:keppo");
    vi.stubEnv("CONVEX_SITE_URL", "https://keppo.example.com");
    delete process.env.KEPPO_ADMIN_USER_IDS;

    const t = createConvexTestHarness().withIdentity({
      subject: "user_prod_bypass",
      email: "prod-bypass@example.com",
      name: "Prod Bypass",
      activeOrganizationId: "org_prod_bypass",
    });

    await expect(t.query(refs.getAccess, {})).resolves.toEqual({
      canAccessAdminPage: false,
      canAccessAdminHealth: false,
      isPlatformAdmin: false,
    });
    await expect(t.query(refs.listFeatureFlags, {})).rejects.toThrow("Forbidden");
  });

  it("keeps admin access closed outside local development unless the user is a platform admin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CONVEX_DEPLOYMENT", "prod");
    vi.stubEnv("KEPPO_URL", "https://keppo.example.com");
    delete process.env.KEPPO_ADMIN_USER_IDS;

    const t = createConvexTestHarness().withIdentity({
      subject: "user_prod",
      email: "prod@example.com",
      name: "Prod User",
      activeOrganizationId: "org_prod",
    });

    await expect(t.query(refs.getAccess, {})).resolves.toEqual({
      canAccessAdminPage: false,
      canAccessAdminHealth: false,
      isPlatformAdmin: false,
    });
    await expect(t.query(refs.listFeatureFlags, {})).rejects.toThrow("Forbidden");
  });

  it("preserves platform-admin access when KEPPO_ADMIN_USER_IDS includes the current user", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CONVEX_DEPLOYMENT", "prod");
    vi.stubEnv("KEPPO_URL", "https://keppo.example.com");
    vi.stubEnv("KEPPO_ADMIN_USER_IDS", "user_platform_admin");

    const t = createConvexTestHarness().withIdentity({
      subject: "user_platform_admin",
      email: "admin@example.com",
      name: "Platform Admin",
      activeOrganizationId: "org_prod",
    });

    await expect(t.query(refs.getAccess, {})).resolves.toEqual({
      canAccessAdminPage: true,
      canAccessAdminHealth: true,
      isPlatformAdmin: true,
    });
    await expect(t.query(refs.listFeatureFlags, {})).resolves.toEqual([]);
  });
});
