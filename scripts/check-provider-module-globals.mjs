import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);

const providerFiles = [];
const rootProviderFile = join(repoRoot, "packages", "shared", "src", "providers.ts");
if (existsSync(rootProviderFile)) {
  providerFiles.push(rootProviderFile);
}

const providerModuleDir = join(repoRoot, "packages", "shared", "src", "providers");
if (existsSync(providerModuleDir)) {
  for (const entry of readdirSync(providerModuleDir)) {
    const fullPath = join(providerModuleDir, entry);
    if (statSync(fullPath).isFile() && fullPath.endsWith(".ts")) {
      providerFiles.push(fullPath);
    }
  }
}

const forbiddenPatterns = [
  { name: "Date.now", pattern: /\bDate\.now\s*\(/g },
  { name: "Math.random", pattern: /\bMath\.random\s*\(/g },
  { name: "global fetch", pattern: /(^|[^.$\w])fetch\s*\(/gm },
];

const toLineAndColumn = (source, index) => {
  const prior = source.slice(0, index);
  const line = prior.split("\n").length;
  const lastNewline = prior.lastIndexOf("\n");
  const column = index - lastNewline;
  return { line, column };
};

const violations = [];

for (const filePath of providerFiles) {
  const source = readFileSync(filePath, "utf8");

  for (const { name, pattern } of forbiddenPatterns) {
    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0;
      const normalizedIndex =
        name === "global fetch" && (match[1]?.length ?? 0) > 0 ? index + (match[1]?.length ?? 0) : index;
      const { line, column } = toLineAndColumn(source, normalizedIndex);
      violations.push({
        file: relative(repoRoot, filePath),
        name,
        line,
        column,
      });
    }
  }
}

if (violations.length > 0) {
  console.error("Forbidden globals found in provider module files:");
  for (const violation of violations) {
    console.error(
      `- ${violation.file}:${String(violation.line)}:${String(violation.column)} uses ${violation.name}`,
    );
  }
  process.exit(1);
}

console.log(`Provider module global check passed for ${String(providerFiles.length)} file(s).`);
