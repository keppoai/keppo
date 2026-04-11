import { spawn, type SpawnOptions } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseJsonValue } from "../providers/boundaries/json.js";
import type { SandboxExecutionResult, SandboxProvider } from "./sandbox.js";
import {
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE,
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE,
} from "./structured-execution-error.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_PROJECT_DIR = "../jslite";
const DEFAULT_RESULT_ERROR = "Code execution failed in JSLite sandbox.";
const DEFAULT_UNAVAILABLE_ERROR =
  "JSLite sandbox provider is unavailable. Build jslite-sidecar in KEPPO_JSLITE_PROJECT_PATH (or ../jslite) or set KEPPO_JSLITE_SIDECAR_PATH to a built binary.";
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_LINE_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_LINES = 200;
const STRUCTURED_VALUE_FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type JsliteStructuredValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | JsliteStructuredValue[]
  | { [key: string]: JsliteStructuredValue };

type EncodedStructuredValue =
  | "Undefined"
  | "Null"
  | { Bool: boolean }
  | { String: string }
  | { Number: "NaN" | "Infinity" | "NegInfinity" | "NegZero" | { Finite: number } }
  | { Array: EncodedStructuredValue[] }
  | { Object: Record<string, EncodedStructuredValue> };

type JsliteStep =
  | {
      type: "completed";
      value: EncodedStructuredValue;
    }
  | {
      type: "suspended";
      capability: string;
      args: EncodedStructuredValue[];
      snapshot_base64: string;
    };

type JsliteResponse =
  | {
      id: number;
      ok: true;
      result:
        | {
            kind: "program";
            program_base64: string;
          }
        | {
            kind: "step";
            step: JsliteStep;
          };
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

type JsliteProgramResult = {
  success: boolean;
  logs?: unknown;
  hasReturnValue?: unknown;
  returnValue?: unknown;
  toolCallsExecuted?: unknown;
  error?: unknown;
};

export type JsliteChildProcess = {
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on: ((
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ) => unknown) &
    ((event: "error", listener: (error: Error) => void) => unknown) &
    ((event: string, listener: (...args: unknown[]) => void) => unknown);
  kill: (signal?: NodeJS.Signals) => boolean;
};

export type JsliteSpawn = (
  command: string,
  args?: ReadonlyArray<string>,
  options?: SpawnOptions,
) => JsliteChildProcess;

type LaunchCommand = {
  command: string;
  args: string[];
};

type JsliteSandboxOptions = {
  spawnProcess?: JsliteSpawn;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  fileExists?: (path: string) => Promise<boolean>;
};

const isPlainStructuredObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertSafeStructuredKey = (key: string): void => {
  if (STRUCTURED_VALUE_FORBIDDEN_KEYS.has(key)) {
    throw new Error(
      `JSLite structured values may not include the reserved key ${JSON.stringify(key)}.`,
    );
  }
};

const failureForBridgeError = (message: string) => ({
  type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
  errorCode: isValidationFailure(message)
    ? CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.validationFailed
    : CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxRuntimeFailed,
  reason: isValidationFailure(message) ? message : "Code execution failed in the sandbox runtime.",
});

const toStructuredValue = (
  value: unknown,
  seen: Set<object> = new Set(),
): JsliteStructuredValue => {
  if (
    value === undefined ||
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
  }
  if (Array.isArray(value)) {
    const array = value.map((entry) => toStructuredValue(entry, seen));
    seen.delete(value);
    return array;
  }
  if (!isPlainStructuredObject(value)) {
    seen.delete(value);
    return String(value);
  }
  const record: Record<string, JsliteStructuredValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    assertSafeStructuredKey(key);
    record[key] = toStructuredValue(entry, seen);
  }
  seen.delete(value);
  return record;
};

const isSpawnUnavailableError = (error: unknown): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "ENOENT" ||
      (error as { code?: unknown }).code === "EACCES")
  );
};

const encodeNumber = (value: number): EncodedStructuredValue => {
  if (Number.isNaN(value)) {
    return { Number: "NaN" };
  }
  if (Object.is(value, -0)) {
    return { Number: "NegZero" };
  }
  if (value === Infinity) {
    return { Number: "Infinity" };
  }
  if (value === -Infinity) {
    return { Number: "NegInfinity" };
  }
  return { Number: { Finite: value } };
};

const encodeStructured = (value: JsliteStructuredValue): EncodedStructuredValue => {
  if (value === undefined) {
    return "Undefined";
  }
  if (value === null) {
    return "Null";
  }
  if (typeof value === "boolean") {
    return { Bool: value };
  }
  if (typeof value === "number") {
    return encodeNumber(value);
  }
  if (typeof value === "string") {
    return { String: value };
  }
  if (Array.isArray(value)) {
    return { Array: value.map((entry) => encodeStructured(entry)) };
  }
  const object: Record<string, EncodedStructuredValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    assertSafeStructuredKey(key);
    object[key] = encodeStructured(entry);
  }
  return { Object: object };
};

const decodeStructured = (value: EncodedStructuredValue): JsliteStructuredValue => {
  if (value === "Undefined") {
    return undefined;
  }
  if (value === "Null") {
    return null;
  }
  if ("Bool" in value) {
    return value.Bool;
  }
  if ("String" in value) {
    return value.String;
  }
  if ("Number" in value) {
    const encoded = value.Number;
    if (encoded === "NaN") {
      return NaN;
    }
    if (encoded === "Infinity") {
      return Infinity;
    }
    if (encoded === "NegInfinity") {
      return -Infinity;
    }
    if (encoded === "NegZero") {
      return -0;
    }
    return encoded.Finite;
  }
  if ("Array" in value) {
    return value.Array.map((entry) => decodeStructured(entry));
  }
  const object: Record<string, JsliteStructuredValue> = {};
  for (const [key, entry] of Object.entries(value.Object)) {
    assertSafeStructuredKey(key);
    object[key] = decodeStructured(entry);
  }
  return object;
};

const asNonEmptyString = (value: unknown): string | null => {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return isPlainStructuredObject(value) ? value : {};
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
    if (!isPlainStructuredObject(entry)) {
      continue;
    }
    if (typeof entry.toolName !== "string" || entry.toolName.length === 0) {
      continue;
    }
    calls.push({
      toolName: entry.toolName,
      input: asRecord(entry.input),
      output: entry.output,
    });
  }
  return calls;
};

const isValidationFailure = (message: string): boolean => {
  return message.startsWith("Parse:") || message.startsWith("Validation:");
};

const toGuestErrorPayload = (
  error: unknown,
): {
  type: "error";
  error: {
    name: string;
    message: string;
    code?: string | null;
    details?: EncodedStructuredValue | null;
  };
} => {
  const source = error instanceof Error ? error : Object(error);
  const named = source as Error & { code?: unknown; details?: unknown };
  return {
    type: "error",
    error: {
      name: named.name || "Error",
      message: named.message || String(error),
      ...(typeof named.code === "string" ? { code: named.code } : { code: null }),
      ...(named.details === undefined
        ? { details: null }
        : { details: encodeStructured(toStructuredValue(named.details)) }),
    },
  };
};

const buildProgramSource = (code: string, sdkSource: string): string => {
  return [
    '"use strict";',
    "",
    "const __keppo_logs = [];",
    "const __keppo_tool_calls_executed = [];",
    "",
    "function __keppo_stringify_console_args(args) {",
    "  return args.map(function (value) {",
    '    if (typeof value === "string") {',
    "      return value;",
    "    }",
    "    try {",
    "      return JSON.stringify(value);",
    "    } catch {",
    "      return String(value);",
    "    }",
    '  }).join(" ");',
    "}",
    "",
    "function __keppo_to_safe_record(value) {",
    '  if (value && typeof value === "object" && !Array.isArray(value)) {',
    "    return value;",
    "  }",
    "  return {};",
    "}",
    "",
    "async function __keppo_execute_tool(toolName, args) {",
    "  const input = __keppo_to_safe_record(args);",
    "  const output = await __keppo_call_tool(toolName, input);",
    "  __keppo_tool_calls_executed.push({ toolName: toolName, input: input, output: output });",
    "  return output;",
    "}",
    "",
    "async function __keppo_execute_search_tools(query, options) {",
    '  if (typeof query !== "string" || query.trim().length === 0) {',
    "    return [];",
    "  }",
    "  return __keppo_search_tools(query, __keppo_to_safe_record(options));",
    "}",
    "",
    "const console = {};",
    "console.log = function (...args) {",
    "  __keppo_logs.push(__keppo_stringify_console_args(args));",
    "  return undefined;",
    "};",
    "console.warn = function (...args) {",
    "  __keppo_logs.push(`[warn] ${__keppo_stringify_console_args(args)}`);",
    "  return undefined;",
    "};",
    "console.error = function (...args) {",
    "  __keppo_logs.push(`[error] ${__keppo_stringify_console_args(args)}`);",
    "  return undefined;",
    "};",
    "",
    sdkSource,
    "",
    "async function __keppo_main() {",
    code,
    "}",
    "",
    "async function __keppo_run() {",
    "  try {",
    "    const returnValue = await __keppo_main();",
    "    return {",
    "      success: true,",
    "      hasReturnValue: returnValue !== undefined,",
    "      returnValue: returnValue,",
    "      logs: __keppo_logs,",
    "      toolCallsExecuted: __keppo_tool_calls_executed,",
    "    };",
    "  } catch (error) {",
    "    return {",
    "      success: false,",
    "      error: error instanceof Error ? error.message : String(error),",
    "      logs: __keppo_logs,",
    "      toolCallsExecuted: __keppo_tool_calls_executed,",
    "    };",
    "  }",
    "}",
    "",
    "__keppo_run();",
  ].join("\n");
};

const parseResponse = (line: string): JsliteResponse => {
  const parsed = parseJsonValue(line) as {
    id?: unknown;
    ok?: unknown;
    result?: unknown;
    error?: unknown;
  };
  if (typeof parsed.id !== "number" || typeof parsed.ok !== "boolean") {
    throw new Error("JSLite sidecar returned an invalid response envelope.");
  }
  if (!parsed.ok) {
    if (typeof parsed.error !== "string") {
      throw new Error("JSLite sidecar returned an invalid error response.");
    }
    return {
      id: parsed.id,
      ok: false,
      error: parsed.error,
    };
  }
  if (!isPlainStructuredObject(parsed.result) || typeof parsed.result.kind !== "string") {
    throw new Error("JSLite sidecar returned an invalid success response.");
  }
  if (parsed.result.kind === "program" && typeof parsed.result.program_base64 === "string") {
    return {
      id: parsed.id,
      ok: true,
      result: {
        kind: "program",
        program_base64: parsed.result.program_base64,
      },
    };
  }
  if (parsed.result.kind === "step" && isPlainStructuredObject(parsed.result.step)) {
    return {
      id: parsed.id,
      ok: true,
      result: {
        kind: "step",
        step: parsed.result.step as JsliteStep,
      },
    };
  }
  throw new Error("JSLite sidecar returned an unsupported success payload.");
};

const defaultFileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const pushStderrLine = (stderrLines: string[], message: string): void => {
  if (message.length === 0) {
    return;
  }
  stderrLines.push(message);
  if (stderrLines.length > MAX_STDERR_LINES) {
    stderrLines.splice(0, stderrLines.length - MAX_STDERR_LINES);
  }
};

export class JsliteSandbox implements SandboxProvider {
  private readonly spawnProcess: JsliteSpawn;
  private readonly env: NodeJS.ProcessEnv;
  private readonly cwd: string;
  private readonly fileExists: (path: string) => Promise<boolean>;

  constructor(options: JsliteSandboxOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? (spawn as unknown as JsliteSpawn);
    this.env = options.env ?? process.env;
    this.cwd = options.cwd ?? process.cwd();
    this.fileExists = options.fileExists ?? defaultFileExists;
  }

  private async resolveLaunchCommand(): Promise<LaunchCommand | null> {
    const explicitPath = this.env["KEPPO_JSLITE_SIDECAR_PATH"]?.trim();
    if (explicitPath) {
      return (await this.fileExists(explicitPath)) ? { command: explicitPath, args: [] } : null;
    }

    const binaryName = process.platform === "win32" ? "jslite-sidecar.exe" : "jslite-sidecar";
    const projectPath =
      this.env["KEPPO_JSLITE_PROJECT_PATH"]?.trim() || resolve(this.cwd, DEFAULT_PROJECT_DIR);
    const releasePath = join(projectPath, "target", "release", binaryName);
    if (await this.fileExists(releasePath)) {
      return { command: releasePath, args: [] };
    }
    const debugPath = join(projectPath, "target", "debug", binaryName);
    if (await this.fileExists(debugPath)) {
      return { command: debugPath, args: [] };
    }

    return null;
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
    const launchCommand = await this.resolveLaunchCommand();
    if (!launchCommand) {
      return {
        success: false,
        output: { logs: [] },
        error: DEFAULT_UNAVAILABLE_ERROR,
        failure: {
          type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
          errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxUnavailable,
          reason: "JSLite sandbox provider is unavailable.",
        },
        toolCallsExecuted: [],
        durationMs: Date.now() - started,
      };
    }

    const programSource = buildProgramSource(params.code, params.sdkSource);
    const child = this.spawnProcess(launchCommand.command, launchCommand.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!child.stdin) {
      return {
        success: false,
        output: { logs: [] },
        error: DEFAULT_RESULT_ERROR,
        failure: {
          type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
          errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxStartupFailed,
          reason: "JSLite sidecar could not be started.",
        },
        toolCallsExecuted: [],
        durationMs: Date.now() - started,
      };
    }

    const stderrLines: string[] = [];
    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString("utf8").trim();
      pushStderrLine(stderrLines, text);
    });
    child.stdin.on("error", (error) => {
      pushStderrLine(stderrLines, `stdin: ${error.message}`);
    });

    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    let exitError: Error | null = null;
    const exitPromise = new Promise<"exit">((resolve) => {
      child.on("error", (error) => {
        exitError = error;
        resolve("exit");
      });
      child.on("close", (code, signal) => {
        if (!exitError) {
          const stderr = stderrLines.join("\n").trim();
          exitError = Object.assign(
            new Error(
              stderr ||
                `JSLite sidecar exited before returning a response (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
            ),
            { code, signal },
          );
        }
        resolve("exit");
      });
    });
    const bufferedLines: string[] = [];
    let stdoutBuffer = "";
    let stdoutEnded = false;
    let pendingLineResolve: ((result: IteratorResult<string>) => void) | null = null;
    let stdoutReadError: Error | null = null;
    const flushPendingLine = (): void => {
      if (!pendingLineResolve) {
        return;
      }
      if (bufferedLines.length > 0) {
        const resolvePending = pendingLineResolve;
        pendingLineResolve = null;
        resolvePending({ done: false, value: bufferedLines.shift()! });
        return;
      }
      if (stdoutReadError || stdoutEnded) {
        const resolvePending = pendingLineResolve;
        pendingLineResolve = null;
        resolvePending({ done: true, value: undefined });
      }
    };
    const failStdoutRead = (message: string): void => {
      if (stdoutReadError) {
        return;
      }
      stdoutReadError = new Error(message);
      child.kill("SIGKILL");
      flushPendingLine();
    };
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString("utf8");
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (Buffer.byteLength(line, "utf8") > MAX_RESPONSE_LINE_BYTES) {
          failStdoutRead(
            `JSLite sidecar returned a response line larger than ${MAX_RESPONSE_LINE_BYTES} bytes.`,
          );
          return;
        }
        bufferedLines.push(line);
        flushPendingLine();
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
      if (Buffer.byteLength(stdoutBuffer, "utf8") > MAX_RESPONSE_LINE_BYTES) {
        failStdoutRead(
          `JSLite sidecar returned a response line larger than ${MAX_RESPONSE_LINE_BYTES} bytes.`,
        );
      }
    });
    child.stdout.on("end", () => {
      if (stdoutBuffer.length > 0) {
        if (Buffer.byteLength(stdoutBuffer, "utf8") > MAX_RESPONSE_LINE_BYTES) {
          failStdoutRead(
            `JSLite sidecar returned a response line larger than ${MAX_RESPONSE_LINE_BYTES} bytes.`,
          );
          return;
        }
        bufferedLines.push(stdoutBuffer);
        stdoutBuffer = "";
      }
      stdoutEnded = true;
      flushPendingLine();
    });
    child.stdout.on("error", (error) => {
      stdoutReadError = error;
      flushPendingLine();
    });
    let nextRequestId = 1;
    const nextLine = async (): Promise<IteratorResult<string>> => {
      if (bufferedLines.length > 0) {
        return { done: false, value: bufferedLines.shift()! };
      }
      if (stdoutReadError || stdoutEnded) {
        return { done: true, value: undefined };
      }
      return await new Promise<IteratorResult<string>>((resolve) => {
        pendingLineResolve = resolve;
      });
    };
    const writeRequestLine = async (line: string): Promise<void> => {
      if (!child.stdin || !child.stdin.writable) {
        throw exitError ?? new Error("JSLite sidecar stdin is no longer writable.");
      }
      const stream = child.stdin as NodeJS.WritableStream & NodeJS.EventEmitter;
      const shouldContinue = stream.write(line);
      if (shouldContinue) {
        return;
      }
      const drainPromise = once(stream, "drain").then(() => ({ kind: "drain" as const }));
      drainPromise.catch(() => {});
      const drainResult = await Promise.race([
        drainPromise,
        exitPromise.then(() => ({ kind: "exit" as const })),
      ]);
      if (drainResult.kind === "exit") {
        throw exitError ?? new Error("JSLite sidecar stopped responding.");
      }
    };

    const sendRequest = async (payload: Record<string, unknown>): Promise<JsliteResponse> => {
      const requestId = nextRequestId++;
      const requestLine = `${JSON.stringify({ ...payload, id: requestId })}\n`;
      if (Buffer.byteLength(requestLine, "utf8") > MAX_REQUEST_BYTES) {
        throw new Error(`JSLite bridge request exceeded ${MAX_REQUEST_BYTES} bytes.`);
      }
      await writeRequestLine(requestLine);
      const lineResult = await Promise.race([
        nextLine().then((result) => ({ kind: "line" as const, result })),
        exitPromise.then(() => ({ kind: "exit" as const })),
      ]);
      if (lineResult.kind === "exit") {
        throw exitError ?? new Error("JSLite sidecar stopped responding.");
      }
      if (stdoutReadError) {
        throw stdoutReadError;
      }
      if (lineResult.result.done || typeof lineResult.result.value !== "string") {
        throw new Error("JSLite sidecar closed stdout before returning a response.");
      }
      const response = parseResponse(lineResult.result.value);
      if (response.id !== requestId) {
        throw new Error("JSLite sidecar returned a mismatched response id.");
      }
      return response;
    };

    try {
      const compileResponse = await sendRequest({
        method: "compile",
        source: programSource,
      });
      if (!compileResponse.ok) {
        return {
          success: false,
          output: { logs: [] },
          error: compileResponse.error,
          failure: failureForBridgeError(compileResponse.error),
          toolCallsExecuted: [],
          durationMs: Date.now() - started,
        };
      }
      if (compileResponse.result.kind !== "program") {
        throw new Error("JSLite sidecar returned an unexpected compile response.");
      }

      let stepResponse = await sendRequest({
        method: "start",
        program_base64: compileResponse.result.program_base64,
        options: {
          inputs: {},
          capabilities: ["__keppo_call_tool", "__keppo_search_tools"],
        },
      });

      while (stepResponse.ok && stepResponse.result.kind === "step") {
        const step = stepResponse.result.step;
        if (step.type === "completed") {
          const value = decodeStructured(step.value);
          const result = isPlainStructuredObject(value) ? (value as JsliteProgramResult) : null;
          if (!result) {
            throw new Error("JSLite sandbox returned an invalid completion payload.");
          }
          if (!result.success) {
            const error = asNonEmptyString(result.error) ?? DEFAULT_RESULT_ERROR;
            return {
              success: false,
              output: {
                logs: normalizeLogs(result.logs),
              },
              error,
              failure: failureForBridgeError(error),
              toolCallsExecuted: normalizeToolCalls(result.toolCallsExecuted),
              durationMs: Date.now() - started,
            };
          }
          return {
            success: true,
            output: {
              logs: normalizeLogs(result.logs),
              ...(result.hasReturnValue === true ? { returnValue: result.returnValue } : {}),
            },
            toolCallsExecuted: normalizeToolCalls(result.toolCallsExecuted),
            durationMs: Date.now() - started,
          };
        }

        const decodedArgs = step.args.map((entry) => decodeStructured(entry));
        let resumePayload:
          | {
              type: "value";
              value: EncodedStructuredValue;
            }
          | {
              type: "error";
              error: {
                name: string;
                message: string;
                code?: string | null;
                details?: EncodedStructuredValue | null;
              };
            };

        try {
          if (step.capability === "__keppo_call_tool") {
            const toolName = asNonEmptyString(decodedArgs[0]);
            if (!toolName) {
              throw new Error("JSLite bridge requested a tool call without a tool name.");
            }
            const value = await params.toolCallHandler(toolName, asRecord(decodedArgs[1]));
            resumePayload = {
              type: "value",
              value: encodeStructured(toStructuredValue(value)),
            };
          } else if (step.capability === "__keppo_search_tools") {
            const query = asNonEmptyString(decodedArgs[0]) ?? "";
            const value = params.searchToolsHandler
              ? await params.searchToolsHandler(query, asRecord(decodedArgs[1]))
              : [];
            resumePayload = {
              type: "value",
              value: encodeStructured(toStructuredValue(value)),
            };
          } else {
            throw new Error(`Unknown JSLite bridge capability: ${step.capability}`);
          }
        } catch (error) {
          resumePayload = toGuestErrorPayload(error);
        }

        stepResponse = await sendRequest({
          method: "resume",
          snapshot_base64: step.snapshot_base64,
          payload: resumePayload,
        });
      }

      if (!stepResponse.ok) {
        return {
          success: false,
          output: { logs: [] },
          error: stepResponse.error,
          failure: failureForBridgeError(stepResponse.error),
          toolCallsExecuted: [],
          durationMs: Date.now() - started,
        };
      }

      throw new Error("JSLite sidecar returned an unexpected execution state.");
    } catch (error) {
      if (timedOut) {
        return {
          success: false,
          output: { logs: [] },
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

      const message = error instanceof Error ? error.message : String(error);
      const unavailable = isSpawnUnavailableError(error);
      return {
        success: false,
        output: { logs: [] },
        error: unavailable ? DEFAULT_UNAVAILABLE_ERROR : message || DEFAULT_RESULT_ERROR,
        failure: {
          type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
          errorCode: unavailable
            ? CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxUnavailable
            : CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxRuntimeFailed,
          reason: unavailable
            ? "JSLite sandbox provider is unavailable."
            : "Code execution failed in the sandbox runtime.",
        },
        toolCallsExecuted: [],
        durationMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timeoutHandle);
      try {
        child.stdin?.end();
      } catch {
        // Ignore stream shutdown races after the sidecar exits.
      }
      child.kill("SIGKILL");
    }
  }
}
