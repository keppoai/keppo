import { defineConfig, devices } from "@playwright/test";

const parsePositiveInt = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const requestedWorkers = parsePositiveInt(
  process.env.E2E_WORKERS ?? process.env.PLAYWRIGHT_WORKERS,
);
if (requestedWorkers !== null && requestedWorkers !== 1) {
  throw new Error(
    `Keppo E2E always runs with exactly 1 Playwright worker. Received ${requestedWorkers}.`,
  );
}

const configuredRetries = 1;
type VideoMode = "off" | "on" | "retain-on-failure" | "on-first-retry";

const parseVideoMode = (value: string | undefined): VideoMode => {
  const candidate = value?.trim();
  switch (candidate) {
    case "off":
    case "on":
    case "retain-on-failure":
    case "on-first-retry":
      return candidate;
    default:
      return "off";
  }
};

const configuredVideoMode = parseVideoMode(process.env.KEPPO_PLAYWRIGHT_VIDEO_MODE);

export default defineConfig({
  testDir: "./specs",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{-projectName}{ext}",
  fullyParallel: true,
  workers: 1,
  retries: configuredRetries,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 15_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: configuredVideoMode,
    timezoneId: "UTC",
    locale: "en-US",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
