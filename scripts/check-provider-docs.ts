import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  ProviderRegistry,
  allProviderModules,
  type ProviderModule,
} from "../packages/shared/src/providers.ts";
import { PROVIDER_SELECTION_ENV_KEY } from "../packages/shared/src/provider-runtime-config.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const outputPath = join(repoRoot, "docs", "providers.md");

const byString = (left: string, right: string): number => left.localeCompare(right);

const toCapabilities = (module: ProviderModule): string => {
  const values: string[] = [];
  if (module.metadata.capabilities.read) {
    values.push("read");
  }
  if (module.metadata.capabilities.write) {
    values.push("write");
  }
  if (module.metadata.capabilities.refreshCredentials) {
    values.push("refresh");
  }
  if (module.metadata.capabilities.webhook) {
    values.push("webhook");
  }
  return values.join(", ");
};

const toDeprecationText = (module: ProviderModule): string => {
  const deprecation = module.metadata.deprecation;
  if (!deprecation) {
    return "-";
  }
  const pieces = [deprecation.status, deprecation.message];
  if (deprecation.sunsetAt) {
    pieces.push(`sunset_at=${deprecation.sunsetAt}`);
  }
  if (deprecation.replacementProviderId) {
    pieces.push(`replacement=${deprecation.replacementProviderId}`);
  }
  return pieces.join("; ");
};

const renderProviderDocs = (): string => {
  const registry = new ProviderRegistry(allProviderModules);
  const modules = registry
    .listProviders()
    .slice()
    .sort((left, right) => byString(left.metadata.providerId, right.metadata.providerId));

  const lines: string[] = [];
  lines.push("# Providers (Generated)");
  lines.push("");
  lines.push("Generated from `packages/shared/src/providers.ts` module metadata.");
  lines.push("Do not edit manually. Run `pnpm run update:provider-docs`.");
  lines.push("");
  lines.push("## Runtime Selection");
  lines.push("");
  lines.push(
    `- Self-hosted deployments can enable a subset with \`${PROVIDER_SELECTION_ENV_KEY}\` (CSV canonical provider ids, or \`all\`).`,
  );
  lines.push(
    "- Disabled providers are not registered in runtime registry/capability lookup paths.",
  );
  lines.push("");
  lines.push("## Shared Contracts");
  lines.push("");
  lines.push(
    "- Runtime provider ownership (auth/webhook/refresh/tool execution hooks + metadata) is defined in `packages/shared/src/providers.ts`.",
  );
  lines.push(
    "- Convex-safe provider default scopes are defined in `packages/shared/src/provider-default-scopes.ts` for V8 query/mutation code paths.",
  );
  lines.push(
    "- Dashboard provider detail forms and metadata editors are defined in `packages/shared/src/providers-ui.ts`.",
  );
  lines.push(
    "- CI guardrails (`scripts/check-provider-guardrails.ts`) enforce canonical IDs, ownership invariants, and provider UI facet coverage.",
  );
  lines.push("");
  lines.push("## Provider Matrix");
  lines.push("");
  lines.push("| Provider | Auth | Capabilities | Feature Gate | Risk | Deprecation |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const module of modules) {
    lines.push(
      `| \`${module.metadata.providerId}\` | \`${module.metadata.auth.mode}\` | ${toCapabilities(
        module,
      )} | \`${module.metadata.featureGate}\` | \`${module.metadata.riskClass}\` | ${toDeprecationText(
        module,
      )} |`,
    );
  }
  lines.push("");
  lines.push("## Provider Details");
  lines.push("");

  for (const module of modules) {
    const tools = registry
      .getProviderTools(module.metadata.providerId)
      .slice()
      .sort((left, right) => byString(left.name, right.name));
    lines.push(`### ${module.metadata.display.label} (\`${module.metadata.providerId}\`)`);
    lines.push("");
    lines.push(`- Description: ${module.metadata.display.description}`);
    lines.push(`- Auth mode: \`${module.metadata.auth.mode}\``);
    lines.push(`- Feature gate: \`${module.metadata.featureGate}\``);
    lines.push(
      `- Env requirements: ${
        module.metadata.envRequirements.length > 0
          ? module.metadata.envRequirements.map((entry) => `\`${entry}\``).join(", ")
          : "none"
      }`,
    );
    if (module.metadata.deprecation) {
      lines.push(
        `- Deprecation: ${module.metadata.deprecation.status} - ${module.metadata.deprecation.message}`,
      );
      if (module.metadata.deprecation.sunsetAt) {
        lines.push(`- Sunset at: \`${module.metadata.deprecation.sunsetAt}\``);
      }
      if (module.metadata.deprecation.replacementProviderId) {
        lines.push(
          `- Replacement provider: \`${module.metadata.deprecation.replacementProviderId}\``,
        );
      }
    }
    lines.push("");
    lines.push("| Tool | Capability | Risk | Approval |");
    lines.push("| --- | --- | --- | --- |");
    for (const tool of tools) {
      lines.push(
        `| \`${tool.name}\` | \`${tool.capability}\` | \`${tool.risk_level}\` | \`${String(
          tool.requires_approval,
        )}\` |`,
      );
    }
    lines.push("");
  }

  lines.push("## Extension Workflow");
  lines.push("");
  lines.push("1. Add/update provider tools in `packages/shared/src/tool-definitions.ts`.");
  lines.push(
    "2. Add/update provider runtime metadata and hooks in `packages/shared/src/providers.ts` (capabilities, auth mode, feature gate, env requirements, tool ownership).",
  );
  lines.push(
    "3. Add/update provider default scopes in `packages/shared/src/provider-default-scopes.ts`.",
  );
  lines.push(
    "4. Add/update provider dashboard detail UI contract in `packages/shared/src/providers-ui.ts` (action form, serializer, metadata editors).",
  );
  lines.push(
    "5. Run `pnpm run check:provider-guardrails`, `pnpm run check:provider-registry-snapshot`, and `pnpm run update:provider-docs`.",
  );
  lines.push("");

  return `${lines.join("\n")}\n`;
};

const toFormattedMarkdown = (content: string): string => {
  const tempDir = mkdtempSync(join(tmpdir(), "provider-docs-"));
  const tempPath = join(tempDir, "providers.md");
  writeFileSync(tempPath, content, "utf8");
  execFileSync("pnpm", ["exec", "oxfmt", "--write", tempPath], { stdio: "ignore" });
  const formatted = readFileSync(tempPath, "utf8");
  rmSync(tempDir, { recursive: true, force: true });
  return formatted;
};

const writeMode = process.argv.includes("--write");
const expected = toFormattedMarkdown(renderProviderDocs());

if (writeMode) {
  writeFileSync(outputPath, expected, "utf8");
  console.log(`Updated provider docs at ${outputPath}`);
  process.exit(0);
}

if (!existsSync(outputPath)) {
  console.error(`Missing generated provider docs: ${outputPath}`);
  console.error("Run `pnpm run update:provider-docs` to create it.");
  process.exit(1);
}

const existing = readFileSync(outputPath, "utf8");
if (existing !== expected) {
  console.error("Generated provider docs drift detected.");
  console.error("Run `pnpm run update:provider-docs` and commit the updated docs/providers.md.");
  process.exit(1);
}

console.log(`Provider docs check passed (${String(allProviderModules.length)} provider modules).`);
