import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sharedSrcDir = path.join(repoRoot, "packages", "shared", "src");
const sharedDistDir = path.join(repoRoot, "packages", "shared", "dist");
const runtimeModeRaw = (process.env.KEPPO_E2E_RUNTIME_MODE ?? "prebuilt").trim().toLowerCase();
const reportDirRaw = (process.env.PLAYWRIGHT_JSON_OUTPUT_DIR ?? "test-results").trim();
const reportNameRaw = (process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? "e2e-report.json").trim();
const reportPathRaw = (process.env.PLAYWRIGHT_JSON_REPORT ?? "").trim();

const shouldIgnoreFreshnessPath = (fullPath) => {
  const normalized = fullPath.replace(/\\/g, "/");
  return (
    normalized.includes("/__tests__/") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.tsx")
  );
};

const walkNewestMtimeMs = (dir) => {
  let newest = 0;
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (shouldIgnoreFreshnessPath(fullPath)) {
        continue;
      }
      const stats = statSync(fullPath);
      newest = Math.max(newest, stats.mtimeMs);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }

  return newest;
};

const runNodeScript = (scriptPath) => {
  const result = spawnSync("node", [scriptPath], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const fail = (message) => {
  process.stderr.write(`e2e preflight failed: ${message}\n`);
  process.exit(1);
};

const resolveRuntimeMode = () => {
  if (runtimeModeRaw === "prebuilt" || runtimeModeRaw === "dev") {
    return runtimeModeRaw;
  }
  fail(
    `KEPPO_E2E_RUNTIME_MODE must be "prebuilt" or "dev", received "${process.env.KEPPO_E2E_RUNTIME_MODE ?? ""}"`,
  );
};

const assertReportContract = () => {
  if (!reportDirRaw) {
    fail("PLAYWRIGHT_JSON_OUTPUT_DIR must not be empty");
  }
  if (!reportNameRaw) {
    fail("PLAYWRIGHT_JSON_OUTPUT_NAME must not be empty");
  }
  if (path.basename(reportNameRaw) !== reportNameRaw) {
    fail(`PLAYWRIGHT_JSON_OUTPUT_NAME must be a file name, received "${reportNameRaw}"`);
  }

  const reportDir = reportPathRaw
    ? path.resolve(repoRoot, path.dirname(reportPathRaw))
    : path.resolve(repoRoot, reportDirRaw);

  if (!existsSync(reportDir)) {
    mkdirSync(reportDir, { recursive: true });
  }
  if (!statSync(reportDir).isDirectory()) {
    fail(`Playwright JSON report directory is not a directory (${reportDir})`);
  }
};

const assertFreshBuildOutput = ({ label, srcDir, outputDir, buildHint }) => {
  if (!existsSync(outputDir)) {
    fail(`${label} build output is missing (${outputDir}). Run \`${buildHint}\`.`);
  }

  const newestSrcMtime = walkNewestMtimeMs(srcDir);
  const newestOutputMtime = walkNewestMtimeMs(outputDir);

  if (newestSrcMtime > newestOutputMtime) {
    fail(`${label} source is newer than build output (${outputDir}). Run \`${buildHint}\`.`);
  }
};

runNodeScript(path.join(repoRoot, "scripts", "check-e2e-shared-state.mjs"));
runNodeScript(path.join(repoRoot, "scripts", "check-e2e-authoring.mjs"));
assertReportContract();
const runtimeMode = resolveRuntimeMode();

if (process.env.KEPPO_E2E_SKIP_DIST_CHECK === "1") {
  process.stdout.write("e2e preflight: build output freshness check skipped\n");
  process.exit(0);
}

assertFreshBuildOutput({
  label: "packages/shared",
  srcDir: sharedSrcDir,
  outputDir: sharedDistDir,
  buildHint: "pnpm --filter @keppo/shared build",
});

if (runtimeMode === "prebuilt") {
  assertFreshBuildOutput({
    label: "apps/web",
    srcDir: path.join(repoRoot, "apps", "web"),
    outputDir: path.join(repoRoot, "apps", "web", ".vercel", "output"),
    buildHint: "pnpm --filter @keppo/web build",
  });
}

process.stdout.write("e2e preflight passed\n");
