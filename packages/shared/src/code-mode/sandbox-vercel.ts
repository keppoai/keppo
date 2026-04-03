import type { SandboxExecutionResult, SandboxProvider } from "./sandbox.js";
import { buildBridgeEntrySource, REQUEST_PREFIX, RESULT_PREFIX } from "./sandbox-bridge.js";
import { parseJsonValue } from "../providers/boundaries/json.js";
import {
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE,
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE,
} from "./structured-execution-error.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const SANDBOX_WORKDIR = "/vercel/sandbox";
const RESPONSE_DIR = "/tmp/keppo-code-mode-responses";
const DEFAULT_RESULT_ERROR = "Code execution failed in Vercel sandbox.";

type VercelCommandLog = {
  data: string;
  stream: "stdout" | "stderr";
};

type VercelCommand = {
  logs(options?: { signal?: AbortSignal }): AsyncIterable<VercelCommandLog>;
  wait(options?: { signal?: AbortSignal }): Promise<{ exitCode: number | null }>;
  kill?: () => Promise<void>;
};

type VercelSandboxInstance = {
  writeFiles(files: Array<{ path: string; content: Buffer }>): Promise<void>;
  runCommand(options: {
    cmd: string;
    args?: string[];
    cwd?: string;
    detached: true;
    signal?: AbortSignal;
  }): Promise<VercelCommand>;
  stop(options?: { signal?: AbortSignal; blocking?: boolean }): Promise<unknown>;
};

type VercelSandboxModule = {
  Sandbox?: {
    create?: (options: {
      runtime?: string;
      networkPolicy?: string;
      timeout?: number;
    }) => Promise<VercelSandboxInstance>;
  };
};

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

type SandboxLoader = () => Promise<VercelSandboxModule>;

const defaultSandboxLoader: SandboxLoader = async () => {
  return (await import("@vercel/sandbox")) as unknown as VercelSandboxModule;
};

const isAbortError = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const name =
    "name" in value && typeof value.name === "string" ? value.name.toLowerCase() : undefined;
  return name === "aborterror";
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

export class VercelSandbox implements SandboxProvider {
  private readonly loadSandboxSdk: SandboxLoader;

  constructor(loader: SandboxLoader = defaultSandboxLoader) {
    this.loadSandboxSdk = loader;
  }

  async execute(params: {
    code: string;
    sdkSource: string;
    toolCallHandler: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
    searchToolsHandler?: (query: string, options?: Record<string, unknown>) => Promise<unknown>;
    timeoutMs?: number;
  }): Promise<SandboxExecutionResult> {
    const started = Date.now();
    const timeoutMs = Math.max(1, Math.floor(params.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    let sandbox: VercelSandboxInstance | null = null;
    let command: VercelCommand | null = null;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    let bridgeResult: BridgeResult | null = null;
    let stdoutRemainder = "";
    let stderrRemainder = "";

    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);

    let sandboxSdk: VercelSandboxModule;
    try {
      sandboxSdk = await this.loadSandboxSdk();
    } catch {
      throw new Error(
        "Vercel sandbox provider is unavailable. Install @vercel/sandbox or use KEPPO_CODE_MODE_SANDBOX_PROVIDER=docker.",
      );
    }

    const sandboxFactory = sandboxSdk.Sandbox?.create;
    if (typeof sandboxFactory !== "function") {
      throw new Error("@vercel/sandbox is installed but does not expose Sandbox.create().");
    }

    try {
      sandbox = await sandboxFactory({
        runtime: "node24",
        networkPolicy: "deny-all",
        timeout: timeoutMs + 5_000,
      });
      const sandboxInstance = sandbox;

      await sandboxInstance.writeFiles([
        {
          path: `${SANDBOX_WORKDIR}/sdk.mjs`,
          content: Buffer.from(params.sdkSource, "utf8"),
        },
        {
          path: `${SANDBOX_WORKDIR}/entry.mjs`,
          content: Buffer.from(buildBridgeEntrySource(params.code, RESPONSE_DIR), "utf8"),
        },
      ]);

      command = await sandboxInstance.runCommand({
        cmd: "node",
        args: ["entry.mjs"],
        cwd: SANDBOX_WORKDIR,
        detached: true,
        signal: timeoutController.signal,
      });

      const handleRequest = async (request: BridgeRequest): Promise<void> => {
        let response: { ok: boolean; value?: unknown; error?: string };
        try {
          if (request.kind === "tool") {
            const value = await params.toolCallHandler(request.toolName, asRecord(request.input));
            response = {
              ok: true,
              value: safeJsonValue(value),
            };
          } else {
            if (!params.searchToolsHandler) {
              response = { ok: true, value: [] };
            } else {
              const value = await params.searchToolsHandler(
                request.query,
                asRecord(request.options),
              );
              response = {
                ok: true,
                value: safeJsonValue(value),
              };
            }
          }
        } catch (error) {
          response = {
            ok: false,
            error: toBridgeErrorMessage(error),
          };
        }
        await sandboxInstance.writeFiles([
          {
            path: request.responsePath,
            content: Buffer.from(JSON.stringify(response), "utf8"),
          },
        ]);
      };

      for await (const log of command.logs({ signal: timeoutController.signal })) {
        const split =
          log.stream === "stdout"
            ? splitLines(log.data, stdoutRemainder)
            : splitLines(log.data, stderrRemainder);

        if (log.stream === "stdout") {
          stdoutRemainder = split.remainder;
        } else {
          stderrRemainder = split.remainder;
        }

        for (const line of split.lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          if (log.stream === "stdout" && trimmed.startsWith(REQUEST_PREFIX)) {
            const request = parseBridgeRequest(trimmed.slice(REQUEST_PREFIX.length));
            if (!request) {
              stdoutLines.push(trimmed);
              continue;
            }
            await handleRequest(request);
            continue;
          }
          if (log.stream === "stdout" && trimmed.startsWith(RESULT_PREFIX)) {
            const result = parseBridgeResult(trimmed.slice(RESULT_PREFIX.length));
            if (result) {
              bridgeResult = result;
              continue;
            }
          }
          if (log.stream === "stdout") {
            stdoutLines.push(trimmed);
          } else {
            stderrLines.push(trimmed);
          }
        }
      }

      if (stdoutRemainder.trim().length > 0) {
        stdoutLines.push(stdoutRemainder.trim());
      }
      if (stderrRemainder.trim().length > 0) {
        stderrLines.push(stderrRemainder.trim());
      }

      const finished = await command.wait({ signal: timeoutController.signal });
      const logs = normalizeLogs(bridgeResult?.logs);
      const toolCallsExecuted = normalizeToolCalls(bridgeResult?.toolCallsExecuted);

      if (bridgeResult?.success) {
        return {
          success: true,
          output: {
            returnValue: bridgeResult.hasReturnValue ? bridgeResult.returnValue : undefined,
            logs,
          },
          toolCallsExecuted,
          durationMs: Date.now() - started,
        };
      }

      if (timeoutController.signal.aborted || isAbortError(finished)) {
        return {
          success: false,
          output: {
            logs,
          },
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

      const bridgeError = asNonEmptyString(bridgeResult?.error);
      const stderrError = stderrLines.length > 0 ? stderrLines.join("\n") : null;
      const stdoutError = stdoutLines.length > 0 ? stdoutLines.join("\n") : null;
      const exitCodeError =
        typeof finished.exitCode === "number" && finished.exitCode !== 0
          ? `Sandbox process exited with code ${finished.exitCode}.`
          : null;

      const message =
        bridgeError ?? stderrError ?? stdoutError ?? exitCodeError ?? DEFAULT_RESULT_ERROR;

      return {
        success: false,
        output: {
          logs,
        },
        error: message,
        failure: {
          type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
          errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxRuntimeFailed,
          reason: "Code execution failed in the sandbox runtime.",
        },
        toolCallsExecuted,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      const message = toBridgeErrorMessage(error) || DEFAULT_RESULT_ERROR;
      if (timeoutController.signal.aborted || isAbortError(error)) {
        if (command?.kill) {
          try {
            await command.kill();
          } catch {}
        }
        return {
          success: false,
          output: {
            logs: [],
          },
          error: "Execution timed out",
          failure: {
            type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
            errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.timeout,
            reason: "Code execution timed out.",
          },
          toolCallsExecuted: [],
          durationMs: Date.now() - started,
        };
      }

      return {
        success: false,
        output: {
          logs: [],
        },
        error: message,
        failure: {
          type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
          errorCode: message.includes("Sandbox.create")
            ? CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxStartupFailed
            : CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxUnavailable,
          reason: message.includes("Sandbox.create")
            ? "Vercel sandbox failed to start."
            : "Vercel sandbox provider is unavailable.",
        },
        toolCallsExecuted: [],
        durationMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timeoutHandle);
      if (sandbox) {
        try {
          await sandbox.stop({ blocking: true });
        } catch {}
      }
    }
  }
}
