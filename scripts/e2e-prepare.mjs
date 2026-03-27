import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const DEFAULT_LOCAL_CONVEX_URL = "http://localhost:3210";
const DEFAULT_LOCAL_CONVEX_SITE_URL = "http://localhost:3211";

const fail = (message) => {
  process.stderr.write(`e2e prepare failed: ${message}\n`);
  process.exit(1);
};

const trimEnvValue = (value) => value?.trim() ?? "";

const deriveConvexSiteUrl = (convexUrl) => {
  const raw = trimEnvValue(convexUrl);
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    const port = Number.parseInt(parsed.port || "", 10);
    if (!Number.isFinite(port)) {
      return raw;
    }
    parsed.port = String(port + 1);
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
};

const resolvePrebuiltWebBuildEnv = () => {
  const keppoUrl = trimEnvValue(process.env.VITE_KEPPO_URL) || trimEnvValue(process.env.KEPPO_URL);
  const convexUrl =
    trimEnvValue(process.env.VITE_CONVEX_URL) ||
    trimEnvValue(process.env.CONVEX_URL) ||
    DEFAULT_LOCAL_CONVEX_URL;
  const convexSiteUrl =
    trimEnvValue(process.env.VITE_CONVEX_SITE_URL) ||
    trimEnvValue(process.env.CONVEX_SITE_URL) ||
    trimEnvValue(process.env.KEPPO_CONVEX_SITE_URL) ||
    deriveConvexSiteUrl(convexUrl) ||
    DEFAULT_LOCAL_CONVEX_SITE_URL;

  return {
    ...(keppoUrl ? { VITE_KEPPO_URL: keppoUrl } : {}),
    VITE_CONVEX_URL: convexUrl,
    VITE_CONVEX_SITE_URL: convexSiteUrl,
  };
};

const run = (command, commandArgs, extraEnv = {}) => {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    cwd: repoRoot,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const resolveRuntimeMode = () => {
  const raw = (process.env.KEPPO_E2E_RUNTIME_MODE ?? "prebuilt").trim().toLowerCase();
  if (raw === "prebuilt" || raw === "dev") {
    return raw;
  }
  fail(
    `KEPPO_E2E_RUNTIME_MODE must be "prebuilt" or "dev", received "${process.env.KEPPO_E2E_RUNTIME_MODE ?? ""}"`,
  );
};

const ensureDirectory = (targetPath, label) => {
  mkdirSync(targetPath, { recursive: true });
  const stats = statSync(targetPath, { throwIfNoEntry: false });
  if (!stats?.isDirectory()) {
    fail(`${label} must resolve to a directory, received ${targetPath}`);
  }
};

const ensureReportOutputAssumptions = () => {
  const outputDirValue = (process.env.PLAYWRIGHT_JSON_OUTPUT_DIR ?? "test-results").trim();
  if (!outputDirValue) {
    fail("PLAYWRIGHT_JSON_OUTPUT_DIR must not be empty");
  }

  const outputNameValue = (process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? "e2e-report.json").trim();
  if (!outputNameValue) {
    fail("PLAYWRIGHT_JSON_OUTPUT_NAME must not be empty");
  }
  if (path.basename(outputNameValue) !== outputNameValue) {
    fail(
      `PLAYWRIGHT_JSON_OUTPUT_NAME must be a file name, received path-like value "${outputNameValue}"`,
    );
  }

  const explicitReportPath = process.env.PLAYWRIGHT_JSON_REPORT?.trim() ?? "";
  if (explicitReportPath.endsWith(path.sep)) {
    fail(
      `PLAYWRIGHT_JSON_REPORT must point to a file, received directory-like value "${explicitReportPath}"`,
    );
  }

  const reportDir = explicitReportPath
    ? path.resolve(repoRoot, path.dirname(explicitReportPath))
    : path.resolve(repoRoot, outputDirValue);
  ensureDirectory(reportDir, "Playwright JSON report directory");
};

const shouldBuild = args.has("--build");
const runtimeMode = resolveRuntimeMode();

ensureReportOutputAssumptions();

if (shouldBuild && runtimeMode === "prebuilt") {
  run("pnpm", ["--filter", "@keppo/shared", "build"]);
  run("pnpm", ["--filter", "@keppo/cloud", "build"]);
  run("pnpm", ["--filter", "@keppo/web", "build"], resolvePrebuiltWebBuildEnv());
}

run("pnpm", ["exec", "node", "scripts/check-e2e-preflight.mjs"], {
  ...(shouldBuild ? { KEPPO_E2E_SKIP_DIST_CHECK: "1" } : {}),
});
