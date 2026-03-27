import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

const readArg = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return args[index + 1] ?? null;
};

const reportPathArg = readArg("--report");
if (!reportPathArg) {
  throw new Error("Missing required --report argument.");
}

const title = readArg("--title") ?? "Playwright Report";
const artifactName = readArg("--artifact-name") ?? null;
const outputPath = readArg("--output") ?? null;
const sha = readArg("--sha") ?? process.env.GITHUB_SHA ?? null;
const maxReasonLength = 400;

const reportPath = path.resolve(process.cwd(), reportPathArg);
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

const writeSummary = (markdown) => {
  if (outputPath) {
    writeFileSync(path.resolve(process.cwd(), outputPath), markdown);
  }
  if (summaryPath) {
    appendFileSync(summaryPath, markdown);
    return;
  }
  process.stdout.write(markdown);
};

const formatDuration = (durationMs) => {
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return "unknown";
  }
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }
  const minutes = durationMs / 60_000;
  if (minutes >= 1) {
    return `${minutes.toFixed(1)} min`;
  }
  return `${(durationMs / 1_000).toFixed(1)} sec`;
};

const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const repository = process.env.GITHUB_REPOSITORY ?? null;

const runUrl =
  repository && process.env.GITHUB_RUN_ID
    ? `${serverUrl}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

const buildSourceUrl = (file, line) => {
  if (!repository || !sha) return null;
  const lineAnchor = line != null ? `#L${line}` : "";
  return `${serverUrl}/${repository}/blob/${sha}/${file}${lineAnchor}`;
};

// Strip ANSI escape codes from terminal output
const stripAnsi = (str) => {
  if (!str) return str;
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "").replace(/\u001b\[[0-9;]*m/g, "");
};

const sanitizeReason = (reason) => {
  if (!reason) {
    return "No error message captured.";
  }
  const stripped = stripAnsi(String(reason));
  const singleLine = stripped.replace(/\s+/g, " ").trim();
  if (!singleLine) {
    return "No error message captured.";
  }
  return singleLine.length > maxReasonLength
    ? `${singleLine.slice(0, maxReasonLength - 3)}...`
    : singleLine;
};

const getResultReason = (result) => {
  if (
    typeof result?.error?.message === "string" &&
    result.error.message.trim()
  ) {
    return result.error.message;
  }
  for (const error of result?.errors ?? []) {
    if (typeof error?.message === "string" && error.message.trim()) {
      return error.message;
    }
    if (typeof error?.value === "string" && error.value.trim()) {
      return error.value;
    }
  }
  return null;
};

const getSkipReason = (test) => {
  for (const ann of test.annotations ?? []) {
    if (
      ann?.type === "skip" &&
      typeof ann?.description === "string" &&
      ann.description.trim()
    ) {
      return ann.description.trim();
    }
  }
  for (const result of test.rawResults ?? []) {
    if (result?.status === "skipped") {
      const msg = getResultReason(result);
      if (msg) {
        return msg;
      }
    }
  }
  return null;
};

const flattenTests = (report) => {
  const flattened = [];

  const visitSuite = (suite) => {
    for (const childSuite of suite?.suites ?? []) {
      visitSuite(childSuite);
    }

    for (const spec of suite?.specs ?? []) {
      for (const test of spec?.tests ?? []) {
        const failingResult = [...(test.results ?? [])]
          .reverse()
          .find((result) =>
            ["failed", "timedOut", "interrupted"].includes(
              result?.status ?? "",
            ),
          );
        flattened.push({
          file: spec.file ?? suite.file ?? "unknown",
          title: spec.title ?? "unknown",
          line: spec.line ?? null,
          column: spec.column ?? null,
          status: test.status ?? "unknown",
          reason: sanitizeReason(getResultReason(failingResult)),
          annotations: test.annotations ?? [],
          rawResults: test.results ?? [],
        });
      }
    }
  };

  for (const suite of report?.suites ?? []) {
    visitSuite(suite);
  }

  return flattened;
};

if (!existsSync(reportPath)) {
  writeSummary(`## ${title}

Merged Playwright JSON report was not generated.

${artifactName ? `Expected artifact: \`${artifactName}\`\n\n` : ""}${runUrl ? `Run: ${runUrl}\n` : ""}`);
  process.exit(0);
}

const parsedReport = JSON.parse(readFileSync(reportPath, "utf8"));
const stats = parsedReport?.stats ?? {};
const allTests = flattenTests(parsedReport);
const failedTests = allTests.filter((test) => test.status === "unexpected");
const flakyTests = allTests.filter((test) => test.status === "flaky");
const skippedTests = allTests.filter((test) => test.status === "skipped");

const expected = Number(stats.expected ?? 0);
const unexpected = Number(stats.unexpected ?? 0);
const flaky = Number(stats.flaky ?? 0);
const skipped = Number(stats.skipped ?? 0);
const duration = formatDuration(Number(stats.duration));

const allPassed = unexpected === 0;
const statusIcon = allPassed ? "\u2705" : "\u274C";

const lines = [
  `## ${statusIcon} ${title}`,
  "",
  "| Metric | Count |",
  "| --- | ---: |",
  `| \u2705 Passed | ${expected} |`,
  `| \u274C Failed | ${unexpected} |`,
  `| \u26A0\uFE0F Flaky | ${flaky} |`,
  `| \u23ED\uFE0F Skipped | ${skipped} |`,
  `| \u23F1\uFE0F Duration | ${duration} |`,
  "",
];

const formatTestEntry = (test) => {
  const location = `${test.file}:${test.line ?? "?"}`;
  const sourceUrl = buildSourceUrl(test.file, test.line);
  const locationDisplay = sourceUrl
    ? `[${location}](${sourceUrl})`
    : `\`${location}\``;
  return [
    `- ${locationDisplay} - ${test.title}`,
    `  > ${test.reason}`,
  ];
};

const formatSkippedEntry = (test) => {
  const location = `${test.file}:${test.line ?? "?"}`;
  const sourceUrl = buildSourceUrl(test.file, test.line);
  const locationDisplay = sourceUrl
    ? `[${location}](${sourceUrl})`
    : `\`${location}\``;
  const skipReason = getSkipReason(test);
  const lines = [`- ${locationDisplay} - ${test.title}`];
  if (skipReason) {
    lines.push(`  > ${sanitizeReason(skipReason)}`);
  }
  return lines;
};

if (failedTests.length > 0) {
  lines.push(`### \u274C Failed Tests (${failedTests.length})`, "");
  for (const test of failedTests) {
    lines.push(...formatTestEntry(test));
  }
  lines.push("");
}

if (flakyTests.length > 0) {
  lines.push(`### \u26A0\uFE0F Flaky Tests (${flakyTests.length})`, "");
  for (const test of flakyTests) {
    lines.push(...formatTestEntry(test));
  }
  lines.push("");
}

if (skippedTests.length > 0) {
  skippedTests.sort((a, b) => {
    const fileCmp = a.file.localeCompare(b.file);
    if (fileCmp !== 0) {
      return fileCmp;
    }
    return a.title.localeCompare(b.title);
  });
  lines.push(`### \u23ED\uFE0F Skipped Tests (${skippedTests.length})`, "");
  for (const test of skippedTests) {
    lines.push(...formatSkippedEntry(test));
  }
  lines.push("");
}

if (failedTests.length === 0 && flakyTests.length === 0) {
  lines.push("All tests passed.", "");
}

lines.push("---", "");

if (artifactName) {
  lines.push(`Unified artifact: \`${artifactName}\``);
}

if (runUrl) {
  lines.push(`[View run](${runUrl})`);
}

writeSummary(`${lines.join("\n")}\n`);
