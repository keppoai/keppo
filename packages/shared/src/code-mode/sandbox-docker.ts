import { randomUUID } from "node:crypto";
import { spawn, type SpawnOptions } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseJsonValue } from "../providers/boundaries/json.js";
import type { SandboxExecutionResult, SandboxProvider } from "./sandbox.js";
import { buildBridgeEntrySource, REQUEST_PREFIX, RESULT_PREFIX } from "./sandbox-bridge.js";
import {
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE,
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE,
} from "./structured-execution-error.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const HOST_WORKSPACE_PREFIX = "keppo-code-mode-";
const HOST_WORKSPACE_ROOT = join(process.cwd(), ".tmp", "code-mode-sandbox");
const CONTAINER_WORKDIR = "/workspace";
const CONTAINER_RESPONSE_DIR = `${CONTAINER_WORKDIR}/responses`;
const DEFAULT_RESULT_ERROR = "Code execution failed in Docker sandbox.";
const DEFAULT_DOCKER_IMAGE = "node:22-alpine";

export type DockerChildProcess = {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on: ((
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ) => unknown) &
    ((event: "error", listener: (error: Error) => void) => unknown) &
    ((event: "data", listener: (chunk: Buffer | string) => void) => unknown) &
    ((event: string, listener: (...args: unknown[]) => void) => unknown);
  kill: (signal?: NodeJS.Signals) => boolean;
};

export type DockerSpawn = (
  command: string,
  args?: ReadonlyArray<string>,
  options?: SpawnOptions,
) => DockerChildProcess;

type BridgeRequest =
  | {
      requestId: string;
      responsePath: string;
      kind: "tool";
      toolName: string;
      input?: unknown;
    }
  | {
      requestId: string;
      responsePath: string;
      kind: "search";
      query: string;
      options?: unknown;
    };

type BridgeResult = {
  success: boolean;
  logs?: unknown;
  hasReturnValue?: boolean;
  returnValue?: unknown;
  toolCallsExecuted?: unknown;
  error?: string;
};

const asNonEmptyString = (value: unknown): string | null => {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const normalizeLogs = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
};

const normalizeToolCalls = (
  value: unknown,
): Array<{ toolName: string; input: Record<string, unknown>; output: unknown }> => {
  if (!Array.isArray(value)) {
    return [];
  }
  const calls: Array<{ toolName: string; input: Record<string, unknown>; output: unknown }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const typed = entry as {
      toolName?: unknown;
      input?: unknown;
      output?: unknown;
    };
    if (typeof typed.toolName !== "string" || typed.toolName.length === 0) {
      continue;
    }
    calls.push({
      toolName: typed.toolName,
      input: asRecord(typed.input),
      output: typed.output,
    });
  }
  return calls;
};

const splitLines = (chunk: string, remainder: string): { lines: string[]; remainder: string } => {
  const combined = `${remainder}${chunk}`;
  const parts = combined.split("\n");
  const nextRemainder = parts.pop() ?? "";
  return {
    lines: parts.map((line) => line.replace(/\r$/, "")),
    remainder: nextRemainder,
  };
};

const toBridgeErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
};

const safeJsonValue = (value: unknown): unknown => {
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
};

const parseBridgeRequest = (line: string): BridgeRequest | null => {
  try {
    const parsed = parseJsonValue(line) as {
      requestId?: unknown;
      responsePath?: unknown;
      kind?: unknown;
      toolName?: unknown;
      input?: unknown;
      query?: unknown;
      options?: unknown;
    };

    if (
      typeof parsed.requestId !== "string" ||
      typeof parsed.responsePath !== "string" ||
      typeof parsed.kind !== "string"
    ) {
      return null;
    }

    if (parsed.kind === "tool") {
      if (typeof parsed.toolName !== "string") {
        return null;
      }
      return {
        requestId: parsed.requestId,
        responsePath: parsed.responsePath,
        kind: "tool",
        toolName: parsed.toolName,
        input: parsed.input,
      };
    }

    if (parsed.kind === "search") {
      if (typeof parsed.query !== "string") {
        return null;
      }
      return {
        requestId: parsed.requestId,
        responsePath: parsed.responsePath,
        kind: "search",
        query: parsed.query,
        options: parsed.options,
      };
    }
  } catch {}
  return null;
};

const parseBridgeResult = (line: string): BridgeResult | null => {
  try {
    const parsed = parseJsonValue(line) as BridgeResult;
    if (typeof parsed.success !== "boolean") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const mapContainerPathToHost = async (
  workspaceDir: string,
  containerPath: string,
): Promise<string> => {
  if (!containerPath.startsWith(`${CONTAINER_WORKDIR}/`)) {
    throw new Error(`Bridge requested unsupported response path: ${containerPath}`);
  }
  const hostPath = resolve(workspaceDir, containerPath.slice(CONTAINER_WORKDIR.length + 1));
  const relativePath = relative(workspaceDir, hostPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Bridge requested path outside workspace: ${containerPath}`);
  }
  // Resolve symlinks in the parent directory to prevent symlink-based escapes.
  // A malicious container could create a symlink inside the workspace pointing
  // outside it; lexical checks alone would not catch this.
  const parentDir = resolve(hostPath, "..");
  try {
    const realParent = await realpath(parentDir);
    const realRelative = relative(workspaceDir, realParent);
    if (realRelative.startsWith("..") || isAbsolute(realRelative)) {
      throw new Error(`Bridge requested path outside workspace (symlink escape): ${containerPath}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Bridge requested path")) {
      throw error;
    }
    // Parent directory doesn't exist yet — no symlink risk since writeFile
    // will create it or fail. The lexical check above is sufficient.
  }
  // Also check if the file itself is a symlink pointing outside the workspace.
  // A malicious container could create a file-level symlink (e.g.,
  // ln -s /etc/passwd /workspace/response.json) that the parent-dir check misses.
  let stat: Awaited<ReturnType<typeof lstat>> | null = null;
  try {
    stat = await lstat(hostPath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      stat = null;
    } else {
      throw error;
    }
  }
  if (stat?.isSymbolicLink()) {
    let realFile: string;
    try {
      realFile = await realpath(hostPath);
    } catch {
      throw new Error(`Bridge requested path outside workspace (symlink escape): ${containerPath}`);
    }
    const realFileRelative = relative(workspaceDir, realFile);
    if (realFileRelative.startsWith("..") || isAbsolute(realFileRelative)) {
      throw new Error(`Bridge requested path outside workspace (symlink escape): ${containerPath}`);
    }
  }
  return hostPath;
};

const isDockerMissingError = (error: unknown): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
};

const runDockerCommand = async (
  spawnProcess: DockerSpawn,
  args: ReadonlyArray<string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> => {
  return await new Promise((resolve, reject) => {
    const child = spawnProcess("docker", [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      resolve({ code, stdout, stderr });
    });
  });
};

const resolveDockerImageRef = async (spawnProcess: DockerSpawn, image: string): Promise<string> => {
  const inspected = await runDockerCommand(spawnProcess, [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    image,
  ]);
  const imageId = inspected.stdout.trim();
  if (inspected.code === 0 && imageId.length > 0) {
    return imageId;
  }
  return image;
};

export class DockerSandbox implements SandboxProvider {
  constructor(private readonly spawnProcess: DockerSpawn = spawn as unknown as DockerSpawn) {}

  async execute(params: {
    code: string;
    sdkSource: string;
    toolCallHandler: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
    searchToolsHandler?: (query: string, options?: Record<string, unknown>) => Promise<unknown>;
    timeoutMs?: number;
  }): Promise<SandboxExecutionResult> {
    const started = Date.now();
    const timeoutMs = Math.max(1, Math.floor(params.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    await mkdir(HOST_WORKSPACE_ROOT, { recursive: true });
    const workspaceDir = await mkdtemp(join(HOST_WORKSPACE_ROOT, HOST_WORKSPACE_PREFIX));
    const responseDir = join(workspaceDir, "responses");
    const containerName = `keppo-code-mode-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    let bridgeResult: BridgeResult | null = null;
    let stdoutRemainder = "";
    let stderrRemainder = "";
    let child: DockerChildProcess | null = null;
    let timedOut = false;

    const cleanup = async (): Promise<void> => {
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    };

    const cleanupContainer = async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        const killer = this.spawnProcess("docker", ["rm", "-f", containerName], {
          stdio: "ignore",
        });
        killer.on("error", () => resolve());
        killer.on("close", () => resolve());
      });
    };

    try {
      await mkdir(responseDir, { recursive: true });
      await writeFile(join(workspaceDir, "sdk.mjs"), params.sdkSource, "utf8");
      await writeFile(
        join(workspaceDir, "entry.mjs"),
        buildBridgeEntrySource(params.code, CONTAINER_RESPONSE_DIR),
        "utf8",
      );

      const configuredImage =
        process.env.KEPPO_CODE_MODE_DOCKER_IMAGE?.trim() || DEFAULT_DOCKER_IMAGE;
      const image = await resolveDockerImageRef(this.spawnProcess, configuredImage);
      const spawned = this.spawnProcess(
        "docker",
        [
          "run",
          "--rm",
          "--name",
          containerName,
          "--network",
          "none",
          "--workdir",
          CONTAINER_WORKDIR,
          "--volume",
          `${workspaceDir}:${CONTAINER_WORKDIR}:rw`,
          image,
          "node",
          "entry.mjs",
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child = spawned;

      const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          spawned.on("error", reject);
          spawned.on("close", (code: number | null, signal: NodeJS.Signals | null) =>
            resolve({ code, signal }),
          );
        },
      );

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        spawned.kill("SIGKILL");
      }, timeoutMs);
      let requestHandlingError: string | null = null;
      const pendingHandlers: Promise<void>[] = [];

      const handleRequest = async (request: BridgeRequest): Promise<void> => {
        let response: { ok: boolean; value?: unknown; error?: string };
        try {
          if (request.kind === "tool") {
            const value = await params.toolCallHandler(request.toolName, asRecord(request.input));
            response = { ok: true, value: safeJsonValue(value) };
          } else if (!params.searchToolsHandler) {
            response = { ok: true, value: [] };
          } else {
            const value = await params.searchToolsHandler(request.query, asRecord(request.options));
            response = { ok: true, value: safeJsonValue(value) };
          }
        } catch (error) {
          response = {
            ok: false,
            error: toBridgeErrorMessage(error),
          };
        }

        const hostResponsePath = await mapContainerPathToHost(workspaceDir, request.responsePath);
        try {
          await writeFile(hostResponsePath, JSON.stringify(response), "utf8");
        } catch {
          // Response directory may have been removed if the sandbox timed out
          // or was killed. Swallow the error to prevent an unhandled rejection
          // from crashing the host process.
        }
      };

      spawned.stdout.on("data", async (chunk: Buffer) => {
        const split = splitLines(chunk.toString("utf8"), stdoutRemainder);
        stdoutRemainder = split.remainder;

        for (const line of split.lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          if (trimmed.startsWith(REQUEST_PREFIX)) {
            const request = parseBridgeRequest(trimmed.slice(REQUEST_PREFIX.length));
            if (!request) {
              stdoutLines.push(trimmed);
              continue;
            }
            const handlerPromise = handleRequest(request).catch((error) => {
              requestHandlingError = toBridgeErrorMessage(error);
              spawned.kill("SIGKILL");
            });
            pendingHandlers.push(handlerPromise);
            await handlerPromise;
            continue;
          }
          if (trimmed.startsWith(RESULT_PREFIX)) {
            const result = parseBridgeResult(trimmed.slice(RESULT_PREFIX.length));
            if (result) {
              bridgeResult = result;
              continue;
            }
          }
          stdoutLines.push(trimmed);
        }
      });

      spawned.stderr.on("data", (chunk: Buffer) => {
        const split = splitLines(chunk.toString("utf8"), stderrRemainder);
        stderrRemainder = split.remainder;
        for (const line of split.lines) {
          const trimmed = line.trim();
          if (trimmed) {
            stderrLines.push(trimmed);
          }
        }
      });

      const finished = await exitPromise.finally(() => clearTimeout(timeoutHandle));

      // Drain any in-flight bridge handlers so requestHandlingError is set
      // before we read it. This closes the race where the container exits
      // before the async handler's catch block runs.
      await Promise.allSettled(pendingHandlers);

      if (stdoutRemainder.trim().length > 0) {
        stdoutLines.push(stdoutRemainder.trim());
      }
      if (stderrRemainder.trim().length > 0) {
        stderrLines.push(stderrRemainder.trim());
      }

      const settledBridgeResult = bridgeResult as BridgeResult | null;
      const logs = normalizeLogs(settledBridgeResult?.logs);
      const toolCallsExecuted = normalizeToolCalls(settledBridgeResult?.toolCallsExecuted);

      if (settledBridgeResult?.success) {
        return {
          success: true,
          output: {
            returnValue: settledBridgeResult.hasReturnValue
              ? settledBridgeResult.returnValue
              : undefined,
            logs,
          },
          toolCallsExecuted,
          durationMs: Date.now() - started,
        };
      }

      if (timedOut) {
        await cleanupContainer();
        return {
          success: false,
          output: { logs },
          error: "Execution timed out",
          failure: {
            type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
            errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.timeout,
            reason: "Code execution timed out.",
          },
          toolCallsExecuted,
          durationMs: Date.now() - started,
        };
      }

      const bridgeError = asNonEmptyString(settledBridgeResult?.error);
      const requestError = asNonEmptyString(requestHandlingError);
      const stderrError = stderrLines.length > 0 ? stderrLines.join("\n") : null;
      const stdoutError = stdoutLines.length > 0 ? stdoutLines.join("\n") : null;
      const exitDetails =
        finished.code !== 0 || finished.signal
          ? `Docker sandbox exited with code ${finished.code ?? "null"}${finished.signal ? ` (signal ${finished.signal})` : ""}`
          : null;

      return {
        success: false,
        output: { logs },
        error:
          requestError ??
          bridgeError ??
          stderrError ??
          stdoutError ??
          exitDetails ??
          DEFAULT_RESULT_ERROR,
        failure: {
          type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
          errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxRuntimeFailed,
          reason: "Code execution failed in the sandbox runtime.",
        },
        toolCallsExecuted,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      const dockerUnavailable = isDockerMissingError(error);
      return {
        success: false,
        output: { logs: [] },
        error: dockerUnavailable
          ? "Docker sandbox provider is unavailable. Install Docker Desktop or set KEPPO_CODE_MODE_SANDBOX_PROVIDER=vercel."
          : toBridgeErrorMessage(error),
        failure: {
          type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
          errorCode: dockerUnavailable
            ? CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxUnavailable
            : CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxStartupFailed,
          reason: dockerUnavailable
            ? "Docker sandbox provider is unavailable."
            : "Docker sandbox failed to start.",
        },
        toolCallsExecuted: [],
        durationMs: Date.now() - started,
      };
    } finally {
      await cleanup();
    }
  }
}
