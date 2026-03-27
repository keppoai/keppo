import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { assertNever } from "@keppo/shared/domain";
import {
  AUTOMATION_RUN_STATUS,
  type AutomationRunLogLevel,
  type AutomationRunTerminalStatus,
} from "@keppo/shared/automations";
import type { SandboxConfig, SandboxProvider } from "./types.js";

type CompletionStatus = AutomationRunTerminalStatus;
type SandboxLogLevel = Extract<AutomationRunLogLevel, "stdout" | "stderr">;
type SpawnFn = typeof spawn;
type TrackedContainer = {
  containerName: string;
  logsProcess: ChildProcess | null;
};

const DOCKER_IMAGE_TAG = "keppo-automation-sandbox:local-v2";
const DOCKER_HOST_ALIAS = "host.docker.internal";
const DOCKER_HOST_GATEWAY = `${DOCKER_HOST_ALIAS}:host-gateway`;

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

const runningContainers = new Map<string, TrackedContainer>();
const timeoutHandles = new Map<string, ReturnType<typeof setTimeout>>();
const cancelledSandboxes = new Set<string>();
const timedOutSandboxes = new Set<string>();

let sandboxImageReady = false;
let ensureImagePromise: Promise<void> | null = null;

export const resetDockerSandboxStateForTests = (): void => {
  sandboxImageReady = false;
  ensureImagePromise = null;
  for (const timeoutHandle of timeoutHandles.values()) {
    clearTimeout(timeoutHandle);
  }
  timeoutHandles.clear();
  runningContainers.clear();
  cancelledSandboxes.clear();
  timedOutSandboxes.clear();
};

const extractRunId = (urlValue: string): string | null => {
  try {
    const url = new URL(urlValue);
    const runId = url.searchParams.get("automation_run_id")?.trim() ?? "";
    return runId.length > 0 ? runId : null;
  } catch {
    return null;
  }
};

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
};

const rewriteDockerReachableUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (!isLoopbackHostname(url.hostname)) {
      return value;
    }
    url.hostname = DOCKER_HOST_ALIAS;
    return url.toString();
  } catch {
    return value;
  }
};

const normalizeConfigForDocker = (config: SandboxConfig): SandboxConfig => {
  const bootstrapEnv = { ...config.bootstrap.env };
  const runtimeEnv = { ...config.runtime.env };
  if (runtimeEnv.KEPPO_MCP_SERVER_URL) {
    runtimeEnv.KEPPO_MCP_SERVER_URL = rewriteDockerReachableUrl(runtimeEnv.KEPPO_MCP_SERVER_URL);
  }
  if (runtimeEnv.KEPPO_E2E_OPENAI_BASE_URL) {
    runtimeEnv.KEPPO_E2E_OPENAI_BASE_URL = rewriteDockerReachableUrl(
      runtimeEnv.KEPPO_E2E_OPENAI_BASE_URL,
    );
  }

  return {
    ...config,
    bootstrap: {
      ...config.bootstrap,
      env: bootstrapEnv,
    },
    runtime: {
      ...config.runtime,
      env: runtimeEnv,
      callbacks: {
        log_url: rewriteDockerReachableUrl(config.runtime.callbacks.log_url),
        complete_url: rewriteDockerReachableUrl(config.runtime.callbacks.complete_url),
      },
    },
  };
};

const postJson = async (url: string, payload: Record<string, unknown>): Promise<void> => {
  await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
};

const postLogLines = async (
  callbackUrl: string,
  runId: string | null,
  level: SandboxLogLevel,
  lines: string[],
): Promise<void> => {
  if (!runId || lines.length === 0) {
    return;
  }
  try {
    await postJson(callbackUrl, {
      automation_run_id: runId,
      lines: lines.map((content) => ({ level, content })),
    });
  } catch {
    // Log ingestion is best-effort; terminal completion still marks the run outcome.
  }
};

const postCompletion = async (
  callbackUrl: string,
  runId: string | null,
  status: CompletionStatus,
  errorMessage?: string,
): Promise<void> => {
  if (!runId) {
    return;
  }
  try {
    await postJson(callbackUrl, {
      automation_run_id: runId,
      status,
      ...(errorMessage ? { error_message: errorMessage } : {}),
    });
  } catch {
    // Completion endpoint failures are intentionally swallowed to avoid crashing the process host.
  }
};

const splitLines = (carry: string, chunk: Buffer): { lines: string[]; carry: string } => {
  const normalized = `${carry}${chunk.toString("utf8").replace(/\r\n/g, "\n")}`;
  const parts = normalized.split("\n");
  const nextCarry = parts.pop() ?? "";
  const lines = parts.map((line) => line.trimEnd()).filter((line) => line.length > 0);
  return { lines, carry: nextCarry };
};

const toDockerErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 0 ? message : "Docker sandbox command failed for an unknown reason.";
};

const composeDockerCommand = (config: SandboxConfig): string => {
  const bootstrap = config.bootstrap.command.trim();
  const runtimeBootstrap = config.runtime.bootstrap_command?.trim() ?? "";
  const runtime = config.runtime.command.trim();
  return [bootstrap, runtimeBootstrap, runtime].filter((part) => part.length > 0).join(" && ");
};

const runDockerCommand = async (
  spawnFn: SpawnFn,
  args: string[],
  options?: { cwd?: string },
): Promise<{ code: number; stdout: string; stderr: string }> => {
  return await new Promise((resolveResult, rejectResult) => {
    const child = spawnFn("docker", args, {
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (error) => {
      rejectResult(
        new Error(
          error instanceof Error && "code" in error && error.code === "ENOENT"
            ? "Docker CLI is required for local automation sandboxes but was not found."
            : toDockerErrorMessage(error),
        ),
      );
    });
    child.once("close", (code) => {
      resolveResult({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
};

const ensureSandboxImage = async (spawnFn: SpawnFn): Promise<void> => {
  if (sandboxImageReady) {
    return;
  }
  if (!ensureImagePromise) {
    ensureImagePromise = (async () => {
      const inspect = await runDockerCommand(spawnFn, ["image", "inspect", DOCKER_IMAGE_TAG]);
      if (inspect.code === 0) {
        sandboxImageReady = true;
        return;
      }

      const build = await runDockerCommand(
        spawnFn,
        ["build", "-t", DOCKER_IMAGE_TAG, "-f", dockerfilePath, repoRootPath],
        { cwd: repoRootPath },
      );
      if (build.code !== 0) {
        const detail = build.stderr.trim() || build.stdout.trim() || "docker build failed";
        throw new Error(`Failed to build Docker sandbox image ${DOCKER_IMAGE_TAG}: ${detail}`);
      }
      sandboxImageReady = true;
    })().finally(() => {
      if (!sandboxImageReady) {
        ensureImagePromise = null;
      }
    });
  }
  await ensureImagePromise;
};

const removeContainer = async (spawnFn: SpawnFn, containerName: string): Promise<void> => {
  const result = await runDockerCommand(spawnFn, ["rm", "-f", containerName]).catch(() => null);
  if (!result) {
    return;
  }
  if (
    result.code !== 0 &&
    !result.stderr.includes("No such container") &&
    !result.stderr.includes("is already in progress")
  ) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Failed to remove container");
  }
};

const monitorContainerLifecycle = async (
  spawnFn: SpawnFn,
  sandboxId: string,
  containerName: string,
  config: SandboxConfig,
): Promise<void> => {
  const tracked = runningContainers.get(sandboxId);
  const runId =
    extractRunId(config.runtime.callbacks.complete_url) ??
    extractRunId(config.runtime.callbacks.log_url);
  let stdoutCarry = "";
  let stderrCarry = "";

  const timeout = setTimeout(
    () => {
      timedOutSandboxes.add(sandboxId);
      void removeContainer(spawnFn, containerName).catch(() => undefined);
    },
    Math.max(1, config.timeout_ms),
  );
  timeoutHandles.set(sandboxId, timeout);

  const logsProcess = spawnFn("docker", ["logs", "-f", containerName], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (tracked) {
    tracked.logsProcess = logsProcess;
  }

  logsProcess.once("error", () => {
    // Completion is driven by `docker wait`; log streaming is best-effort.
  });

  logsProcess.stdout?.on("data", (chunk: Buffer) => {
    const { lines, carry } = splitLines(stdoutCarry, chunk);
    stdoutCarry = carry;
    void postLogLines(config.runtime.callbacks.log_url, runId, "stdout", lines);
  });
  logsProcess.stderr?.on("data", (chunk: Buffer) => {
    const { lines, carry } = splitLines(stderrCarry, chunk);
    stderrCarry = carry;
    void postLogLines(config.runtime.callbacks.log_url, runId, "stderr", lines);
  });

  let waitResult: { code: number; stdout: string; stderr: string } | null = null;
  let waitError: unknown = null;

  try {
    waitResult = await runDockerCommand(spawnFn, ["wait", containerName]);
  } catch (error) {
    waitError = error;
  } finally {
    const timeoutHandle = timeoutHandles.get(sandboxId);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandles.delete(sandboxId);
    }
    if (logsProcess.exitCode === null && !logsProcess.killed) {
      logsProcess.kill("SIGKILL");
    }

    if (stdoutCarry.trim().length > 0) {
      void postLogLines(config.runtime.callbacks.log_url, runId, "stdout", [stdoutCarry.trim()]);
    }
    if (stderrCarry.trim().length > 0) {
      void postLogLines(config.runtime.callbacks.log_url, runId, "stderr", [stderrCarry.trim()]);
    }
  }

  const wasCancelled = cancelledSandboxes.delete(sandboxId);
  const timedOut = timedOutSandboxes.delete(sandboxId);
  runningContainers.delete(sandboxId);

  let status: CompletionStatus;
  let errorMessage: string | undefined;

  if (timedOut) {
    status = AUTOMATION_RUN_STATUS.timedOut;
    errorMessage = "Sandbox container exceeded timeout";
  } else if (wasCancelled) {
    status = AUTOMATION_RUN_STATUS.cancelled;
    errorMessage = "Sandbox container terminated by request";
  } else if (waitError) {
    status = AUTOMATION_RUN_STATUS.failed;
    errorMessage = `Sandbox container failed: ${toDockerErrorMessage(waitError)}`;
  } else {
    const exitCode = Number.parseInt(waitResult?.stdout.trim() ?? "", 10);
    status =
      waitResult?.code === 0 && Number.isFinite(exitCode) && exitCode === 0
        ? AUTOMATION_RUN_STATUS.succeeded
        : AUTOMATION_RUN_STATUS.failed;
    errorMessage =
      status === AUTOMATION_RUN_STATUS.failed
        ? `Sandbox container exited with code ${Number.isFinite(exitCode) ? exitCode : "unknown"}`
        : undefined;
  }

  await removeContainer(spawnFn, containerName).catch(() => undefined);
  await postCompletion(config.runtime.callbacks.complete_url, runId, status, errorMessage);
};

export class DockerSandboxProvider implements SandboxProvider {
  constructor(private readonly spawnFn: SpawnFn = spawn) {}

  async dispatch(config: SandboxConfig): Promise<{ sandbox_id: string }> {
    await ensureSandboxImage(this.spawnFn);

    const sandboxId = `sandbox_${randomUUID().replace(/-/g, "")}`;
    const containerName = `keppo-automation-${sandboxId}`;
    const dockerConfig = normalizeConfigForDocker(config);
    const env = {
      ...dockerConfig.bootstrap.env,
      ...dockerConfig.runtime.env,
      KEPPO_RUNNER_COMMAND: composeDockerCommand(dockerConfig),
      KEPPO_LOG_CALLBACK_URL: dockerConfig.runtime.callbacks.log_url,
      KEPPO_COMPLETE_CALLBACK_URL: dockerConfig.runtime.callbacks.complete_url,
      KEPPO_TIMEOUT_MS: String(Math.max(1, dockerConfig.timeout_ms)),
    };

    const args = [
      "run",
      "-d",
      "--init",
      "--name",
      containerName,
      "--add-host",
      DOCKER_HOST_GATEWAY,
      ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      DOCKER_IMAGE_TAG,
    ];

    const runResult = await runDockerCommand(this.spawnFn, args);
    if (runResult.code !== 0) {
      const detail = runResult.stderr.trim() || runResult.stdout.trim() || "docker run failed";
      throw new Error(`Failed to start Docker sandbox ${containerName}: ${detail}`);
    }

    runningContainers.set(sandboxId, {
      containerName,
      logsProcess: null,
    });
    void monitorContainerLifecycle(this.spawnFn, sandboxId, containerName, config);
    return { sandbox_id: sandboxId };
  }

  async terminate(sandbox_id: string): Promise<void> {
    const tracked = runningContainers.get(sandbox_id);
    if (!tracked) {
      return;
    }
    cancelledSandboxes.add(sandbox_id);
    await removeContainer(this.spawnFn, tracked.containerName).catch(() => undefined);
  }
}
