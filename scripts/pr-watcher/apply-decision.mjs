/**
 * PR Watcher — read and validate Claude's decision, output as step outputs.
 *
 * Required env:
 *   CLAUDE_DECISION_PATH — path to Claude's decision JSON
 *   GITHUB_OUTPUT        — path to $GITHUB_OUTPUT file
 */

import fs from "node:fs";

const claudeDecisionPath = process.env.CLAUDE_DECISION_PATH;
const githubOutputPath = process.env.GITHUB_OUTPUT;

if (!claudeDecisionPath) throw new Error("CLAUDE_DECISION_PATH is required");
if (!githubOutputPath) throw new Error("GITHUB_OUTPUT is required");

if (!fs.existsSync(claudeDecisionPath)) {
  throw new Error(`Decision file not found: ${claudeDecisionPath}`);
}

const setOutput = (key, value) => {
  // Sanitize newlines to prevent GITHUB_OUTPUT injection
  const safe = String(value).replace(/\r?\n/g, " ");
  fs.appendFileSync(githubOutputPath, `${key}=${safe}\n`);
};

const decision = JSON.parse(fs.readFileSync(claudeDecisionPath, "utf8"));

if (!decision.action || !decision.reason) {
  throw new Error("Claude decision must have 'action' and 'reason' fields");
}

const validActions = ["fix-pr", "label"];
const validLabels = ["pr=ready-to-merge", "pr=needs-human-review", "pr=max-auto-fix"];

if (!validActions.includes(decision.action)) {
  throw new Error(`Invalid action: ${decision.action}`);
}

if (decision.action === "fix-pr") {
  setOutput("action", "fix-pr");
  setOutput("label", "/fix-pr");
} else {
  if (!validLabels.includes(decision.label)) {
    throw new Error(`Invalid label: ${decision.label}`);
  }
  setOutput("action", "label");
  setOutput("label", decision.label);
}

setOutput("reason", decision.reason);
console.log(
  `Claude decision: action=${decision.action} label=${decision.label ?? "/fix-pr"}`,
);
console.log(`Reason: ${decision.reason}`);
