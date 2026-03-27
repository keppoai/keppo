import { spawn } from "node:child_process";
import {
  releaseE2ERunOwnership,
  startWorkerStack,
  stopWorkerStack,
} from "../tests/e2e/infra/stack-manager";
import { acquireE2ERunOwnership } from "../tests/e2e/infra/stack-manager";

const LOCAL_CONVEX_TEST_PATH_PATTERN = /^tests\/local-convex\/.+\.test\.[cm]?[jt]sx?$/;

const run = async (): Promise<void> => {
  process.env.TZ = "UTC";
  process.env.LANG = "C";
  process.env.LC_ALL = "C";
  process.env.KEPPO_E2E_RUN_ID =
    process.env.KEPPO_E2E_RUN_ID ??
    `local_convex_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;

  const runId = process.env.KEPPO_E2E_RUN_ID;
  if (!runId) {
    throw new Error("Missing KEPPO_E2E_RUN_ID.");
  }

  await acquireE2ERunOwnership(runId, {
    waitForRelease: process.env.KEPPO_E2E_WAIT_FOR_ACTIVE_RUN === "1",
  });

  try {
    const runtime = await startWorkerStack(0);
    const vitestArgs = process.argv.slice(2);
    const testPathArgs = vitestArgs.filter((arg) => LOCAL_CONVEX_TEST_PATH_PATTERN.test(arg));
    const runnerArgs = vitestArgs.filter((arg) => !LOCAL_CONVEX_TEST_PATH_PATTERN.test(arg));
    const testTargets = testPathArgs.length > 0 ? testPathArgs : ["tests/local-convex/"];

    const child = spawn(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "--config",
        "tests/local-convex/vitest.config.ts",
        ...testTargets,
        ...runnerArgs,
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          CONVEX_URL: runtime.convexUrl,
          VITE_CONVEX_URL: runtime.convexUrl,
          KEPPO_API_BASE_URL: runtime.apiBaseUrl,
          KEPPO_FAKE_GATEWAY_BASE_URL: runtime.fakeGatewayBaseUrl,
          KEPPO_DASHBOARD_BASE_URL: runtime.dashboardBaseUrl,
          KEPPO_LOCAL_QUEUE_BROKER_URL: runtime.queueBrokerBaseUrl,
        },
      },
    );

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code, signal) => {
        if (signal) {
          reject(new Error(`Vitest exited via signal ${signal}`));
          return;
        }
        resolve(code ?? 1);
      });
    });

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  } finally {
    await stopWorkerStack(0);
    await releaseE2ERunOwnership(runId);
  }
};

void run().catch(async (error) => {
  const runId = process.env.KEPPO_E2E_RUN_ID;
  try {
    await stopWorkerStack(0);
  } catch {
    // no-op
  }
  if (runId) {
    try {
      await releaseE2ERunOwnership(runId);
    } catch {
      // no-op
    }
  }
  console.error(error);
  process.exit(1);
});
