import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type CliOptions = {
  providerId: string;
  force: boolean;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const templateDir = join(scriptDir, "templates", "provider-module");
const outputRoot = join(repoRoot, "packages", "shared", "src", "providers");

const usage = () => {
  console.error(
    [
      "Usage:",
      "  pnpm exec tsx scripts/create-provider-module.ts --provider <provider-id> [--force]",
      "",
      "Example:",
      "  pnpm exec tsx scripts/create-provider-module.ts --provider acme-mail",
    ].join("\n"),
  );
};

const parseArgs = (argv: string[]): CliOptions => {
  let providerId = "";
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      continue;
    }
    if (token === "--provider" || token === "-p") {
      providerId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token.startsWith("--provider=")) {
      providerId = token.slice("--provider=".length);
      continue;
    }
    if (token === "--force") {
      force = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      usage();
      process.exit(0);
    }
    throw new Error(`Unknown argument "${token}".`);
  }

  if (!providerId) {
    throw new Error("Missing required --provider argument.");
  }

  return { providerId, force };
};

const isValidProviderId = (providerId: string): boolean => /^[a-z][a-z0-9-]*$/.test(providerId);

const toPascalCase = (providerId: string): string => {
  return providerId
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join("");
};

const templateFiles: Array<{ template: string; output: string }> = [
  { template: "module.ts.template", output: "module.ts" },
  { template: "module.test.ts.template", output: "module.test.ts" },
  { template: "fixture.ts.template", output: "fixture.ts" },
  { template: "provider.manifest.json.template", output: "provider.manifest.json" },
  { template: "README.md.template", output: "README.md" },
];

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const replaceTokens = (source: string, providerId: string): string => {
  const providerName = providerId.replace(/-/g, " ");
  const providerEnvKey = providerId.replace(/-/g, "_").toUpperCase();
  return source
    .replaceAll("__PROVIDER_ID__", providerId)
    .replaceAll("__PROVIDER_NAME__", providerName)
    .replaceAll("__PROVIDER_PASCAL__", toPascalCase(providerId))
    .replaceAll("__PROVIDER_TITLE__", toPascalCase(providerId))
    .replaceAll("__PROVIDER_ENV_KEY__", providerEnvKey);
};

const main = async () => {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage();
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }

  const providerId = options.providerId.trim().toLowerCase();
  if (!isValidProviderId(providerId)) {
    console.error(
      `Invalid provider id "${providerId}". Use lowercase letters, numbers, and dashes (must start with a letter).`,
    );
    process.exit(1);
    return;
  }

  const outputDir = join(outputRoot, providerId);
  await mkdir(outputDir, { recursive: true });

  const writtenFiles: string[] = [];
  for (const entry of templateFiles) {
    const templatePath = join(templateDir, entry.template);
    const outputPath = join(outputDir, entry.output);
    const alreadyExists = await exists(outputPath);

    if (alreadyExists && !options.force) {
      console.error(
        `Refusing to overwrite ${outputPath}. Re-run with --force to overwrite scaffold files.`,
      );
      process.exit(1);
      return;
    }

    const template = await readFile(templatePath, "utf8");
    const rendered = replaceTokens(template, providerId);
    await writeFile(outputPath, rendered);
    writtenFiles.push(outputPath);
  }

  console.log(`Created provider scaffold for "${providerId}" at ${outputDir}`);
  for (const filePath of writtenFiles) {
    console.log(`- ${filePath}`);
  }
  console.log("");
  console.log("Next steps:");
  console.log("1. Fill in module hooks and connector wiring in module.ts.");
  console.log(
    "2. Validate provider.manifest.json with pnpm run validate:provider-manifest -- <path>.",
  );
  console.log("3. Register the module in packages/shared/src/providers.ts.");
  console.log("4. Add provider docs/spec updates and refresh registry snapshot + provider docs.");
};

void main();
