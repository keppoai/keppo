import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

type ConvexImportRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: BufferEncoding;
    timeout: number;
  },
) => {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

const EMPTY_ZIP_ARCHIVE = Buffer.from([
  0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const DEFAULT_CONVEX_IMPORT_TIMEOUT_MS = 45_000;
const CONVEX_IMPORT_MAX_ATTEMPTS = 2;
const CONVEX_IMPORT_RETRY_DELAY_MS = 250;

const resolvePnpmCommand = (): string => {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
};

const assertSuccessfulCommand = (
  label: string,
  timeoutMs: number,
  result: {
    status: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    error?: Error;
  },
): void => {
  if (result.error) {
    throw new Error(`${label} failed after ${timeoutMs}ms: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
    const outcome =
      result.signal !== null ? `signal ${result.signal}` : `exit code ${result.status}`;
    throw new Error(`${label} failed with ${outcome}.${detail ? `\n${detail}` : ""}`);
  }
};

const isRetryableTimeoutError = (result: {
  error?: Error;
  signal: NodeJS.Signals | null;
}): boolean => {
  const message = result.error?.message ?? "";
  return result.signal === "SIGTERM" && message.includes("ETIMEDOUT");
};

const runCommandWithRetry = async (
  label: string,
  timeoutMs: number,
  run: ConvexImportRunner,
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: BufferEncoding;
    timeout: number;
  },
): Promise<void> => {
  for (let attempt = 1; attempt <= CONVEX_IMPORT_MAX_ATTEMPTS; attempt += 1) {
    const result = run(command, args, options);
    if (!isRetryableTimeoutError(result) || attempt === CONVEX_IMPORT_MAX_ATTEMPTS) {
      assertSuccessfulCommand(label, timeoutMs, result);
      return;
    }
    await sleep(CONVEX_IMPORT_RETRY_DELAY_MS);
  }
};

export const resetConvexDeploymentViaImport = async (
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    run?: ConvexImportRunner;
  } = {},
): Promise<void> => {
  const env = {
    ...process.env,
    ...options.env,
  };
  if (env.CONVEX_SELF_HOSTED_URL && env.CONVEX_SELF_HOSTED_ADMIN_KEY) {
    delete env.CONVEX_DEPLOYMENT;
  }
  if (
    !env.CONVEX_DEPLOYMENT &&
    !env.CONVEX_URL &&
    (!env.CONVEX_SELF_HOSTED_URL || !env.CONVEX_SELF_HOSTED_ADMIN_KEY)
  ) {
    throw new Error("Missing CONVEX_DEPLOYMENT or CONVEX_URL for Convex replace-all reset.");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_CONVEX_IMPORT_TIMEOUT_MS;
  const tempDir = await mkdtemp(path.join(tmpdir(), "keppo-convex-reset-"));
  const zipPath = path.join(tempDir, "empty.zip");
  const selfHostedSelectionFilePath = path.join(tempDir, "convex-self-hosted.env");

  try {
    // Minimal empty ZIP archive so Convex can atomically replace all tables.
    await writeFile(zipPath, EMPTY_ZIP_ARCHIVE);
    const run = options.run ?? spawnSync;
    const args = ["exec", "convex", "import", "--replace-all", "--yes"];
    if (env.CONVEX_SELF_HOSTED_URL && env.CONVEX_SELF_HOSTED_ADMIN_KEY) {
      await writeFile(
        selfHostedSelectionFilePath,
        [
          `CONVEX_SELF_HOSTED_URL=${env.CONVEX_SELF_HOSTED_URL}`,
          `CONVEX_SELF_HOSTED_ADMIN_KEY=${env.CONVEX_SELF_HOSTED_ADMIN_KEY}`,
        ].join("\n"),
      );
      args.push("--env-file", selfHostedSelectionFilePath);
    }
    args.push(zipPath);

    await runCommandWithRetry(
      "Convex replace-all reset",
      timeoutMs,
      run,
      resolvePnpmCommand(),
      args,
      {
        cwd: options.cwd ?? process.cwd(),
        env,
        encoding: "utf8",
        timeout: timeoutMs,
      },
    );

    if (env.CONVEX_SELF_HOSTED_URL && env.CONVEX_SELF_HOSTED_ADMIN_KEY) {
      const syncResult = run(
        "bash",
        ["-lc", "source scripts/_convex-env.sh; setup_common_convex_env; setup_e2e_convex_env"],
        {
          cwd: options.cwd ?? process.cwd(),
          env,
          encoding: "utf8",
          timeout: timeoutMs,
        },
      );
      assertSuccessfulCommand("Convex env resync after replace-all reset", timeoutMs, syncResult);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};
