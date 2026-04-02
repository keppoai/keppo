import { existsSync, readFileSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockerSandboxProvider, resetDockerSandboxStateForTests } from "./docker.js";

const resolveRepoRootPath = (): string => {
  let current = resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return resolve(process.cwd());
};

const repoRootPath = resolveRepoRootPath();
const dockerfilePath = resolve(
  repoRootPath,
  "apps/web/app/lib/server/api-runtime/sandbox/Dockerfile",
);

const baseConfig = {
  bootstrap: {
    command: "true",
    env: {},
    network_access: "package_registry_only" as const,
  },
  runtime: {
    bootstrap_command:
      "mkdir -p '/sandbox/.keppo-codex-home' && export HOME='/sandbox/.keppo-codex-home'",
    command: "codex exec --model 'gpt-5.2' 'hello'",
    env: {
      OPENAI_API_KEY: "openai-key",
      KEPPO_MCP_SERVER_URL: "http://localhost:8787/mcp/ws_test",
    },
    network_access: "mcp_only" as const,
    callbacks: {
      log_url:
        "http://localhost:8787/internal/automations/log?automation_run_id=arun_test&expires=1&signature=abc",
      complete_url:
        "http://localhost:8787/internal/automations/complete?automation_run_id=arun_test&expires=1&signature=abc",
    },
  },
  timeout_ms: 120_000,
};

class FakeChildProcess extends EventEmitter {
  stdout: PassThrough | null;
  stderr: PassThrough | null;
  exitCode: number | null = null;
  killed = false;

  constructor(withPipes = true) {
    super();
    this.stdout = withPipes ? new PassThrough() : null;
    this.stderr = withPipes ? new PassThrough() : null;
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.exitCode = typeof signal === "number" ? signal : 137;
    this.emit("close", this.exitCode, signal);
    return true;
  }
}

afterEach(() => {
  resetDockerSandboxStateForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DockerSandboxProvider", () => {
  it("keeps the sandbox Dockerfile compatible with legacy local builders", () => {
    const dockerfile = readFileSync(dockerfilePath, "utf8");

    expect(dockerfile).not.toContain("COPY <<");
    expect(dockerfile).toContain(
      "RUN cat <<'EOF' >/usr/local/bin/automation-sandbox-entrypoint.sh",
    );
  });

  it("launches the runner in Docker and rewrites loopback URLs for container reachability", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);

    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
    const spawnMock = vi.fn((cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });

      if (args[0] === "image" && args[1] === "inspect") {
        const child = new FakeChildProcess();
        queueMicrotask(() => child.emit("close", 0));
        return child;
      }

      if (args[0] === "run") {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout?.write("container_123\n");
          child.emit("close", 0);
        });
        return child;
      }

      if (args[0] === "logs") {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout?.write("hello from codex\n");
          child.emit("close", 0);
        });
        return child;
      }

      if (args[0] === "wait") {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout?.write("0\n");
          child.emit("close", 0);
        });
        return child;
      }

      if (args[0] === "rm") {
        const child = new FakeChildProcess();
        queueMicrotask(() => child.emit("close", 0));
        return child;
      }

      throw new Error(`Unexpected docker args: ${args.join(" ")}`);
    });

    const provider = new DockerSandboxProvider(spawnMock as unknown as typeof nodeSpawn);
    const result = await provider.dispatch(baseConfig);

    expect(result.sandbox_id).toMatch(/^sandbox_/u);
    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledWith(
        baseConfig.runtime.callbacks.complete_url,
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    const runCall = spawnCalls.find((call) => call.args[0] === "run");
    expect(runCall).toBeDefined();
    expect(runCall?.args).toEqual(
      expect.arrayContaining([
        "--add-host",
        "host.docker.internal:host-gateway",
        "--entrypoint",
        "sh",
        "keppo-automation-sandbox:local-v2",
      ]),
    );
    expect(runCall?.args.join(" ")).toContain(
      "KEPPO_MCP_SERVER_URL=http://host.docker.internal:8787/mcp/ws_test",
    );
    expect(runCall?.args).toContain("-lc");
    const shellCommand = runCall?.args[runCall.args.length - 1] ?? "";
    expect(shellCommand).toContain(
      "true && mkdir -p '/sandbox/.keppo-codex-home' && export HOME='/sandbox/.keppo-codex-home' && codex exec --model 'gpt-5.2' 'hello'",
    );
    expect(runCall?.args.join(" ")).toContain(
      "KEPPO_LOG_CALLBACK_URL=http://host.docker.internal:8787/internal/automations/log?automation_run_id=arun_test&expires=1&signature=abc",
    );
    expect(fetchFn).toHaveBeenCalledWith(
      baseConfig.runtime.callbacks.log_url,
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("builds the sandbox image when it is missing locally", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);

    const spawnCalls: Array<string[]> = [];
    const spawnMock = vi.fn((cmd: string, args: string[]) => {
      spawnCalls.push(args);

      if (args[0] === "image" && args[1] === "inspect") {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stderr?.write("missing\n");
          child.emit("close", 1);
        });
        return child;
      }

      if (args[0] === "build") {
        const child = new FakeChildProcess();
        queueMicrotask(() => child.emit("close", 0));
        return child;
      }

      if (args[0] === "run") {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout?.write("container_123\n");
          child.emit("close", 0);
        });
        return child;
      }

      if (args[0] === "logs") {
        const child = new FakeChildProcess();
        queueMicrotask(() => child.emit("close", 0));
        return child;
      }

      if (args[0] === "wait") {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout?.write("0\n");
          child.emit("close", 0);
        });
        return child;
      }

      if (args[0] === "rm") {
        const child = new FakeChildProcess();
        queueMicrotask(() => child.emit("close", 0));
        return child;
      }

      throw new Error(`Unexpected docker args: ${args.join(" ")}`);
    });

    const provider = new DockerSandboxProvider(spawnMock as unknown as typeof nodeSpawn);
    await provider.dispatch(baseConfig);

    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalled();
    });
    const buildCall = spawnCalls.find((args) => args[0] === "build");
    expect(buildCall).toBeDefined();
    expect(buildCall).toEqual([
      "build",
      "-t",
      "keppo-automation-sandbox:local-v2",
      "-f",
      dockerfilePath,
      repoRootPath,
    ]);
  });

  it("removes the Docker container when a run is terminated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 })),
    );

    const waitChildren: FakeChildProcess[] = [];
    const spawnCalls: Array<string[]> = [];
    const spawnMock = vi.fn((cmd: string, args: string[]) => {
      spawnCalls.push(args);

      if (args[0] === "image" && args[1] === "inspect") {
        const child = new FakeChildProcess();
        queueMicrotask(() => child.emit("close", 0));
        return child;
      }

      if (args[0] === "run") {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout?.write("container_123\n");
          child.emit("close", 0);
        });
        return child;
      }

      if (args[0] === "logs") {
        return new FakeChildProcess();
      }

      if (args[0] === "wait") {
        const child = new FakeChildProcess();
        waitChildren.push(child);
        return child;
      }

      if (args[0] === "rm") {
        const child = new FakeChildProcess();
        queueMicrotask(() => child.emit("close", 0));
        return child;
      }

      throw new Error(`Unexpected docker args: ${args.join(" ")}`);
    });

    const provider = new DockerSandboxProvider(spawnMock as unknown as typeof nodeSpawn);
    const result = await provider.dispatch(baseConfig);
    await provider.terminate(result.sandbox_id);

    expect(spawnCalls.some((args) => args[0] === "rm")).toBe(true);

    const activeWaitChild = waitChildren[0];
    activeWaitChild?.stdout?.write("137\n");
    activeWaitChild?.emit("close", 0);
    await vi.waitFor(() => {
      expect(spawnCalls.filter((args) => args[0] === "rm").length).toBeGreaterThanOrEqual(1);
    });
  });
});
