import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_PROVIDER_IDS,
  providerModules,
  providerRegistry,
} from "../packages/shared/src/providers.ts";
import { providerModulesV2 } from "../packages/shared/src/providers/modules/index.ts";
import { assertProviderModuleFacetExports } from "../packages/shared/src/providers/registry/invariants.ts";
import { getProviderDetailUi } from "../packages/shared/src/providers-ui.ts";
import { SDK_MIGRATED_CONNECTOR_PROVIDERS } from "../packages/shared/src/provider-sdk/migration.ts";
import { toolMap } from "../packages/shared/src/tooling.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const sharedPackageJsonPath = join(repoRoot, "packages", "shared", "package.json");
const sharedPackageJson = JSON.parse(readFileSync(sharedPackageJsonPath, "utf8")) as {
  exports?: Record<string, unknown>;
};
const ALLOWED_PROVIDER_SWITCH_FILES = new Set<string>(["packages/shared/src/providers.ts"]);

const ALLOWED_NON_CANONICAL_LITERAL_FILES = new Set<string>([
  "packages/shared/src/provider-catalog.ts",
]);
const ALLOWED_CANONICAL_PROVIDER_LITERAL_FILES = new Map<string, Set<string>>([
  ["apps/web/app/lib/server/api-runtime/billing.ts", new Set(["stripe"])],
]);
const ALLOWED_APP_SHARED_IMPORTS = new Set<string>(
  Object.keys(sharedPackageJson.exports ?? {})
    .filter((subpath) => subpath !== ".")
    .map((subpath) => `@keppo/shared${subpath.slice(1)}`),
);
const ALLOWED_CONVEX_SHARED_SOURCE_IMPORTS = new Set<string>([
  "../../packages/shared/src/provider-catalog.js",
  "../packages/shared/src/ai-credit-errors.js",
  "../packages/shared/src/connectors/base.js",
  "../packages/shared/src/providers-core.js",
  "../packages/shared/src/providers-contracts.js",
  "../packages/shared/src/domain.js",
  "../packages/shared/src/automations.js",
  "../packages/shared/src/runtime.js",
  "../packages/shared/src/gating.js",
  "../packages/shared/src/ids.js",
  "../packages/shared/src/provider-catalog.js",
  "../packages/shared/src/provider-ids.js",
  "../packages/shared/src/notifications.js",
  "../packages/shared/src/execution-errors.js",
  "../packages/shared/src/provider-default-scopes.js",
  "../packages/shared/src/subscriptions.js",
  "../packages/shared/src/tool-definitions.js",
  "../packages/shared/src/custom-mcp/client.js",
  "../packages/shared/src/code-mode/sdk-generator.js",
  "../packages/shared/src/code-mode/mcp-tools.js",
  "../packages/shared/src/feature-flags.js",
  "../packages/shared/src/mcp-auth.js",
  "../packages/shared/src/network.js",
  "../packages/shared/src/provider-runtime-context.js",
  "../packages/shared/src/provider-runtime-secrets.js",
  "../packages/shared/src/providers/modules/index.js",
  "../packages/shared/src/providers.js",
  "../packages/shared/src/providers/boundaries/api-schemas.js",
  "../packages/shared/src/providers/boundaries/common.js",
  "../packages/shared/src/providers/boundaries/convex-schemas.js",
  "../packages/shared/src/providers/boundaries/error-boundary.js",
  "../packages/shared/src/providers/boundaries/json.js",
  "../packages/shared/src/providers/boundaries/types.js",
]);
const SHARED_IMPORT_PATTERN = /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gm;

const RUNTIME_ROOTS = [
  join(repoRoot, "apps", "web", "app", "lib", "server", "api-runtime"),
  join(repoRoot, "apps", "web", "src"),
  join(repoRoot, "convex"),
  join(repoRoot, "packages", "shared", "src"),
];
const PROVIDER_MODULES_ROOT = join(repoRoot, "packages", "shared", "src", "providers", "modules");

const REQUIRED_PROVIDER_MODULE_FILES = [
  "metadata.ts",
  "schemas.ts",
  "auth.ts",
  "tools.ts",
  "ui.ts",
  "connector.ts",
  "index.ts",
];

const REQUIRED_PROVIDER_MODULE_EXPORT_PATTERNS: Record<string, RegExp> = {
  "metadata.ts": /\bexport const metadata\b/,
  "schemas.ts": /\bexport const schemas\b/,
  "auth.ts": /\bexport const auth\b/,
  "tools.ts": /\bexport const tools\b/,
  "ui.ts": /\bexport const ui\b/,
  "connector.ts": /\bexport default\b/,
};

const ALLOWED_CONNECTOR_RUNTIME_FILES = new Set(["base.ts", "base-connector.ts", "index.ts"]);
const PROVIDER_SDK_ROOT = join(repoRoot, "packages", "shared", "src", "provider-sdk");
const OFFICIAL_SDK_REAL_ADAPTER_PROVIDERS = new Set([
  "google",
  "stripe",
  "github",
  "slack",
  "notion",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const migratedProviderSet = new Set<string>(SDK_MIGRATED_CONNECTOR_PROVIDERS);
const DIRECT_HTTP_CONNECTOR_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "safeFetchWithRetry", pattern: /\bsafeFetchWithRetry\s*\(/gm },
  { label: "fetch", pattern: /\bfetch\s*\(/gm },
  { label: "axios", pattern: /\baxios(?:\.|\s*\()/gm },
];
const DIRECT_HTTP_REAL_ADAPTER_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "safeFetchWithRetry", pattern: /\bsafeFetchWithRetry\s*\(/gm },
  { label: "fetch", pattern: /\bfetch\s*\(/gm },
  { label: "axios", pattern: /\baxios(?:\.|\s*\()/gm },
];

const toLineAndColumn = (source: string, index: number): { line: number; column: number } => {
  const prior = source.slice(0, index);
  const line = prior.split("\n").length;
  const column = index - prior.lastIndexOf("\n");
  return { line, column };
};

const collectSourceFiles = (root: string): string[] => {
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        if (entry === "dist" || entry === "node_modules" || entry === ".turbo") {
          continue;
        }
        visit(fullPath);
        continue;
      }
      if (!stats.isFile() || !SOURCE_EXTENSIONS.has(extname(entry))) {
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
  };
  visit(root);
  return files;
};

const failures: string[] = [];

const assertGuardrail = (condition: boolean, message: string): void => {
  if (!condition) {
    failures.push(message);
  }
};

const assertNoDirectHttpCallsInMigratedConnector = (
  providerId: string,
  relativePath: string,
  source: string,
): void => {
  if (!migratedProviderSet.has(providerId)) {
    return;
  }
  for (const { label, pattern } of DIRECT_HTTP_CONNECTOR_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0;
      const { line, column } = toLineAndColumn(source, index);
      failures.push(
        `Migrated provider "${providerId}" uses direct HTTP helper "${label}" in ${relativePath}:${String(
          line,
        )}:${String(column)}. Move protocol calls into packages/shared/src/provider-sdk/${providerId}/real.ts.`,
      );
    }
  }
};

const assertNoDirectHttpCallsInProviderSdkReal = (
  providerId: string,
  relativePath: string,
  source: string,
): void => {
  if (!OFFICIAL_SDK_REAL_ADAPTER_PROVIDERS.has(providerId)) {
    return;
  }
  for (const { label, pattern } of DIRECT_HTTP_REAL_ADAPTER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0;
      const { line, column } = toLineAndColumn(source, index);
      failures.push(
        `Provider SDK real adapter "${providerId}" uses direct HTTP helper "${label}" in ${relativePath}:${String(
          line,
        )}:${String(
          column,
        )}. Real adapters for official SDK providers must call the official SDK client only.`,
      );
    }
  }
};

const seenProviders = new Set<string>();
const seenToolOwners = new Map<string, string>();
const v2ModulesByProvider = new Map(
  providerModulesV2.map((module) => [module.providerId, module] as const),
);

for (const module of providerModules) {
  const providerId = module.metadata.providerId;
  assertGuardrail(
    CANONICAL_PROVIDER_IDS.includes(providerId),
    `Provider module "${providerId}" is not canonical.`,
  );
  assertGuardrail(
    !seenProviders.has(providerId),
    `Provider module "${providerId}" is declared more than once.`,
  );
  seenProviders.add(providerId);

  const providerModuleV2 = v2ModulesByProvider.get(providerId);
  assertGuardrail(
    providerModuleV2 !== undefined,
    `Provider "${providerId}" is missing ProviderModuleV2 declaration.`,
  );
  if (providerModuleV2) {
    try {
      assertProviderModuleFacetExports(providerModuleV2);
    } catch (error) {
      failures.push(
        `ProviderModuleV2 facet check failed for "${providerId}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  assertGuardrail(
    module.metadata.legacyAliases.length === 0,
    `Provider module "${providerId}" must not expose runtime legacy aliases.`,
  );

  if (module.metadata.auth.managed && module.metadata.auth.mode === "oauth2") {
    assertGuardrail(
      Array.isArray(module.metadata.oauth?.defaultScopes) &&
        (module.metadata.oauth?.defaultScopes.length ?? 0) > 0,
      `Managed OAuth provider "${providerId}" must declare metadata.oauth.defaultScopes.`,
    );
  }

  for (const toolName of module.metadata.toolOwnership) {
    const tool = toolMap.get(toolName);
    assertGuardrail(!!tool, `Provider "${providerId}" owns unknown tool "${toolName}".`);
    if (!tool) {
      continue;
    }

    const existingOwner = seenToolOwners.get(toolName);
    assertGuardrail(
      existingOwner === undefined,
      `Tool "${toolName}" is owned by both "${String(existingOwner)}" and "${providerId}".`,
    );
    seenToolOwners.set(toolName, providerId);

    assertGuardrail(
      tool.provider === providerId,
      `Tool "${toolName}" advertises provider "${tool.provider}" but registry owner is "${providerId}".`,
    );

    assertGuardrail(
      providerRegistry.getToolOwner(toolName) === providerId,
      `Provider registry owner mismatch for tool "${toolName}".`,
    );
  }

  const moduleDir = join(PROVIDER_MODULES_ROOT, providerId);
  assertGuardrail(
    statSync(moduleDir, { throwIfNoEntry: false })?.isDirectory() === true,
    `Provider module directory is missing: ${relative(repoRoot, moduleDir)}.`,
  );

  for (const requiredFile of REQUIRED_PROVIDER_MODULE_FILES) {
    const filePath = join(moduleDir, requiredFile);
    assertGuardrail(
      existsSync(filePath),
      `Provider module "${providerId}" is missing required file "${requiredFile}".`,
    );
    if (!existsSync(filePath)) {
      continue;
    }
    const exportPattern = REQUIRED_PROVIDER_MODULE_EXPORT_PATTERNS[requiredFile];
    if (!exportPattern) {
      continue;
    }
    const source = readFileSync(filePath, "utf8");
    if (requiredFile === "connector.ts") {
      assertNoDirectHttpCallsInMigratedConnector(providerId, relative(repoRoot, filePath), source);
    }
    assertGuardrail(
      exportPattern.test(source),
      `Provider module "${providerId}" file "${requiredFile}" must export the expected facet.`,
    );
  }

  const indexPath = join(moduleDir, "index.ts");
  if (existsSync(indexPath)) {
    const source = readFileSync(indexPath, "utf8");
    const expectedIdentifier = `${providerId}ProviderModule`;
    assertGuardrail(
      new RegExp(`\\bexport const ${expectedIdentifier}\\b`).test(source),
      `Provider module "${providerId}" index.ts must export "${expectedIdentifier}".`,
    );
  }

  const refreshFacetPath = join(moduleDir, "refresh.ts");
  const webhookFacetPath = join(moduleDir, "webhooks.ts");
  assertGuardrail(
    module.metadata.capabilities.refreshCredentials ? existsSync(refreshFacetPath) : true,
    `Provider module "${providerId}" requires refresh.ts for refresh capability.`,
  );
  assertGuardrail(
    module.metadata.capabilities.webhook ? existsSync(webhookFacetPath) : true,
    `Provider module "${providerId}" requires webhooks.ts for webhook capability.`,
  );
}

for (const canonicalProviderId of CANONICAL_PROVIDER_IDS) {
  assertGuardrail(
    seenProviders.has(canonicalProviderId),
    `Canonical provider "${canonicalProviderId}" is missing from provider modules.`,
  );

  const uiConfig = getProviderDetailUi(canonicalProviderId);
  assertGuardrail(
    uiConfig.fields.length > 0,
    `Provider "${canonicalProviderId}" must define at least one dashboard UI field.`,
  );
  assertGuardrail(
    typeof uiConfig.buildActionRequest === "function",
    `Provider "${canonicalProviderId}" must define a dashboard action serializer.`,
  );
  if (uiConfig.fixedToolName) {
    assertGuardrail(
      seenToolOwners.get(uiConfig.fixedToolName) === canonicalProviderId,
      `Provider "${canonicalProviderId}" fixed tool "${uiConfig.fixedToolName}" is not owned by that provider.`,
    );
  }

  for (const [providerId] of v2ModulesByProvider) {
    assertGuardrail(
      seenProviders.has(providerId),
      `ProviderModuleV2 "${providerId}" does not have a matching legacy provider module.`,
    );
  }
}

const connectorsRoot = join(repoRoot, "packages", "shared", "src", "connectors");
for (const connectorFile of readdirSync(connectorsRoot)) {
  const connectorPath = join(connectorsRoot, connectorFile);
  const connectorStats = statSync(connectorPath);
  if (!connectorStats.isFile() || !connectorFile.endsWith(".ts")) {
    continue;
  }
  assertGuardrail(
    ALLOWED_CONNECTOR_RUNTIME_FILES.has(connectorFile),
    `Unexpected legacy connector file found: ${relative(repoRoot, connectorPath)}. Provider runtime connectors must live under packages/shared/src/providers/modules/**.`,
  );
}

if (existsSync(PROVIDER_SDK_ROOT)) {
  for (const entry of readdirSync(PROVIDER_SDK_ROOT)) {
    const providerDir = join(PROVIDER_SDK_ROOT, entry);
    if (!statSync(providerDir).isDirectory()) {
      continue;
    }
    const realPath = join(providerDir, "real.ts");
    if (!existsSync(realPath)) {
      continue;
    }
    const source = readFileSync(realPath, "utf8");
    assertNoDirectHttpCallsInProviderSdkReal(entry, relative(repoRoot, realPath), source);
  }
}

const runtimeFiles = RUNTIME_ROOTS.flatMap((root) => collectSourceFiles(root));

const providerSwitchPattern = /switch\s*\([^)]*\bprovider\b[^)]*\)/gm;
const nonCanonicalLiteralPattern = /(["'])gmail\1/gm;
const providerLiteralPattern = new RegExp(
  `(["'])(${[
    ...CANONICAL_PROVIDER_IDS.filter((providerId) => providerId !== "x" && providerId !== "custom"),
    "gmail",
  ].join("|")})\\1`,
  "gm",
);

for (const filePath of runtimeFiles) {
  const relativePath = relative(repoRoot, filePath);
  const source = readFileSync(filePath, "utf8");
  const importSpecifiers = [...source.matchAll(SHARED_IMPORT_PATTERN)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier): specifier is string => typeof specifier === "string");

  if (relativePath.startsWith("apps/web/app/lib/server/api-runtime/")) {
    for (const specifier of importSpecifiers) {
      if (specifier.startsWith("@keppo/shared")) {
        assertGuardrail(
          ALLOWED_APP_SHARED_IMPORTS.has(specifier),
          `Forbidden shared import "${specifier}" in ${relativePath}. Use an explicit @keppo/shared subpath export.`,
        );
      }
      assertGuardrail(
        !specifier.includes("packages/shared/src/"),
        `Forbidden direct shared source import "${specifier}" in ${relativePath}. Use package entrypoints.`,
      );
    }
  }

  if (relativePath.startsWith("convex/")) {
    for (const specifier of importSpecifiers) {
      if (specifier.startsWith("@keppo/shared")) {
        assertGuardrail(
          ALLOWED_APP_SHARED_IMPORTS.has(specifier),
          `Forbidden shared import "${specifier}" in ${relativePath}. Use an explicit @keppo/shared subpath export.`,
        );
      }
      if (specifier.includes("packages/shared/src/")) {
        assertGuardrail(
          ALLOWED_CONVEX_SHARED_SOURCE_IMPORTS.has(specifier),
          `Forbidden direct shared source import "${specifier}" in ${relativePath}. Allowed Convex imports: ${Array.from(
            ALLOWED_CONVEX_SHARED_SOURCE_IMPORTS,
          ).join(", ")}.`,
        );
      }
    }
  }

  if (!ALLOWED_PROVIDER_SWITCH_FILES.has(relativePath)) {
    for (const match of source.matchAll(providerSwitchPattern)) {
      const index = match.index ?? 0;
      const { line, column } = toLineAndColumn(source, index);
      failures.push(
        `Forbidden provider switch in ${relativePath}:${String(line)}:${String(column)}. Use registry metadata instead.`,
      );
    }
  }

  if (!ALLOWED_NON_CANONICAL_LITERAL_FILES.has(relativePath)) {
    for (const match of source.matchAll(nonCanonicalLiteralPattern)) {
      const index = match.index ?? 0;
      const { line, column } = toLineAndColumn(source, index);
      failures.push(
        `Non-canonical provider literal "gmail" found in ${relativePath}:${String(line)}:${String(column)}.`,
      );
    }
  }

  if (
    relativePath.startsWith("apps/web/app/lib/server/api-runtime/") ||
    relativePath.startsWith("apps/web/") ||
    relativePath.startsWith("convex/")
  ) {
    for (const match of source.matchAll(providerLiteralPattern)) {
      const providerLiteral = match[2];
      if (!providerLiteral) {
        continue;
      }
      const allowedFileLiterals = ALLOWED_CANONICAL_PROVIDER_LITERAL_FILES.get(relativePath);
      if (allowedFileLiterals?.has(providerLiteral)) {
        continue;
      }
      const index = match.index ?? 0;
      const { line, column } = toLineAndColumn(source, index);
      failures.push(
        `Provider literal "${providerLiteral}" found outside shared provider modules in ${relativePath}:${String(
          line,
        )}:${String(column)}.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Provider guardrail check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Provider guardrail check passed (${String(providerModules.length)} modules, ${String(
    seenToolOwners.size,
  )} owned tools, ${String(runtimeFiles.length)} runtime files scanned).`,
);
