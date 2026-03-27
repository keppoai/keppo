import type { FullConfig } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { acquireE2ERunOwnership } from "./infra/stack-manager";

const globalSetup = async (config: FullConfig): Promise<void> => {
  if (config.workers !== 1) {
    throw new Error(
      `Keppo E2E must run with exactly 1 Playwright worker. Resolved workers: ${config.workers}.`,
    );
  }
  process.env.TZ = "UTC";
  process.env.LANG = "C";
  process.env.LC_ALL = "C";
  process.env.KEPPO_E2E_RUN_ID =
    process.env.KEPPO_E2E_RUN_ID ??
    `run_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  const runId = process.env.KEPPO_E2E_RUN_ID;

  await mkdir(path.resolve(process.cwd(), "tests/e2e/.runtime"), { recursive: true });
  await acquireE2ERunOwnership(runId, {
    waitForRelease: process.env.KEPPO_E2E_WAIT_FOR_ACTIVE_RUN === "1",
  });
};

export default globalSetup;
