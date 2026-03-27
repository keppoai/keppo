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

const checkFiles = (files, rules) => {
  for (const filePath of files) {
    for (const rule of rules) {
      for (const match of collectMatches(filePath, rule.pattern)) {
        errors.push(`${rel(filePath)}:${match.line} ${rule.message}`);
      }
    }
  }
};

const webTestRoots = [
  path.join(repoRoot, "apps", "web", "src"),
  path.join(repoRoot, "apps", "web", "app"),
];
const webTestFiles = webTestRoots.flatMap((dir) => walkFiles(dir)).filter((file) =>
  /\.test\.[cm]?tsx?$/.test(file),
);
checkFiles(webTestFiles, [
  {
    pattern: /\bvi\.mock\(\s*["']react["']/g,
    message: 'mocks "react"; render through the web-app test harness instead.',
  },
  {
    pattern: /\bvi\.mock\(\s*["']convex\/react["']/g,
    message: 'mocks "convex/react"; fake the unified web runtime seam instead.',
  },
  {
    pattern: /\bvi\.mock\(\s*["']@tanstack\/react-router["']/g,
    message: "mocks the router directly; use the shared router/render helpers instead.",
  },
  {
    pattern: /\bglobalThis\.fetch\s*=/g,
    message: "assigns global fetch directly; use MSW or an approved shared harness.",
  },
]);

const providerHarnessRoots = [
  path.join(repoRoot, "packages", "shared", "src"),
  path.join(repoRoot, "tests", "provider-conformance"),
];
const providerHarnessAllowlist = new Set([
  "packages/shared/src/test-utils/provider-transport-harness.ts",
  "packages/shared/src/network.test.ts",
  "packages/shared/src/provider-write-utils.test.ts",
]);
const providerHarnessFiles = providerHarnessRoots
  .flatMap((dir) => walkFiles(dir))
  .filter((filePath) => {
    const relative = rel(filePath);
    return /\.test\.[cm]?tsx?$/.test(filePath) && !providerHarnessAllowlist.has(relative);
  });
checkFiles(providerHarnessFiles, [
  {
    pattern: /\bglobalThis\.fetch\s*=/g,
    message:
      "assigns global fetch directly; use the shared provider transport harness or connector harness.",
  },
  {
    pattern: /\bprocess\.env\.KEPPO_EXTERNAL_FETCH_ALLOWLIST\s*=/g,
    message:
      "mutates the outbound allowlist in-test; centralize transport policy in the shared provider transport harness.",
  },
]);

const allNonE2eFiles = [
  ...webTestFiles,
  ...providerHarnessFiles,
  ...walkFiles(path.join(repoRoot, "tests", "local-convex")).filter((file) =>
    /\.test\.[cm]?tsx?$/.test(file),
  ),
];
checkFiles(allNonE2eFiles, [
  {
    pattern: /\bvi\.mock\(\s*["']react["']/g,
    message: 'mocks "react"; non-E2E suites should test real boundaries instead.',
  },
]);

const staleLocalConvexReferenceFiles = [
  path.join(repoRoot, "package.json"),
  ...walkFiles(path.join(repoRoot, "scripts")),
  ...walkFiles(path.join(repoRoot, ".github", "workflows")),
  ...walkFiles(path.join(repoRoot, "docs", "rules")),
  ...walkFiles(path.join(repoRoot, "docs", "specs")),
];
checkFiles(staleLocalConvexReferenceFiles, [
  {
    pattern: /\btests\/e2e\/local-convex(?:-[^"'\s]+)?\.e2e\.test\.ts\b/g,
    message:
      "references the retired tests/e2e local-Convex suite path; use tests/local-convex/*.test.ts and the shared local-Convex runner instead.",
  },
]);

if (errors.length > 0) {
  process.stderr.write("non-e2e authoring check failed:\n");
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`);
  }
  process.exit(1);
}

process.stdout.write("non-e2e authoring check passed\n");
