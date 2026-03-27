#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const sourceRoots = ["apps/web/app/lib/server/api-runtime", "convex", "packages/shared/src"];

const listTrackedFiles = () => {
  const quotedRoots = sourceRoots.map((root) => `\"${root}\"`).join(" ");
  const output = execSync(`git ls-files ${quotedRoots}`, { encoding: "utf8" });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => existsSync(line))
    .filter((line) => !line.includes("/_generated/"))
    .filter((line) => /\.(ts|tsx|js|mjs)$/.test(line));
};

const bannedLiterals = [
  "keppo-dev-master-key",
  "keppo-local-better-auth-secret-v1",
  "fake-stripe-webhook-secret",
  "fake-github-webhook-secret",
  "keppo-dev-callback-secret",
];

const bannedRegexes = [
  {
    id: "fail-open-internal-auth",
    regex: /allowWhenSecretMissing\s*[:=]\s*true/g,
    message: "Fail-open internal auth configuration detected.",
  },
  {
    id: "fail-open-nullish",
    regex: /allowWhenSecretMissing\s*\?\?\s*true/g,
    message: "Fail-open nullish fallback detected for allowWhenSecretMissing.",
  },
  {
    id: "fail-open-or",
    regex: /allowWhenSecretMissing\s*\|\|\s*true/g,
    message: "Fail-open boolean-or fallback detected for allowWhenSecretMissing.",
  },
];

const violations = [];
for (const filePath of listTrackedFiles()) {
  const contents = readFileSync(filePath, "utf8");
  const lines = contents.split("\n");

  for (const literal of bannedLiterals) {
    const literalIndex = contents.indexOf(literal);
    if (literalIndex === -1) {
      continue;
    }
    const lineNumber = contents.slice(0, literalIndex).split("\n").length;
    violations.push({
      filePath,
      lineNumber,
      message: `Insecure fallback literal found: ${literal}`,
    });
  }

  for (const { regex, message } of bannedRegexes) {
    regex.lastIndex = 0;
    const match = regex.exec(contents);
    if (!match) {
      continue;
    }
    const lineNumber = contents.slice(0, match.index).split("\n").length;
    violations.push({ filePath, lineNumber, message });
  }
}

if (violations.length > 0) {
  console.error("Launch security defaults check failed.");
  for (const violation of violations) {
    console.error(`- ${violation.filePath}:${violation.lineNumber} ${violation.message}`);
  }
  process.exit(1);
}

console.log("Launch security defaults check passed.");
