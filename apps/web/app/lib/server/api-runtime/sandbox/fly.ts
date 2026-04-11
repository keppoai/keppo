import { getEnv, type ApiEnv } from "../env.js";
import type { SandboxConfig, SandboxDispatchResult, SandboxProvider } from "./types.js";

const DEFAULT_FLY_API_HOSTNAME = "https://api.machines.dev";
const DEFAULT_FLY_AUTOMATION_IMAGE = "registry-1.docker.io/library/node:22-bookworm";
const DEFAULT_FLY_CPU_KIND = "shared";
const DEFAULT_FLY_CPUS = 1;
const DEFAULT_FLY_MEMORY_MB = 1024;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;
const DEFAULT_FLY_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_FLY_DELETE_TIMEOUT_MS = 15_000;
const DEFAULT_FLY_WAIT_STARTED_TIMEOUT_SECONDS = 10;
const WRAPPER_ENTRYPOINT_PATH = "/sandbox/keppo-automation-runner-wrapper.mjs";
const SANDBOX_HANDLE_SEPARATOR = "::";

type FlyAppDetails = {
  id?: string;
  name?: string;
  organization?: {
    slug?: string;
  };
};

type FlyMachineDetails = {
  id: string;
  state?: string;
};

type FlyCreateAppRequest = {
  app_name: string;
  org_slug: string;
  network?: string;
};

type FlyCreateMachineRequest = {
  config: {
    auto_destroy: boolean;
    env: Record<string, string>;
    files: Array<{ guest_path: string; raw_value: string }>;
    guest: {
      cpu_kind: string;
      cpus: number;
      memory_mb: number;
    };
    image: string;
    init: {
      exec: string[];
    };
    metadata: Record<string, string>;
    restart: {
      policy: "no";
    };
    stop_config: {
      signal: "SIGTERM";
      timeout: number;
    };
  };
  name: string;
  region?: string;
  skip_service_registration?: boolean;
};

export interface FlyMachinesClientLike {
  createApp(request: FlyCreateAppRequest): Promise<void>;
  createMachine(appName: string, request: FlyCreateMachineRequest): Promise<FlyMachineDetails>;
  deleteMachine(appName: string, machineId: string, options?: { force?: boolean }): Promise<void>;
  getApp(appName: string): Promise<FlyAppDetails | null>;
  waitForMachineStarted(
    appName: string,
    machineId: string,
    options?: { timeoutSeconds?: number },
  ): Promise<FlyMachineDetails>;
}

class FlyApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FlyApiError";
  }
}

class FlyRequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlyRequestTimeoutError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseFlyAppDetails = (value: unknown): FlyAppDetails => {
  if (!isRecord(value)) {
    return {};
  }
  const id = readTrimmedString(value.id);
  const name = readTrimmedString(value.name);
  const organizationSlug = isRecord(value.organization)
    ? readTrimmedString(value.organization.slug)
    : undefined;
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(organizationSlug ? { organization: { slug: organizationSlug } } : {}),
  };
};

const parseFlyMachineDetails = (value: unknown): FlyMachineDetails => {
  if (!isRecord(value)) {
    throw new Error("Fly API returned an invalid machine payload.");
  }
  const id = readTrimmedString(value.id);
  if (!id) {
    throw new Error("Fly API returned a machine payload without an id.");
  }
  const state = readTrimmedString(value.state);
  return {
    id,
    ...(state ? { state } : {}),
  };
};

class FlyMachinesHttpClient implements FlyMachinesClientLike {
  constructor(
    private readonly token: string,
    private readonly apiHostname: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async getApp(appName: string): Promise<FlyAppDetails | null> {
    const action = `get Fly app ${appName}`;
    const response = await this.fetchWithTimeout(
      this.toUrl(`/v1/apps/${encodeURIComponent(appName)}`),
      {
        method: "GET",
        headers: this.buildHeaders(),
      },
      { action, timeoutMs: DEFAULT_FLY_FETCH_TIMEOUT_MS },
    );
    if (response.status === 404) {
      return null;
    }
    return parseFlyAppDetails(
      await this.parseJsonResponse(response, {
        action,
        okStatuses: [200],
      }),
    );
  }

  async createApp(request: FlyCreateAppRequest): Promise<void> {
    const response = await this.fetchWithTimeout(
      this.toUrl("/v1/apps"),
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(request),
      },
      {
        action: `create Fly app ${request.app_name}`,
        timeoutMs: DEFAULT_FLY_FETCH_TIMEOUT_MS,
      },
    );
    await this.parseJsonResponse(response, {
      action: `create Fly app ${request.app_name}`,
      okStatuses: [201],
      allowEmptyBody: true,
    });
  }

  async createMachine(
    appName: string,
    request: FlyCreateMachineRequest,
  ): Promise<FlyMachineDetails> {
    const response = await this.fetchWithTimeout(
      this.toUrl(`/v1/apps/${encodeURIComponent(appName)}/machines`),
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(request),
      },
      {
        action: `create Fly machine for app ${appName}`,
        timeoutMs: DEFAULT_FLY_FETCH_TIMEOUT_MS,
      },
    );
    return parseFlyMachineDetails(
      await this.parseJsonResponse(response, {
        action: `create Fly machine for app ${appName}`,
        okStatuses: [200, 201],
      }),
    );
  }

  async deleteMachine(
    appName: string,
    machineId: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const url = new URL(
      `/v1/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}`,
      this.apiHostname,
    );
    if (options.force === true) {
      url.searchParams.set("force", "true");
    }
    const action = `delete Fly machine ${machineId} from app ${appName}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(
          url,
          {
            method: "DELETE",
            headers: this.buildHeaders(),
          },
          { action, timeoutMs: DEFAULT_FLY_DELETE_TIMEOUT_MS },
        );
        await this.parseJsonResponse(response, {
          action,
          okStatuses: [200, 202],
          allowEmptyBody: true,
        });
        return;
      } catch (error) {
        if (attempt === 1 || !this.isRetryableDeleteError(error)) {
          throw error;
        }
      }
    }
  }

  async waitForMachineStarted(
    appName: string,
    machineId: string,
    options: { timeoutSeconds?: number } = {},
  ): Promise<FlyMachineDetails> {
    const url = this.toUrl(
      `/v1/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/wait`,
    );
    url.searchParams.set("state", "started");
    url.searchParams.set(
      "timeout",
      String(options.timeoutSeconds ?? DEFAULT_FLY_WAIT_STARTED_TIMEOUT_SECONDS),
    );
    const action = `wait for Fly machine ${machineId} in app ${appName} to start`;
    const response = await this.fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: this.buildHeaders(),
      },
      { action, timeoutMs: DEFAULT_FLY_FETCH_TIMEOUT_MS },
    );
    return parseFlyMachineDetails(
      await this.parseJsonResponse(response, {
        action,
        okStatuses: [200],
      }),
    );
  }

  private buildHeaders(): HeadersInit {
    return {
      authorization: `Bearer ${this.token}`,
      "content-type": "application/json",
    };
  }

  private toUrl(pathname: string): URL {
    return new URL(pathname, this.apiHostname);
  }

  private async fetchWithTimeout(
    input: URL,
    init: RequestInit,
    options: { action: string; timeoutMs: number },
  ): Promise<Response> {
    try {
      return await this.fetchFn(input, {
        ...init,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      if (
        (error instanceof Error && error.name === "TimeoutError") ||
        (error instanceof DOMException && error.name === "TimeoutError")
      ) {
        throw new FlyRequestTimeoutError(
          `${options.action} timed out after ${String(options.timeoutMs)}ms.`,
        );
      }
      throw error;
    }
  }

  private async parseJsonResponse(
    response: Response,
    options: {
      action: string;
      okStatuses: number[];
      allowEmptyBody?: boolean;
    },
  ): Promise<unknown> {
    const isExpectedStatus = options.okStatuses.includes(response.status);
    const bodyText = (await response.text()).trim();
    if (!isExpectedStatus) {
      throw new FlyApiError(
        response.status,
        this.toErrorMessage(options.action, response, bodyText),
      );
    }
    if (bodyText.length === 0) {
      return undefined;
    }
    try {
      return JSON.parse(bodyText);
    } catch (error) {
      if (options.allowEmptyBody) {
        return undefined;
      }
      throw new Error(
        `${options.action} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private toErrorMessage(action: string, response: Response, bodyText: string): string {
    void bodyText;
    return `${action} failed with status ${String(response.status)}.`;
  }

  private isRetryableDeleteError(error: unknown): boolean {
    if (error instanceof FlyRequestTimeoutError) {
      return true;
    }
    const status = getErrorStatus(error);
    return status !== null && status >= 500;
  }
}

type FlySandboxOptions = {
  apiHostname: string;
  appName: string;
  automationImage: string;
  cpuKind: string;
  cpus: number;
  memoryMb: number;
  orgSlug: string;
  region?: string;
  timeoutGraceMs: number;
  appNetwork?: string;
};

const flyAppReadyByName = new Map<string, Promise<void>>();

const createDefaultClient = (env: ApiEnv): FlyMachinesClientLike => {
  const token = env.FLY_API_TOKEN?.trim();
  if (!token) {
    throw new Error("FLY_API_TOKEN is required for the Fly Machines sandbox provider.");
  }
  return new FlyMachinesHttpClient(token, env.FLY_API_HOSTNAME ?? DEFAULT_FLY_API_HOSTNAME);
};

const resolveFlySandboxOptions = (env: ApiEnv): FlySandboxOptions => {
  const appName = env.FLY_AUTOMATION_APP_NAME?.trim();
  if (!appName) {
    throw new Error("FLY_AUTOMATION_APP_NAME is required for the Fly Machines sandbox provider.");
  }
  const orgSlug = env.FLY_AUTOMATION_ORG_SLUG?.trim();
  if (!orgSlug) {
    throw new Error("FLY_AUTOMATION_ORG_SLUG is required for the Fly Machines sandbox provider.");
  }
  const appNetwork = env.FLY_AUTOMATION_APP_NETWORK?.trim();
  const region = env.FLY_AUTOMATION_MACHINE_REGION?.trim();
  return {
    apiHostname: env.FLY_API_HOSTNAME ?? DEFAULT_FLY_API_HOSTNAME,
    appName,
    automationImage: env.FLY_AUTOMATION_IMAGE ?? DEFAULT_FLY_AUTOMATION_IMAGE,
    cpuKind: env.FLY_AUTOMATION_MACHINE_CPU_KIND,
    cpus: env.FLY_AUTOMATION_MACHINE_CPUS,
    memoryMb: env.FLY_AUTOMATION_MACHINE_MEMORY_MB,
    orgSlug,
    timeoutGraceMs: DEFAULT_TERMINATION_GRACE_MS,
    ...(appNetwork ? { appNetwork } : {}),
    ...(region ? { region } : {}),
  };
};

const toSandboxHandle = (appName: string, machineId: string): string =>
  `${appName}${SANDBOX_HANDLE_SEPARATOR}${machineId}`;

const parseSandboxHandle = (
  sandboxId: string,
): { appName: string | null; machineId: string | null } => {
  const separatorIndex = sandboxId.indexOf(SANDBOX_HANDLE_SEPARATOR);
  if (separatorIndex < 0) {
    return { appName: null, machineId: null };
  }
  const appName = sandboxId.slice(0, separatorIndex).trim();
  const machineId = sandboxId.slice(separatorIndex + SANDBOX_HANDLE_SEPARATOR.length).trim();
  return {
    appName: appName.length > 0 ? appName : null,
    machineId: machineId.length > 0 ? machineId : null,
  };
};

const getErrorStatus = (error: unknown): number | null => {
  if (error instanceof FlyApiError) {
    return error.status;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }
  return null;
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

const encodeFileContent = (content: string): string =>
  Buffer.from(content, "utf8").toString("base64");

const buildMachineName = (runId: string): string => {
  const normalized = runId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const fallback = normalized.length > 0 ? normalized : "run";
  return `keppo-${fallback}`.slice(0, 63);
};

const buildFlyWrapperSource = (): string => {
  return [
    'import { spawn } from "node:child_process";',
    'import { dirname } from "node:path";',
    "",
    'const RUNNER_ENTRYPOINT_PATH = process.env.KEPPO_RUNNER_ENTRYPOINT_PATH ?? "";',
    'const RUNNER_PACKAGES_JSON = process.env.KEPPO_RUNNER_PACKAGES_JSON ?? "[]";',
    'const RUNNER_SETUP_COMMAND = process.env.KEPPO_RUNNER_SETUP_COMMAND ?? "";',
    'const RUNNER_BOOTSTRAP_COMMAND = process.env.KEPPO_RUNNER_BOOTSTRAP_COMMAND ?? "";',
    'const RUNNER_COMMAND = process.env.KEPPO_RUNNER_COMMAND ?? "";',
    'const LOG_CALLBACK_URL = process.env.KEPPO_LOG_CALLBACK_URL ?? "";',
    'const COMPLETE_CALLBACK_URL = process.env.KEPPO_COMPLETE_CALLBACK_URL ?? "";',
    'const VERCEL_AUTOMATION_BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";',
    'const TIMEOUT_MS = Math.max(1, Number.parseInt(process.env.KEPPO_TIMEOUT_MS ?? "300000", 10) || 300000);',
    'const TIMEOUT_GRACE_MS = Math.max(1, Number.parseInt(process.env.KEPPO_TIMEOUT_GRACE_MS ?? "5000", 10) || 5000);',
    'const RUN_ID = process.env.KEPPO_AUTOMATION_RUN_ID?.trim() ?? "";',
    "const MAX_LOG_BATCH_LINES = 100;",
    "const MAX_BUFFERED_LOG_LINES = 500;",
    "const LOG_FLUSH_INTERVAL_MS = 250;",
    "const COMPLETION_RETRY_DELAYS_MS = [250, 750, 1500];",
    "",
    "const parsePackages = () => {",
    "  try {",
    "    const parsed = JSON.parse(RUNNER_PACKAGES_JSON);",
    "    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string' && value.trim().length > 0) : [];",
    "  } catch {",
    "    return [];",
    "  }",
    "};",
    "",
    "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
    "",
    "const shellQuote = (value) => `'${String(value).replace(/'/g, `'\"'\"'`)}'`;",
    "",
    "const postJson = async (url, payload) => {",
    "  const response = await fetch(url, {",
    '    method: "POST",',
    "    headers: {",
    '      "content-type": "application/json",',
    "      ...(VERCEL_AUTOMATION_BYPASS_SECRET",
    '        ? { "x-vercel-protection-bypass": VERCEL_AUTOMATION_BYPASS_SECRET }',
    "        : {}),",
    "    },",
    "    body: JSON.stringify(payload),",
    "  });",
    "  if (!response.ok) {",
    "    const detail = (await response.text()).trim();",
    "    throw new Error(detail || `Callback request failed with status ${String(response.status)}.`);",
    "  }",
    "};",
    "",
    "let bufferedLogLines = [];",
    "let droppedLogLineCount = 0;",
    "let logFlushPromise = null;",
    "let logFlushTimer = null;",
    "",
    "const scheduleLogFlush = () => {",
    "  if (logFlushTimer !== null) {",
    "    return;",
    "  }",
    "  logFlushTimer = setTimeout(() => {",
    "    logFlushTimer = null;",
    "    void flushLogLines();",
    "  }, LOG_FLUSH_INTERVAL_MS);",
    "  logFlushTimer.unref?.();",
    "};",
    "",
    "const enqueueLogLines = (level, lines) => {",
    "  if (!Array.isArray(lines) || lines.length === 0 || !LOG_CALLBACK_URL || !RUN_ID) {",
    "    return;",
    "  }",
    "  for (const content of lines) {",
    "    if (bufferedLogLines.length >= MAX_BUFFERED_LOG_LINES) {",
    "      droppedLogLineCount += 1;",
    "      continue;",
    "    }",
    "    bufferedLogLines.push({ level, content });",
    "  }",
    "  if (bufferedLogLines.length >= MAX_LOG_BATCH_LINES) {",
    "    void flushLogLines();",
    "    return;",
    "  }",
    "  scheduleLogFlush();",
    "};",
    "",
    "const flushLogLines = async () => {",
    "  if (logFlushPromise) {",
    "    await logFlushPromise;",
    "    return;",
    "  }",
    "  if (logFlushTimer !== null) {",
    "    clearTimeout(logFlushTimer);",
    "    logFlushTimer = null;",
    "  }",
    "  if (bufferedLogLines.length === 0 && droppedLogLineCount === 0) {",
    "    return;",
    "  }",
    "  const batch = bufferedLogLines.splice(0, MAX_LOG_BATCH_LINES);",
    "  const truncatedCount = droppedLogLineCount;",
    "  droppedLogLineCount = 0;",
    "  if (truncatedCount > 0) {",
    '    batch.push({ level: "stderr", content: `[${truncatedCount} log lines truncated before upload]` });',
    "  }",
    "  logFlushPromise = (async () => {",
    "    try {",
    "      if (batch.length === 0 || !LOG_CALLBACK_URL || !RUN_ID) {",
    "        return;",
    "      }",
    "      await postJson(LOG_CALLBACK_URL, {",
    "        automation_run_id: RUN_ID,",
    "        lines: batch,",
    "      });",
    "    } catch {}",
    "    finally {",
    "      logFlushPromise = null;",
    "      if (bufferedLogLines.length > 0 || droppedLogLineCount > 0) {",
    "        scheduleLogFlush();",
    "      }",
    "    }",
    "  })();",
    "  await logFlushPromise;",
    "};",
    "",
    "let completionSent = false;",
    "const postCompletion = async (status, errorMessage) => {",
    "  if (completionSent || !COMPLETE_CALLBACK_URL || !RUN_ID) {",
    "    return;",
    "  }",
    "  completionSent = true;",
    "  let lastError = null;",
    "  for (let attempt = 0; attempt < COMPLETION_RETRY_DELAYS_MS.length; attempt += 1) {",
    "    try {",
    "      await postJson(COMPLETE_CALLBACK_URL, {",
    "        automation_run_id: RUN_ID,",
    "        status,",
    "        ...(errorMessage ? { error_message: errorMessage } : {}),",
    "      });",
    "      return;",
    "    } catch (error) {",
    "      lastError = error;",
    "      if (attempt < COMPLETION_RETRY_DELAYS_MS.length - 1) {",
    "        await sleep(COMPLETION_RETRY_DELAYS_MS[attempt]);",
    "      }",
    "    }",
    "  }",
    "  process.stderr.write(`[keppo-fly-wrapper] completion callback failed: ${lastError instanceof Error ? lastError.message : String(lastError)}\\n`);",
    "};",
    "",
    "const splitLines = (carry, chunk) => {",
    '  const normalized = `${carry}${chunk.toString("utf8").replace(/\\r\\n/g, "\\n")}`;',
    '  const parts = normalized.split("\\n");',
    '  const nextCarry = parts.pop() ?? "";',
    "  return {",
    "    carry: nextCarry,",
    "    lines: parts.map((line) => line.trimEnd()).filter((line) => line.length > 0),",
    "  };",
    "};",
    "",
    "const validateEnv = () => {",
    "  const missing = [];",
    "  if (!RUN_ID) missing.push('KEPPO_AUTOMATION_RUN_ID');",
    "  if (!RUNNER_ENTRYPOINT_PATH) missing.push('KEPPO_RUNNER_ENTRYPOINT_PATH');",
    "  if (!RUNNER_COMMAND) missing.push('KEPPO_RUNNER_COMMAND');",
    "  if (!LOG_CALLBACK_URL) missing.push('KEPPO_LOG_CALLBACK_URL');",
    "  if (!COMPLETE_CALLBACK_URL) missing.push('KEPPO_COMPLETE_CALLBACK_URL');",
    "  if (missing.length > 0) {",
    '    throw new Error(`Missing required Fly sandbox runner environment: ${missing.join(", ")}`);',
    "  }",
    "};",
    "",
    "const packages = parsePackages();",
    "const installCommand = packages.length > 0",
    "  ? `npm install --no-audit --no-fund --prefix ${shellQuote(dirname(RUNNER_ENTRYPOINT_PATH))} ${packages.map(shellQuote).join(' ')}`",
    "  : '';",
    "const commandScript = [installCommand, RUNNER_SETUP_COMMAND, RUNNER_BOOTSTRAP_COMMAND, RUNNER_COMMAND]",
    "  .map((part) => part.trim())",
    "  .filter((part) => part.length > 0)",
    '  .join(" && ");',
    "",
    "validateEnv();",
    "if (!commandScript) {",
    "  throw new Error('No Fly sandbox runner command was configured.');",
    "}",
    "",
    "let timedOut = false;",
    "let cancelled = false;",
    'let stdoutCarry = "";',
    'let stderrCarry = "";',
    "",
    'const child = spawn("sh", ["-lc", commandScript], {',
    "  env: process.env,",
    '  stdio: ["ignore", "pipe", "pipe"],',
    "});",
    "",
    "const timeoutHandle = setTimeout(() => {",
    "  timedOut = true;",
    '  child.kill("SIGTERM");',
    '  setTimeout(() => child.kill("SIGKILL"), TIMEOUT_GRACE_MS).unref?.();',
    "}, TIMEOUT_MS);",
    "timeoutHandle.unref?.();",
    "",
    'child.stdout.on("data", (chunk) => {',
    "  const { lines, carry } = splitLines(stdoutCarry, chunk);",
    "  stdoutCarry = carry;",
    '  enqueueLogLines("stdout", lines);',
    "});",
    "",
    'child.stderr.on("data", (chunk) => {',
    "  const { lines, carry } = splitLines(stderrCarry, chunk);",
    "  stderrCarry = carry;",
    '  enqueueLogLines("stderr", lines);',
    "});",
    "",
    "const forwardTermination = () => {",
    "  if (child.exitCode !== null) {",
    "    return;",
    "  }",
    "  cancelled = true;",
    '  child.kill("SIGTERM");',
    '  setTimeout(() => child.kill("SIGKILL"), TIMEOUT_GRACE_MS).unref?.();',
    "};",
    "",
    'process.on("SIGTERM", forwardTermination);',
    'process.on("SIGINT", forwardTermination);',
    "",
    "await new Promise((resolve) => {",
    '  child.on("close", async (code, signal) => {',
    "    clearTimeout(timeoutHandle);",
    "    if (stdoutCarry.trim().length > 0) {",
    '      enqueueLogLines("stdout", [stdoutCarry.trim()]);',
    "    }",
    "    if (stderrCarry.trim().length > 0) {",
    '      enqueueLogLines("stderr", [stderrCarry.trim()]);',
    "    }",
    "    while (logFlushPromise || bufferedLogLines.length > 0 || droppedLogLineCount > 0) {",
    "      await flushLogLines();",
    "    }",
    "    const status = timedOut",
    '      ? "timed_out"',
    "      : cancelled",
    '        ? "cancelled"',
    "        : code === 0",
    '          ? "succeeded"',
    '          : "failed";',
    '    const errorMessage = status === "failed"',
    '      ? `Sandbox process exited with code ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}`',
    '      : status === "timed_out"',
    '        ? "Sandbox process exceeded timeout"',
    '        : status === "cancelled"',
    '          ? "Sandbox process terminated by request"',
    "          : undefined;",
    "    await postCompletion(status, errorMessage);",
    '    process.exitCode = status === "succeeded" ? 0 : 1;',
    "    resolve(undefined);",
    "  });",
    "});",
  ].join("\n");
};

const FLY_WRAPPER_SOURCE = buildFlyWrapperSource();

const omitEmptyEnvValues = (env: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(([, value]) => typeof value === "string" && value.trim().length > 0),
  );

export class FlyMachinesSandboxProvider implements SandboxProvider {
  private readonly options: FlySandboxOptions;

  constructor(
    private readonly client: FlyMachinesClientLike = createDefaultClient(getEnv()),
    options: FlySandboxOptions = resolveFlySandboxOptions(getEnv()),
  ) {
    this.options = options;
  }

  async dispatch(config: SandboxConfig): Promise<SandboxDispatchResult> {
    if (
      config.runtime.network_access === "mcp_only" &&
      getEnv().KEPPO_FLY_ALLOW_UNENFORCED_MCP_ONLY !== true
    ) {
      throw new Error(
        "Fly sandbox does not enforce mcp_only egress. Set KEPPO_FLY_ALLOW_UNENFORCED_MCP_ONLY=true to allow this configuration explicitly.",
      );
    }

    const runId =
      extractRunId(config.runtime.callbacks.complete_url) ??
      extractRunId(config.runtime.callbacks.log_url);
    if (!runId) {
      throw new Error("Automation sandbox callbacks must include automation_run_id.");
    }

    await this.ensureAppExists();

    const runtimeEnv = omitEmptyEnvValues({
      ...config.bootstrap.env,
      ...config.runtime.env,
      ...(config.bootstrap.command.trim().length > 0
        ? { KEPPO_RUNNER_SETUP_COMMAND: config.bootstrap.command }
        : {}),
      ...(config.runtime.bootstrap_command
        ? { KEPPO_RUNNER_BOOTSTRAP_COMMAND: config.runtime.bootstrap_command }
        : {}),
      KEPPO_AUTOMATION_RUN_ID: runId,
      KEPPO_COMPLETE_CALLBACK_URL: config.runtime.callbacks.complete_url,
      KEPPO_LOG_CALLBACK_URL: config.runtime.callbacks.log_url,
      KEPPO_RUNNER_COMMAND: config.runtime.command,
      KEPPO_RUNNER_ENTRYPOINT_PATH: config.runtime.runner.entrypoint_path,
      KEPPO_RUNNER_PACKAGES_JSON: JSON.stringify(config.runtime.runner.install_packages),
      KEPPO_TIMEOUT_GRACE_MS: String(this.options.timeoutGraceMs),
      KEPPO_TIMEOUT_MS: String(config.timeout_ms),
      KEPPO_TRACE_CALLBACK_URL: config.runtime.callbacks.trace_url,
    });

    const machine = await this.client.createMachine(this.options.appName, {
      config: {
        auto_destroy: true,
        env: runtimeEnv,
        files: [
          {
            guest_path: WRAPPER_ENTRYPOINT_PATH,
            raw_value: encodeFileContent(FLY_WRAPPER_SOURCE),
          },
          {
            guest_path: config.runtime.runner.entrypoint_path,
            raw_value: encodeFileContent(config.runtime.runner.source_text),
          },
        ],
        guest: {
          cpu_kind: this.options.cpuKind,
          cpus: this.options.cpus,
          memory_mb: this.options.memoryMb,
        },
        image: this.options.automationImage,
        init: {
          exec: ["node", WRAPPER_ENTRYPOINT_PATH],
        },
        metadata: {
          automation_run_id: runId,
          keppo_network_access: config.runtime.network_access,
          keppo_sandbox_provider: "fly",
        },
        restart: {
          policy: "no",
        },
        stop_config: {
          signal: "SIGTERM",
          timeout: this.options.timeoutGraceMs * 1_000_000,
        },
      },
      name: buildMachineName(runId),
      ...(this.options.region ? { region: this.options.region } : {}),
      skip_service_registration: true,
    });
    await this.client.waitForMachineStarted(this.options.appName, machine.id);

    return {
      sandbox_id: toSandboxHandle(this.options.appName, machine.id),
    };
  }

  async terminate(sandboxId: string): Promise<void> {
    const { appName, machineId } = parseSandboxHandle(sandboxId);
    if (!appName || !machineId) {
      throw new Error("Invalid Fly sandbox handle.");
    }

    try {
      await this.client.deleteMachine(appName, machineId, { force: true });
    } catch (error) {
      if (getErrorStatus(error) === 404) {
        return;
      }
      throw error;
    }
  }

  private async ensureAppExists(): Promise<void> {
    const existingCheck = flyAppReadyByName.get(this.options.appName);
    if (existingCheck) {
      await existingCheck;
      return;
    }
    const check = this.ensureAppExistsUncached().catch((error) => {
      flyAppReadyByName.delete(this.options.appName);
      throw error;
    });
    flyAppReadyByName.set(this.options.appName, check);
    await check;
  }

  private async ensureAppExistsUncached(): Promise<void> {
    const existing = await this.client.getApp(this.options.appName);
    if (existing) {
      return;
    }
    try {
      await this.client.createApp({
        app_name: this.options.appName,
        org_slug: this.options.orgSlug,
        ...(this.options.appNetwork ? { network: this.options.appNetwork } : {}),
      });
    } catch (error) {
      if (getErrorStatus(error) === 409) {
        return;
      }
      throw error;
    }
  }
}
