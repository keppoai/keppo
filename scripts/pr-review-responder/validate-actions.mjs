import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const contextPath = process.env.CONTEXT_PATH;
const actionsPath = process.env.ACTIONS_PATH;
const expectedContextSha = process.env.EXPECTED_CONTEXT_SHA;

if (!contextPath) throw new Error("CONTEXT_PATH is required");
if (!actionsPath) throw new Error("ACTIONS_PATH is required");
if (!expectedContextSha) throw new Error("EXPECTED_CONTEXT_SHA is required");

const contextRaw = fs.readFileSync(contextPath, "utf8");
const actualContextSha = crypto.createHash("sha256").update(contextRaw).digest("hex");
if (actualContextSha !== expectedContextSha) {
  throw new Error("PR context file changed after generation");
}

const context = JSON.parse(contextRaw);
const actionsRaw = fs.readFileSync(actionsPath, "utf8");

// Always log the raw actions file for debuggability
console.log("--- actions.json content ---");
console.log(actionsRaw);
console.log("--- end actions.json ---");

const actions = JSON.parse(actionsRaw);

const validateDemoVideoPath = (value) => {
  if (typeof value !== "string") {
    throw new Error("demo.videoPath must be a string");
  }
  if (path.isAbsolute(value) || value.includes("\\") || value.includes("..")) {
    throw new Error("demo.videoPath must be a safe relative path under ux-artifacts/video-demos/");
  }
  const normalized = path.posix.normalize(value);
  if (!normalized.startsWith("ux-artifacts/video-demos/")) {
    throw new Error("demo.videoPath must be under ux-artifacts/video-demos/");
  }
};

if (typeof actions.summaryComment !== "string") {
  throw new Error("summaryComment must be a string");
}
if (!Array.isArray(actions.threadActions)) {
  throw new Error("threadActions must be an array");
}
if (actions.unrelatedE2EFailures != null && !Array.isArray(actions.unrelatedE2EFailures)) {
  throw new Error("unrelatedE2EFailures must be an array when provided");
}
if (actions.demo != null) {
  if (
    typeof actions.demo !== "object" ||
    typeof actions.demo.summary !== "string" ||
    typeof actions.demo.videoPath !== "string"
  ) {
    throw new Error("demo must be an object with string summary and videoPath fields");
  }
  validateDemoVideoPath(actions.demo.videoPath);
}

const validActions = new Set(["resolve", "reply_and_resolve", "reply_only"]);
const knownThreads = new Map(context.trustedThreads.map((thread) => [thread.id, thread]));
const unrelatedE2EFailures = actions.unrelatedE2EFailures ?? [];

for (const failure of unrelatedE2EFailures) {
  if (typeof failure !== "object" || failure == null || Array.isArray(failure)) {
    throw new Error("Each unrelatedE2EFailures entry must be an object");
  }
  if (typeof failure.checkName !== "string" || !failure.checkName.trim()) {
    throw new Error("Each unrelatedE2EFailures entry must include a non-empty checkName");
  }
  if (typeof failure.reason !== "string" || !failure.reason.trim()) {
    throw new Error("Each unrelatedE2EFailures entry must include a non-empty reason");
  }
  if (
    failure.specs != null &&
    (!Array.isArray(failure.specs) ||
      failure.specs.some((spec) => typeof spec !== "string" || !spec.trim()))
  ) {
    throw new Error("unrelatedE2EFailures.specs must be an array of non-empty strings when provided");
  }
}

for (const entry of actions.threadActions) {
  if (typeof entry.threadId !== "string" || !knownThreads.has(entry.threadId)) {
    throw new Error(`Unknown threadId in action metadata: ${entry.threadId}`);
  }
  if (!validActions.has(entry.action)) {
    throw new Error(`Invalid action type: ${entry.action}`);
  }

  const thread = knownThreads.get(entry.threadId);

  // Be forgiving: if agent wrote "resolve" but included body+commentId, promote to reply_and_resolve
  if (entry.action === "resolve") {
    if (typeof entry.body === "string" && entry.body.trim() && entry.commentId != null) {
      console.log(`Promoting resolve → reply_and_resolve for thread ${entry.threadId} (body and commentId present)`);
      entry.action = "reply_and_resolve";
    } else {
      delete entry.body;
      delete entry.commentId;
      continue;
    }
  }

  if (typeof entry.body !== "string" || !entry.body.trim()) {
    throw new Error(`${entry.action} requires a non-empty body`);
  }

  // Be forgiving: coerce commentId from string to integer if needed
  if (typeof entry.commentId === "string") {
    entry.commentId = Number.parseInt(entry.commentId, 10);
  }
  if (!Number.isInteger(entry.commentId)) {
    throw new Error(`${entry.action} requires an integer commentId`);
  }

  if (entry.commentId !== thread.replyCommentId) {
    throw new Error(`commentId ${entry.commentId} does not match replyCommentId for thread ${entry.threadId}`);
  }
}

actions.unrelatedE2EFailures = unrelatedE2EFailures.map((failure) => ({
  checkName: failure.checkName.trim(),
  reason: failure.reason.trim(),
  ...(failure.specs != null
    ? {
        specs: failure.specs.map((spec) => spec.trim()),
      }
    : {}),
}));

// Write back the sanitized actions so downstream steps use clean data
fs.writeFileSync(actionsPath, JSON.stringify(actions, null, 2));
