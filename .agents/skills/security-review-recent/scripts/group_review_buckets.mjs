#!/usr/bin/env node

import { readFileSync } from "node:fs";

const inputPath = process.argv[2];
const maxBuckets = Number(process.argv[3] ?? "8");

if (!inputPath) {
  console.error("Usage: group_review_buckets.mjs <selected-files.txt> [max-buckets]");
  process.exit(1);
}

const files = readFileSync(inputPath, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

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

const grouped = new Map();
for (const file of files) {
  const key = areaKey(file);
  const entry = grouped.get(key) ?? {
    name: key,
    area_keys: [key],
    files: [],
  };
  entry.files.push(file);
  grouped.set(key, entry);
}

let buckets = [...grouped.values()].sort((a, b) => {
  if (b.files.length !== a.files.length) return b.files.length - a.files.length;
  return a.name.localeCompare(b.name);
});

if (buckets.length > maxBuckets) {
  const keep = buckets.slice(0, maxBuckets - 1);
  const overflow = buckets.slice(maxBuckets - 1);
  keep.push({
    name: "mixed-overflow",
    area_keys: overflow.flatMap((bucket) => bucket.area_keys),
    files: overflow.flatMap((bucket) => bucket.files),
  });
  buckets = keep;
}

process.stdout.write(`${JSON.stringify(buckets, null, 2)}\n`);
