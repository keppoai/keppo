import crypto from "node:crypto";
import fs from "node:fs";

const contextPath = process.env.CONTEXT_PATH;
const reviewPath = process.env.REVIEW_PATH;
const findingsPath = process.env.FINDINGS_PATH;
const expectedContextSha = process.env.EXPECTED_CONTEXT_SHA;

if (!contextPath) throw new Error("CONTEXT_PATH is required");
if (!reviewPath) throw new Error("REVIEW_PATH is required");
if (!expectedContextSha) throw new Error("EXPECTED_CONTEXT_SHA is required");

const contextRaw = fs.readFileSync(contextPath, "utf8");
const context = JSON.parse(contextRaw);
const actualContextSha = crypto
  .createHash("sha256")
  .update(contextRaw)
  .digest("hex");
if (actualContextSha !== expectedContextSha) {
  throw new Error("PR review context changed after generation");
}

const summary = fs.readFileSync(reviewPath, "utf8").trim();
if (!summary) {
  throw new Error("Review output file is empty");
}

// Validate that the summary contains a Recommendation line with a valid value.
// Graceful fallback: if missing (e.g. in-flight review using old prompt format),
// inject a safe default of human-review rather than failing the workflow.
const recMatch = summary.match(
  /\*\*Recommendation:\s*(auto-fix|human-review|ready)\s*\*\*/,
);
let finalSummary = summary;
if (!recMatch) {
  console.warn(
    "WARNING: Review summary missing **Recommendation:** line — defaulting to human-review",
  );
  const verdictIndex = finalSummary.indexOf("**Verdict:");
  if (verdictIndex !== -1) {
    const lineEnd = finalSummary.indexOf("\n", verdictIndex);
    if (lineEnd !== -1) {
      finalSummary =
        finalSummary.slice(0, lineEnd + 1) +
        "**Recommendation: human-review (default)**\n" +
        finalSummary.slice(lineEnd + 1);
    } else {
      finalSummary += "\n**Recommendation: human-review (default)**";
    }
  } else {
    finalSummary = "**Recommendation: human-review**\n\n" + finalSummary;
  }
}

fs.writeFileSync(reviewPath, finalSummary);

if (!findingsPath) {
  process.exit(0);
}

if (!fs.existsSync(findingsPath)) {
  throw new Error("Findings output file is missing");
}

const filesByPath = new Map(
  (context.files ?? []).map((file) => [file.path, file]),
);

const lineInRanges = (line, ranges) =>
  Array.isArray(ranges) &&
  ranges.some((range) => Number.isInteger(range.start) && Number.isInteger(range.end) && line >= range.start && line <= range.end);

const findingsRaw = fs.readFileSync(findingsPath, "utf8").trim();
if (!findingsRaw) {
  throw new Error("Findings output file is empty");
}
const findingsPayload = JSON.parse(findingsRaw);
if (!findingsPayload || typeof findingsPayload !== "object") {
  throw new Error("Findings output must be a JSON object");
}
if (!Array.isArray(findingsPayload.findings)) {
  throw new Error("Findings output must include a findings array");
}

const rawFindings = findingsPayload.findings;
const normalizedFindings = [];
const seenKeys = new Set();

for (const [index, finding] of rawFindings.entries()) {
  if (!finding || typeof finding !== "object") {
    throw new Error(`Finding ${index} must be an object`);
  }

  const severity = `${finding.severity ?? ""}`.trim().toUpperCase();
  if (severity !== "HIGH" && severity !== "MEDIUM") {
    throw new Error(`Finding ${index} has invalid severity: ${finding.severity}`);
  }

  const path = `${finding.path ?? ""}`.trim();
  const file = filesByPath.get(path);
  if (!file) {
    throw new Error(`Finding ${index} references unknown changed file: ${path}`);
  }

  const lineRaw = `${finding.line ?? ""}`.trim();
  const line = /^\d+$/.test(lineRaw) ? Number(lineRaw) : Number.NaN;
  if (!Number.isInteger(line) || line <= 0) {
    throw new Error(`Finding ${index} has invalid line: ${finding.line}`);
  }
  if (!lineInRanges(line, file.commentableLineRanges)) {
    throw new Error(
      `Finding ${index} references non-commentable line ${line} in ${path}`,
    );
  }

  const title = `${finding.title ?? ""}`.trim();
  const body = `${finding.body ?? ""}`.trim();
  const suggestion =
    typeof finding.suggestion === "string" ? finding.suggestion.trim() : "";

  if (!title) {
    throw new Error(`Finding ${index} is missing title`);
  }
  if (!body) {
    throw new Error(`Finding ${index} is missing body`);
  }

  const dedupeKey = `${severity}:${path}:${line}:${title}`;
  if (seenKeys.has(dedupeKey)) {
    continue;
  }
  seenKeys.add(dedupeKey);

  normalizedFindings.push({
    severity,
    path,
    line,
    title,
    body,
    ...(suggestion ? { suggestion } : {}),
  });
}

const hasExplicitRecommendation = Boolean(recMatch);
const recommendation = recMatch?.[1] ?? "human-review";
const highFindings = normalizedFindings.filter(
  (finding) => finding.severity === "HIGH",
);
if (recommendation === "ready" && highFindings.length > 0) {
  throw new Error("Review summary says ready but findings include HIGH issues");
}
if (
  hasExplicitRecommendation &&
  (recommendation === "auto-fix" || recommendation === "human-review") &&
  highFindings.length === 0
) {
  throw new Error(
    `Review summary says ${recommendation} but findings do not include HIGH issues`,
  );
}
if (
  normalizedFindings.length > 0 &&
  finalSummary.includes(":white_check_mark: No significant issues found.")
) {
  throw new Error(
    "Review summary says no significant issues found but findings were emitted",
  );
}

fs.writeFileSync(
  findingsPath,
  JSON.stringify({ findings: normalizedFindings }, null, 2) + "\n",
);
