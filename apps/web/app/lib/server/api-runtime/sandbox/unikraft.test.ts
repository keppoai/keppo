import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOMATION_RUN_STATUS } from "@keppo/shared/automations";

const baseConfig = {
  bootstrap: {
    command: "true",
    env: {
      BOOTSTRAP_ENV: "1",
    },
    network_access: "package_registry_only" as const,
  },
  runtime: {
    bootstrap_command: "export HOME=/sandbox/home",
    command: "codex exec 'hello'",
    env: {
      OPENAI_API_KEY: "secret",
    },
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
  timeout_ms: 50,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

const loadProvider = async (envOverrides: Record<string, unknown> = {}) => {
  vi.doMock("../env.js", () => ({
    getEnv: () => ({
      UNIKRAFT_SANDBOX_IMAGE: "ghcr.io/keppo/automation:latest",
      UNIKRAFT_API_TOKEN: "uk_test",
      UNIKRAFT_METRO: "fra0",
      ...envOverrides,
    }),
  }));

  const module = await import("./unikraft.js");
  return module.UnikraftSandboxProvider;
};

describe("UnikraftSandboxProvider", () => {
  it("dispatches an instance with the expected image and env and forwards logs/completion", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);

    const createInstance = vi.fn().mockResolvedValue({
      uuid: "inst_123",
      state: "running",
    });
    const getInstanceLogs = vi.fn().mockResolvedValue({
      output: "hello from unikraft\n",
      next_offset: 20,
    });
    const getInstance = vi.fn().mockResolvedValue({
      uuid: "inst_123",
      state: "stopped",
      env: {
        KEPPO_LOG_CALLBACK_URL: baseConfig.runtime.callbacks.log_url,
        KEPPO_COMPLETE_CALLBACK_URL: baseConfig.runtime.callbacks.complete_url,
      },
    });
    const deleteInstance = vi.fn().mockResolvedValue(undefined);

    const UnikraftSandboxProvider = await loadProvider();
    const provider = new UnikraftSandboxProvider({
      createInstance,
      getInstanceLogs,
      getInstance,
      deleteInstance,
      stopInstance: vi.fn(),
    });

    await expect(provider.dispatch(baseConfig)).resolves.toEqual({
      sandbox_id: "inst_123",
    });

    expect(createInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        image: "ghcr.io/keppo/automation:latest",
        env: expect.objectContaining({
          BOOTSTRAP_ENV: "1",
          OPENAI_API_KEY: "secret",
          KEPPO_RUNNER_COMMAND: "true && export HOME=/sandbox/home && codex exec 'hello'",
          KEPPO_LOG_CALLBACK_URL: baseConfig.runtime.callbacks.log_url,
          KEPPO_COMPLETE_CALLBACK_URL: baseConfig.runtime.callbacks.complete_url,
          KEPPO_SESSION_ARTIFACT_CALLBACK_URL: baseConfig.runtime.callbacks.session_artifact_url,
          KEPPO_TIMEOUT_MS: "50",
          KEPPO_TIMEOUT_GRACE_MS: "5000",
        }),
      }),
    );

    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledWith(
        baseConfig.runtime.callbacks.log_url,
        expect.objectContaining({
          method: "POST",
        }),
      );
      expect(fetchFn).toHaveBeenCalledWith(
        baseConfig.runtime.callbacks.complete_url,
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
    expect(deleteInstance).toHaveBeenCalledWith("inst_123");
  });

  it("terminates an instance and posts cancelled completion", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);

    const UnikraftSandboxProvider = await loadProvider();
    const stopInstance = vi.fn().mockResolvedValue(undefined);
    const deleteInstance = vi.fn().mockResolvedValue(undefined);
    const provider = new UnikraftSandboxProvider({
      createInstance: vi.fn(),
      getInstanceLogs: vi.fn(),
      getInstance: vi.fn().mockResolvedValue({
        uuid: "inst_cancelled",
        state: "running",
        env: {
          KEPPO_COMPLETE_CALLBACK_URL: baseConfig.runtime.callbacks.complete_url,
          KEPPO_LOG_CALLBACK_URL: baseConfig.runtime.callbacks.log_url,
        },
      }),
      stopInstance,
      deleteInstance,
    });

    await provider.terminate("inst_cancelled");

    expect(stopInstance).toHaveBeenCalledWith("inst_cancelled", { drainTimeoutMs: 5_000 });
    expect(deleteInstance).toHaveBeenCalledWith("inst_cancelled");
    expect(fetchFn).toHaveBeenCalledWith(
      baseConfig.runtime.callbacks.complete_url,
      expect.objectContaining({
        body: JSON.stringify({
          automation_run_id: "arun_test",
          status: AUTOMATION_RUN_STATUS.cancelled,
        }),
      }),
    );
  });

  it("posts timed_out completion when the instance exceeds the timeout", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);

    const UnikraftSandboxProvider = await loadProvider();
    const stopInstance = vi.fn().mockResolvedValue(undefined);
    const deleteInstance = vi.fn().mockResolvedValue(undefined);
    const provider = new UnikraftSandboxProvider({
      createInstance: vi.fn().mockResolvedValue({
        uuid: "inst_timeout",
        state: "running",
      }),
      getInstanceLogs: vi.fn().mockResolvedValue({
        output: "",
        next_offset: 0,
      }),
      getInstance: vi.fn().mockResolvedValue({
        uuid: "inst_timeout",
        state: "running",
        env: {
          KEPPO_COMPLETE_CALLBACK_URL: baseConfig.runtime.callbacks.complete_url,
          KEPPO_LOG_CALLBACK_URL: baseConfig.runtime.callbacks.log_url,
        },
      }),
      stopInstance,
      deleteInstance,
    });

    await provider.dispatch(baseConfig);

    await vi.waitFor(
      () => {
        expect(fetchFn).toHaveBeenCalledWith(
          baseConfig.runtime.callbacks.complete_url,
          expect.objectContaining({
            body: JSON.stringify({
              automation_run_id: "arun_test",
              status: AUTOMATION_RUN_STATUS.timedOut,
            }),
          }),
        );
      },
      { timeout: 2_500 },
    );
    expect(stopInstance).toHaveBeenCalledWith("inst_timeout", { drainTimeoutMs: 5_000 });
    expect(deleteInstance).toHaveBeenCalledWith("inst_timeout");
  });

  it("posts failed completion when the monitor loop itself errors", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);

    const UnikraftSandboxProvider = await loadProvider();
    const stopInstance = vi.fn().mockResolvedValue(undefined);
    const deleteInstance = vi.fn().mockResolvedValue(undefined);
    const provider = new UnikraftSandboxProvider({
      createInstance: vi.fn().mockResolvedValue({
        uuid: "inst_error",
        state: "running",
      }),
      getInstanceLogs: vi.fn().mockRejectedValue(new Error("upstream unavailable")),
      getInstance: vi.fn(),
      stopInstance,
      deleteInstance,
    });

    await provider.dispatch(baseConfig);

    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledWith(
        baseConfig.runtime.callbacks.complete_url,
        expect.objectContaining({
          body: JSON.stringify({
            automation_run_id: "arun_test",
            status: AUTOMATION_RUN_STATUS.failed,
            error_message:
              "The remote sandbox stopped unexpectedly before the automation completed.",
          }),
        }),
      );
    });
    expect(stopInstance).toHaveBeenCalledWith("inst_error", { drainTimeoutMs: 5_000 });
    expect(deleteInstance).toHaveBeenCalledWith("inst_error");
  });
});
