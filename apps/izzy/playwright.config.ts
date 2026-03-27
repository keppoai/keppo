import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, devices } from "@playwright/test";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../..");

type VideoMode = "off" | "on" | "retain-on-failure" | "on-first-retry";

const parseVideoMode = (value: string | undefined): VideoMode => {
  switch (value?.trim()) {
    case "off":
    case "on":
    case "retain-on-failure":
    case "on-first-retry":
      return value;
    default:
      return "off";
  }
};

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:3201",
    video: parseVideoMode(process.env.IZZY_PLAYWRIGHT_VIDEO_MODE),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "cd /Users/will/Documents/GitHub/keppo && NODE_ENV=test NEXTAUTH_URL=http://127.0.0.1:3201 GITHUB_ID=test GITHUB_SECRET=test NEXTAUTH_SECRET=test IZZY_ALLOWED_GITHUB_USERS=will IZZY_OPENAI_API_KEY=test IZZY_E2E_PREVIEW_LOGIN=will pnpm --filter @keppo/izzy dev",
    port: 3201,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  outputDir: path.join(repoRoot, "artifacts", "izzy-playwright"),
});
