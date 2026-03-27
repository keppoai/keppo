import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";

const defaultReportPath = path.join(
  process.env.PLAYWRIGHT_JSON_OUTPUT_DIR ?? "test-results",
  process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? "e2e-report.json",
);
const reportPath = process.env.PLAYWRIGHT_JSON_REPORT ?? defaultReportPath;
const outputPath =
  process.env.E2E_TREND_OUTPUT ?? path.join("test-results", "e2e-trend-summary.json");
const generatedAt = new Date().toISOString();

if (!existsSync(reportPath)) {
  process.stderr.write(`Playwright JSON report not found at ${reportPath}\n`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const durationsMs = [];

const statusCounts = {
  passed: 0,
  failed: 0,
  flaky: 0,
  skipped: 0,
  timedOut: 0,
  interrupted: 0,
  unknown: 0,
};

const asFiniteDuration = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};

const percentile = (sortedValues, p) => {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.min(sortedValues.length - 1, Math.ceil(p * sortedValues.length) - 1);
  return sortedValues[index];
};

const walk = (suite) => {
  for (const child of suite.suites ?? []) {
    walk(child);
  }
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const status = String(test.status ?? "unknown");
      if (status in statusCounts) {
        statusCounts[status] += 1;
      } else {
        statusCounts.unknown += 1;
      }

      for (const result of test.results ?? []) {
        durationsMs.push(asFiniteDuration(result.duration));
      }
    }
  }
};

walk(report);
durationsMs.sort((a, b) => a - b);

const totalResults = durationsMs.length;
const totalTests = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
const sumMs = durationsMs.reduce((sum, value) => sum + value, 0);

const summary = {
  generatedAt,
  reportPath,
  totals: {
    tests: totalTests,
    results: totalResults,
    statuses: statusCounts,
  },
  runtimeMs: {
    min: totalResults > 0 ? durationsMs[0] : 0,
    p50: percentile(durationsMs, 0.5),
    p95: percentile(durationsMs, 0.95),
    max: totalResults > 0 ? durationsMs[totalResults - 1] : 0,
    mean: totalResults > 0 ? Math.round(sumMs / totalResults) : 0,
  },
};

const resolvedOutputPath = path.resolve(process.cwd(), outputPath);
mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
writeFileSync(resolvedOutputPath, `${JSON.stringify(summary, null, 2)}\n`);

const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
if (stepSummaryPath) {
  const lines = [
    "### E2E Runtime Trend Summary",
    "",
    `- Generated: \`${generatedAt}\``,
    `- Source report: \`${reportPath}\``,
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Tests | ${summary.totals.tests} |`,
    `| Results | ${summary.totals.results} |`,
    `| Passed | ${summary.totals.statuses.passed} |`,
    `| Failed | ${summary.totals.statuses.failed} |`,
    `| Flaky | ${summary.totals.statuses.flaky} |`,
    `| Skipped | ${summary.totals.statuses.skipped} |`,
    `| p50 (ms) | ${summary.runtimeMs.p50} |`,
    `| p95 (ms) | ${summary.runtimeMs.p95} |`,
    `| Max (ms) | ${summary.runtimeMs.max} |`,
    "",
  ];
  appendFileSync(stepSummaryPath, `${lines.join("\n")}\n`);
}

process.stdout.write(`e2e trend summary written to ${outputPath}\n`);
