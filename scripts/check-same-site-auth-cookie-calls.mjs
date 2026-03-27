import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptDir);
const webSrcRoot = path.join(repoRoot, "apps", "web", "src");
const bannedPattern = /\bauthClient\.getCookie\(\)/u;
const sourceExtensions = new Set([".ts", ".tsx"]);

const collectSourceFiles = (dir) => {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (entry === "dist" || entry === "node_modules") {
        continue;
      }
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (!stats.isFile() || !sourceExtensions.has(path.extname(entry))) {
      continue;
    }
    if (
      entry.endsWith(".test.ts") ||
      entry.endsWith(".test.tsx") ||
      entry.endsWith(".spec.ts") ||
      entry.endsWith(".spec.tsx")
    ) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
};

const findLineNumber = (source, pattern) => {
  const match = pattern.exec(source);
  if (!match || match.index === undefined) {
    return 1;
  }
  return source.slice(0, match.index).split("\n").length;
};

const offenders = collectSourceFiles(webSrcRoot).flatMap((filePath) => {
  const source = readFileSync(filePath, "utf8");
  if (!bannedPattern.test(source)) {
    return [];
  }
  const relativePath = path.relative(repoRoot, filePath);
  const line = findLineNumber(source, bannedPattern);
  return [`${relativePath}:${String(line)} uses authClient.getCookie()`];
});

if (offenders.length > 0) {
  console.error("Same-site auth cookie callsite check failed.");
  console.error("Browser auth code must rely on same-origin cookies, not authClient.getCookie().");
  for (const offender of offenders) {
    console.error(`- ${offender}`);
  }
  process.exit(1);
}

console.log("Same-site auth cookie callsite check passed.");
