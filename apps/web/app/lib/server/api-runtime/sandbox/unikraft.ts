import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  AUTOMATION_RUN_STATUS,
  type AutomationRunLogLevel,
  type AutomationRunTerminalStatus,
} from "@keppo/shared/automations";
import { UnikraftCloudClient } from "@keppo/shared/unikraft/client";
import type { UnikraftInstance, UnikraftInstanceLog } from "@keppo/shared/unikraft/types";
import { getEnv } from "../env.js";
import type { SandboxConfig, SandboxDispatchResult, SandboxProvider } from "./types.js";

type CompletionStatus = AutomationRunTerminalStatus;
type SandboxLogLevel = Extract<AutomationRunLogLevel, "stdout" | "stderr">;
type AutomationLogRequest = {
  automation_run_id: string;
  lines: Array<{ level: SandboxLogLevel; content: string }>;
};
type AutomationCompletionRequest = {
  automation_run_id: string;
  status: CompletionStatus;
  error_message?: string;
};
type UnikraftClientLike = Pick<
  UnikraftCloudClient,
  "createInstance" | "deleteInstance" | "getInstance" | "getInstanceLogs" | "stopInstance"
>;

const DEFAULT_LOG_POLL_INTERVAL_MS = 1_000;
const DEFAULT_LOG_LIMIT_BYTES = 16_384;
const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;
const LOG_POST_RETRIES = 2;
const LOG_POST_RETRY_BASE_DELAY_MS = 250;
const INSTANCE_STATE_POLL_INTERVAL = 5;
const MONITOR_FAILURE_MESSAGE =
  "The remote sandbox stopped unexpectedly before the automation completed.";

const TERMINAL_STATES = new Set([
  "stopped",
  "stopping",
  "exited",
  "failed",
  "error",
  "deleted",
  "terminated",
  "crashed",
]);

const extractRunId = (urlValue: string): string | null => {
  try {
    const url = new URL(urlValue);
    const runId = url.searchParams.get("automation_run_id")?.trim() ?? "";
    return runId.length > 0 ? runId : null;
  } catch {
    return null;
  }
};

const composeRunnerCommand = (config: SandboxConfig): string => {
  return [
    config.bootstrap.command.trim(),
    config.runtime.bootstrap_command?.trim() ?? "",
    config.runtime.command.trim(),
  ]
    .filter((part) => part.length > 0)
    .join(" && ");
};

const postJson = async (
  url: string,
  payload: AutomationLogRequest | AutomationCompletionRequest,
): Promise<void> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = (await response.text()).trim();
    throw new Error(
      body.length > 0
        ? `Callback request failed with status ${String(response.status)}: ${body}`
        : `Callback request failed with status ${String(response.status)}.`,
    );
  }
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
  for (let attempt = 0; attempt <= LOG_POST_RETRIES; attempt += 1) {
    try {
      await postJson(callbackUrl, {
        automation_run_id: runId,
        lines: lines.map((content) => ({ level, content })),
      });
      return;
    } catch {
      if (attempt >= LOG_POST_RETRIES) {
        break;
      }
      await sleep(LOG_POST_RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
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
    // Best-effort completion callback.
  }
};

const toInstanceState = (instance: Pick<UnikraftInstance, "state"> | null): string | null => {
  const normalized = instance?.state?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
};

const isTerminalState = (instance: Pick<UnikraftInstance, "state"> | null): boolean => {
  const state = toInstanceState(instance);
  return state ? TERMINAL_STATES.has(state) : false;
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

const parseLogSnapshot = (
  snapshot: UnikraftInstanceLog,
  previousOffset: number,
): { lines: string[]; nextOffset: number } => {
  if (typeof snapshot.output === "string") {
    const normalized = snapshot.output.replace(/\r\n/g, "\n");
    return {
      lines: normalized
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0),
      nextOffset:
        typeof snapshot.next_offset === "number"
          ? snapshot.next_offset
          : previousOffset + Buffer.byteLength(snapshot.output, "utf8"),
    };
  }

  const lines = (snapshot.lines ?? snapshot.entries ?? [])
    .map(extractLogText)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  return {
    lines,
    nextOffset:
      typeof snapshot.next_offset === "number"
        ? snapshot.next_offset
        : typeof snapshot.offset === "number"
          ? snapshot.offset
          : previousOffset,
  };
};

const resolveTerminalStatus = (
  instance: Pick<UnikraftInstance, "state"> | null,
): CompletionStatus => {
  const state = toInstanceState(instance);
  if (state === "failed" || state === "error" || state === "crashed") {
    return AUTOMATION_RUN_STATUS.failed;
  }
  return AUTOMATION_RUN_STATUS.succeeded;
};

const extractCompletionContext = (
  instance: Pick<UnikraftInstance, "env"> | null,
): { completeUrl: string | null; logUrl: string | null; runId: string | null } => {
  const completeUrl = instance?.env?.["KEPPO_COMPLETE_CALLBACK_URL"]?.trim() ?? "";
  const logUrl = instance?.env?.["KEPPO_LOG_CALLBACK_URL"]?.trim() ?? "";
  return {
    completeUrl: completeUrl.length > 0 ? completeUrl : null,
    logUrl: logUrl.length > 0 ? logUrl : null,
    runId: extractRunId(completeUrl) ?? extractRunId(logUrl),
  };
};

const cleanupInstance = async (client: UnikraftClientLike, sandboxId: string): Promise<void> => {
  await client
    .stopInstance(sandboxId, { drainTimeoutMs: DEFAULT_DRAIN_TIMEOUT_MS })
    .catch(() => undefined);
  await client.deleteInstance(sandboxId).catch(() => undefined);
};

export class UnikraftSandboxProvider implements SandboxProvider {
  private readonly activeMonitorIds = new Set<string>();
  private readonly monitorStates = new Map<
    string,
    {
      cancelled: boolean;
      timedOut: boolean;
    }
  >();
  private readonly activeMonitors = new Set<Promise<void>>();

  constructor(
    private readonly client: UnikraftClientLike = new UnikraftCloudClient({
      token:
        getEnv().UNIKRAFT_API_TOKEN ??
        (() => {
          throw new Error("UNIKRAFT_API_TOKEN is required for the Unikraft sandbox provider.");
        })(),
      metro:
        getEnv().UNIKRAFT_METRO ??
        (() => {
          throw new Error("UNIKRAFT_METRO is required for the Unikraft sandbox provider.");
        })(),
    }),
  ) {}

  async dispatch(config: SandboxConfig): Promise<SandboxDispatchResult> {
    const env = getEnv();
    const image = env.UNIKRAFT_SANDBOX_IMAGE?.trim();
    if (!image) {
      throw new Error("UNIKRAFT_SANDBOX_IMAGE is required for the Unikraft sandbox provider.");
    }

    const runId =
      extractRunId(config.runtime.callbacks.complete_url) ??
      extractRunId(config.runtime.callbacks.log_url);
    const instance = await this.client.createInstance({
      name: runId ? `keppo-automation-${runId}` : `keppo-automation-${randomUUID().slice(0, 8)}`,
      image,
      env: {
        ...config.bootstrap.env,
        ...config.runtime.env,
        KEPPO_RUNNER_COMMAND: composeRunnerCommand(config),
        KEPPO_LOG_CALLBACK_URL: config.runtime.callbacks.log_url,
        KEPPO_COMPLETE_CALLBACK_URL: config.runtime.callbacks.complete_url,
        KEPPO_SESSION_ARTIFACT_CALLBACK_URL: config.runtime.callbacks.session_artifact_url,
        KEPPO_TIMEOUT_MS: String(config.timeout_ms),
        KEPPO_TIMEOUT_GRACE_MS: String(DEFAULT_DRAIN_TIMEOUT_MS),
      },
      autostart: true,
      restart_policy: "never",
    });

    this.startMonitor(instance.uuid, config.timeout_ms, {
      completeUrl: config.runtime.callbacks.complete_url,
      logUrl: config.runtime.callbacks.log_url,
      runId,
    });

    return {
      sandbox_id: instance.uuid,
    };
  }

  async terminate(sandboxId: string): Promise<void> {
    this.getOrCreateMonitorState(sandboxId).cancelled = true;
    try {
      const instance = await this.client.getInstance(sandboxId);
      const context = extractCompletionContext(instance);
      await cleanupInstance(this.client, sandboxId);
      if (context.completeUrl) {
        await postCompletion(context.completeUrl, context.runId, AUTOMATION_RUN_STATUS.cancelled);
      }
    } finally {
      this.activeMonitorIds.delete(sandboxId);
    }
  }

  private getOrCreateMonitorState(sandboxId: string): { cancelled: boolean; timedOut: boolean } {
    const existing = this.monitorStates.get(sandboxId);
    if (existing) {
      return existing;
    }
    const created = {
      cancelled: false,
      timedOut: false,
    };
    this.monitorStates.set(sandboxId, created);
    return created;
  }

  private startMonitor(
    sandboxId: string,
    timeoutMs: number,
    callbacks: { completeUrl: string; logUrl: string; runId: string | null },
  ): void {
    const monitor = this.monitorInstance(sandboxId, timeoutMs, callbacks)
      .catch(() => undefined)
      .finally(() => {
        this.activeMonitors.delete(monitor);
      });
    this.activeMonitors.add(monitor);
  }

  private async monitorInstance(
    sandboxId: string,
    timeoutMs: number,
    callbacks: { completeUrl: string; logUrl: string; runId: string | null },
  ): Promise<void> {
    if (this.activeMonitorIds.has(sandboxId)) {
      return;
    }
    this.activeMonitorIds.add(sandboxId);
    const state = this.getOrCreateMonitorState(sandboxId);

    const deadline = Date.now() + timeoutMs;
    let logOffset = 0;
    let lastKnownInstance: UnikraftInstance | null = null;
    let statePollCount = 0;

    try {
      while (Date.now() < deadline) {
        const logSnapshot = await this.client.getInstanceLogs(sandboxId, {
          offset: logOffset,
          limit: DEFAULT_LOG_LIMIT_BYTES,
        });
        const parsedLogs = parseLogSnapshot(logSnapshot, logOffset);
        logOffset = parsedLogs.nextOffset;

        if (callbacks.logUrl) {
          await postLogLines(callbacks.logUrl, callbacks.runId, "stdout", parsedLogs.lines);
        }

        if (state.cancelled) {
          return;
        }

        statePollCount += 1;
        if (!lastKnownInstance || statePollCount >= INSTANCE_STATE_POLL_INTERVAL) {
          lastKnownInstance = await this.client.getInstance(sandboxId);
          statePollCount = 0;
        }

        if (isTerminalState(lastKnownInstance)) {
          if (callbacks.completeUrl && !state.timedOut) {
            await postCompletion(
              callbacks.completeUrl,
              callbacks.runId,
              resolveTerminalStatus(lastKnownInstance),
            );
          }
          await this.client.deleteInstance(sandboxId).catch(() => undefined);
          return;
        }

        await sleep(DEFAULT_LOG_POLL_INTERVAL_MS);
      }

      state.timedOut = true;
      await cleanupInstance(this.client, sandboxId);
      if (callbacks.completeUrl) {
        await postCompletion(
          callbacks.completeUrl,
          callbacks.runId,
          AUTOMATION_RUN_STATUS.timedOut,
        );
      }
    } catch {
      await cleanupInstance(this.client, sandboxId).catch(() => undefined);
      if (callbacks.completeUrl && !state.cancelled && !state.timedOut) {
        await postCompletion(
          callbacks.completeUrl,
          callbacks.runId,
          AUTOMATION_RUN_STATUS.failed,
          MONITOR_FAILURE_MESSAGE,
        );
      }
    } finally {
      this.activeMonitorIds.delete(sandboxId);
      this.monitorStates.delete(sandboxId);
    }
  }
}
