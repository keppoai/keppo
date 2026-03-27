import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./docker.js", () => ({
  DockerSandboxProvider: vi.fn(),
}));
vi.mock("./unikraft.js", () => ({
  UnikraftSandboxProvider: vi.fn(),
}));
vi.mock("../../../../../../../cloud/api/sandbox/vercel.js", () => ({
  VercelSandboxProvider: vi.fn(),
}));

describe("createAutomationSandboxProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("throws when docker provider is used in production", async () => {
    vi.doMock("../env.js", () => ({
      getEnv: () => ({
        NODE_ENV: "production",
        KEPPO_E2E_MODE: false,
        KEPPO_SANDBOX_PROVIDER: "docker",
      }),
    }));

    const { createAutomationSandboxProvider } = await import("./index.js");
    expect(() => createAutomationSandboxProvider("docker")).toThrow(
      "Docker sandbox provider is not allowed in production",
    );
  });

  it("throws when docker provider is used with no NODE_ENV set", async () => {
    vi.doMock("../env.js", () => ({
      getEnv: () => ({
        NODE_ENV: undefined,
        KEPPO_E2E_MODE: false,
        KEPPO_SANDBOX_PROVIDER: "docker",
      }),
    }));

    const { createAutomationSandboxProvider } = await import("./index.js");
    expect(() => createAutomationSandboxProvider("docker")).toThrow(
      "Docker sandbox provider is not allowed in production",
    );
  });

  it("allows docker provider in development", async () => {
    vi.doMock("../env.js", () => ({
      getEnv: () => ({
        NODE_ENV: "development",
        KEPPO_E2E_MODE: false,
        KEPPO_SANDBOX_PROVIDER: "docker",
      }),
    }));

    const { createAutomationSandboxProvider } = await import("./index.js");
    expect(() => createAutomationSandboxProvider("docker")).not.toThrow();
  });

  it("allows docker provider in test", async () => {
    vi.doMock("../env.js", () => ({
      getEnv: () => ({
        NODE_ENV: "test",
        KEPPO_E2E_MODE: false,
        KEPPO_SANDBOX_PROVIDER: "docker",
      }),
    }));

    const { createAutomationSandboxProvider } = await import("./index.js");
    expect(() => createAutomationSandboxProvider("docker")).not.toThrow();
  });

  it("allows docker provider when KEPPO_E2E_MODE is true", async () => {
    vi.doMock("../env.js", () => ({
      getEnv: () => ({
        NODE_ENV: "production",
        KEPPO_E2E_MODE: true,
        KEPPO_SANDBOX_PROVIDER: "docker",
      }),
    }));

    const { createAutomationSandboxProvider } = await import("./index.js");
    expect(() => createAutomationSandboxProvider("docker")).not.toThrow();
  });

  it("allows vercel provider without explicit sandbox credentials", async () => {
    vi.doMock("../env.js", () => ({
      getEnv: () => ({
        NODE_ENV: "production",
        KEPPO_E2E_MODE: false,
        KEPPO_SANDBOX_PROVIDER: "vercel",
        VERCEL_OIDC_TOKEN: undefined,
        VERCEL_TOKEN: undefined,
        VERCEL_TEAM_ID: undefined,
        VERCEL_PROJECT_ID: undefined,
      }),
    }));

    const { createAutomationSandboxProvider } = await import("./index.js");
    expect(() => createAutomationSandboxProvider("vercel")).not.toThrow();
  });

  it("allows unikraft provider in production", async () => {
    vi.doMock("../env.js", () => ({
      getEnv: () => ({
        NODE_ENV: "production",
        KEPPO_E2E_MODE: false,
        KEPPO_SANDBOX_PROVIDER: "unikraft",
        UNIKRAFT_API_TOKEN: "uk_test",
        UNIKRAFT_METRO: "fra0",
      }),
    }));

    const { createAutomationSandboxProvider } = await import("./index.js");
    expect(() => createAutomationSandboxProvider("unikraft")).not.toThrow();
  });

  it("allows unikraft provider in development", async () => {
    vi.doMock("../env.js", () => ({
      getEnv: () => ({
        NODE_ENV: "development",
        KEPPO_E2E_MODE: false,
        KEPPO_SANDBOX_PROVIDER: "unikraft",
        UNIKRAFT_API_TOKEN: "uk_test",
        UNIKRAFT_METRO: "fra0",
      }),
    }));

    const { createAutomationSandboxProvider } = await import("./index.js");
    expect(() => createAutomationSandboxProvider("unikraft")).not.toThrow();
  });
});
