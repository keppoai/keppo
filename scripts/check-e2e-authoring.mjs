import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const walkFiles = (dir) => {
  const files = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && /\.(?:[cm]?ts|[cm]?tsx|[cm]?js|[cm]?jsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
};

const rel = (filePath) => path.relative(repoRoot, filePath);

const collectMatches = (filePath, pattern) => {
  const source = readFileSync(filePath, "utf8");
  const matches = [];
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    const line = source.slice(0, index).split("\n").length;
    matches.push({ line, text: match[0] });
  }
  return matches;
};

const errors = [];
const authoringFiles = [
  ...walkFiles(path.join(repoRoot, "tests", "e2e")),
  ...walkFiles(path.join(repoRoot, "tests", "provider-conformance")),
];

for (const filePath of authoringFiles) {
  for (const match of collectMatches(filePath, /\bwaitForTimeout\s*\(/g)) {
    errors.push(
      `${rel(filePath)}:${match.line} uses waitForTimeout(); poll for a real condition instead.`,
    );
  }
}

const orderSensitiveSpecFiles = walkFiles(path.join(repoRoot, "tests", "e2e", "specs"));
for (const filePath of orderSensitiveSpecFiles) {
  for (const match of collectMatches(filePath, /\.(?:first|last|nth)\s*\(/g)) {
    errors.push(
      `${rel(filePath)}:${match.line} uses order-based locator ${match.text}; add a stable role/name/testid contract instead.`,
    );
  }
}

for (const filePath of authoringFiles) {
  const relativePath = rel(filePath);
  if (
    relativePath === "tests/e2e/helpers/aria-diff.ts" ||
    relativePath === "tests/e2e/helpers/aria-golden.ts"
  ) {
    continue;
  }

  for (const match of collectMatches(filePath, /\bariaSnapshot\s*\(/g)) {
    errors.push(
      `${relativePath}:${match.line} calls ariaSnapshot() directly; use the shared golden helper/fixture.`,
    );
  }

  for (const match of collectMatches(filePath, /\bexpectAria[A-Za-z0-9_]*\s*=\s*async\b/g)) {
    errors.push(
      `${relativePath}:${match.line} defines a custom ARIA snapshot helper; keep snapshot normalization in tests/e2e/helpers/aria-diff.ts.`,
    );
  }
}

if (errors.length > 0) {
  process.stderr.write("e2e authoring check failed:\n");
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`);
  }
  process.exit(1);
}

process.stdout.write("e2e authoring check passed\n");
