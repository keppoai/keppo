// SPDX-License-Identifier: FSL-1.1-Apache-2.0

import { setTimeout as sleep } from "node:timers/promises";
import type {
  SandboxConfig,
  SandboxProvider,
} from "../../../apps/web/app/lib/server/api-runtime/sandbox/types.js";

const SANDBOX_WORKDIR = "/vercel/sandbox";
const RUNNER_DIR = `${SANDBOX_WORKDIR}/.keppo-automation-runner`;
const RUNNER_BIN_DIR = `${RUNNER_DIR}/node_modules/.bin`;
const ENTRYPOINT_PATH = `${SANDBOX_WORKDIR}/keppo-automation-runner.mjs`;
const SETUP_TIMEOUT_BUFFER_MS = 60_000;
const TERMINATION_GRACE_MS = 5_000;
const SANDBOX_HANDLE_SEPARATOR = "::";
const PINNED_CODEX_PACKAGE = "@openai/codex@0.118.0";

type VercelNetworkPolicy =
  | "allow-all"
  | "deny-all"
  | {
      allow?: string[];
      subnets?: {
        allow?: string[];
        deny?: string[];
      };
    };

type VercelCommandLog = {
  data: string;
  stream: "stdout" | "stderr";
};

type VercelCommand = {
  readonly cmdId: string;
  readonly exitCode: number | null;
  logs(options?: { signal?: AbortSignal }): AsyncIterable<VercelCommandLog>;
  wait(options?: { signal?: AbortSignal }): Promise<{ exitCode: number | null }>;
  stdout?(options?: { signal?: AbortSignal }): Promise<string>;
  stderr?(options?: { signal?: AbortSignal }): Promise<string>;
  kill?(signal?: string, options?: { abortSignal?: AbortSignal }): Promise<void>;
};

type VercelSandboxInstance = {
  readonly sandboxId: string;
  writeFiles(files: Array<{ path: string; content: Buffer }>): Promise<void>;
  runCommand(options: {
    cmd: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    detached?: boolean;
    signal?: AbortSignal;
  }): Promise<VercelCommand>;
  updateNetworkPolicy(
    networkPolicy: VercelNetworkPolicy,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  getCommand(cmdId: string, options?: { signal?: AbortSignal }): Promise<VercelCommand>;
  stop(options?: { signal?: AbortSignal }): Promise<void>;
};

type VercelSandboxModule = {
  Sandbox?: {
    create?: (options: {
      runtime?: string;
      timeout?: number;
      env?: Record<string, string>;
      networkPolicy?: VercelNetworkPolicy;
    }) => Promise<VercelSandboxInstance>;
    get?: (options: { sandboxId: string; signal?: AbortSignal }) => Promise<VercelSandboxInstance>;
  };
};

type SandboxLoader = () => Promise<VercelSandboxModule>;
const BOOTSTRAP_SECRET_ENV_NAMES = [
  "OPENAI_API_KEY",
  "OPENAI_SUBSCRIPTION_TOKEN",
  "OPENAI_CODEX_AUTH_JSON",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_SUBSCRIPTION_TOKEN",
  "KEPPO_MCP_BEARER_TOKEN",
] as const;
const PACKAGE_REGISTRY_NETWORK_POLICY: VercelNetworkPolicy = {
  allow: ["registry.npmjs.org"],
};

const defaultSandboxLoader: SandboxLoader = async () => {
  return (await import("@vercel/sandbox")) as unknown as VercelSandboxModule;
};

const extractHost = (value: string): string | null => {
  try {
    const host = new URL(value).hostname.trim().toLowerCase();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
};

const isIpv4Host = (value: string): boolean => /^(\d{1,3}\.){3}\d{1,3}$/u.test(value);

const isIpv6Host = (value: string): boolean => value.includes(":");

const extractRunId = (urlValue: string): string | null => {
  try {
    const url = new URL(urlValue);
    const runId = url.searchParams.get("automation_run_id")?.trim() ?? "";
    return runId.length > 0 ? runId : null;
  } catch {
    return null;
  }
};

const resolveRunnerPackage = (): string => PINNED_CODEX_PACKAGE;

const toSandboxHandle = (sandboxId: string, cmdId: string): string =>
  `${sandboxId}${SANDBOX_HANDLE_SEPARATOR}${cmdId}`;

const parseSandboxHandle = (handle: string): { sandboxId: string; cmdId: string | null } => {
  const separatorIndex = handle.indexOf(SANDBOX_HANDLE_SEPARATOR);
  if (separatorIndex < 0) {
    return { sandboxId: handle, cmdId: null };
  }
  return {
    sandboxId: handle.slice(0, separatorIndex),
    cmdId: handle.slice(separatorIndex + SANDBOX_HANDLE_SEPARATOR.length) || null,
  };
};

const addProviderApiHost = (
  hostSet: Set<string>,
  addUrlHost: (value: string) => void,
  configuredBaseUrl: string | undefined,
  defaultHost: string,
): void => {
  const trimmedBaseUrl = configuredBaseUrl?.trim() ?? "";
  if (trimmedBaseUrl.length > 0) {
    addUrlHost(trimmedBaseUrl);
    return;
  }
  hostSet.add(defaultHost);
};

const toAllowedNetworkPolicy = (config: SandboxConfig): VercelNetworkPolicy => {
  if (config.runtime.network_access === "mcp_and_web") {
    return "allow-all";
  }

  const hostSet = new Set<string>();
  const subnetSet = new Set<string>();
  const addUrlHost = (value: string) => {
    const host = extractHost(value);
    if (!host) {
      return;
    }
    if (isIpv4Host(host)) {
      subnetSet.add(`${host}/32`);
      return;
    }
    if (isIpv6Host(host)) {
      subnetSet.add(`${host}/128`);
      return;
    }
    hostSet.add(host);
  };

  addUrlHost(config.runtime.callbacks.log_url);
  addUrlHost(config.runtime.callbacks.complete_url);
  const mcpUrl = config.runtime.env.KEPPO_MCP_SERVER_URL;
  if (mcpUrl) {
    addUrlHost(mcpUrl);
  }

  if (
    config.runtime.env.OPENAI_API_KEY ||
    config.runtime.env.OPENAI_SUBSCRIPTION_TOKEN ||
    config.runtime.env.OPENAI_CODEX_AUTH_JSON
  ) {
    addProviderApiHost(hostSet, addUrlHost, config.runtime.env.OPENAI_BASE_URL, "api.openai.com");
  }
  if (config.runtime.env.ANTHROPIC_API_KEY || config.runtime.env.ANTHROPIC_SUBSCRIPTION_TOKEN) {
    addProviderApiHost(
      hostSet,
      addUrlHost,
      config.runtime.env.ANTHROPIC_BASE_URL,
      "api.anthropic.com",
    );
  }

  return {
    ...(hostSet.size > 0 ? { allow: [...hostSet].sort() } : {}),
    ...(subnetSet.size > 0
      ? {
          subnets: {
            allow: [...subnetSet].sort(),
          },
        }
      : {}),
  };
};

const buildRunnerEntrypoint = (): string => {
  return [
    'import { spawn } from "node:child_process";',
    "",
    'const RUNNER_SETUP_COMMAND = process.env.KEPPO_RUNNER_SETUP_COMMAND ?? "";',
    'const LOG_CALLBACK_URL = process.env.KEPPO_LOG_CALLBACK_URL ?? "";',
    'const COMPLETE_CALLBACK_URL = process.env.KEPPO_COMPLETE_CALLBACK_URL ?? "";',
    'const RUNNER_BOOTSTRAP_COMMAND = process.env.KEPPO_RUNNER_BOOTSTRAP_COMMAND ?? "";',
    'const RUNNER_COMMAND = process.env.KEPPO_RUNNER_COMMAND ?? "";',
    'const RUNNER_BIN_DIR = process.env.KEPPO_RUNNER_BIN_DIR ?? "";',
    'const VERCEL_AUTOMATION_BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";',
    'const TIMEOUT_MS = Math.max(1, Number.parseInt(process.env.KEPPO_TIMEOUT_MS ?? "300000", 10) || 300000);',
    'const TIMEOUT_GRACE_MS = Math.max(1, Number.parseInt(process.env.KEPPO_TIMEOUT_GRACE_MS ?? "5000", 10) || 5000);',
    "",
    "const runId = (() => {",
    "  try {",
    '    return new URL(COMPLETE_CALLBACK_URL).searchParams.get("automation_run_id") ??',
    '      new URL(LOG_CALLBACK_URL).searchParams.get("automation_run_id") ?? null;',
    "  } catch {",
    "    return null;",
    "  }",
    "})();",
    "",
    "if (!RUNNER_COMMAND || !LOG_CALLBACK_URL || !COMPLETE_CALLBACK_URL || !runId) {",
    '  throw new Error("Missing required sandbox runner environment.");',
    "}",
    "",
    "const postJson = async (url, payload) => {",
    "  await fetch(url, {",
    '    method: "POST",',
    "    headers: {",
    '      "content-type": "application/json",',
    "      ...(VERCEL_AUTOMATION_BYPASS_SECRET",
    '        ? { "x-vercel-protection-bypass": VERCEL_AUTOMATION_BYPASS_SECRET }',
    "        : {}),",
    "    },",
    "    body: JSON.stringify(payload),",
    "  });",
    "};",
    "",
    "const postLogLines = async (level, lines) => {",
    "  if (!Array.isArray(lines) || lines.length === 0) {",
    "    return;",
    "  }",
    "  try {",
    "    await postJson(LOG_CALLBACK_URL, {",
    "      automation_run_id: runId,",
    "      lines: lines.map((content) => ({ level, content })),",
    "    });",
    "  } catch {}",
    "};",
    "",
    "let completionSent = false;",
    "const postCompletion = async (status, errorMessage) => {",
    "  if (completionSent) {",
    "    return;",
    "  }",
    "  completionSent = true;",
    "  try {",
    "    await postJson(COMPLETE_CALLBACK_URL, {",
    "      automation_run_id: runId,",
    "      status,",
    "      ...(errorMessage ? { error_message: errorMessage } : {}),",
    "    });",
    "  } catch {}",
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
    "let timedOut = false;",
    "let cancelled = false;",
    'let stdoutCarry = "";',
    'let stderrCarry = "";',
    "",
    "const commandScript = [RUNNER_SETUP_COMMAND, RUNNER_BOOTSTRAP_COMMAND, RUNNER_COMMAND]",
    "  .map((part) => part.trim())",
    "  .filter((part) => part.length > 0)",
    '  .join(" && ");',
    "",
    'const child = spawn("sh", ["-lc", commandScript], {',
    "  env: {",
    "    ...process.env,",
    "    ...(RUNNER_BIN_DIR",
    '      ? { PATH: `${RUNNER_BIN_DIR}${process.env.PATH ? `:${process.env.PATH}` : ""}` }',
    "      : {}),",
    "  },",
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
    '  void postLogLines("stdout", lines);',
    "});",
    "",
    'child.stderr.on("data", (chunk) => {',
    "  const { lines, carry } = splitLines(stderrCarry, chunk);",
    "  stderrCarry = carry;",
    '  void postLogLines("stderr", lines);',
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
    '      await postLogLines("stdout", [stdoutCarry.trim()]);',
    "    }",
    "    if (stderrCarry.trim().length > 0) {",
    '      await postLogLines("stderr", [stderrCarry.trim()]);',
    "    }",
    "",
    "    const status = timedOut",
    '      ? "timed_out"',
    "      : cancelled",
    '        ? "cancelled"',
    "        : code === 0",
    '          ? "succeeded"',
    '          : "failed";',
    "",
    '    const errorMessage = status === "failed"',
    '      ? `Sandbox process exited with code ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}`',
    '      : status === "timed_out"',
    '        ? "Sandbox process exceeded timeout"',
    '        : status === "cancelled"',
    '          ? "Sandbox process terminated by request"',
    "          : undefined;",
    "",
    "    await postCompletion(status, errorMessage);",
    '    process.exitCode = status === "succeeded" ? 0 : 1;',
    "    resolve(undefined);",
    "  });",
    "});",
  ].join("\n");
};

const readCommandOutput = async (
  command: Pick<VercelCommand, "stdout" | "stderr">,
): Promise<string | null> => {
  if (typeof command.stderr === "function") {
    const stderr = (await command.stderr())?.trim();
    if (stderr) {
      return stderr;
    }
  }
  if (typeof command.stdout === "function") {
    const stdout = (await command.stdout())?.trim();
    if (stdout) {
      return stdout;
    }
  }
  return null;
};

export class VercelSandboxProvider implements SandboxProvider {
  private readonly loadModule: SandboxLoader;

  constructor(loader: SandboxLoader = defaultSandboxLoader) {
    this.loadModule = loader;
  }

  async dispatch(config: SandboxConfig): Promise<{ sandbox_id: string }> {
    if (config.bootstrap.network_access !== "package_registry_only") {
      throw new Error("Vercel sandbox bootstrap must use package_registry_only network access.");
    }
    for (const envName of BOOTSTRAP_SECRET_ENV_NAMES) {
      if (config.bootstrap.env[envName]) {
        throw new Error(`Vercel sandbox bootstrap cannot receive ${envName}.`);
      }
    }

    const sandboxModule = await this.loadModule();
    const sandboxFactory = sandboxModule.Sandbox?.create;
    if (typeof sandboxFactory !== "function") {
      throw new Error("@vercel/sandbox is installed but does not expose Sandbox.create().");
    }

    const runId =
      extractRunId(config.runtime.callbacks.complete_url) ??
      extractRunId(config.runtime.callbacks.log_url);
    if (!runId) {
      throw new Error("Automation sandbox callbacks must include automation_run_id.");
    }

    const runnerPackage = resolveRunnerPackage();
    const runtimeEnv = {
      ...config.runtime.env,
      ...(config.bootstrap.command.trim().length > 0
        ? { KEPPO_RUNNER_SETUP_COMMAND: config.bootstrap.command }
        : {}),
      ...(config.runtime.bootstrap_command
        ? { KEPPO_RUNNER_BOOTSTRAP_COMMAND: config.runtime.bootstrap_command }
        : {}),
      KEPPO_RUNNER_COMMAND: config.runtime.command,
      KEPPO_RUNNER_BIN_DIR: RUNNER_BIN_DIR,
      KEPPO_TIMEOUT_MS: String(config.timeout_ms),
      KEPPO_TIMEOUT_GRACE_MS: String(TERMINATION_GRACE_MS),
      KEPPO_LOG_CALLBACK_URL: config.runtime.callbacks.log_url,
      KEPPO_COMPLETE_CALLBACK_URL: config.runtime.callbacks.complete_url,
      KEPPO_SESSION_ARTIFACT_CALLBACK_URL: config.runtime.callbacks.session_artifact_url,
      KEPPO_AUTOMATION_RUN_ID: runId,
      ...(config.runtime.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? { VERCEL_AUTOMATION_BYPASS_SECRET: config.runtime.env.VERCEL_AUTOMATION_BYPASS_SECRET }
        : {}),
    };

    const sandbox = await sandboxFactory({
      runtime: "node24",
      timeout: config.timeout_ms + SETUP_TIMEOUT_BUFFER_MS,
      env: config.bootstrap.env,
      networkPolicy: PACKAGE_REGISTRY_NETWORK_POLICY,
    });

    try {
      const installCommand = await sandbox.runCommand({
        cmd: "npm",
        args: ["install", "--no-audit", "--no-fund", "--prefix", RUNNER_DIR, runnerPackage],
        cwd: SANDBOX_WORKDIR,
        env: config.bootstrap.env,
      });

      if (installCommand.exitCode !== 0) {
        const detail = await readCommandOutput(installCommand);
        throw new Error(
          detail
            ? `Failed to install sandbox runner package ${runnerPackage}: ${detail}`
            : `Failed to install sandbox runner package ${runnerPackage}.`,
        );
      }

      await sandbox.writeFiles([
        {
          path: ENTRYPOINT_PATH,
          content: Buffer.from(buildRunnerEntrypoint(), "utf8"),
        },
      ]);

      await sandbox.updateNetworkPolicy(toAllowedNetworkPolicy(config));

      const command = await sandbox.runCommand({
        cmd: "node",
        args: [ENTRYPOINT_PATH],
        cwd: SANDBOX_WORKDIR,
        env: runtimeEnv,
        detached: true,
      });

      return {
        sandbox_id: toSandboxHandle(sandbox.sandboxId, command.cmdId),
      };
    } catch (error) {
      await sandbox.stop().catch(() => undefined);
      throw error;
    }
  }

  async terminate(sandbox_id: string): Promise<void> {
    const { sandboxId, cmdId } = parseSandboxHandle(sandbox_id);
    if (!sandboxId) {
      return;
    }

    const sandboxModule = await this.loadModule();
    const sandboxGetter = sandboxModule.Sandbox?.get;
    if (typeof sandboxGetter !== "function") {
      throw new Error("@vercel/sandbox is installed but does not expose Sandbox.get().");
    }

    let sandbox: VercelSandboxInstance;
    try {
      sandbox = await sandboxGetter({ sandboxId });
    } catch {
      return;
    }

    try {
      if (cmdId) {
        const command = await sandbox.getCommand(cmdId);
        if (typeof command.kill === "function") {
          await command.kill("SIGTERM");
          await Promise.race([command.wait().catch(() => undefined), sleep(TERMINATION_GRACE_MS)]);
        }
      }
    } finally {
      await sandbox.stop().catch(() => undefined);
    }
  }
}
