#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const outputDir = process.argv[2] ?? "./out-security-review";
const targetFileCount = Number(process.argv[3] ?? "25");
const maxBuckets = Number(process.argv[4] ?? "8");

const sourceConfigs = [
  {
    key: "past-day",
    label: "Past day",
    minBuckets: 2,
    maxBuckets: 3,
    gitArgs: ["log", "--since=1 day ago", "--name-only", "--pretty=format:"],
  },
  {
    key: "past-week",
    label: "Past week",
    minBuckets: 2,
    maxBuckets: 3,
    gitArgs: [
      "log",
      "--since=7 days ago",
      "--until=1 day ago",
      "--name-only",
      "--pretty=format:",
    ],
  },
  {
    key: "broad-coverage",
    label: "Broad coverage",
    minBuckets: 2,
    maxBuckets: 3,
    gitArgs: ["ls-files"],
  },
];

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

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function include(path) {
  return !excludedPatterns.some((pattern) => pattern.test(path));
}

function areaKey(path) {
  const parts = path.split("/");
  const dirs = parts.slice(0, -1);
  if (dirs.length === 0) return path;

  const [first, second] = dirs;
  if (first.startsWith(".")) {
    return [first, second].filter(Boolean).join("/");
  }
  if (first === "apps" || first === "packages") {
    return [first, second].filter(Boolean).join("/");
  }
  return first;
}

function fileScore(path) {
  const keywordMatches =
    path
      .toLowerCase()
      .match(
        /auth|oauth|token|secret|webhook|sandbox|internal|billing|mcp|invite|callback|dispatch|provider|workflow|credential|session|admin|payment|checkout|connect|upload|proxy|github|stripe|mailgun|convex/g,
      )?.length ?? 0;
  const parts = path.split("/");
  const filename = parts[parts.length - 1] ?? "";
  const extensionBonus = /\.(ts|tsx|js|mjs|cjs|sh|ya?ml)$/.test(filename) ? 5 : 0;
  const routeBonus = /(route|routes|api|webhook|workflow|auth|billing)/i.test(path) ? 10 : 0;
  const shorterPathBonus = Math.max(0, 8 - parts.length);
  return keywordMatches * 12 + extensionBonus + routeBonus + shorterPathBonus;
}

function uniqueSortedPaths(raw) {
  return [...new Set(raw.split("\n").map((line) => line.trim()).filter(Boolean))]
    .filter(include)
    .sort((a, b) => fileScore(b) - fileScore(a) || a.localeCompare(b));
}

function buildAreaEntries(config) {
  const grouped = new Map();
  for (const path of uniqueSortedPaths(runGit(config.gitArgs))) {
    const key = areaKey(path);
    const entry = grouped.get(key) ?? {
      source: config.key,
      source_label: config.label,
      area_key: key,
      files: [],
      total_score: 0,
    };
    entry.files.push(path);
    entry.total_score += fileScore(path);
    grouped.set(key, entry);
  }

  return [...grouped.values()].sort((a, b) => {
    if (b.total_score !== a.total_score) return b.total_score - a.total_score;
    if (b.files.length !== a.files.length) return b.files.length - a.files.length;
    return a.area_key.localeCompare(b.area_key);
  });
}

const entriesBySource = new Map(sourceConfigs.map((config) => [config.key, buildAreaEntries(config)]));
const selectedEntries = [];
const usedAreas = new Set();

function takeBestEntry(sourceKey, allowDuplicateArea) {
  const entries = entriesBySource.get(sourceKey) ?? [];
  const index = entries.findIndex((entry) => allowDuplicateArea || !usedAreas.has(entry.area_key));
  if (index === -1) return null;
  const [entry] = entries.splice(index, 1);
  usedAreas.add(entry.area_key);
  return entry;
}

function peekBestEntry(sourceKey) {
  const entries = entriesBySource.get(sourceKey) ?? [];
  return (
    entries.find((entry) => !usedAreas.has(entry.area_key)) ??
    entries[0] ??
    null
  );
}

for (const config of sourceConfigs) {
  for (let count = 0; count < config.minBuckets; count += 1) {
    const entry = takeBestEntry(config.key, false) ?? takeBestEntry(config.key, true);
    if (entry) selectedEntries.push(entry);
  }
}

while (selectedEntries.length < maxBuckets) {
  const nextConfig = [...sourceConfigs]
    .filter(
      (config) =>
        selectedEntries.filter((entry) => entry.source === config.key).length < config.maxBuckets,
    )
    .map((config) => ({
      config,
      entry: peekBestEntry(config.key),
    }))
    .filter((candidate) => candidate.entry)
    .sort((a, b) => b.entry.total_score - a.entry.total_score)[0];

  if (!nextConfig) break;
  const selected =
    takeBestEntry(nextConfig.config.key, false) ?? takeBestEntry(nextConfig.config.key, true);
  if (!selected) break;
  selectedEntries.push(selected);
}

const buckets = selectedEntries.map((entry) => ({
  name: `${entry.source}:${entry.area_key}`,
  focus: entry.source,
  focus_label: entry.source_label,
  area_keys: [entry.area_key],
  files: [],
  candidate_files: entry.files,
}));

const usedFiles = new Set();
while (usedFiles.size < targetFileCount) {
  let advanced = false;
  for (const bucket of buckets) {
    const next = bucket.candidate_files.find((path) => !usedFiles.has(path));
    if (!next) continue;
    bucket.files.push(next);
    usedFiles.add(next);
    advanced = true;
    if (usedFiles.size >= targetFileCount) break;
  }
  if (!advanced) break;
}

const flattened = buckets.flatMap((bucket) => bucket.files);
if (flattened.length < targetFileCount) {
  throw new Error(
    `Unable to select ${targetFileCount} unique files; only found ${flattened.length}.`,
  );
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/selected-files.txt`, `${flattened.join("\n")}\n`);
writeFileSync(
  `${outputDir}/review-buckets.json`,
  `${JSON.stringify(
    buckets.map(({ candidate_files, ...bucket }) => bucket),
    null,
    2,
  )}\n`,
);

process.stdout.write(
  `${JSON.stringify(
    buckets.map(({ candidate_files, ...bucket }) => bucket),
    null,
    2,
  )}\n`,
);
