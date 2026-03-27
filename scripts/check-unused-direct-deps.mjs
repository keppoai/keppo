import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

const MANIFESTS = [
  { path: "package.json", scope: "repo" },
  { path: "apps/web/package.json", scope: "workspace" },
  { path: "apps/oauth-helper/package.json", scope: "workspace" },
  { path: "cloud/package.json", scope: "workspace" },
  { path: "packages/shared/package.json", scope: "workspace" },
];

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".mts",
  ".sh",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const IGNORE_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "tmp",
  "ux-artifacts",
]);

const esc = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const collectFiles = (targetPath) => {
  const absolutePath = join(repoRoot, targetPath);
  const stats = statSync(absolutePath);
  if (stats.isFile()) {
    return [absolutePath];
  }

  const files = [];
  const visit = (currentPath) => {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) {
          continue;
        }
        visit(join(currentPath, entry.name));
        continue;
      }
      if (TEXT_EXTENSIONS.has(extname(entry.name))) {
        files.push(join(currentPath, entry.name));
      }
    }
  };

  visit(absolutePath);
  return files;
};

const repoFiles = [
  ...collectFiles("package.json"),
  ...collectFiles("apps"),
  ...collectFiles("cloud"),
  ...collectFiles("convex"),
  ...collectFiles("packages"),
  ...collectFiles("scripts"),
  ...collectFiles("tests"),
];

const workspaceFiles = new Map(
  MANIFESTS.filter((manifest) => manifest.scope === "workspace").map((manifest) => [
    manifest.path,
    [...collectFiles(dirname(manifest.path)), join(repoRoot, manifest.path)],
  ]),
);

const readManifest = (relativePath) =>
  JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));

const getPackageBins = (manifestPath, dependencyName) => {
  if (dependencyName.startsWith("@types/")) {
    return [];
  }

  try {
    const requireFromManifest = createRequire(join(repoRoot, manifestPath));
    const dependencyManifestPath = requireFromManifest.resolve(`${dependencyName}/package.json`);
    const dependencyManifest = JSON.parse(readFileSync(dependencyManifestPath, "utf8"));
    if (!dependencyManifest.bin) {
      return [];
    }
    if (typeof dependencyManifest.bin === "string") {
      return [dependencyName.startsWith("@") ? dependencyName.split("/")[1] : dependencyName];
    }
    return Object.keys(dependencyManifest.bin);
  } catch {
    return [];
  }
};

const fileContainsPattern = (filePath, pattern) => {
  const content = readFileSync(filePath, "utf8");
  return pattern.test(content);
};

const findUnusedDeps = (manifestPath, dependencySection) => {
  const manifest = readManifest(manifestPath);
  const filesToScan =
    manifestPath === "package.json"
      ? repoFiles
      : (workspaceFiles.get(manifestPath) ?? [join(repoRoot, manifestPath)]);

  const unused = [];
  for (const dependencyName of Object.keys(manifest[dependencySection] ?? {})) {
    if (dependencyName.startsWith("@types/")) {
      continue;
    }

    const specifierPattern = new RegExp(`["'\`]${esc(dependencyName)}(?:/[^"'\\\`]+)?["'\`]`);
    const binPatterns = getPackageBins(manifestPath, dependencyName).map(
      (binName) => new RegExp(`(^|[^A-Za-z0-9_-])${esc(binName)}(?=$|[^A-Za-z0-9_-])`, "m"),
    );
    const patterns = [specifierPattern, ...binPatterns];

    const isUsed = filesToScan.some((filePath) =>
      patterns.some((pattern) => fileContainsPattern(filePath, pattern)),
    );
    if (!isUsed) {
      unused.push(dependencyName);
    }
  }

  return unused;
};

const unusedByManifest = [];
for (const manifest of MANIFESTS) {
  const unused = [
    ...findUnusedDeps(manifest.path, "dependencies"),
    ...findUnusedDeps(manifest.path, "devDependencies"),
  ];
  if (unused.length > 0) {
    unusedByManifest.push({
      manifest: manifest.path,
      dependencies: unused.sort(),
    });
  }
}

if (unusedByManifest.length > 0) {
  console.error("Unused direct dependencies found:");
  for (const entry of unusedByManifest) {
    console.error(`- ${entry.manifest}: ${entry.dependencies.join(", ")}`);
  }
  process.exit(1);
}

console.log("No unused direct dependencies found.");
