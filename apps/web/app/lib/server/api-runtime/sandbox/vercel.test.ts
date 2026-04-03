import { describe, expect, it, vi } from "vitest";
import { VercelSandboxProvider } from "../../../../../../../cloud/api/sandbox/vercel.js";

const baseConfig = {
  bootstrap: {
    command: "true",
    env: {},
    network_access: "package_registry_only" as const,
  },
  runtime: {
    bootstrap_command:
      "mkdir -p '/sandbox/.keppo-codex-home' && export HOME='/sandbox/.keppo-codex-home'",
    command: "codex --model gpt-5.2 --prompt 'hello'",
    env: {},
    network_access: "mcp_only" as const,
    callbacks: {
      log_url:
        "https://api.keppo.ai/internal/automations/log?automation_run_id=arun_test&expires=1&signature=abc",
      complete_url:
        "https://api.keppo.ai/internal/automations/complete?automation_run_id=arun_test&expires=1&signature=abc",
      session_artifact_url:
        "https://api.keppo.ai/internal/automations/session-artifact?automation_run_id=arun_test&expires=1&signature=abc",
    },
  },
  timeout_ms: 120_000,
};

describe("VercelSandboxProvider", () => {
  it("dispatches a sandbox with the runtime command and callback env", async () => {
    const updateNetworkPolicy = vi.fn().mockResolvedValue(undefined);
    const writeFiles = vi.fn().mockResolvedValue(undefined);
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        cmdId: "cmd_install",
        exitCode: 0,
        wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
        logs: vi.fn(),
        stdout: vi.fn().mockResolvedValue(""),
        stderr: vi.fn().mockResolvedValue(""),
      })
      .mockResolvedValueOnce({
        cmdId: "cmd_runner",
        exitCode: 0,
        wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
        logs: vi.fn(),
      });
    const stop = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({
      sandboxId: "sb_test",
      writeFiles,
      runCommand,
      updateNetworkPolicy,
      getCommand: vi.fn(),
      stop,
    });

    const provider = new VercelSandboxProvider(async () => ({
      Sandbox: {
        create,
      },
    }));

    await expect(provider.dispatch(baseConfig)).resolves.toEqual({
      sandbox_id: "sb_test::cmd_runner",
    });
    expect(create).toHaveBeenCalledWith({
      runtime: "node24",
      timeout: 180_000,
      env: {},
      networkPolicy: {
        allow: ["registry.npmjs.org"],
      },
    });
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cmd: "npm",
        args: [
          "install",
          "--no-audit",
          "--no-fund",
          "--prefix",
          "/vercel/sandbox/.keppo-automation-runner",
          "@openai/codex@0.118.0",
        ],
        env: {},
      }),
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cmd: "node",
        env: expect.objectContaining({
          KEPPO_RUNNER_SETUP_COMMAND: baseConfig.bootstrap.command,
          KEPPO_RUNNER_BOOTSTRAP_COMMAND: baseConfig.runtime.bootstrap_command,
          KEPPO_LOG_CALLBACK_URL: baseConfig.runtime.callbacks.log_url,
          KEPPO_COMPLETE_CALLBACK_URL: baseConfig.runtime.callbacks.complete_url,
          KEPPO_SESSION_ARTIFACT_CALLBACK_URL: baseConfig.runtime.callbacks.session_artifact_url,
          KEPPO_TIMEOUT_GRACE_MS: "5000",
        }),
      }),
    );
    const writtenEntrypoint = writeFiles.mock.calls[0]?.[0]?.[0];
    expect(writtenEntrypoint?.path).toBe("/vercel/sandbox/keppo-automation-runner.mjs");
    expect(Buffer.from(writtenEntrypoint?.content ?? "").toString("utf8")).toContain(
      'child.kill("SIGTERM");',
    );
    expect(updateNetworkPolicy).toHaveBeenCalledTimes(1);
    expect(writeFiles).toHaveBeenCalledTimes(1);
  });

  it("keeps runtime secrets and callback URLs out of bootstrap sandbox creation", async () => {
    const create = vi.fn().mockResolvedValue({
      sandboxId: "sb_test",
      writeFiles: vi.fn().mockResolvedValue(undefined),
      runCommand: vi
        .fn()
        .mockResolvedValueOnce({
          cmdId: "cmd_install",
          exitCode: 0,
          wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
          logs: vi.fn(),
          stdout: vi.fn().mockResolvedValue(""),
          stderr: vi.fn().mockResolvedValue(""),
        })
        .mockResolvedValueOnce({
          cmdId: "cmd_runner",
          exitCode: 0,
          wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
          logs: vi.fn(),
        }),
      updateNetworkPolicy: vi.fn().mockResolvedValue(undefined),
      getCommand: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    });

    const provider = new VercelSandboxProvider(async () => ({
      Sandbox: {
        create,
      },
    }));

    await provider.dispatch({
      ...baseConfig,
      runtime: {
        ...baseConfig.runtime,
        env: {
          OPENAI_API_KEY: "secret",
          KEPPO_MCP_BEARER_TOKEN: "mcp-secret",
        },
      },
    });

    const createArg = create.mock.calls[0]?.[0];
    expect(createArg?.env).toEqual({});
    expect(createArg?.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(createArg?.env).not.toHaveProperty("KEPPO_MCP_BEARER_TOKEN");
    expect(createArg?.env).not.toHaveProperty("KEPPO_LOG_CALLBACK_URL");
    expect(createArg?.env).not.toHaveProperty("KEPPO_COMPLETE_CALLBACK_URL");
    expect(createArg?.env).not.toHaveProperty("KEPPO_SESSION_ARTIFACT_CALLBACK_URL");
  });

  it("allowlists the configured OpenAI base URL host for mcp_only runs", async () => {
    const updateNetworkPolicy = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({
      sandboxId: "sb_test",
      writeFiles: vi.fn().mockResolvedValue(undefined),
      runCommand: vi
        .fn()
        .mockResolvedValueOnce({
          cmdId: "cmd_install",
          exitCode: 0,
          wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
          logs: vi.fn(),
          stdout: vi.fn().mockResolvedValue(""),
          stderr: vi.fn().mockResolvedValue(""),
        })
        .mockResolvedValueOnce({
          cmdId: "cmd_runner",
          exitCode: 0,
          wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
          logs: vi.fn(),
        }),
      updateNetworkPolicy,
      getCommand: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    });

    const provider = new VercelSandboxProvider(async () => ({
      Sandbox: {
        create,
      },
    }));

    await provider.dispatch({
      ...baseConfig,
      runtime: {
        ...baseConfig.runtime,
        env: {
          OPENAI_API_KEY: "secret",
          OPENAI_BASE_URL: "https://llm-gateway.dyad.sh/v1",
        },
      },
    });

    expect(updateNetworkPolicy).toHaveBeenCalledWith({
      allow: ["api.keppo.ai", "llm-gateway.dyad.sh"],
    });
  });

  it("rejects secret-bearing bootstrap env", async () => {
    const provider = new VercelSandboxProvider(async () => ({
      Sandbox: {
        create: vi.fn(),
      },
    }));
    await expect(
      provider.dispatch({
        ...baseConfig,
        bootstrap: {
          ...baseConfig.bootstrap,
          env: {
            OPENAI_API_KEY: "secret",
          },
        },
      }),
    ).rejects.toThrow("Vercel sandbox bootstrap cannot receive OPENAI_API_KEY.");
  });

  it("terminates an existing sandbox command before stopping the sandbox", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue({ exitCode: 0 });
    const stop = vi.fn().mockResolvedValue(undefined);

    const provider = new VercelSandboxProvider(async () => ({
      Sandbox: {
        get: vi.fn().mockResolvedValue({
          sandboxId: "sb_test",
          writeFiles: vi.fn(),
          runCommand: vi.fn(),
          updateNetworkPolicy: vi.fn(),
          getCommand: vi.fn().mockResolvedValue({
            cmdId: "cmd_runner",
            exitCode: null,
            wait,
            logs: vi.fn(),
            kill,
          }),
          stop,
        }),
      },
    }));

    await expect(provider.terminate("sb_test::cmd_runner")).resolves.toBeUndefined();
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
