import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const budgetMs = Number(process.env.E2E_TEST_TIMEOUT_MS ?? "20000");
const providerActionMatrixBudgetMs = Number(
  process.env.E2E_PROVIDER_ACTION_MATRIX_TIMEOUT_MS ?? "30000",
);
const defaultReportPath = path.join(
  process.env.PLAYWRIGHT_JSON_OUTPUT_DIR ?? "test-results",
  process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? "e2e-report.json",
);
const reportPath = process.env.PLAYWRIGHT_JSON_REPORT ?? defaultReportPath;

if (!existsSync(reportPath)) {
  process.stderr.write(`Playwright JSON report not found at ${reportPath}\n`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const offenders = [];

const getBudgetForTest = (file, title) => {
  if (typeof file === "string" && file.includes("providers/provider-action-matrix.spec.ts")) {
    return providerActionMatrixBudgetMs;
  }
  if (typeof title === "string" && title.toLowerCase().includes("provider-action-matrix")) {
    return providerActionMatrixBudgetMs;
  }
  return budgetMs;
};

const walk = (suite, suitePath = []) => {
  for (const child of suite.suites ?? []) {
    walk(child, [...suitePath, child.title].filter(Boolean));
  }
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const testTitle = [...suitePath, spec.title].filter(Boolean).join(" > ");
      for (const result of test.results ?? []) {
        const duration = Number(result.duration ?? 0);
        const perTestBudgetMs = getBudgetForTest(spec.file, testTitle);
        if (duration > perTestBudgetMs) {
          offenders.push({
            duration,
            budget: perTestBudgetMs,
            file: spec.file,
            title: testTitle,
            status: result.status ?? "unknown",
          });
        }
      }
    }
  }
};

walk(report);

if (offenders.length > 0) {
  offenders.sort((a, b) => b.duration - a.duration);
  process.stderr.write(
    `E2E per-test time budget exceeded:\n${offenders.map((entry) => `- ${entry.duration}ms > ${entry.budget}ms :: ${entry.file} :: ${entry.title} [${entry.status}]`).join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(`e2e time budget ok (<= ${budgetMs}ms per test result)\n`);
