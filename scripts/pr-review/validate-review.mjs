import crypto from "node:crypto";
import fs from "node:fs";
import { extractFirstJsonObject } from "./extract-json.mjs";

const contextPath = process.env.CONTEXT_PATH;
const reviewPath = process.env.REVIEW_PATH;
const expectedContextSha = process.env.EXPECTED_CONTEXT_SHA;

if (!contextPath) throw new Error("CONTEXT_PATH is required");
if (!reviewPath) throw new Error("REVIEW_PATH is required");
if (!expectedContextSha) throw new Error("EXPECTED_CONTEXT_SHA is required");

const contextRaw = fs.readFileSync(contextPath, "utf8");
const actualContextSha = crypto.createHash("sha256").update(contextRaw).digest("hex");
if (actualContextSha !== expectedContextSha) {
  throw new Error("PR review context changed after generation");
}

const reviewRaw = fs.readFileSync(reviewPath, "utf8");
console.log("--- codex-review.json content ---");
console.log(reviewRaw);
console.log("--- end codex-review.json ---");

const cleaned = extractFirstJsonObject(reviewRaw);
const parsed = JSON.parse(cleaned);
if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
  throw new Error("Review output must be a JSON object");
}

const keys = Object.keys(parsed);
if (keys.length !== 1 || keys[0] !== "summary") {
  throw new Error("Review output must contain exactly one top-level `summary` field");
}

if (typeof parsed.summary !== "string" || parsed.summary.trim() === "") {
  throw new Error("Review summary must be a non-empty string");
}

const summary = parsed.summary.trim();

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
  // Insert default recommendation after the Verdict line if present, otherwise prepend
  const verdictIndex = finalSummary.indexOf("**Verdict:");
  if (verdictIndex !== -1) {
    const lineEnd = finalSummary.indexOf("\n", verdictIndex);
    if (lineEnd !== -1) {
      finalSummary =
        finalSummary.slice(0, lineEnd + 1) +
        "**Recommendation: human-review (default)**\n" +
        finalSummary.slice(lineEnd + 1);
    } else {
      // Verdict is the last line with no trailing newline
      finalSummary += "\n**Recommendation: human-review (default)**";
    }
  } else {
    finalSummary = "**Recommendation: human-review**\n\n" + finalSummary;
  }
}

fs.writeFileSync(reviewPath, JSON.stringify({ summary: finalSummary }, null, 2));
