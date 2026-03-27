import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sandbox-docker.js", () => ({
  DockerSandbox: vi.fn(),
}));
vi.mock("./sandbox-unikraft.js", () => ({
  UnikraftSandbox: vi.fn(),
}));
vi.mock("./sandbox-vercel.js", () => ({
  VercelSandbox: vi.fn(),
}));
vi.mock("../unikraft/client.js", () => ({
  UnikraftCloudClient: vi.fn(),
}));

describe("createSandboxProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws when docker provider is used in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.KEPPO_E2E_MODE;

    const { createSandboxProvider } = await import("./sandbox.js");
    await expect(createSandboxProvider("docker")).rejects.toThrow(
      "Docker sandbox provider is not allowed in production",
    );
  });

  it("throws when docker provider is used with no NODE_ENV", async () => {
    delete process.env.NODE_ENV;
    delete process.env.KEPPO_E2E_MODE;

    const { createSandboxProvider } = await import("./sandbox.js");
    await expect(createSandboxProvider("docker")).rejects.toThrow(
      "Docker sandbox provider is not allowed in production",
    );
  });

  it("allows docker provider in development", async () => {
    process.env.NODE_ENV = "development";

    const { createSandboxProvider } = await import("./sandbox.js");
    await expect(createSandboxProvider("docker")).resolves.toBeDefined();
  });

  it("allows docker provider in test", async () => {
    process.env.NODE_ENV = "test";

    const { createSandboxProvider } = await import("./sandbox.js");
    await expect(createSandboxProvider("docker")).resolves.toBeDefined();
  });

  it("allows docker provider when KEPPO_E2E_MODE is true", async () => {
    process.env.NODE_ENV = "production";
    process.env.KEPPO_E2E_MODE = "true";

    const { createSandboxProvider } = await import("./sandbox.js");
    await expect(createSandboxProvider("docker")).resolves.toBeDefined();
  });

  it("allows vercel provider in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.KEPPO_E2E_MODE;

    const { createSandboxProvider } = await import("./sandbox.js");
    await expect(createSandboxProvider("vercel")).resolves.toBeDefined();
  });

  it("allows unikraft provider in production when credentials are set", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["UNIKRAFT_API_TOKEN"] = "uk_test";
    process.env["UNIKRAFT_METRO"] = "fra0";
    delete process.env["KEPPO_E2E_MODE"];

    const { createSandboxProvider } = await import("./sandbox.js");
    await expect(createSandboxProvider("unikraft")).resolves.toBeDefined();
  });

  it("allows unikraft provider in development", async () => {
    process.env["NODE_ENV"] = "development";
    process.env["UNIKRAFT_API_TOKEN"] = "uk_test";
    process.env["UNIKRAFT_METRO"] = "fra0";

    const { createSandboxProvider } = await import("./sandbox.js");
    await expect(createSandboxProvider("unikraft")).resolves.toBeDefined();
  });

  it("requires unikraft credentials when unikraft provider is selected", async () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["UNIKRAFT_API_TOKEN"];
    delete process.env["UNIKRAFT_METRO"];

    const { createSandboxProvider } = await import("./sandbox.js");
    await expect(createSandboxProvider("unikraft")).rejects.toThrow(
      "Unikraft sandbox provider requires UNIKRAFT_API_TOKEN and UNIKRAFT_METRO.",
    );
  });
});
