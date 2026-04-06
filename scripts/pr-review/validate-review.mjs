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

const filesByPath = new Map(
  (context.files ?? []).map((file) => [file.path, file]),
);

const lineInRanges = (line, ranges) =>
  Array.isArray(ranges) &&
  ranges.some((range) => Number.isInteger(range.start) && Number.isInteger(range.end) && line >= range.start && line <= range.end);

let findingsPayload = { findings: [] };
if (fs.existsSync(findingsPath)) {
  const findingsRaw = fs.readFileSync(findingsPath, "utf8").trim();
  if (findingsRaw) {
    findingsPayload = JSON.parse(findingsRaw);
  }
}

const rawFindings = Array.isArray(findingsPayload.findings)
  ? findingsPayload.findings
  : [];
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

  const line = Number.parseInt(`${finding.line ?? ""}`, 10);
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

fs.writeFileSync(
  findingsPath,
  JSON.stringify({ findings: normalizedFindings }, null, 2) + "\n",
);
