#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const days = Number(process.argv[2] ?? "7");
const targetCount = Number(process.argv[3] ?? "25");

const raw = execFileSync(
  "git",
  ["log", `--since=${days} days ago`, "--name-only", "--pretty=format:"],
  { encoding: "utf8" },
);

const excludedPatterns = [
  /\.mdx?$/i,
  /(^|\/)(docs|tests?)\//,
  /(^|\/)README(\.|$)/i,
  /(^|\/)(CHANGELOG|LICENSE|CONTRIBUTING|AGENTS|CLAUDE|SECURITY)\.md$/i,
  /(^|\/)\.env/,
  /\.test\./,
  /\.spec\./,
  /-snapshots\//,
  /\.d\.ts$/,
  /^convex\/_generated\//,
  /^convex\/betterAuth\/_generated\//,
];

function include(path) {
  return !excludedPatterns.some((pattern) => pattern.test(path));
}

function bucket(path) {
  const dirParts = path.split("/").slice(0, -1);
  if (dirParts.length === 0) return path;
  const targetDepth = dirParts[0].startsWith(".")
    ? Math.min(dirParts.length, 2)
    : Math.min(dirParts.length, 3);
  return dirParts.slice(0, targetDepth).join("/");
}

function score(path) {
  const keywordMatches =
    path
      .toLowerCase()
      .match(
        /mutation|query|action|component|route|api|form|hook|state|context|store|fetch|loader|error|boundary|layout|page|modal|dialog|worker|queue|connector|provider|webhook|handler|middleware|util|helper|service|client|dashboard|settings|navigation|sidebar/g,
      )?.length ?? 0;
  const parts = path.split("/");
  const filename = parts[parts.length - 1] ?? "";
  const extensionBonus = /\.(ts|tsx|js|mjs|sh|ya?ml)$/.test(filename) ? 5 : 0;
  const componentBonus = /\.(tsx|jsx)$/.test(filename) ? 8 : 0;
  const convexBonus = /^convex\//.test(path) ? 10 : 0;
  const routeBonus = /(route|routes|api|page|layout)/i.test(path) ? 10 : 0;
  const shorterPathBonus = Math.max(0, 8 - parts.length);
  return keywordMatches * 12 + extensionBonus + componentBonus + convexBonus + routeBonus + shorterPathBonus;
}

const unique = [...new Set(raw.split("\n").map((line) => line.trim()).filter(Boolean))].filter(include);
const sorted = unique.sort((a, b) => score(b) - score(a) || a.localeCompare(b));

const buckets = new Map();
for (const path of sorted) {
  const key = bucket(path);
  const list = buckets.get(key) ?? [];
  list.push(path);
  buckets.set(key, list);
}

const selected = [];
const used = new Set();

while (selected.length < targetCount) {
  let advanced = false;
  for (const list of buckets.values()) {
    const next = list.find((path) => !used.has(path));
    if (!next) continue;
    selected.push(next);
    used.add(next);
    advanced = true;
    if (selected.length >= targetCount) break;
  }
  if (!advanced) break;
}

process.stdout.write(`${selected.join("\n")}\n`);
