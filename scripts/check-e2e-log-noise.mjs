import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const maxServiceStdoutLinesPerTest = Number(
  process.env.E2E_MAX_SERVICE_STDOUT_LINES_PER_TEST ?? "20",
);
const maxCronLinesPerWindow = Number(process.env.E2E_MAX_CRON_LINES_PER_5S ?? "2");
const bucketMs = 5_000;
const isVerbose = process.env.KEPPO_E2E_VERBOSE === "1";

const defaultReportPath = path.join(
  process.env.PLAYWRIGHT_JSON_OUTPUT_DIR ?? "test-results",
  process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? "e2e-report.json",
);
const reportPath = process.env.PLAYWRIGHT_JSON_REPORT ?? defaultReportPath;
const runtimeRoot = path.resolve(process.cwd(), "tests/e2e/.runtime");

const shouldSurfaceServiceLogLine = (line, source) => {
  const levelMatch = line.match(/\[(debug|info|warn|error)\]/i);
  const level = levelMatch?.[1]?.toLowerCase() ?? null;
  if (level === "warn" || level === "error") {
    return true;
  }
  if (/\[error\]|\[warn\]|Error:|EADDRINUSE|ECONNREFUSED|fatal|panic|unhandled/i.test(line)) {
    return true;
  }
  return source === "stderr" && /warn|error|exception|failed/i.test(line);
};

if (!existsSync(reportPath)) {
  process.stderr.write(`Playwright JSON report not found at ${reportPath}\n`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));

let executedTests = 0;
const failedWithoutAttachment = [];

const walk = (suite, suitePath = []) => {
  for (const child of suite.suites ?? []) {
    walk(child, [...suitePath, child.title].filter(Boolean));
  }
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const status = test.status ?? "unknown";
      if (status !== "skipped") {
        executedTests += 1;
      }
      const isFailure = status === "unexpected";
      if (!isFailure) {
        continue;
      }
      const hasServiceLogsAttachment = (test.results ?? []).some((result) =>
        (result.attachments ?? []).some((attachment) => attachment.name === "service-logs"),
      );
      if (!hasServiceLogsAttachment) {
        failedWithoutAttachment.push({
          file: spec.file,
          title: [...suitePath, spec.title].filter(Boolean).join(" > "),
          status,
        });
      }
    }
  }
};

walk(report);

const reportStartTimeMs = Date.parse(report.stats?.startTime ?? "");
const reportDurationMs = Number(report.stats?.duration ?? 0);
const reportEndTimeMs = Number.isFinite(reportStartTimeMs)
  ? reportStartTimeMs + Math.max(0, reportDurationMs)
  : Number.POSITIVE_INFINITY;
const reportMarginMs = 60_000;

const runtimeLogFiles = existsSync(runtimeRoot)
  ? readdirSync(runtimeRoot)
      .filter((fileName) => /^worker-\d+-[^/]+\.log$/.test(fileName))
      .map((fileName) => path.join(runtimeRoot, fileName))
      .filter((logPath) => {
        if (!Number.isFinite(reportStartTimeMs)) {
          return true;
        }
        const mtimeMs = statSync(logPath).mtimeMs;
        return (
          mtimeMs >= reportStartTimeMs - reportMarginMs &&
          mtimeMs <= reportEndTimeMs + reportMarginMs
        );
      })
  : [];

let surfacedServiceLogLines = 0;
const cronBucketCounts = new Map();

for (const logPath of runtimeLogFiles) {
  const raw = readFileSync(logPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const parsed =
      line.match(/^\[(?<ts>[^\]]+)\]\s+\[(?<source>stdout|stderr)\]\s+(?<message>.*)$/i) ?? null;
    const timestamp = parsed?.groups?.ts ?? null;
    const source = (parsed?.groups?.source?.toLowerCase() ?? "stdout");
    const message = parsed?.groups?.message ?? line;

    if (!isVerbose && shouldSurfaceServiceLogLine(message, source)) {
      surfacedServiceLogLines += 1;
    }

    if (
      message.includes("[cron-driver] auto tick failed") ||
      message.includes("[cron-driver] (suppressed")
    ) {
      let bucket = 0;
      if (timestamp) {
        const ms = Date.parse(timestamp);
        if (Number.isFinite(ms)) {
          bucket = Math.floor(ms / bucketMs);
        }
      }
      const key = `${logPath}:${bucket}`;
      cronBucketCounts.set(key, (cronBucketCounts.get(key) ?? 0) + 1);
    }
  }
}

const serviceStdoutLinesPerTest =
  surfacedServiceLogLines / Math.max(1, executedTests);
const maxCronLinesSeen = Math.max(0, ...cronBucketCounts.values());

const failures = [];
if (!isVerbose && serviceStdoutLinesPerTest > maxServiceStdoutLinesPerTest) {
  failures.push(
    `service stdout noise exceeded: ${serviceStdoutLinesPerTest.toFixed(2)} lines/test > ${maxServiceStdoutLinesPerTest}`,
  );
}
if (!isVerbose && maxCronLinesSeen > maxCronLinesPerWindow) {
  failures.push(
    `cron repeat noise exceeded: ${maxCronLinesSeen} lines/5s > ${maxCronLinesPerWindow}`,
  );
}
if (failedWithoutAttachment.length > 0) {
  failures.push(
    `missing service-logs attachment for failed tests:\n${failedWithoutAttachment.map((entry) => `- ${entry.file} :: ${entry.title} [${entry.status}]`).join("\n")}`,
  );
}

if (failures.length > 0) {
  process.stderr.write(`E2E log noise check failed:\n${failures.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(
  `e2e log noise ok (${serviceStdoutLinesPerTest.toFixed(2)} surfaced lines/test, max cron lines/5s=${maxCronLinesSeen}, failed tests missing attachment=${failedWithoutAttachment.length})\n`,
);
