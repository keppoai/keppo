import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "../json-types.js";
import { UnikraftCloudClient } from "../unikraft/client.js";
import type { UnikraftInstance, UnikraftInstanceLog } from "../unikraft/types.js";
import {
  parseCodeModeHttpBridgeRequest,
  serializeCodeModeBridgeResponseFile,
  toBridgeRequestObject,
  tryParseCodeModeBridgeResult,
  type CodeModeBridgeResult,
  type CodeModeHttpBridgeRequest,
} from "./bridge-contracts.js";
import { buildHttpBridgeEntrySource, REQUEST_PREFIX, RESULT_PREFIX } from "./sandbox-bridge.js";
import type { SandboxExecutionResult, SandboxProvider } from "./sandbox.js";
import {
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE,
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE,
} from "./structured-execution-error.js";
import type { ToolSearchResult } from "./tool-search-types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_IMAGE = "node:22-alpine";
const DEFAULT_LOG_POLL_INTERVAL_MS = 500;
const DEFAULT_LOG_LIMIT_BYTES = 16_384;
const MAX_BRIDGE_BODY_BYTES = 128 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024;
const DEFAULT_RESULT_ERROR = "Code execution failed in the remote sandbox.";
const OVERSIZED_SOURCE_ERROR =
  "Your code is too large to execute. Please reduce its size and try again.";
const TERMINAL_STATE_ERROR = "The remote sandbox stopped before returning a result.";
const TERMINAL_FAILURE_ERROR = "The remote sandbox stopped with an execution error.";
const PROVIDER_UNAVAILABLE_ERROR =
  "The remote sandbox could not execute your request. Please try again.";
const BRIDGE_UNAUTHORIZED_RESPONSE = JSON.stringify({
  ok: false,
  error: "Bridge request was not authorized.",
});
const INSTANCE_STATE_POLL_INTERVAL = 5;

const TERMINAL_INSTANCE_STATES = new Set([
  "stopped",
  "stopping",
  "exited",
  "failed",
  "error",
  "deleted",
  "terminated",
  "crashed",
]);

type BridgeServer = {
  callbackUrl: string;
  authToken: string;
  close: () => Promise<void>;
};

type BridgeServerOptions = {
  bridgeBaseUrl?: string;
  bindHost?: string;
};

type UnikraftCloudClientLike = Pick<
  UnikraftCloudClient,
  "createInstance" | "getInstance" | "getInstanceLogs" | "stopInstance" | "deleteInstance"
>;

const asNonEmptyString = (value: unknown): string | null => {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const asRecord = (value: unknown): JsonObject => {
  const parsed = jsonObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
};

const normalizeLogs = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
};

const safeJsonValue = (value: unknown): JsonValue => {
  const parsed = jsonValueSchema.safeParse(value);
  return parsed.success ? parsed.data : String(value);
};

const normalizeToolCalls = (
  value: unknown,
): Array<{ toolName: string; input: JsonObject; output: JsonValue }> => {
  if (!Array.isArray(value)) {
    return [];
  }
  const calls: Array<{ toolName: string; input: JsonObject; output: JsonValue }> = [];
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
      output: safeJsonValue(typed.output),
    });
  }
  return calls;
};

const toBridgeErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
};

const toInstanceState = (instance: Pick<UnikraftInstance, "state"> | null): string | null => {
  const value = instance?.state?.trim().toLowerCase();
  return value && value.length > 0 ? value : null;
};

const isTerminalState = (instance: Pick<UnikraftInstance, "state"> | null): boolean => {
  const state = toInstanceState(instance);
  return state ? TERMINAL_INSTANCE_STATES.has(state) : false;
};

const deriveFailureForTerminalState = (
  state: string | null,
): { errorCode: string; reason: string } => {
  if (state === "failed" || state === "error" || state === "crashed") {
    return {
      errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxRuntimeFailed,
      reason: TERMINAL_FAILURE_ERROR,
    };
  }
  return {
    errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxRuntimeFailed,
    reason: TERMINAL_STATE_ERROR,
  };
};

const extractLogText = (
  entry:
    | string
    | {
        message?: string | undefined;
        content?: string | undefined;
        line?: string | undefined;
      },
): string => {
  if (typeof entry === "string") {
    return entry;
  }
  return entry.message ?? entry.content ?? entry.line ?? "";
};

const splitSnapshotLines = (
  normalized: string,
  carryover: string,
): { lines: string[]; carryover: string } => {
  const combined = `${carryover}${normalized}`;
  const parts = combined.split("\n");
  const nextCarryover = normalized.endsWith("\n") ? "" : (parts.pop() ?? "");
  const lines = parts
    .map((line: string) => line.trimEnd())
    .filter((line: string) => line.length > 0);
  return {
    lines,
    carryover: nextCarryover,
  };
};

const parseLogSnapshot = (
  snapshot: UnikraftInstanceLog,
  previousOffset: number,
  carryover: string,
): { lines: string[]; nextOffset: number; carryover: string } => {
  if (typeof snapshot.output === "string") {
    const normalized = snapshot.output.replace(/\r\n/g, "\n");
    const parsed = splitSnapshotLines(normalized, carryover);
    const nextOffset =
      typeof snapshot.next_offset === "number"
        ? snapshot.next_offset
        : previousOffset + Buffer.byteLength(snapshot.output, "utf8");
    return {
      lines: parsed.lines,
      nextOffset,
      carryover: parsed.carryover,
    };
  }

  const source = snapshot.lines ?? snapshot.entries ?? [];
  const normalized = source
    .map(extractLogText)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");
  const parsed = splitSnapshotLines(normalized.length > 0 ? `${normalized}\n` : "", carryover);
  const nextOffset =
    typeof snapshot.next_offset === "number"
      ? snapshot.next_offset
      : typeof snapshot.offset === "number"
        ? snapshot.offset
        : previousOffset;
  return {
    lines: parsed.lines,
    nextOffset,
    carryover: parsed.carryover,
  };
};

const authorizationMatches = (actual: string | null, expected: string): boolean => {
  if (!actual?.startsWith("Bearer ")) {
    return false;
  }
  const actualToken = Buffer.from(actual.slice("Bearer ".length), "utf8");
  const expectedToken = Buffer.from(expected, "utf8");
  return actualToken.length === expectedToken.length && timingSafeEqual(actualToken, expectedToken);
};

const readBoundedRequestBody = async (request: IncomingMessage): Promise<string> => {
  return await new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BRIDGE_BODY_BYTES) {
        reject(new Error("Bridge request body exceeded the maximum size."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
};

const respondJson = (response: ServerResponse, statusCode: number, body: string): void => {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(body);
};

const startBridgeServer = async (
  handlers: {
    toolCallHandler: (toolName: string, args: JsonObject) => Promise<unknown>;
    searchToolsHandler?: (query: string, options?: JsonObject) => Promise<ToolSearchResult[]>;
  },
  options: BridgeServerOptions = {},
): Promise<BridgeServer> => {
  const bridgeId = randomUUID();
  const authToken = randomBytes(32).toString("hex");
  const path = `/__keppo_unikraft_bridge/${bridgeId}`;
  const bindHost = options.bindHost ?? (options.bridgeBaseUrl ? "0.0.0.0" : "127.0.0.1");

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== path) {
      response.statusCode = 404;
      response.end();
      return;
    }
    if (!authorizationMatches(request.headers.authorization ?? null, authToken)) {
      respondJson(response, 401, BRIDGE_UNAUTHORIZED_RESPONSE);
      return;
    }

    try {
      const rawBody = await readBoundedRequestBody(request);
      const payload = parseCodeModeHttpBridgeRequest(rawBody);
      let result: { ok: boolean; value?: JsonValue; error?: string };

      try {
        result =
          payload.kind === "tool"
            ? {
                ok: true,
                value: safeJsonValue(
                  await handlers.toolCallHandler(
                    payload.toolName,
                    toBridgeRequestObject(payload.input),
                  ),
                ),
              }
            : {
                ok: true,
                value: safeJsonValue(
                  handlers.searchToolsHandler
                    ? await handlers.searchToolsHandler(
                        payload.query,
                        toBridgeRequestObject(payload.options),
                      )
                    : [],
                ),
              };
      } catch (error) {
        result = {
          ok: false,
          error: toBridgeErrorMessage(error),
        };
      }

      respondJson(response, 200, serializeCodeModeBridgeResponseFile(result));
    } catch (error) {
      respondJson(
        response,
        400,
        serializeCodeModeBridgeResponseFile({
          ok: false,
          error: toBridgeErrorMessage(error),
        }),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Failed to determine Unikraft bridge server address.");
  }

  const callbackUrl = options.bridgeBaseUrl
    ? new URL(path, options.bridgeBaseUrl).toString()
    : `http://${address.address}:${address.port}${path}`;

  return {
    callbackUrl,
    authToken,
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
};

const resolveBridgeOptions = (): BridgeServerOptions => {
  const bridgeBaseUrl = process.env["UNIKRAFT_CODE_MODE_BRIDGE_BASE_URL"]?.trim();
  const bindHost = process.env["UNIKRAFT_CODE_MODE_BRIDGE_BIND_HOST"]?.trim();
  return {
    ...(bridgeBaseUrl ? { bridgeBaseUrl } : {}),
    ...(bindHost ? { bindHost } : {}),
  };
};

const cleanupInstance = async (client: UnikraftCloudClientLike, uuid: string): Promise<void> => {
  await client.stopInstance(uuid, { drainTimeoutMs: 1_000 }).catch(() => undefined);
  await client.deleteInstance(uuid).catch(() => undefined);
};

const buildEntrypointCommand = (): string => {
  return [
    "set -eu",
    "mkdir -p /workspace",
    "cd /workspace",
    'printf "%s" "$KEPPO_SDK_SOURCE_B64" | base64 -d > sdk.mjs',
    'printf "%s" "$KEPPO_ENTRY_SOURCE_B64" | base64 -d > entry.mjs',
    "node entry.mjs",
  ].join(" && ");
};

export class UnikraftSandbox implements SandboxProvider {
  constructor(
    private readonly client: UnikraftCloudClientLike,
    private readonly bridgeOptions: BridgeServerOptions = resolveBridgeOptions(),
  ) {}

  async execute(params: {
    code: string;
    sdkSource: string;
    toolCallHandler: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
    searchToolsHandler?: (
      query: string,
      options?: Record<string, unknown>,
    ) => Promise<ToolSearchResult[]>;
    timeoutMs?: number;
  }): Promise<SandboxExecutionResult> {
    const started = Date.now();
    const timeoutMs = Math.max(1, Math.floor(params.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    const entrySource = buildHttpBridgeEntrySource(params.code, "http://placeholder.invalid");
    const entryBytes = Buffer.byteLength(entrySource, "utf8");
    const sdkBytes = Buffer.byteLength(params.sdkSource, "utf8");

    if (entryBytes > MAX_SOURCE_BYTES || sdkBytes > MAX_SOURCE_BYTES) {
      return {
        success: false,
        output: { logs: [] },
        error: "Code or generated SDK exceeded the maximum Unikraft bridge payload size.",
        failure: {
          type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
          errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.validationFailed,
          reason: OVERSIZED_SOURCE_ERROR,
        },
        toolCallsExecuted: [],
        durationMs: Date.now() - started,
      };
    }

    let bridgeServer: BridgeServer | null = null;
    let instanceId: string | null = null;
    const stdoutLines: string[] = [];
    let bridgeResult: CodeModeBridgeResult | null = null;
    let lastKnownInstance: UnikraftInstance | null = null;
    let logOffset = 0;
    let logCarryover = "";
    let statePollCount = 0;

    try {
      bridgeServer = await startBridgeServer(
        {
          toolCallHandler: params.toolCallHandler,
          ...(params.searchToolsHandler ? { searchToolsHandler: params.searchToolsHandler } : {}),
        },
        this.bridgeOptions,
      );

      const finalizedEntrySource = buildHttpBridgeEntrySource(
        params.code,
        bridgeServer.callbackUrl,
      );
      const instance = await this.client.createInstance({
        name: `keppo-code-${randomUUID().slice(0, 8)}`,
        image: process.env["UNIKRAFT_CODE_MODE_IMAGE"]?.trim() || DEFAULT_IMAGE,
        args: ["/bin/sh", "-lc", buildEntrypointCommand()],
        env: {
          KEPPO_ENTRY_SOURCE_B64: Buffer.from(finalizedEntrySource, "utf8").toString("base64"),
          KEPPO_SDK_SOURCE_B64: Buffer.from(params.sdkSource, "utf8").toString("base64"),
          KEPPO_BRIDGE_AUTH_TOKEN: bridgeServer.authToken,
        },
        autostart: true,
        restart_policy: "never",
      });
      instanceId = instance.uuid;

      while (Date.now() - started < timeoutMs) {
        const logSnapshot = await this.client.getInstanceLogs(instanceId, {
          offset: logOffset,
          limit: DEFAULT_LOG_LIMIT_BYTES,
        });
        const parsedLogs = parseLogSnapshot(logSnapshot, logOffset, logCarryover);
        logOffset = parsedLogs.nextOffset;
        logCarryover = parsedLogs.carryover;

        for (const line of parsedLogs.lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          if (trimmed.startsWith(RESULT_PREFIX)) {
            const result = tryParseCodeModeBridgeResult(trimmed.slice(RESULT_PREFIX.length));
            if (result) {
              bridgeResult = result;
              break;
            }
          }
          if (trimmed.startsWith(REQUEST_PREFIX)) {
            continue;
          }
          stdoutLines.push(trimmed);
        }

        if (bridgeResult) {
          break;
        }

        statePollCount += 1;
        if (!lastKnownInstance || statePollCount >= INSTANCE_STATE_POLL_INTERVAL) {
          lastKnownInstance = await this.client.getInstance(instanceId);
          statePollCount = 0;
          if (isTerminalState(lastKnownInstance)) {
            break;
          }
        }
        await sleep(DEFAULT_LOG_POLL_INTERVAL_MS);
      }

      if (!bridgeResult) {
        if (Date.now() - started >= timeoutMs) {
          return {
            success: false,
            output: { logs: stdoutLines },
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

        const failure = deriveFailureForTerminalState(toInstanceState(lastKnownInstance));
        return {
          success: false,
          output: { logs: stdoutLines },
          error: DEFAULT_RESULT_ERROR,
          failure: {
            type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
            errorCode: failure.errorCode,
            reason: failure.reason,
          },
          toolCallsExecuted: [],
          durationMs: Date.now() - started,
        };
      }

      if (!bridgeResult.success) {
        return {
          success: false,
          output: {
            logs: normalizeLogs(bridgeResult.logs),
          },
          error: asNonEmptyString(bridgeResult.error) ?? DEFAULT_RESULT_ERROR,
          failure: {
            type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
            errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxRuntimeFailed,
            reason: asNonEmptyString(bridgeResult.error) ?? DEFAULT_RESULT_ERROR,
          },
          toolCallsExecuted: normalizeToolCalls(bridgeResult.toolCallsExecuted),
          durationMs: Date.now() - started,
        };
      }

      return {
        success: true,
        output: {
          ...(bridgeResult.hasReturnValue
            ? { returnValue: safeJsonValue(bridgeResult.returnValue) }
            : {}),
          logs: normalizeLogs(bridgeResult.logs),
        },
        toolCallsExecuted: normalizeToolCalls(bridgeResult.toolCallsExecuted),
        durationMs: Date.now() - started,
      };
    } catch (error) {
      return {
        success: false,
        output: { logs: stdoutLines },
        error: PROVIDER_UNAVAILABLE_ERROR,
        failure: {
          type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
          errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.sandboxUnavailable,
          reason: PROVIDER_UNAVAILABLE_ERROR,
        },
        toolCallsExecuted: [],
        durationMs: Date.now() - started,
      };
    } finally {
      if (instanceId) {
        await cleanupInstance(this.client, instanceId);
      }
      if (bridgeServer) {
        await bridgeServer.close().catch(() => undefined);
      }
    }
  }
}
