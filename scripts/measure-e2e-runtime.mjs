import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const reportDir = process.env.PLAYWRIGHT_JSON_OUTPUT_DIR ?? "test-results";
const reportName = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? "e2e-report.json";
const reportPath = process.env.PLAYWRIGHT_JSON_REPORT ?? path.join(reportDir, reportName);
const timingOutputPath =
  process.env.E2E_TIMING_OUTPUT ?? path.join("test-results", "e2e-timing-breakdown.json");
const timingEventsPath = path.join("tests", "e2e", ".runtime", "e2e-timing-events.jsonl");
const passthroughArgs = process.argv.slice(2);

mkdirSync(path.dirname(path.resolve(repoRoot, reportPath)), { recursive: true });
mkdirSync(path.dirname(path.resolve(repoRoot, timingEventsPath)), { recursive: true });
mkdirSync(path.dirname(path.resolve(repoRoot, timingOutputPath)), { recursive: true });
rmSync(path.resolve(repoRoot, timingEventsPath), { force: true });

const appendReporterArg = (args) => {
  if (args.some((arg) => arg === "--reporter" || arg.startsWith("--reporter="))) {
    return args;
  }
  return [...args, "--reporter=line,json"];
};

const runtimeStartMs = Date.now();
const runResult = spawnSync("pnpm", ["run", "test:e2e:base", "--", ...appendReporterArg(passthroughArgs)], {
  stdio: "inherit",
  env: {
    ...process.env,
    PLAYWRIGHT_JSON_OUTPUT_DIR: reportDir,
    PLAYWRIGHT_JSON_OUTPUT_NAME: reportName,
    KEPPO_E2E_TIMING_FILE: timingEventsPath,
  },
});
const runtimeEndMs = Date.now();

let playwrightDurationMs = null;
if (existsSync(path.resolve(repoRoot, reportPath))) {
  try {
    const parsedReport = JSON.parse(readFileSync(path.resolve(repoRoot, reportPath), "utf8"));
    if (typeof parsedReport?.stats?.duration === "number") {
      playwrightDurationMs = parsedReport.stats.duration;
    }
  } catch {
    playwrightDurationMs = null;
  }
}

let timingEvents = [];
if (existsSync(path.resolve(repoRoot, timingEventsPath))) {
  const rawEvents = readFileSync(path.resolve(repoRoot, timingEventsPath), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  timingEvents = rawEvents.map((line) => JSON.parse(line));
}

const stackStarts = timingEvents.filter((entry) => entry.event === "stack_start");
const stackReadyEvents = timingEvents.filter((entry) => entry.event === "stack_ready");
const teardownCompleteEvents = timingEvents.filter((entry) => entry.event === "teardown_complete");

const firstStackStartMs =
  stackStarts.length > 0 ? Date.parse(stackStarts[0].at) : Number.NaN;
const bootstrapMs = Number.isFinite(firstStackStartMs)
  ? Math.max(0, firstStackStartMs - runtimeStartMs)
  : null;
const stackReadyMs =
  stackReadyEvents.length > 0
    ? Math.max(...stackReadyEvents.map((entry) => Number(entry.elapsedMs ?? 0)))
    : null;
const teardownMs =
  teardownCompleteEvents.length > 0
    ? Math.max(...teardownCompleteEvents.map((entry) => Number(entry.elapsedMs ?? 0)))
    : null;

const totalMs = runtimeEndMs - runtimeStartMs;
const knownMs = [bootstrapMs, stackReadyMs, playwrightDurationMs, teardownMs]
  .filter((value) => typeof value === "number")
  .reduce((sum, value) => sum + value, 0);
const residualMs = Math.max(0, totalMs - knownMs);

const breakdown = {
  generatedAt: new Date().toISOString(),
  totalRuntimeMs: totalMs,
  reportPath,
  timingEventsPath,
  stages: {
    bootstrapMs,
    stackReadyMs,
    playwrightRuntimeMs: playwrightDurationMs,
    teardownMs,
    residualMs,
  },
  timingEventsCaptured: timingEvents.length,
  commandStatus: runResult.status ?? 1,
};

writeFileSync(path.resolve(repoRoot, timingOutputPath), `${JSON.stringify(breakdown, null, 2)}\n`);
process.stdout.write(`e2e timing breakdown written to ${timingOutputPath}\n`);

if (runResult.status !== 0) {
  process.exit(runResult.status ?? 1);
}
