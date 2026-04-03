import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { access, mkdir, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  resolveLocalAdminKey,
  toUsableAdminKey,
} from "../../../packages/shared/src/convex-admin.js";
import { resetConvexDeploymentViaImport } from "../helpers/convex-import-reset";
import { buildWorkerEnv } from "./env";
import { getWorkerPortBlock, type WorkerPortBlock } from "./ports";
import { CronDriver } from "./cron-driver";

export type E2EStackRuntime = {
  runId: string;
  workerIndex: number;
  namespacePrefix: string;
  ownerPid: number;
  status: "starting" | "ready";
  startedAt: string;
  updatedAt: string;
  ports: WorkerPortBlock;
  convexUrl: string;
  fakeGatewayBaseUrl: string;
  fakeExternalBaseUrl: string;
  apiBaseUrl: string;
  queueBrokerBaseUrl: string;
  cronAuthorizationHeader: string | null;
  dashboardBaseUrl: string;
  readyServices: Array<{
    name: string;
    pid: number;
    healthUrl: string;
    readyAt: string | null;
  }>;
  services: Array<{
    name: string;
    pid: number;
  }>;
};

export type E2ERunOwnership = {
  runId: string;
  ownerPid: number;
  acquiredAt: string;
  cwd: string;
};

type StartedService = {
  name: string;
  child: ChildProcess;
};

type E2ERuntimeMode = "prebuilt" | "dev";

export type ServiceStreamSource = "stdout" | "stderr";
export type ServiceLogName = "api" | "fake-gateway" | "queue-broker" | "dashboard";

type E2ETimingEvent = {
  event: string;
  at: string;
  workerIndex: number;
  elapsedMs?: number;
  service?: string;
  mode?: E2ERuntimeMode;
};

const refs = {
  resetNamespace: makeFunctionReference<"mutation">("e2e:resetNamespace"),
};

const RUNTIME_ROOT = path.resolve(process.cwd(), "tests/e2e/.runtime");
const runtimeFileForWorker = (workerIndex: number): string =>
  path.join(RUNTIME_ROOT, `worker-${workerIndex}.json`);
const cronPauseRequestFileForWorker = (workerIndex: number): string =>
  path.join(RUNTIME_ROOT, `worker-${workerIndex}.cron-pause`);
const cronPauseAckFileForWorker = (workerIndex: number): string =>
  path.join(RUNTIME_ROOT, `worker-${workerIndex}.cron-paused`);
const runMarkerFile = (runId: string, marker: string): string =>
  path.join(RUNTIME_ROOT, `${runId}.${marker}`);
const activeRunOwnershipFile = (): string => path.join(RUNTIME_ROOT, "active-run.json");
const startupFailureArtifactFileForWorker = (workerIndex: number): string =>
  path.join(RUNTIME_ROOT, `worker-${workerIndex}.startup-failure.json`);
const SERVICE_LOG_NAMES: ServiceLogName[] = ["api", "fake-gateway", "queue-broker", "dashboard"];
const DEFAULT_TAIL_MAX_BYTES = 128 * 1024;
const DEFAULT_TAIL_MAX_LINES = 30;
const DEFAULT_LOCAL_SERVICE_TIMEOUT_MS = 8_000;
const DEFAULT_CONVEX_OPERATION_TIMEOUT_MS = 12_000;
const DEFAULT_CONVEX_FULL_RESET_TIMEOUT_MS = 45_000;
const DEFAULT_CRON_PAUSE_TIMEOUT_MS = 10_000;

export const serviceLogFileForWorker = (workerIndex: number, serviceName: string): string =>
  path.join(RUNTIME_ROOT, `worker-${workerIndex}-${serviceName}.log`);

const isE2EVerbose = (): boolean => process.env.KEPPO_E2E_VERBOSE === "1";
const SERVICE_LOG_SURFACE_PATTERN =
  /\[error\]|\[warn\]|Error:|EADDRINUSE|ECONNREFUSED|fatal|panic|unhandled/i;
const STDERR_FALLBACK_PATTERN = /warn|error|exception|failed/i;

const REDACTION_RULES: Array<{
  pattern: RegExp;
  replacement: string;
}> = [
  {
    pattern: /Bearer\s+[A-Za-z0-9._-]+/g,
    replacement: "Bearer [REDACTED]",
  },
  {
    pattern: /("(?:access|refresh|id)_token"\s*:\s*")[^"]+"/gi,
    replacement: '$1[REDACTED]"',
  },
  {
    pattern: /(KEPPO_[A-Z0-9_]*=)[^\s]+/g,
    replacement: "$1[REDACTED]",
  },
];

const toServiceLogName = (value: string): ServiceLogName | null => {
  return SERVICE_LOG_NAMES.includes(value as ServiceLogName) ? (value as ServiceLogName) : null;
};

const startedByWorker = new Map<number, E2EStackRuntime>();
const cronDriversByWorker = new Map<number, CronDriver>();
const e2eTimingFile = process.env.KEPPO_E2E_TIMING_FILE;

const isCronAutoStartDisabled = (): boolean => process.env.KEPPO_E2E_AUTO_CRON === "false";

const isCronPauseRequested = (workerIndex: number): boolean => {
  return existsSync(cronPauseRequestFileForWorker(workerIndex));
};

const setCronPausedState = (workerIndex: number, paused: boolean): void => {
  const ackPath = cronPauseAckFileForWorker(workerIndex);
  if (paused) {
    writeFileSync(ackPath, `${new Date().toISOString()}\n`, "utf8");
    return;
  }
  rmSync(ackPath, { force: true });
};

const clearCronPauseFiles = async (workerIndex: number): Promise<void> => {
  await rm(cronPauseRequestFileForWorker(workerIndex), { force: true });
  await rm(cronPauseAckFileForWorker(workerIndex), { force: true });
};

const shouldBypassCronPause = async (workerIndex: number): Promise<boolean> => {
  if (isCronAutoStartDisabled()) {
    return true;
  }
  return !(await fileExists(runtimeFileForWorker(workerIndex)));
};

export const requestRuntimeCronPause = async (
  workerIndex: number,
  timeoutMs = DEFAULT_CRON_PAUSE_TIMEOUT_MS,
): Promise<void> => {
  if (await shouldBypassCronPause(workerIndex)) {
    return;
  }

  await ensureRuntimeRoot();
  await writeFile(
    cronPauseRequestFileForWorker(workerIndex),
    `${new Date().toISOString()}\n`,
    "utf8",
  );

  const ackPath = cronPauseAckFileForWorker(workerIndex);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fileExists(ackPath)) {
      return;
    }
    if (await shouldBypassCronPause(workerIndex)) {
      return;
    }
    await sleep(25);
  }

  throw new Error(`Timed out waiting for worker ${workerIndex} cron driver to pause.`);
};

export const releaseRuntimeCronPause = async (
  workerIndex: number,
  timeoutMs = DEFAULT_CRON_PAUSE_TIMEOUT_MS,
): Promise<void> => {
  await rm(cronPauseRequestFileForWorker(workerIndex), { force: true });
  if (await shouldBypassCronPause(workerIndex)) {
    await rm(cronPauseAckFileForWorker(workerIndex), { force: true });
    return;
  }

  const ackPath = cronPauseAckFileForWorker(workerIndex);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await fileExists(ackPath))) {
      return;
    }
    await sleep(25);
  }

  throw new Error(`Timed out waiting for worker ${workerIndex} cron driver to resume.`);
};

export const withPausedRuntimeCronDriver = async <T>(
  workerIndex: number,
  fn: () => Promise<T>,
): Promise<T> => {
  await requestRuntimeCronPause(workerIndex);
  try {
    return await fn();
  } finally {
    await releaseRuntimeCronPause(workerIndex);
  }
};

const resolveRuntimeMode = (): E2ERuntimeMode => {
  const mode = (process.env.KEPPO_E2E_RUNTIME_MODE ?? "prebuilt").trim().toLowerCase();
  return mode === "dev" ? "dev" : "prebuilt";
};

const parsePositiveInt = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const resolveConfiguredWorkerCount = (): number => {
  const configured =
    parsePositiveInt(process.env.E2E_WORKERS) ?? parsePositiveInt(process.env.PLAYWRIGHT_WORKERS);
  if (configured !== null) {
    return configured;
  }
  return 1;
};

export const assertSingleE2EWorkerConfigured = (): void => {
  const workers = resolveConfiguredWorkerCount();
  if (workers > 1) {
    throw new Error(
      [
        "Keppo E2E always requires a single Playwright worker.",
        `Resolved worker count: ${workers}.`,
        "Set E2E_WORKERS=1 (or PLAYWRIGHT_WORKERS=1) and do not pass a larger CLI worker override.",
      ].join(" "),
    );
  }
};

const appendTimingEvent = (event: E2ETimingEvent): void => {
  if (!e2eTimingFile) {
    return;
  }
  appendFileSync(e2eTimingFile, `${JSON.stringify(event)}\n`);
};

const resolveRunId = (): string => {
  const fromEnv = process.env.KEPPO_E2E_RUN_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const generated = `run_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  process.env.KEPPO_E2E_RUN_ID = generated;
  return generated;
};

export const parseStructuredLevel = (line: string): "debug" | "info" | "warn" | "error" | null => {
  const match = line.match(/\[(debug|info|warn|error)\]/i);
  if (!match) {
    return null;
  }
  const parsed = match[1].toLowerCase();
  if (parsed === "debug" || parsed === "info" || parsed === "warn" || parsed === "error") {
    return parsed;
  }
  return null;
};

export const shouldSurfaceServiceLogLine = (
  line: string,
  source: ServiceStreamSource,
  options: { verbose?: boolean } = {},
): boolean => {
  const verbose = options.verbose ?? isE2EVerbose();
  if (verbose) {
    return true;
  }
  const level = parseStructuredLevel(line);
  if (level === "warn" || level === "error") {
    return true;
  }
  if (SERVICE_LOG_SURFACE_PATTERN.test(line)) {
    return true;
  }
  return source === "stderr" && STDERR_FALLBACK_PATTERN.test(line);
};

export const redactServiceLogText = (rawText: string): string => {
  let text = rawText;
  for (const rule of REDACTION_RULES) {
    text = text.replace(rule.pattern, rule.replacement);
  }
  return text;
};

const resolveTailLineLimit = (fallback: number): number => {
  const configured = Number.parseInt(process.env.KEPPO_E2E_LOG_TAIL_LINES ?? "", 10);
  if (Number.isInteger(configured) && configured > 0) {
    return configured;
  }
  return fallback;
};

const readBoundedTail = async (filePath: string, maxBytes: number): Promise<string> => {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, "r");
    const stats = await handle.stat();
    const safeMaxBytes = Math.max(1, Math.floor(maxBytes));
    const start = Math.max(0, stats.size - safeMaxBytes);
    const readLength = stats.size - start;
    if (readLength <= 0) {
      return "";
    }
    const buffer = Buffer.alloc(readLength);
    await handle.read(buffer, 0, readLength, start);
    let text = buffer.toString("utf8");
    if (start > 0) {
      const firstLineBreak = text.indexOf("\n");
      if (firstLineBreak >= 0) {
        text = text.slice(firstLineBreak + 1);
      }
    }
    return text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  } finally {
    if (handle) {
      await handle.close();
    }
  }
};

export const tailServiceLogs = async (
  workerIndex: number,
  services: string[] = SERVICE_LOG_NAMES,
  maxLines = resolveTailLineLimit(DEFAULT_TAIL_MAX_LINES),
  maxBytes = DEFAULT_TAIL_MAX_BYTES,
): Promise<string> => {
  const sections: string[] = [];
  const safeMaxLines = Math.max(1, Math.floor(maxLines));
  const safeMaxBytes = Math.max(1, Math.floor(maxBytes));
  const uniqueServices = [...new Set(services.map((service) => service.trim()).filter(Boolean))];
  for (const serviceName of uniqueServices) {
    const tail = await readBoundedTail(
      serviceLogFileForWorker(workerIndex, serviceName),
      safeMaxBytes,
    );
    if (!tail.trim()) {
      continue;
    }
    const lines = tail
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0)
      .slice(-safeMaxLines);
    if (lines.length === 0) {
      continue;
    }
    sections.push(`== ${serviceName} ==\n${lines.join("\n")}`);
  }

  if (sections.length === 0) {
    return "No service logs captured for this worker.";
  }

  return redactServiceLogText(sections.join("\n\n"));
};

export const buildStartupFailureError = (
  workerIndex: number,
  cause: unknown,
  logs: string,
): Error => {
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    [
      `Failed to start e2e worker stack for worker ${workerIndex}: ${causeMessage}`,
      "",
      "Recent service logs:",
      logs,
    ].join("\n"),
    {
      cause: cause instanceof Error ? cause : undefined,
    },
  );
};

export const persistStartupFailureArtifact = async (params: {
  workerIndex: number;
  cause: unknown;
  logs: string;
  runtime: E2EStackRuntime | null;
}): Promise<string> => {
  await ensureRuntimeRoot();
  const filePath = startupFailureArtifactFileForWorker(params.workerIndex);
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        workerIndex: params.workerIndex,
        at: new Date().toISOString(),
        error: formatErrorMessage(params.cause),
        logs: params.logs,
        runtime: params.runtime,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return filePath;
};

const streamServiceLogs = (
  name: string,
  source: ServiceStreamSource,
  stream: NodeJS.ReadableStream | null,
  logFile?: string,
): void => {
  if (!stream) {
    return;
  }
  const reader = createInterface({ input: stream });
  reader.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    if (shouldSurfaceServiceLogLine(line, source)) {
      process.stdout.write(`[${name}] ${redactServiceLogText(line)}\n`);
    }
    if (logFile) {
      appendFileSync(logFile, `[${new Date().toISOString()}] [${source}] ${line}\n`);
    }
  });
};

const spawnService = (params: {
  name: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  logFile?: string;
}): StartedService => {
  const child = spawn(params.command, params.args, {
    cwd: params.cwd,
    env: params.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  streamServiceLogs(params.name, "stdout", child.stdout, params.logFile);
  streamServiceLogs(params.name, "stderr", child.stderr, params.logFile);

  return {
    name: params.name,
    child,
  };
};

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const killService = async (service: { pid: number }): Promise<void> => {
  try {
    process.kill(-service.pid, "SIGTERM");
  } catch {
    return;
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isPidAlive(service.pid)) {
      return;
    }
    await sleep(100);
  }

  try {
    process.kill(-service.pid, "SIGKILL");
  } catch {
    // no-op
  }
};

const freePort = (port: number): void => {
  const inspect = spawnSync("lsof", ["-ti", `tcp:${port}`], {
    encoding: "utf8",
  });

  if (inspect.error) {
    return;
  }
  if (inspect.status !== 0 && inspect.status !== 1) {
    return;
  }

  const pids = inspect.stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pid) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);

  for (const pid of pids) {
    spawnSync("kill", ["-9", String(pid)], { encoding: "utf8" });
  }
};

const freeWorkerPortBlock = (ports: WorkerPortBlock): void => {
  freePort(ports.fakeGateway);
  freePort(ports.api);
  freePort(ports.dashboard);
  freePort(ports.queueBroker);
};

const waitForPortToClose = async (port: number, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const inspect = spawnSync("lsof", ["-ti", `tcp:${port}`], {
      encoding: "utf8",
    });
    if (inspect.error || inspect.status === 1 || !inspect.stdout.trim()) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for port ${port} to close`);
};

const waitForWorkerPortBlockToClose = async (ports: WorkerPortBlock): Promise<void> => {
  await waitForPortToClose(ports.fakeGateway);
  await waitForPortToClose(ports.api);
  await waitForPortToClose(ports.dashboard);
  await waitForPortToClose(ports.queueBroker);
};

const killProcessesByPattern = (pattern: string): void => {
  const inspect = spawnSync("pgrep", ["-f", pattern], {
    encoding: "utf8",
  });

  if (inspect.error) {
    return;
  }
  if (inspect.status !== 0 && inspect.status !== 1) {
    return;
  }
  if (!inspect.stdout.trim()) {
    return;
  }

  const pids = inspect.stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pid) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);

  for (const pid of pids) {
    spawnSync("kill", ["-9", String(pid)], { encoding: "utf8" });
  }
};

const killCompetingProcesses = (): void => {
  killProcessesByPattern("tests/e2e/infra/fake-gateway.ts");
  killProcessesByPattern("tests/e2e/infra/local-queue-broker.ts");
  killProcessesByPattern("@keppo/web exec vite --host 0.0.0.0 --port");
  killProcessesByPattern("@keppo/web exec vite preview --host 127.0.0.1 --port");
  killProcessesByPattern("@keppo/web start");
};

const resolveCleanupWorkerIndices = async (): Promise<number[]> => {
  const persisted = await listRuntimeWorkerIndices();
  const indices = new Set<number>(persisted);
  indices.add(0);
  return [...indices].sort((left, right) => left - right);
};

const cleanupCompetingWorkerStacks = async (): Promise<void> => {
  const workerIndices = await resolveCleanupWorkerIndices();
  await Promise.allSettled(
    workerIndices.map(async (workerIndex) => {
      await stopWorkerStack(workerIndex);
      const ports = getWorkerPortBlock(workerIndex);
      freeWorkerPortBlock(ports);
      await waitForWorkerPortBlockToClose(ports);
    }),
  );
};

const waitForHttpOk = async (
  url: string,
  params: { serviceName: string; child: ChildProcess; timeoutMs?: number },
): Promise<void> => {
  const timeoutMs = params.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (params.child.exitCode !== null) {
      throw new Error(`${params.serviceName} exited early with code ${params.child.exitCode}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for ${params.serviceName} readiness: ${url}`);
};

const formatErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const withTimeout = async <T>(
  label: string,
  timeoutMs: number,
  run: () => Promise<T>,
): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      run(),
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const buildRuntimeServiceError = async (params: {
  runtime: E2EStackRuntime;
  serviceName: ServiceLogName;
  action: string;
  url: string;
  error: unknown;
}): Promise<Error> => {
  const logs = await tailServiceLogs(
    params.runtime.workerIndex,
    [params.serviceName],
    resolveTailLineLimit(DEFAULT_TAIL_MAX_LINES),
    DEFAULT_TAIL_MAX_BYTES,
  );
  return new Error(
    [
      `${params.action} failed for ${params.serviceName}: ${formatErrorMessage(params.error)}`,
      `url=${params.url}`,
      "",
      "Recent service logs:",
      logs,
    ].join("\n"),
    {
      cause: params.error instanceof Error ? params.error : undefined,
    },
  );
};

const fetchRuntimeService = async (
  runtime: E2EStackRuntime,
  params: {
    serviceName: ServiceLogName;
    url: string;
    action: string;
    timeoutMs?: number;
    init?: RequestInit;
  },
): Promise<Response> => {
  const timeoutMs = params.timeoutMs ?? DEFAULT_LOCAL_SERVICE_TIMEOUT_MS;
  try {
    return await withTimeout(params.action, timeoutMs, async () => {
      return await fetch(params.url, {
        ...params.init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    });
  } catch (error) {
    throw await buildRuntimeServiceError({
      runtime,
      serviceName: params.serviceName,
      action: params.action,
      url: params.url,
      error,
    });
  }
};

export const resolveConvexAdminKey = async (): Promise<string | null> => {
  const localKey = resolveLocalAdminKey();
  if (localKey) {
    return localKey;
  }
  return toUsableAdminKey(process.env.KEPPO_CONVEX_ADMIN_KEY);
};

const resetConvexState = async (
  convexUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<void> => {
  await resetConvexDeploymentViaImport({
    env: {
      CONVEX_URL: convexUrl,
    },
    timeoutMs: options.timeoutMs ?? DEFAULT_CONVEX_FULL_RESET_TIMEOUT_MS,
  });
};

const isOptimisticConcurrencyFailure = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("optimisticconcurrencycontrolfailure");
};

const runMutationWithRetry = async <T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isOptimisticConcurrencyFailure(error) || attempt === maxAttempts - 1) {
        throw error;
      }
      await sleep(25 * (attempt + 1));
    }
  }
  throw new Error("Retry attempts exhausted");
};

const resetConvexNamespace = async (
  convexUrl: string,
  namespace: string,
  options: { timeoutMs?: number } = {},
): Promise<void> => {
  const client = new ConvexHttpClient(convexUrl);
  const adminKey = (await resolveConvexAdminKey()) ?? process.env.KEPPO_CONVEX_ADMIN_KEY ?? null;
  if (adminKey) {
    (client as unknown as { setAdminAuth: (key: string) => void }).setAdminAuth(adminKey);
  }
  let tableIndex = 0;
  let cursor: string | null = null;
  let attempts = 0;
  while (true) {
    if (attempts > 20_000) {
      throw new Error(`Timed out while completing Convex namespace reset for ${namespace}.`);
    }
    attempts += 1;
    const result = await withTimeout(
      `Convex namespace reset (${namespace})`,
      options.timeoutMs ?? DEFAULT_CONVEX_OPERATION_TIMEOUT_MS,
      () =>
        runMutationWithRetry(() =>
          client.mutation(refs.resetNamespace, {
            namespace,
            tableIndex,
            cursor,
          }),
        ),
    );
    tableIndex = result.tableIndex;
    cursor = result.cursor;
    if (result.done) {
      return;
    }
  }
};

const ensureRuntimeRoot = async (): Promise<void> => {
  await mkdir(RUNTIME_ROOT, { recursive: true });
};

const writeRuntime = async (runtime: E2EStackRuntime): Promise<void> => {
  await ensureRuntimeRoot();
  await writeFile(
    runtimeFileForWorker(runtime.workerIndex),
    JSON.stringify(runtime, null, 2),
    "utf8",
  );
};

const readRuntime = async (workerIndex: number): Promise<E2EStackRuntime> => {
  const runtime = await readJsonFile<E2EStackRuntime>(runtimeFileForWorker(workerIndex));
  if (!runtime) {
    throw new Error(`Missing e2e runtime file for worker ${workerIndex}`);
  }
  return runtime;
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const readJsonFile = async <T>(filePath: string): Promise<T | null> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const writeRuntimeRecord = async (
  runtime: E2EStackRuntime,
  updates: Partial<E2EStackRuntime> = {},
): Promise<E2EStackRuntime> => {
  const nextRuntime: E2EStackRuntime = {
    ...runtime,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  await writeRuntime(nextRuntime);
  return nextRuntime;
};

const isRuntimeOwnedByLiveProcess = (runtime: E2EStackRuntime): boolean => {
  return Number.isInteger(runtime.ownerPid) && runtime.ownerPid > 0 && isPidAlive(runtime.ownerPid);
};

const buildActiveRunConflictError = (ownership: E2ERunOwnership): Error => {
  return new Error(
    [
      `Another local e2e run already owns tests/e2e/.runtime: run ${ownership.runId} (pid ${ownership.ownerPid}).`,
      "Wait for that run to finish, remove stale owner state, or rerun with KEPPO_E2E_WAIT_FOR_ACTIVE_RUN=1 to wait for release.",
    ].join("\n"),
  );
};

export const readActiveE2ERunOwnership = async (): Promise<E2ERunOwnership | null> => {
  const ownership = await readJsonFile<E2ERunOwnership>(activeRunOwnershipFile());
  if (!ownership) {
    return null;
  }
  if (ownership.runId.trim().length === 0 || !Number.isInteger(ownership.ownerPid)) {
    await rm(activeRunOwnershipFile(), { force: true });
    return null;
  }
  return ownership;
};

export const acquireE2ERunOwnership = async (
  runId: string,
  options: {
    waitForRelease?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<E2ERunOwnership> => {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  await ensureRuntimeRoot();

  while (true) {
    const ownership = await readActiveE2ERunOwnership();
    if (!ownership) {
      const nextOwnership: E2ERunOwnership = {
        runId,
        ownerPid: process.pid,
        acquiredAt: new Date().toISOString(),
        cwd: process.cwd(),
      };
      try {
        const handle = await open(activeRunOwnershipFile(), "wx");
        await handle.writeFile(`${JSON.stringify(nextOwnership, null, 2)}\n`, "utf8");
        await handle.close();
        return nextOwnership;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST") {
          continue;
        }
        throw error;
      }
    }

    if (ownership.runId === runId && ownership.ownerPid === process.pid) {
      return ownership;
    }

    if (!isPidAlive(ownership.ownerPid)) {
      await rm(activeRunOwnershipFile(), { force: true });
      continue;
    }

    if (!options.waitForRelease) {
      throw buildActiveRunConflictError(ownership);
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `${buildActiveRunConflictError(ownership).message}\nTimed out after ${timeoutMs}ms waiting for active-run ownership.`,
      );
    }
    await sleep(250);
  }
};

export const releaseE2ERunOwnership = async (runId: string): Promise<void> => {
  const ownership = await readActiveE2ERunOwnership();
  if (!ownership) {
    return;
  }
  if (ownership.runId === runId && ownership.ownerPid === process.pid) {
    await rm(activeRunOwnershipFile(), { force: true });
  }
};

const assertCurrentRunOwnsLifecycle = async (runId: string): Promise<void> => {
  const ownership = await readActiveE2ERunOwnership();
  if (!ownership) {
    throw new Error(
      `Missing active e2e run ownership for ${runId}. Run Playwright through tests/e2e/global-setup.ts.`,
    );
  }
  if (ownership.runId !== runId) {
    throw buildActiveRunConflictError(ownership);
  }
  if (!isPidAlive(ownership.ownerPid)) {
    throw new Error(
      `Active e2e run owner for ${runId} is stale (pid ${ownership.ownerPid} is no longer alive).`,
    );
  }
};

const listRuntimeWorkerIndices = async (): Promise<number[]> => {
  try {
    const entries = await readdir(RUNTIME_ROOT, { withFileTypes: true });
    return [
      ...new Set(
        entries
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name.match(/^worker-(\d+)\.json$/))
          .filter((match): match is RegExpMatchArray => match !== null)
          .map((match) => Number.parseInt(match[1] ?? "", 10))
          .filter((index) => Number.isInteger(index) && index >= 0),
      ),
    ].sort((left, right) => left - right);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const waitForMarker = async (filePath: string, timeoutMs = 60_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fileExists(filePath)) {
      return;
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for run marker: ${filePath}`);
};

const runOncePerRun = async (params: {
  runId: string;
  marker: string;
  run: () => Promise<void>;
  timeoutMs?: number;
}): Promise<void> => {
  const timeoutMs = params.timeoutMs ?? 60_000;
  await ensureRuntimeRoot();
  const donePath = runMarkerFile(params.runId, `${params.marker}.done`);
  if (await fileExists(donePath)) {
    return;
  }

  const lockPath = runMarkerFile(params.runId, `${params.marker}.lock`);
  let lockHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    lockHandle = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      await waitForMarker(donePath, timeoutMs);
      return;
    }
    throw error;
  }

  try {
    if (!(await fileExists(donePath))) {
      await params.run();
      await writeFile(donePath, `${new Date().toISOString()}\n`, "utf8");
    }
  } finally {
    try {
      await lockHandle.close();
    } catch {
      // no-op
    }
    await rm(lockPath, { force: true });
  }
};

export const readE2EStackRuntime = async (workerIndex = 0): Promise<E2EStackRuntime> => {
  const inMemory = startedByWorker.get(workerIndex);
  if (inMemory) {
    return inMemory;
  }
  return await readRuntime(workerIndex);
};

export const startWorkerStack = async (workerIndex: number): Promise<E2EStackRuntime> => {
  const existing = startedByWorker.get(workerIndex);
  if (existing) {
    return existing;
  }
  const stackStart = Date.now();
  const runtimeMode = resolveRuntimeMode();
  appendTimingEvent({
    event: "stack_start",
    at: new Date(stackStart).toISOString(),
    workerIndex,
    mode: runtimeMode,
  });

  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Missing CONVEX_URL. Run e2e through `convex dev --once --local` wrapper.");
  }

  const convexAdminKey = await resolveConvexAdminKey();
  if (!convexAdminKey) {
    throw new Error("Missing KEPPO_CONVEX_ADMIN_KEY and unable to infer local Convex admin key.");
  }
  process.env.KEPPO_CONVEX_ADMIN_KEY = convexAdminKey;

  const runId = resolveRunId();
  await assertCurrentRunOwnsLifecycle(runId);
  assertSingleE2EWorkerConfigured();
  const namespacePrefix = `${runId}.${workerIndex}`;
  const ports = getWorkerPortBlock(workerIndex);
  const env = buildWorkerEnv({
    runId,
    workerIndex,
    namespacePrefix,
    ports,
    convexUrl,
    convexAdminKey,
  });

  const fakeGatewayBaseUrl = `http://127.0.0.1:${ports.fakeGateway}`;
  const apiBaseUrl = `http://localhost:${ports.dashboard}`;
  const queueBrokerBaseUrl = `http://127.0.0.1:${ports.queueBroker}`;
  const dashboardBaseUrl = `http://localhost:${ports.dashboard}`;

  await runOncePerRun({
    runId,
    marker: "global-bootstrap",
    run: async () => {
      killCompetingProcesses();
      await cleanupCompetingWorkerStacks();
      await resetConvexState(convexUrl);
    },
    timeoutMs: 120_000,
  });

  const persistedRuntime = await readJsonFile<E2EStackRuntime>(runtimeFileForWorker(workerIndex));
  if (
    persistedRuntime &&
    persistedRuntime.runId !== runId &&
    isRuntimeOwnedByLiveProcess(persistedRuntime)
  ) {
    throw new Error(
      [
        `Worker ${workerIndex} stack is still owned by active run ${persistedRuntime.runId} (pid ${persistedRuntime.ownerPid}).`,
        `Refusing to reclaim ports ${JSON.stringify(persistedRuntime.ports)} while the owning process is alive.`,
      ].join("\n"),
    );
  }

  await stopWorkerStack(workerIndex);
  freeWorkerPortBlock(ports);
  await waitForWorkerPortBlockToClose(ports);
  await clearCronPauseFiles(workerIndex);

  const repoRoot = process.cwd();
  const started: StartedService[] = [];
  let runtime: E2EStackRuntime = {
    runId,
    workerIndex,
    namespacePrefix,
    ownerPid: process.pid,
    status: "starting",
    startedAt: new Date(stackStart).toISOString(),
    updatedAt: new Date(stackStart).toISOString(),
    ports,
    convexUrl,
    fakeGatewayBaseUrl,
    fakeExternalBaseUrl: fakeGatewayBaseUrl,
    apiBaseUrl,
    queueBrokerBaseUrl,
    cronAuthorizationHeader: null,
    dashboardBaseUrl,
    readyServices: [],
    services: [],
  };
  await ensureRuntimeRoot();
  const logFile = (serviceName: string): string =>
    serviceLogFileForWorker(workerIndex, serviceName);
  await Promise.all(
    SERVICE_LOG_NAMES.map((serviceName) => writeFile(logFile(serviceName), "", "utf8")),
  );
  await rm(startupFailureArtifactFileForWorker(workerIndex), { force: true });
  runtime = await writeRuntimeRecord(runtime);

  const recordServiceStart = async (params: {
    name: ServiceLogName;
    child: ChildProcess;
    healthUrl: string;
    readyAt: string | null;
  }): Promise<void> => {
    const pid = params.child.pid ?? -1;
    runtime = await writeRuntimeRecord(runtime, {
      services: [
        ...runtime.services.filter((service) => service.name !== params.name),
        ...(pid > 0 ? [{ name: params.name, pid }] : []),
      ],
      readyServices: [
        ...runtime.readyServices.filter((service) => service.name !== params.name),
        ...(pid > 0
          ? [
              {
                name: params.name,
                pid,
                healthUrl: params.healthUrl,
                readyAt: params.readyAt,
              },
            ]
          : []),
      ],
    });
  };

  try {
    const fakeGateway = spawnService({
      name: `fake-gateway:w${workerIndex}`,
      command: "pnpm",
      args: ["exec", "tsx", "tests/e2e/infra/fake-gateway.ts"],
      cwd: repoRoot,
      env: env.fakeGateway,
      logFile: logFile("fake-gateway"),
    });
    started.push(fakeGateway);
    await recordServiceStart({
      name: "fake-gateway",
      child: fakeGateway.child,
      healthUrl: `${fakeGatewayBaseUrl}/health`,
      readyAt: null,
    });
    await waitForHttpOk(`${fakeGatewayBaseUrl}/health`, {
      serviceName: fakeGateway.name,
      child: fakeGateway.child,
    });
    await recordServiceStart({
      name: "fake-gateway",
      child: fakeGateway.child,
      healthUrl: `${fakeGatewayBaseUrl}/health`,
      readyAt: new Date().toISOString(),
    });
    appendTimingEvent({
      event: "service_ready",
      at: new Date().toISOString(),
      workerIndex,
      service: "fake-gateway",
      elapsedMs: Date.now() - stackStart,
    });

    const queueBroker = spawnService({
      name: `queue-broker:w${workerIndex}`,
      command: "pnpm",
      args: ["exec", "tsx", "tests/e2e/infra/local-queue-broker.ts"],
      cwd: repoRoot,
      env: env.queueBroker,
      logFile: logFile("queue-broker"),
    });
    started.push(queueBroker);
    await recordServiceStart({
      name: "queue-broker",
      child: queueBroker.child,
      healthUrl: `${queueBrokerBaseUrl}/health`,
      readyAt: null,
    });
    await waitForHttpOk(`${queueBrokerBaseUrl}/health`, {
      serviceName: queueBroker.name,
      child: queueBroker.child,
    });
    await recordServiceStart({
      name: "queue-broker",
      child: queueBroker.child,
      healthUrl: `${queueBrokerBaseUrl}/health`,
      readyAt: new Date().toISOString(),
    });
    appendTimingEvent({
      event: "service_ready",
      at: new Date().toISOString(),
      workerIndex,
      service: "queue-broker",
      elapsedMs: Date.now() - stackStart,
    });

    const dashboard = spawnService({
      name: `dashboard:w${workerIndex}`,
      command: "pnpm",
      args:
        runtimeMode === "prebuilt"
          ? ["--filter", "@keppo/web", "start"]
          : [
              "--filter",
              "@keppo/web",
              "exec",
              "vite",
              "--host",
              "0.0.0.0",
              "--port",
              String(ports.dashboard),
            ],
      cwd: repoRoot,
      env: env.dashboard,
      logFile: logFile("dashboard"),
    });
    started.push(dashboard);
    await recordServiceStart({
      name: "dashboard",
      child: dashboard.child,
      healthUrl: `${dashboardBaseUrl}/`,
      readyAt: null,
    });
    await waitForHttpOk(`${dashboardBaseUrl}/`, {
      serviceName: dashboard.name,
      child: dashboard.child,
    });
    await recordServiceStart({
      name: "dashboard",
      child: dashboard.child,
      healthUrl: `${dashboardBaseUrl}/`,
      readyAt: new Date().toISOString(),
    });
    appendTimingEvent({
      event: "service_ready",
      at: new Date().toISOString(),
      workerIndex,
      service: "dashboard",
      elapsedMs: Date.now() - stackStart,
    });

    appendTimingEvent({
      event: "stack_ready",
      at: new Date().toISOString(),
      workerIndex,
      elapsedMs: Date.now() - stackStart,
    });

    const cronAuthorizationHeader = env.base.KEPPO_CRON_SECRET
      ? `Bearer ${env.base.KEPPO_CRON_SECRET}`
      : null;
    const cronDriver = new CronDriver({
      apiBaseUrl,
      queueBrokerBaseUrl,
      authorizationHeader: cronAuthorizationHeader,
      intervalMs: Number.parseInt(process.env.KEPPO_E2E_CRON_INTERVAL_MS ?? "250", 10),
      maintenanceIntervalMs: Number.parseInt(
        // E2E keeps queue advancement automatic, but maintenance must be explicit.
        process.env.KEPPO_E2E_MAINTENANCE_INTERVAL_MS ?? "0",
        10,
      ),
      autoStart: process.env.KEPPO_E2E_AUTO_CRON !== "false",
      pauseRequested: () => isCronPauseRequested(workerIndex),
      setPausedState: (paused) => setCronPausedState(workerIndex, paused),
    });
    cronDriversByWorker.set(workerIndex, cronDriver);
    cronDriver.start();

    runtime = await writeRuntimeRecord(runtime, {
      status: "ready",
      cronAuthorizationHeader,
      services: started
        .map((service) => ({
          name: service.name.split(":")[0] ?? service.name,
          pid: service.child.pid ?? -1,
        }))
        .filter((service) => service.pid > 0),
    });
    startedByWorker.set(workerIndex, runtime);
    return runtime;
  } catch (error) {
    const cronDriver = cronDriversByWorker.get(workerIndex);
    if (cronDriver) {
      await cronDriver.stop();
      cronDriversByWorker.delete(workerIndex);
    }
    await Promise.all(
      started
        .filter((service) => typeof service.child.pid === "number" && (service.child.pid ?? -1) > 0)
        .map((service) => killService({ pid: service.child.pid as number })),
    );
    const startedServiceNames = started
      .map((service) => service.name.split(":")[0]?.trim() ?? "")
      .map((serviceName) => toServiceLogName(serviceName))
      .filter((serviceName): serviceName is ServiceLogName => serviceName !== null);
    const logs = await tailServiceLogs(
      workerIndex,
      startedServiceNames.length > 0 ? startedServiceNames : SERVICE_LOG_NAMES,
      resolveTailLineLimit(DEFAULT_TAIL_MAX_LINES),
      DEFAULT_TAIL_MAX_BYTES,
    );
    await persistStartupFailureArtifact({
      workerIndex,
      cause: error,
      logs,
      runtime,
    });
    await rm(runtimeFileForWorker(workerIndex), { force: true });
    throw buildStartupFailureError(workerIndex, error, logs);
  }
};

export const stopWorkerStack = async (workerIndex: number): Promise<void> => {
  const teardownStart = Date.now();
  appendTimingEvent({
    event: "teardown_start",
    at: new Date(teardownStart).toISOString(),
    workerIndex,
  });
  let runtime: E2EStackRuntime | null = startedByWorker.get(workerIndex) ?? null;

  if (!runtime) {
    try {
      runtime = await readRuntime(workerIndex);
    } catch {
      runtime = null;
    }
  }

  if (!runtime) {
    appendTimingEvent({
      event: "teardown_skipped",
      at: new Date().toISOString(),
      workerIndex,
      elapsedMs: Date.now() - teardownStart,
    });
    return;
  }

  const currentRunId = process.env.KEPPO_E2E_RUN_ID?.trim() ?? null;
  const ownedByCurrentRun = currentRunId !== null && runtime.runId === currentRunId;
  if (!ownedByCurrentRun && isRuntimeOwnedByLiveProcess(runtime)) {
    appendTimingEvent({
      event: "teardown_foreign_skip",
      at: new Date().toISOString(),
      workerIndex,
      elapsedMs: Date.now() - teardownStart,
    });
    return;
  }

  const cronDriver = cronDriversByWorker.get(workerIndex);
  if (cronDriver) {
    await cronDriver.stop();
    cronDriversByWorker.delete(workerIndex);
  }

  await Promise.all(runtime.services.map((service) => killService({ pid: service.pid })));
  await waitForWorkerPortBlockToClose(runtime.ports).catch(() => undefined);
  startedByWorker.delete(workerIndex);
  await clearCronPauseFiles(workerIndex);
  await rm(runtimeFileForWorker(workerIndex), { force: true });
  appendTimingEvent({
    event: "teardown_complete",
    at: new Date().toISOString(),
    workerIndex,
    elapsedMs: Date.now() - teardownStart,
  });
};

export const startE2EStack = async (): Promise<E2EStackRuntime> => {
  return await startWorkerStack(0);
};

export const stopE2EStack = async (): Promise<void> => {
  const active = [...startedByWorker.keys()];
  const persisted = await listRuntimeWorkerIndices();
  const targets = [...new Set([...active, ...persisted, 0])].sort((left, right) => left - right);
  await Promise.all(targets.map((workerIndex) => stopWorkerStack(workerIndex)));
};

export const resetNamespaceState = async (
  runtime: E2EStackRuntime,
  namespace: string,
): Promise<void> => {
  const fakeGatewayResetUrl = `${runtime.fakeGatewayBaseUrl}/__reset`;
  await fetchRuntimeService(runtime, {
    serviceName: "fake-gateway",
    url: fakeGatewayResetUrl,
    action: `Reset fake gateway namespace ${namespace}`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-keppo-e2e-namespace": namespace,
      },
      body: JSON.stringify({ namespace }),
    },
  });
  const queueResetUrl = `${runtime.queueBrokerBaseUrl}/reset?namespace=${encodeURIComponent(namespace)}`;
  await fetchRuntimeService(runtime, {
    serviceName: "queue-broker",
    url: queueResetUrl,
    action: `Reset queue broker namespace ${namespace}`,
    init: {
      method: "POST",
    },
  });
  await resetConvexNamespace(runtime.convexUrl, namespace);
};

export const resetGlobalState = async (runtime: E2EStackRuntime): Promise<void> => {
  await withPausedRuntimeCronDriver(runtime.workerIndex, async () => {
    await fetchRuntimeService(runtime, {
      serviceName: "fake-gateway",
      url: `${runtime.fakeGatewayBaseUrl}/__reset`,
      action: "Reset fake gateway state",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    });
    await fetchRuntimeService(runtime, {
      serviceName: "queue-broker",
      url: `${runtime.queueBrokerBaseUrl}/reset`,
      action: "Reset queue broker state",
      init: {
        method: "POST",
      },
    });
    await resetConvexState(runtime.convexUrl);
  });
};

export const triggerMaintenanceCronTick = async (runtime: E2EStackRuntime): Promise<void> => {
  const response = await fetchRuntimeService(runtime, {
    serviceName: "api",
    url: `${runtime.apiBaseUrl}/internal/cron/maintenance`,
    action: "Trigger maintenance tick",
    init: {
      method: "POST",
      headers: runtime.cronAuthorizationHeader
        ? { authorization: runtime.cronAuthorizationHeader }
        : {},
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to trigger maintenance tick: ${response.status} ${text}`);
  }
};

export const advanceQueueClock = async (runtime: E2EStackRuntime, ms: number): Promise<void> => {
  const response = await fetchRuntimeService(runtime, {
    serviceName: "queue-broker",
    url: `${runtime.queueBrokerBaseUrl}/advance`,
    action: "Advance queue clock",
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ms: Math.max(0, Math.floor(ms)),
      }),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to advance queue clock: ${response.status} ${text}`);
  }
};

export const drainQueueBroker = async (runtime: E2EStackRuntime): Promise<void> => {
  const response = await fetchRuntimeService(runtime, {
    serviceName: "queue-broker",
    url: `${runtime.queueBrokerBaseUrl}/drain`,
    action: "Drain queue broker",
    init: {
      method: "POST",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to drain queue broker: ${response.status} ${text}`);
  }
};

export const injectQueueFailure = async (
  runtime: E2EStackRuntime,
  params: {
    actionId?: string;
    count?: number;
    statusCode?: number;
    namespace?: string;
  },
): Promise<void> => {
  const response = await fetchRuntimeService(runtime, {
    serviceName: "queue-broker",
    url: `${runtime.queueBrokerBaseUrl}/inject-failure`,
    action: "Inject queue failure",
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        topic: "approved-action",
        ...(params.actionId ? { actionId: params.actionId } : {}),
        ...(params.count ? { count: params.count } : {}),
        ...(params.statusCode ? { statusCode: params.statusCode } : {}),
        ...(params.namespace ? { namespace: params.namespace } : {}),
      }),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to inject queue failure: ${response.status} ${text}`);
  }
};

export const readQueueBrokerState = async (
  runtime: E2EStackRuntime,
  namespace?: string,
): Promise<{
  pending: Array<Record<string, unknown>>;
  deadLetters: Array<Record<string, unknown>>;
  deliveries: Array<Record<string, unknown>>;
}> => {
  const targetNamespace = namespace?.trim();
  const response = await fetchRuntimeService(runtime, {
    serviceName: "queue-broker",
    url: targetNamespace
      ? `${runtime.queueBrokerBaseUrl}/state?namespace=${encodeURIComponent(targetNamespace)}`
      : `${runtime.queueBrokerBaseUrl}/state`,
    action: targetNamespace
      ? `Read queue broker state for namespace ${targetNamespace}`
      : "Read queue broker state",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to read queue broker state: ${response.status} ${text}`);
  }
  const payload = (await response.json()) as {
    pending?: Array<Record<string, unknown>>;
    deadLetters?: Array<Record<string, unknown>>;
    deliveries?: Array<Record<string, unknown>>;
  };
  return {
    pending: payload.pending ?? [],
    deadLetters: payload.deadLetters ?? [],
    deliveries: payload.deliveries ?? [],
  };
};

export const assertNamespaceIsolation = async (
  runtime: E2EStackRuntime,
  namespace: string,
): Promise<void> => {
  const response = await fetchRuntimeService(runtime, {
    serviceName: "fake-gateway",
    url: `${runtime.fakeGatewayBaseUrl}/__assert-no-foreign-events?namespace=${encodeURIComponent(namespace)}`,
    action: `Assert namespace isolation for ${namespace}`,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Namespace isolation failure for ${namespace}: ${text}`);
  }
};

export const listNamespaceEvents = async (
  runtime: E2EStackRuntime,
  namespace: string,
): Promise<unknown[]> => {
  const response = await fetchRuntimeService(runtime, {
    serviceName: "fake-gateway",
    url: `${runtime.fakeGatewayBaseUrl}/__provider-events?namespace=${encodeURIComponent(namespace)}`,
    action: `List provider events for ${namespace}`,
  });
  if (!response.ok) {
    throw new Error(`Failed to list provider events for namespace ${namespace}`);
  }
  const payload = (await response.json()) as { events?: unknown[] };
  return payload.events ?? [];
};
