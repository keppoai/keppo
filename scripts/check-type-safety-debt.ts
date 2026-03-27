import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);

const scopeRoots = [
  "apps/web/app/lib/server/api-runtime",
  "apps/web/src",
  "convex",
  "packages/shared/src",
] as const;

const highRiskFiles = new Set<string>([
  "apps/web/app/lib/server/api-runtime/app-helpers.ts",
  "apps/web/app/lib/server/api-runtime/internal-auth.ts",
  "apps/web/app/lib/server/api-runtime/routes/automations.ts",
  "apps/web/app/lib/server/api-runtime/convex.ts",
  "apps/web/app/lib/server/billing-api.ts",
  "apps/web/app/lib/server/internal-api.ts",
  "apps/web/app/lib/server/mcp-api.ts",
  "apps/web/app/lib/server/oauth-api.ts",
  "apps/web/app/lib/server/operational-api.ts",
  "apps/web/app/lib/server/webhook-api.ts",
  "apps/web/src/lib/unified-protocol-boundary.ts",
  "cloud/api/billing.ts",
  "convex/crypto_helpers.ts",
  "convex/e2e_shared.ts",
  "convex/mcp.ts",
  "convex/mcp_node.ts",
  "convex/auth.ts",
  "convex/code_mode.ts",
  "convex/org_ai_keys.ts",
  "convex/schema.ts",
  "packages/shared/src/providers/boundaries/json.ts",
]);

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const excludedPathSegments = new Set(["node_modules", "dist", ".turbo"]);

const isExcludedFile = (path: string): boolean => {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.includes("/_generated/")) {
    return true;
  }
  if (normalized.includes("/tests/")) {
    return true;
  }
  return (
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.tsx")
  );
};

const collectSourceFiles = (root: string): string[] => {
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        if (excludedPathSegments.has(entry)) {
          continue;
        }
        visit(fullPath);
        continue;
      }
      if (!stats.isFile() || !sourceExtensions.has(extname(entry))) {
        continue;
      }
      if (isExcludedFile(fullPath)) {
        continue;
      }
      files.push(fullPath);
    }
  };
  visit(root);
  return files;
};

const metrics = [
  {
    key: "explicitAny",
    label: ": any + as any",
    pattern: /\b[a-zA-Z_$][a-zA-Z0-9_$]*\s*:\s*any\b|\bas\s+any\b/gm,
    enforceGlobalBudget: true,
  },
  {
    key: "contextAny",
    label: "ctx: any + c: any",
    pattern: /\bctx\s*:\s*any\b|\bc\s*:\s*any\b/gm,
    enforceGlobalBudget: true,
  },
  {
    key: "validatorAny",
    label: "v.any()",
    pattern: /\bv\.any\s*\(/gm,
    enforceGlobalBudget: true,
  },
  {
    key: "unsafeJsonParseCast",
    label: "JSON.parse(...) as ...",
    pattern: /\bJSON\.parse\s*\([\s\S]*?\)\s+as\s+[A-Za-z_{(]/gm,
    enforceGlobalBudget: true,
  },
] as const;

type MetricKey = (typeof metrics)[number]["key"];
type MetricCounts = Record<MetricKey, number>;

const initialCounts = (): MetricCounts => ({
  explicitAny: 0,
  contextAny: 0,
  validatorAny: 0,
  unsafeJsonParseCast: 0,
});

const globalBudget: MetricCounts = {
  explicitAny: 17,
  contextAny: 0,
  validatorAny: 3,
  unsafeJsonParseCast: 11,
};

const highRiskBudget: MetricCounts = {
  explicitAny: 0,
  contextAny: 0,
  validatorAny: 1,
  unsafeJsonParseCast: 0,
};

const countMatches = (source: string, pattern: RegExp): number => {
  const matches = source.match(pattern);
  return matches ? matches.length : 0;
};

const fileCounts = new Map<string, Partial<MetricCounts>>();
const globalCounts = initialCounts();
const highRiskCounts = initialCounts();

for (const root of scopeRoots.map((scopeRoot) => join(repoRoot, scopeRoot))) {
  for (const filePath of collectSourceFiles(root)) {
    const source = readFileSync(filePath, "utf8");
    const relativePath = relative(repoRoot, filePath).replaceAll("\\", "/");
    const counts: Partial<MetricCounts> = {};
    for (const metric of metrics) {
      const count = countMatches(source, metric.pattern);
      if (count === 0) {
        continue;
      }
      counts[metric.key] = count;
      globalCounts[metric.key] += count;
      if (highRiskFiles.has(relativePath)) {
        highRiskCounts[metric.key] += count;
      }
    }
    if (Object.keys(counts).length > 0) {
      fileCounts.set(relativePath, counts);
    }
  }
}

const failures: string[] = [];

for (const metric of metrics) {
  if (metric.enforceGlobalBudget && globalCounts[metric.key] > globalBudget[metric.key]) {
    failures.push(
      `Global ${metric.label} count ${String(globalCounts[metric.key])} exceeds budget ${String(globalBudget[metric.key])}.`,
    );
  }
  if (highRiskCounts[metric.key] > highRiskBudget[metric.key]) {
    failures.push(
      `High-risk ${metric.label} count ${String(highRiskCounts[metric.key])} exceeds budget ${String(highRiskBudget[metric.key])}.`,
    );
  }
}

const hotspots = [...fileCounts.entries()]
  .map(([file, counts]) => {
    const total = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
    return { file, counts, total };
  })
  .sort((a, b) => b.total - a.total)
  .slice(0, 15);

const report = {
  generatedAt: new Date().toISOString(),
  scopeRoots,
  globalBudget,
  highRiskBudget,
  globalCounts,
  highRiskCounts,
  hotspots,
  failures,
};

const reportPath = join(repoRoot, "test-results", "type-safety-debt-report.json");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log("Type-safety debt gate summary");
for (const metric of metrics) {
  const globalSummary = metric.enforceGlobalBudget
    ? `${String(globalCounts[metric.key])}/${String(globalBudget[metric.key])}`
    : `${String(globalCounts[metric.key])} (tracking only)`;
  console.log(
    `- ${metric.label}: global ${globalSummary}, high-risk ${String(highRiskCounts[metric.key])}/${String(highRiskBudget[metric.key])}`,
  );
}
console.log(`- report: ${relative(repoRoot, reportPath).replaceAll("\\", "/")}`);

if (hotspots.length > 0) {
  console.log("- hotspots:");
  for (const hotspot of hotspots) {
    const details = metrics
      .map((metric) => `${metric.key}=${String(hotspot.counts[metric.key] ?? 0)}`)
      .join(", ");
    console.log(`  - ${hotspot.file} (${details})`);
  }
}

if (failures.length > 0) {
  console.error("Type-safety debt gate failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Type-safety debt gate passed.");
