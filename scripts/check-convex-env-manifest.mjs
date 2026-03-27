#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { managedConvexEnvKeys, unmanagedConvexEnvKeys } from "./convex-managed-env.mjs";

const listConvexSourceFiles = (directory) => {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (fullPath === "convex/_generated") {
        continue;
      }
      files.push(...listConvexSourceFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
};

const convexFiles = listConvexSourceFiles("convex");

const collectStringConstantEnvBindings = (source) => {
  const bindings = new Map();
  for (const match of source.matchAll(/const\s+([A-Z0-9_]+)\s*=\s*"([A-Z0-9_]+)"/gu)) {
    bindings.set(match[1], match[2]);
  }
  return bindings;
};

const providerConfigurationRequirementsPath = "packages/shared/src/provider-catalog.ts";
const readProviderConfigurationRequirementKeys = () => {
  const source = readFileSync(providerConfigurationRequirementsPath, "utf8");
  const blockMatch = source.match(
    /const providerConfigurationRequirements:[\s\S]*?=\s*\{([\s\S]*?)\n\};/u,
  );
  if (!blockMatch) {
    return [];
  }

  return [...blockMatch[1].matchAll(/"([A-Z0-9_]+)"/gu)].map((match) => match[1]);
};

const discoveredEnvKeys = new Set();
const unresolvedDynamicAccesses = [];
for (const file of convexFiles) {
  const source = readFileSync(file, "utf8");
  const constantBindings = collectStringConstantEnvBindings(source);
  for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)|process\.env\[['"]([A-Z0-9_]+)['"]\]/gu)) {
    discoveredEnvKeys.add(match[1] || match[2]);
  }

  for (const match of source.matchAll(/process\.env\[([^\]]+)\]/gu)) {
    const expression = match[1]?.trim() ?? "";
    if (
      expression.startsWith(`"`) ||
      expression.startsWith(`'`) ||
      expression.length === 0
    ) {
      continue;
    }

    const constantKey = constantBindings.get(expression);
    if (constantKey) {
      discoveredEnvKeys.add(constantKey);
      continue;
    }

    if (file === "convex/integrations/read_model.ts" && expression === "envVar") {
      for (const key of readProviderConfigurationRequirementKeys()) {
        discoveredEnvKeys.add(key);
      }
      continue;
    }

    unresolvedDynamicAccesses.push(`${file}: process.env[${expression}]`);
  }
}

const classifiedKeys = new Set([...managedConvexEnvKeys, ...unmanagedConvexEnvKeys]);
const missingKeys = [...discoveredEnvKeys].filter((key) => !classifiedKeys.has(key)).sort();

if (unresolvedDynamicAccesses.length > 0) {
  console.error("Convex env manifest check failed.");
  console.error(
    "Dynamic convex process.env lookups must be explicitly handled by scripts/check-convex-env-manifest.mjs:",
  );
  for (const access of unresolvedDynamicAccesses) {
    console.error(`- ${access}`);
  }
  process.exit(1);
}

if (missingKeys.length > 0) {
  console.error("Convex env manifest check failed.");
  console.error(
    "Classify each new convex process.env key in scripts/convex-managed-env.mjs as managed or unmanaged:",
  );
  for (const key of missingKeys) {
    console.error(`- ${key}`);
  }
  process.exit(1);
}

console.log("Convex env manifest check passed.");
