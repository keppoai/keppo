#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "LICENSE",
  "LICENSE.md",
  ".env.example",
  ".env.dev",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/setup.md",
];

const expectedLicenses = [
  { file: "package.json", expected: "Apache-2.0" },
  { file: "packages/shared/package.json", expected: "Apache-2.0" },
  { file: "apps/web/package.json", expected: "Apache-2.0" },
];

const violations = [];

for (const filePath of requiredFiles) {
  if (!existsSync(filePath)) {
    violations.push(`Missing required OSS artifact: ${filePath}`);
  }
}

for (const entry of expectedLicenses) {
  if (!existsSync(entry.file)) {
    violations.push(`Missing package file for license validation: ${entry.file}`);
    continue;
  }
  const parsed = JSON.parse(readFileSync(entry.file, "utf8"));
  const actual = typeof parsed.license === "string" ? parsed.license : "";
  if (actual !== entry.expected) {
    violations.push(`${entry.file} license expected ${entry.expected} but found ${actual || "<missing>"}`);
  }
}

const setupDoc = existsSync("docs/setup.md") ? readFileSync("docs/setup.md", "utf8") : "";
if (!setupDoc.includes(".env.example")) {
  violations.push("docs/setup.md must document .env.example bootstrap usage.");
}
if (!/pnpm/i.test(setupDoc)) {
  violations.push("docs/setup.md must document pnpm usage.");
}
if (/prepare:cloud|strip:cloud|build:cloud|build:oss/.test(setupDoc)) {
  violations.push("docs/setup.md must not document removed cloud overlay scripts.");
}
if (existsSync("scripts/prepare-cloud.ts") || existsSync("scripts/strip-cloud.ts")) {
  violations.push("Overlay mutation scripts must not be reintroduced.");
}

if (existsSync("package.json")) {
  const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
  const scriptSource = JSON.stringify(rootPackage.scripts ?? {});
  if (/prepare:cloud|strip:cloud|build:cloud|build:oss/.test(scriptSource)) {
    violations.push("package.json must not reference removed overlay scripts.");
  }
}

try {
  const trackedEnvLocal = execSync("git ls-files --error-unmatch .env.local", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .trim()
    .length;
  if (trackedEnvLocal > 0) {
    violations.push(".env.local must be untracked; commit shared defaults in .env.dev and keep machine-local overrides out of git.");
  }
} catch {
  // Expected when .env.local is not tracked.
}

if (violations.length > 0) {
  console.error("OSS artifact check failed.");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("OSS artifact check passed.");
