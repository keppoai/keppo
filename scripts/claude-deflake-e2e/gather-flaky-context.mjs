import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const parsedCommitCount = Number.parseInt(process.env.COMMIT_COUNT ?? "10", 10);
const commitCount = Number.isFinite(parsedCommitCount) && parsedCommitCount > 0 ? parsedCommitCount : 10;
const outputPath = process.env.OUTPUT_PATH;
const summaryPath = process.env.SUMMARY_PATH;
const githubOutputPath = process.env.GITHUB_OUTPUT;

if (!token) throw new Error("GITHUB_TOKEN is required");
if (!repository) throw new Error("GITHUB_REPOSITORY is required");
if (!outputPath) throw new Error("OUTPUT_PATH is required");
if (!summaryPath) throw new Error("SUMMARY_PATH is required");
if (!githubOutputPath) throw new Error("GITHUB_OUTPUT is required");

const [owner, repo] = repository.split("/");
if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);

const api = async (pathname) => {
  const response = await fetch(`https://api.github.com/${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "keppo-claude-deflake-e2e",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${pathname} failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

const downloadArtifactZip = async (downloadUrl, destinationZip) => {
  const response = await fetch(downloadUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "keppo-claude-deflake-e2e",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`Artifact download failed: ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destinationZip, bytes);
};

const normalizeSpecPath = (rawTitle) => {
  const match = rawTitle.match(/([A-Za-z0-9_./-]+\.spec\.ts)\b/);
  return match?.[1] ?? "unknown";
};

const collectFlakyFromReport = (report, sourceLabel) => {
  const matches = [];

  const visitSuite = (suite, parents = []) => {
    const nextParents = suite?.title ? [...parents, suite.title] : parents;

    for (const child of suite?.suites ?? []) {
      visitSuite(child, nextParents);
    }

    for (const spec of suite?.specs ?? []) {
      for (const test of spec?.tests ?? []) {
        const results = test?.results ?? [];
        const finalStatus = results.at(-1)?.status ?? test?.status ?? "unknown";
        const hadPriorFailure = results
          .slice(0, Math.max(0, results.length - 1))
          .some((result) => ["failed", "timedOut", "interrupted"].includes(result?.status ?? ""));
        const isFlaky = test?.status === "flaky" || (finalStatus === "passed" && hadPriorFailure);
        if (!isFlaky) continue;

        const titleParts = [spec.file ?? suite?.file ?? "unknown", ...nextParents, spec.title ?? "unknown"];
        const testTitle = titleParts.filter(Boolean).join(" > ");
        matches.push({
          title: testTitle,
          specFile: spec.file ?? suite?.file ?? "unknown",
          source: sourceLabel,
        });
      }
    }
  };

  for (const suite of report?.suites ?? []) {
    visitSuite(suite, []);
  }

  return matches;
};

const collectFlakyFromComment = (body, sourceLabel) => {
  const matches = [];
  let inFlakySection = false;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line === "### Flaky Tests") {
      inFlakySection = true;
      continue;
    }
    if (inFlakySection && line.startsWith("### ")) {
      inFlakySection = false;
    }
    if (!inFlakySection) continue;

    const match = line.match(/^- `(.+?)` \(passed after \d+ retries\)$/);
    if (!match) continue;

    matches.push({
      title: match[1],
      specFile: normalizeSpecPath(match[1]),
      source: sourceLabel,
    });
  }

  return matches;
};

const aggregatedByTitle = new Map();
const noteMatch = (entry) => {
  const existing = aggregatedByTitle.get(entry.title) ?? {
    title: entry.title,
    specFile: entry.specFile,
    occurrences: 0,
    sources: new Set(),
  };
  existing.occurrences += 1;
  existing.sources.add(entry.source);
  aggregatedByTitle.set(entry.title, existing);
};

const recentRuns = await api(
  `repos/${owner}/${repo}/actions/workflows/ci-main.yml/runs?branch=main&event=push&status=completed&per_page=${Math.max(
    1,
    commitCount * 3,
  )}`,
);

for (const run of recentRuns.workflow_runs ?? []) {
  if (!["success", "failure"].includes(run.conclusion)) continue;

  const artifacts = await api(`repos/${owner}/${repo}/actions/runs/${run.id}/artifacts?per_page=30`);
  const reportArtifact = (artifacts.artifacts ?? []).find(
    (artifact) => artifact.name === "e2e-report" && artifact.expired === false,
  );
  if (!reportArtifact) continue;

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `keppo-deflake-${run.id}-`));
  const zipPath = path.join(tmpRoot, "artifact.zip");
  const extractDir = path.join(tmpRoot, "extract");
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    await downloadArtifactZip(reportArtifact.archive_download_url, zipPath);
    execFileSync("unzip", ["-q", zipPath, "-d", extractDir], { stdio: "pipe" });
    const reportPath = path.join(extractDir, "test-results", "e2e-report.json");
    if (!fs.existsSync(reportPath)) continue;
    const parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    for (const match of collectFlakyFromReport(parsed, `main run ${run.id}`)) {
      noteMatch(match);
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

const trustedPullAuthors = new Set(["wwwillchen", "wwwillchen-bot", "keppo-bot"]);
const pulls = await api(`repos/${owner}/${repo}/pulls?state=open&per_page=30`);
for (const pr of pulls) {
  const normalizedAuthor = (pr.user?.login ?? "").replace(/\[bot\]$/i, "");
  if (!trustedPullAuthors.has(normalizedAuthor)) continue;

  const comments = await api(`repos/${owner}/${repo}/issues/${pr.number}/comments?per_page=100`);
  const comment = [...comments]
    .reverse()
    .find(
      (entry) =>
        entry.user?.type === "Bot" &&
        typeof entry.body === "string" &&
        entry.body.includes("Playwright Test Results"),
    );
  if (!comment?.body) continue;

  for (const match of collectFlakyFromComment(comment.body, `PR #${pr.number}`)) {
    noteMatch(match);
  }
}

const flakyTests = [...aggregatedByTitle.values()]
  .map((entry) => ({
    title: entry.title,
    specFile: entry.specFile,
    occurrences: entry.occurrences,
    sources: [...entry.sources].sort(),
  }))
  .sort((a, b) => b.occurrences - a.occurrences || a.title.localeCompare(b.title));

const specMap = new Map();
for (const entry of flakyTests) {
  const spec = specMap.get(entry.specFile) ?? {
    specFile: entry.specFile,
    occurrences: 0,
    tests: [],
  };
  spec.occurrences += entry.occurrences;
  spec.tests.push({
    title: entry.title,
    occurrences: entry.occurrences,
    sources: entry.sources,
  });
  specMap.set(entry.specFile, spec);
}

const rankedSpecs = [...specMap.values()].sort(
  (a, b) => b.occurrences - a.occurrences || a.specFile.localeCompare(b.specFile),
);

const payload = {
  generatedAt: new Date().toISOString(),
  commitCount,
  totalFlakyTests: flakyTests.length,
  flakyTests,
  rankedSpecs,
};

const summaryLines = ["# Flaky E2E Context", ""];
if (rankedSpecs.length === 0) {
  summaryLines.push("No flaky tests were found in recent main runs or recent trusted PR comments.");
} else {
  summaryLines.push(`Found ${flakyTests.length} unique flaky tests across ${rankedSpecs.length} spec files.`, "");
  summaryLines.push("## Ranked Spec Files", "");
  for (const spec of rankedSpecs) {
    summaryLines.push(`- \`${spec.specFile}\` (${spec.occurrences} occurrences)`);
  }
  summaryLines.push("", "## Top Flaky Tests", "");
  for (const entry of flakyTests.slice(0, 20)) {
    summaryLines.push(`- \`${entry.title}\` (${entry.occurrences} occurrences; ${entry.sources.join(", ")})`);
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
fs.writeFileSync(summaryPath, `${summaryLines.join("\n")}\n`);

fs.appendFileSync(githubOutputPath, `has_flaky_tests=${rankedSpecs.length > 0}\n`);
