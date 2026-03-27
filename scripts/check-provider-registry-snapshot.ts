import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProviderRegistry, allProviderModules } from "../packages/shared/src/providers.ts";

type ProviderSnapshotEntry = {
  providerId: string;
  schemaVersion: number;
  auth: {
    mode: "oauth2" | "api_key" | "custom";
    managed: boolean;
  };
  capabilities: {
    read: boolean;
    write: boolean;
    refreshCredentials: boolean;
    webhook: boolean;
  };
  featureGate: string;
  riskClass: "low" | "medium" | "high";
  display: {
    label: string;
    description: string;
    icon: string;
  };
  deprecation?: {
    status: "deprecated" | "sunset";
    message: string;
    sunsetAt?: string;
    replacementProviderId?: string;
  };
  envRequirements: string[];
  legacyAliases: string[];
  toolOwnership: Array<{
    name: string;
    capability: "read" | "write";
    risk_level: "low" | "medium" | "high" | "critical";
    requires_approval: boolean;
    action_type: string;
    provider: string;
  }>;
};

type ProviderRegistrySnapshot = {
  snapshotVersion: 1;
  providers: ProviderSnapshotEntry[];
  toolOwners: Array<{
    name: string;
    providerId: string;
  }>;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const snapshotPath = join(repoRoot, "packages", "shared", "provider-registry.snapshot.json");

const byString = (left: string, right: string): number => left.localeCompare(right);

const buildSnapshot = (): ProviderRegistrySnapshot => {
  const registry = new ProviderRegistry(allProviderModules);
  const modules = registry
    .listProviders()
    .slice()
    .sort((left, right) => byString(left.metadata.providerId, right.metadata.providerId));

  const providers: ProviderSnapshotEntry[] = modules.map((module) => {
    const tools = registry
      .getProviderTools(module.metadata.providerId)
      .slice()
      .sort((left, right) => byString(left.name, right.name))
      .map((tool) => ({
        name: tool.name,
        capability: tool.capability,
        risk_level: tool.risk_level,
        requires_approval: tool.requires_approval,
        action_type: tool.action_type,
        provider: tool.provider,
      }));

    return {
      providerId: module.metadata.providerId,
      schemaVersion: module.schemaVersion,
      auth: {
        mode: module.metadata.auth.mode,
        managed: module.metadata.auth.managed,
      },
      capabilities: {
        read: module.metadata.capabilities.read,
        write: module.metadata.capabilities.write,
        refreshCredentials: module.metadata.capabilities.refreshCredentials,
        webhook: module.metadata.capabilities.webhook,
      },
      featureGate: module.metadata.featureGate,
      riskClass: module.metadata.riskClass,
      display: {
        label: module.metadata.display.label,
        description: module.metadata.display.description,
        icon: module.metadata.display.icon,
      },
      ...(module.metadata.deprecation
        ? {
            deprecation: {
              status: module.metadata.deprecation.status,
              message: module.metadata.deprecation.message,
              ...(module.metadata.deprecation.sunsetAt
                ? { sunsetAt: module.metadata.deprecation.sunsetAt }
                : {}),
              ...(module.metadata.deprecation.replacementProviderId
                ? { replacementProviderId: module.metadata.deprecation.replacementProviderId }
                : {}),
            },
          }
        : {}),
      envRequirements: [...module.metadata.envRequirements].sort(byString),
      legacyAliases: [...module.metadata.legacyAliases].sort(byString),
      toolOwnership: tools,
    };
  });

  const toolOwners = providers
    .flatMap((provider) =>
      provider.toolOwnership.map((tool) => ({
        name: tool.name,
        providerId: provider.providerId,
      })),
    )
    .sort((left, right) => byString(left.name, right.name));

  return {
    snapshotVersion: 1,
    providers,
    toolOwners,
  };
};

const formatSnapshot = (snapshot: ProviderRegistrySnapshot): string => {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
};

const writeMode = process.argv.includes("--write");
const expected = formatSnapshot(buildSnapshot());

if (writeMode) {
  writeFileSync(snapshotPath, expected, "utf8");
  console.log(`Updated provider registry snapshot at ${snapshotPath}`);
  process.exit(0);
}

if (!existsSync(snapshotPath)) {
  console.error(`Missing provider snapshot: ${snapshotPath}`);
  console.error("Run `pnpm run check:provider-registry-snapshot -- --write` to create it.");
  process.exit(1);
}

const existing = readFileSync(snapshotPath, "utf8");
if (existing !== expected) {
  console.error("Provider registry snapshot drift detected.");
  console.error(
    "Run `pnpm run check:provider-registry-snapshot -- --write` and commit the result.",
  );
  process.exit(1);
}

const parsed = JSON.parse(expected) as ProviderRegistrySnapshot;
console.log(
  `Provider registry snapshot check passed (${String(parsed.providers.length)} providers, ${String(
    parsed.toolOwners.length,
  )} tool owners).`,
);
