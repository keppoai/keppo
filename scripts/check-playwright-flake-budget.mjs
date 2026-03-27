import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const defaultReportPath = path.join(
  process.env.PLAYWRIGHT_JSON_OUTPUT_DIR ?? "test-results",
  process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? "e2e-report.json",
);
const reportPath = process.env.PLAYWRIGHT_JSON_REPORT ?? defaultReportPath;
const budget = Number(process.env.E2E_FLAKE_BUDGET ?? "0");

if (!existsSync(reportPath)) {
  process.stderr.write(`Playwright JSON report not found at ${reportPath}\n`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(reportPath, "utf8"));

const collect = (suite, acc) => {
  for (const child of suite.suites ?? []) {
    collect(child, acc);
  }
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const status = test.status ?? "unknown";
      if (status === "flaky") {
        acc.push(`${spec.file} :: ${spec.title}`);
      }
    }
  }
};

const flaky = [];
collect(raw, flaky);

if (flaky.length > budget) {
  process.stderr.write(
    `Flake budget exceeded: ${flaky.length} > ${budget}\n${flaky.join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(`Flake budget ok: ${flaky.length}/${budget}\n`);
