import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRunnerCommand } from "../routes/automations";
import { buildSandboxRunnerContract } from "./agents-sdk-runner.js";
import { FlyMachinesHttpClient, FlyMachinesSandboxProvider } from "./fly.js";
import { resetApiRuntimeEnvForTest } from "../runtime-env.js";

const baseConfig = {
  bootstrap: {
    command: "true",
    env: {
      KEPPO_BOOTSTRAP_TOKEN: "bootstrap-secret",
    },
    network_access: "package_registry_only" as const,
  },
  runtime: {
    bootstrap_command: "true",
    command: buildRunnerCommand({
      runnerType: "chatgpt_codex",
      providerMode: "fly",
      aiModelProvider: "openai",
    }),
    env: {
      OPENAI_API_KEY: "secret",
      KEPPO_MCP_BEARER_TOKEN: "mcp-secret",
      KEPPO_MCP_SERVER_URL: "https://api.keppo.ai/mcp/ws_test",
    },
    network_access: "mcp_only" as const,
    callbacks: {
      log_url:
        "https://api.keppo.ai/internal/automations/log?automation_run_id=arun_test&expires=1&signature=abc",
      complete_url:
        "https://api.keppo.ai/internal/automations/complete?automation_run_id=arun_test&expires=1&signature=abc",
      trace_url:
        "https://api.keppo.ai/internal/automations/trace?automation_run_id=arun_test&expires=1&signature=abc",
    },
    runner: buildSandboxRunnerContract("fly"),
  },
  timeout_ms: 120_000,
};

describe("FlyMachinesSandboxProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetApiRuntimeEnvForTest();
  });

  it("creates the app when it is missing and launches an auto-destroy machine", async () => {
    vi.stubEnv("KEPPO_FLY_ALLOW_UNENFORCED_MCP_ONLY", "true");
    resetApiRuntimeEnvForTest();
    const client = {
      getApp: vi.fn().mockResolvedValue(null),
      createApp: vi.fn().mockResolvedValue(undefined),
      createMachine: vi.fn().mockResolvedValue({
        id: "machine_123",
        state: "started",
      }),
      waitForMachineStarted: vi.fn().mockResolvedValue({
        id: "machine_123",
        state: "started",
      }),
      deleteMachine: vi.fn().mockResolvedValue(undefined),
    };

    const provider = new FlyMachinesSandboxProvider(client, {
      apiHostname: "https://api.machines.dev",
      appName: "keppo-automation-sandbox",
      automationImage: "registry-1.docker.io/library/node:22-bookworm",
      cpuKind: "shared",
      cpus: 1,
      memoryMb: 1024,
      orgSlug: "personal",
      region: "iad",
      timeoutGraceMs: 5_000,
    });

    await expect(provider.dispatch(baseConfig)).resolves.toEqual({
      sandbox_id: "keppo-automation-sandbox::machine_123",
    });

    expect(client.getApp).toHaveBeenCalledWith("keppo-automation-sandbox");
    expect(client.createApp).toHaveBeenCalledWith({
      app_name: "keppo-automation-sandbox",
      org_slug: "personal",
    });
    expect(client.createMachine).toHaveBeenCalledWith(
      "keppo-automation-sandbox",
      expect.objectContaining({
        name: "keppo-arun-test",
        region: "iad",
        skip_service_registration: true,
        config: expect.objectContaining({
          auto_destroy: true,
          image: "registry-1.docker.io/library/node:22-bookworm",
          init: {
            exec: ["node", "/sandbox/keppo-automation-runner-wrapper.mjs"],
          },
          restart: {
            policy: "no",
          },
          guest: {
            cpu_kind: "shared",
            cpus: 1,
            memory_mb: 1024,
          },
          metadata: {
            automation_run_id: "arun_test",
            keppo_network_access: "mcp_only",
            keppo_sandbox_provider: "fly",
          },
          env: expect.objectContaining({
            OPENAI_API_KEY: "secret",
            KEPPO_BOOTSTRAP_TOKEN: "bootstrap-secret",
            KEPPO_MCP_BEARER_TOKEN: "mcp-secret",
            KEPPO_LOG_CALLBACK_URL: baseConfig.runtime.callbacks.log_url,
            KEPPO_COMPLETE_CALLBACK_URL: baseConfig.runtime.callbacks.complete_url,
            KEPPO_TRACE_CALLBACK_URL: baseConfig.runtime.callbacks.trace_url,
            KEPPO_AUTOMATION_RUN_ID: "arun_test",
            KEPPO_RUNNER_COMMAND: baseConfig.runtime.command,
            KEPPO_RUNNER_ENTRYPOINT_PATH:
              "/sandbox/.keppo-automation-runner/keppo-automation-runner.mjs",
            KEPPO_RUNNER_PACKAGES_JSON: JSON.stringify(["@openai/agents@0.8.2"]),
          }),
        }),
      }),
    );
    expect(client.waitForMachineStarted).toHaveBeenCalledWith(
      "keppo-automation-sandbox",
      "machine_123",
    );

    const files = client.createMachine.mock.calls[0]?.[1]?.config.files;
    expect(files).toHaveLength(2);
    expect(files?.[0]?.guest_path).toBe("/sandbox/keppo-automation-runner-wrapper.mjs");
    expect(Buffer.from(files?.[0]?.raw_value ?? "", "base64").toString("utf8")).toContain(
      "KEPPO_RUNNER_PACKAGES_JSON",
    );
    expect(Buffer.from(files?.[1]?.raw_value ?? "", "base64").toString("utf8")).toContain(
      'from "@openai/agents"',
    );
  });

  it("reuses an existing Fly app without attempting to recreate it", async () => {
    vi.stubEnv("KEPPO_FLY_ALLOW_UNENFORCED_MCP_ONLY", "true");
    resetApiRuntimeEnvForTest();
    const client = {
      getApp: vi
        .fn()
        .mockResolvedValue({ id: "app_123", name: "keppo-automation-sandbox-existing" }),
      createApp: vi.fn().mockResolvedValue(undefined),
      createMachine: vi.fn().mockResolvedValue({
        id: "machine_123",
      }),
      waitForMachineStarted: vi.fn().mockResolvedValue({
        id: "machine_123",
        state: "started",
      }),
      deleteMachine: vi.fn().mockResolvedValue(undefined),
    };

    const provider = new FlyMachinesSandboxProvider(client, {
      apiHostname: "https://api.machines.dev",
      appName: "keppo-automation-sandbox-existing",
      automationImage: "registry-1.docker.io/library/node:22-bookworm",
      cpuKind: "shared",
      cpus: 1,
      memoryMb: 1024,
      orgSlug: "personal",
      timeoutGraceMs: 5_000,
    });

    await provider.dispatch(baseConfig);
    await provider.dispatch(baseConfig);

    expect(client.createApp).not.toHaveBeenCalled();
    expect(client.getApp).toHaveBeenCalledTimes(1);
  });

  it("treats app-create conflicts as successful races", async () => {
    vi.stubEnv("KEPPO_FLY_ALLOW_UNENFORCED_MCP_ONLY", "true");
    resetApiRuntimeEnvForTest();
    const client = {
      getApp: vi.fn().mockResolvedValue(null),
      createApp: vi.fn().mockRejectedValue(Object.assign(new Error("conflict"), { status: 409 })),
      createMachine: vi.fn().mockResolvedValue({
        id: "machine_123",
      }),
      waitForMachineStarted: vi.fn().mockResolvedValue({
        id: "machine_123",
        state: "started",
      }),
      deleteMachine: vi.fn().mockResolvedValue(undefined),
    };

    const provider = new FlyMachinesSandboxProvider(client, {
      apiHostname: "https://api.machines.dev",
      appName: "keppo-automation-sandbox",
      automationImage: "registry-1.docker.io/library/node:22-bookworm",
      cpuKind: "shared",
      cpus: 1,
      memoryMb: 1024,
      orgSlug: "personal",
      timeoutGraceMs: 5_000,
    });

    await expect(provider.dispatch(baseConfig)).resolves.toEqual({
      sandbox_id: "keppo-automation-sandbox::machine_123",
    });
  });

  it("force-deletes the machine on terminate", async () => {
    const client = {
      getApp: vi.fn(),
      createApp: vi.fn(),
      createMachine: vi.fn(),
      waitForMachineStarted: vi.fn(),
      deleteMachine: vi.fn().mockResolvedValue(undefined),
    };

    const provider = new FlyMachinesSandboxProvider(client, {
      apiHostname: "https://api.machines.dev",
      appName: "keppo-automation-sandbox",
      automationImage: "registry-1.docker.io/library/node:22-bookworm",
      cpuKind: "shared",
      cpus: 1,
      memoryMb: 1024,
      orgSlug: "personal",
      timeoutGraceMs: 5_000,
    });

    await expect(
      provider.terminate("keppo-automation-sandbox::machine_123"),
    ).resolves.toBeUndefined();

    expect(client.deleteMachine).toHaveBeenCalledWith("keppo-automation-sandbox", "machine_123", {
      force: true,
    });
  });

  it("ignores missing machines on terminate", async () => {
    const client = {
      getApp: vi.fn(),
      createApp: vi.fn(),
      createMachine: vi.fn(),
      waitForMachineStarted: vi.fn(),
      deleteMachine: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("missing"), { status: 404 })),
    };

    const provider = new FlyMachinesSandboxProvider(client, {
      apiHostname: "https://api.machines.dev",
      appName: "keppo-automation-sandbox",
      automationImage: "registry-1.docker.io/library/node:22-bookworm",
      cpuKind: "shared",
      cpus: 1,
      memoryMb: 1024,
      orgSlug: "personal",
      timeoutGraceMs: 5_000,
    });

    await expect(
      provider.terminate("keppo-automation-sandbox::machine_123"),
    ).resolves.toBeUndefined();
  });

  it("rejects Fly mcp_only runs unless the explicit opt-in env is set", async () => {
    const client = {
      getApp: vi.fn(),
      createApp: vi.fn(),
      createMachine: vi.fn(),
      waitForMachineStarted: vi.fn(),
      deleteMachine: vi.fn(),
    };
    const provider = new FlyMachinesSandboxProvider(client, {
      apiHostname: "https://api.machines.dev",
      appName: "keppo-automation-sandbox",
      automationImage: "registry-1.docker.io/library/node:22-bookworm",
      cpuKind: "shared",
      cpus: 1,
      memoryMb: 1024,
      orgSlug: "personal",
      timeoutGraceMs: 5_000,
    });

    await expect(provider.dispatch(baseConfig)).rejects.toThrow(
      "Fly sandbox does not enforce mcp_only egress.",
    );
  });

  it("rejects malformed sandbox handles on terminate", async () => {
    const client = {
      getApp: vi.fn(),
      createApp: vi.fn(),
      createMachine: vi.fn(),
      waitForMachineStarted: vi.fn(),
      deleteMachine: vi.fn(),
    };
    const provider = new FlyMachinesSandboxProvider(client, {
      apiHostname: "https://api.machines.dev",
      appName: "keppo-automation-sandbox",
      automationImage: "registry-1.docker.io/library/node:22-bookworm",
      cpuKind: "shared",
      cpus: 1,
      memoryMb: 1024,
      orgSlug: "personal",
      timeoutGraceMs: 5_000,
    });

    await expect(provider.terminate("bad-handle")).rejects.toThrow("Invalid Fly sandbox handle.");
  });

  it("adds a network grace margin beyond the Fly wait timeout", async () => {
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(new AbortController().signal);
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "machine_123", state: "started" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new FlyMachinesHttpClient("token", "https://api.machines.dev", fetchFn);

    await expect(
      client.waitForMachineStarted("keppo-automation-sandbox", "machine_123"),
    ).resolves.toMatchObject({
      id: "machine_123",
      state: "started",
    });

    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
  });

  it("best-effort deletes the machine if startup wait fails", async () => {
    vi.stubEnv("KEPPO_FLY_ALLOW_UNENFORCED_MCP_ONLY", "true");
    resetApiRuntimeEnvForTest();
    const client = {
      getApp: vi.fn().mockResolvedValue({ id: "app_123", name: "keppo-automation-sandbox" }),
      createApp: vi.fn(),
      createMachine: vi.fn().mockResolvedValue({
        id: "machine_123",
      }),
      waitForMachineStarted: vi.fn().mockRejectedValue(new Error("wait failed")),
      deleteMachine: vi.fn().mockResolvedValue(undefined),
    };

    const provider = new FlyMachinesSandboxProvider(client, {
      apiHostname: "https://api.machines.dev",
      appName: "keppo-automation-sandbox",
      automationImage: "registry-1.docker.io/library/node:22-bookworm",
      cpuKind: "shared",
      cpus: 1,
      memoryMb: 1024,
      orgSlug: "personal",
      timeoutGraceMs: 5_000,
    });

    await expect(provider.dispatch(baseConfig)).rejects.toThrow("wait failed");

    expect(client.deleteMachine).toHaveBeenCalledWith("keppo-automation-sandbox", "machine_123", {
      force: true,
    });
  });

  it("rejects sandbox handles that target a different configured Fly app", async () => {
    const client = {
      getApp: vi.fn(),
      createApp: vi.fn(),
      createMachine: vi.fn(),
      waitForMachineStarted: vi.fn(),
      deleteMachine: vi.fn(),
    };
    const provider = new FlyMachinesSandboxProvider(client, {
      apiHostname: "https://api.machines.dev",
      appName: "keppo-automation-sandbox",
      automationImage: "registry-1.docker.io/library/node:22-bookworm",
      cpuKind: "shared",
      cpus: 1,
      memoryMb: 1024,
      orgSlug: "personal",
      timeoutGraceMs: 5_000,
    });

    await expect(provider.terminate("other-app::machine_123")).rejects.toThrow(
      'Fly sandbox handle targets app "other-app" but this provider manages "keppo-automation-sandbox".',
    );
  });

  it("emits a wrapper that separates install-time env from runtime secrets and bounds log buffering", async () => {
    vi.stubEnv("KEPPO_FLY_ALLOW_UNENFORCED_MCP_ONLY", "true");
    resetApiRuntimeEnvForTest();
    const client = {
      getApp: vi.fn().mockResolvedValue({ id: "app_123", name: "keppo-automation-sandbox" }),
      createApp: vi.fn(),
      createMachine: vi.fn().mockResolvedValue({
        id: "machine_123",
      }),
      waitForMachineStarted: vi.fn().mockResolvedValue({
        id: "machine_123",
        state: "started",
      }),
      deleteMachine: vi.fn().mockResolvedValue(undefined),
    };

    const provider = new FlyMachinesSandboxProvider(client, {
      apiHostname: "https://api.machines.dev",
      appName: "keppo-automation-sandbox",
      automationImage: "registry-1.docker.io/library/node:22-bookworm",
      cpuKind: "shared",
      cpus: 1,
      memoryMb: 1024,
      orgSlug: "personal",
      timeoutGraceMs: 5_000,
    });

    await provider.dispatch(baseConfig);

    const files = client.createMachine.mock.calls[0]?.[1]?.config.files;
    const wrapperSource = Buffer.from(files?.[0]?.raw_value ?? "", "base64").toString("utf8");
    expect(wrapperSource).toContain("env: buildInstallEnv()");
    expect(wrapperSource).toContain("MAX_CARRY_CHARS = 65_536");
    expect(wrapperSource).toContain("[log upload failed:");
  });
});
