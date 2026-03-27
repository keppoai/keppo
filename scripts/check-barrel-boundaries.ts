import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "ux-artifacts",
]);
const IGNORED_FILE_SUFFIXES = [".d.ts", ".gen.ts"];
const SCAN_ROOTS = [
  join(repoRoot, "apps"),
  join(repoRoot, "cloud"),
  join(repoRoot, "convex"),
  join(repoRoot, "packages", "shared", "src"),
  join(repoRoot, "scripts"),
  join(repoRoot, "tests"),
];
const WORKSPACE_PACKAGE_ROOTS = new Map<string, string>([
  ["@keppo/shared", join(repoRoot, "packages", "shared")],
  ["@keppo/cloud", join(repoRoot, "cloud")],
]);

type ModuleReference = {
  line: number;
  column: number;
  specifier: string;
};

const toRepoRelativePath = (path: string): string => relative(repoRoot, path).replaceAll("\\", "/");

const hasIgnoredSuffix = (path: string): boolean => {
  return IGNORED_FILE_SUFFIXES.some((suffix) => path.endsWith(suffix));
};

const collectSourceFiles = (root: string): string[] => {
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  const visit = (currentPath: string): void => {
    for (const entry of readdirSync(currentPath)) {
      const fullPath = join(currentPath, entry);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry) || entry === "_generated") {
          continue;
        }
        visit(fullPath);
        continue;
      }

      if (!stats.isFile() || hasIgnoredSuffix(fullPath)) {
        continue;
      }

      if (!SOURCE_EXTENSIONS.includes(extname(fullPath) as (typeof SOURCE_EXTENSIONS)[number])) {
        continue;
      }

      files.push(fullPath);
    }
  };

  visit(root);
  return files;
};

const getScriptKind = (path: string): ts.ScriptKind => {
  return path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
};

const parseSourceFile = (path: string): ts.SourceFile => {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(path),
  );
};

const isDirectiveStatement = (statement: ts.Statement): boolean => {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression) &&
    statement.expression.text.length > 0
  );
};

const isPassiveBarrelFile = (sourceFile: ts.SourceFile): boolean => {
  const relativePath = toRepoRelativePath(sourceFile.fileName);
  if (relativePath === "packages/shared/src/providers/modules/index.ts") {
    return false;
  }

  const bodyStatements = sourceFile.statements.filter(
    (statement) => !isDirectiveStatement(statement),
  );
  if (bodyStatements.length === 0) {
    return false;
  }

  return bodyStatements.every((statement) => {
    return (
      ts.isImportDeclaration(statement) ||
      (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined)
    );
  });
};

const resolveWithExtensions = (candidatePath: string): string | null => {
  if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
    return candidatePath;
  }

  const parsedExtension = extname(candidatePath);
  const extensionCandidates =
    parsedExtension.length > 0
      ? SOURCE_EXTENSIONS.map((extension) => {
          const basePath = candidatePath.slice(0, -parsedExtension.length);
          return `${basePath}${extension}`;
        })
      : SOURCE_EXTENSIONS.map((extension) => `${candidatePath}${extension}`);

  for (const extensionCandidate of extensionCandidates) {
    if (existsSync(extensionCandidate) && statSync(extensionCandidate).isFile()) {
      return extensionCandidate;
    }
  }

  if (existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
    for (const extension of SOURCE_EXTENSIONS) {
      const indexCandidate = join(candidatePath, `index${extension}`);
      if (existsSync(indexCandidate) && statSync(indexCandidate).isFile()) {
        return indexCandidate;
      }
    }
  }

  return null;
};

const resolveWorkspaceExportTarget = (packageName: string, specifier: string): string | null => {
  const packageRoot = WORKSPACE_PACKAGE_ROOTS.get(packageName);
  if (!packageRoot) {
    return null;
  }

  const packageJsonPath = join(packageRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    exports?: Record<string, { default?: string }>;
  };

  const exportKey = specifier === packageName ? "." : `.${specifier.slice(packageName.length)}`;
  const exportTarget = packageJson.exports?.[exportKey]?.default;
  if (!exportTarget) {
    return null;
  }

  if (packageName === "@keppo/shared") {
    return resolveWithExtensions(
      join(packageRoot, "src", exportTarget.replace(/^\.\/dist\//u, "").replace(/\.js$/u, "")),
    );
  }

  if (packageName === "@keppo/cloud") {
    return resolveWithExtensions(
      join(packageRoot, exportTarget.replace(/^\.\/dist\/cloud\//u, "").replace(/\.js$/u, "")),
    );
  }

  return null;
};

const resolveModuleTarget = (importerPath: string, specifier: string): string | null => {
  if (specifier.startsWith(".")) {
    return resolveWithExtensions(resolve(dirname(importerPath), specifier));
  }

  for (const packageName of WORKSPACE_PACKAGE_ROOTS.keys()) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
      return resolveWorkspaceExportTarget(packageName, specifier);
    }
  }

  return null;
};

const collectModuleReferences = (sourceFile: ts.SourceFile): ModuleReference[] => {
  const references: ModuleReference[] = [];

  const addReference = (specifier: string, node: ts.Node): void => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    references.push({
      specifier,
      line: line + 1,
      column: character + 1,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      addReference(node.moduleSpecifier.text, node.moduleSpecifier);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      addReference(node.moduleSpecifier.text, node.moduleSpecifier);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      const [argument] = node.arguments;
      if (ts.isStringLiteralLike(argument)) {
        addReference(argument.text, argument);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return references;
};

const failures: string[] = [];
const sourceFiles = SCAN_ROOTS.flatMap((root) => collectSourceFiles(root));
const parsedFiles = sourceFiles.map((path) => parseSourceFile(path));
const passiveBarrelFiles = new Set(
  parsedFiles
    .filter((sourceFile) => isPassiveBarrelFile(sourceFile))
    .map((sourceFile) => sourceFile.fileName),
);

for (const passiveBarrelFile of [...passiveBarrelFiles].sort()) {
  failures.push(
    `${toRepoRelativePath(passiveBarrelFile)} is a passive barrel. Delete it or replace it with a concrete module.`,
  );
}

for (const sourceFile of parsedFiles) {
  const importerPath = sourceFile.fileName;
  const importerRelativePath = toRepoRelativePath(importerPath);

  for (const reference of collectModuleReferences(sourceFile)) {
    const resolvedTarget = resolveModuleTarget(importerPath, reference.specifier);
    if (!resolvedTarget || !passiveBarrelFiles.has(resolvedTarget)) {
      continue;
    }

    failures.push(
      `${importerRelativePath}:${String(reference.line)}:${String(
        reference.column,
      )} resolves "${reference.specifier}" through passive barrel ${toRepoRelativePath(
        resolvedTarget,
      )}. Import the concrete module instead.`,
    );
  }
}

if (failures.length > 0) {
  console.error("Barrel boundary check failed:\n");
  for (const failure of failures.sort()) {
    console.error(`- ${failure}`);
  }
  console.error(`\nFound ${String(failures.length)} barrel boundary violation(s).`);
  process.exit(1);
}

console.log(`Barrel boundary check passed for ${String(sourceFiles.length)} source files.`);
