import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { cwd } from "node:process";
import { providerMarketplaceManifestSchema } from "../packages/shared/src/provider-manifest.ts";

const usage = (): never => {
  console.error(
    [
      "Usage:",
      "  pnpm run validate:provider-manifest -- <manifest-path> [more paths]",
      "",
      "Examples:",
      "  pnpm run validate:provider-manifest -- manifests/acme-mail.json",
      "  pnpm run validate:provider-manifest -- packages/shared/manifests/*.json",
    ].join("\n"),
  );
  process.exit(1);
};

const parsePaths = (argv: string[]): string[] => {
  const paths = argv.filter((token) => token !== "--");
  if (paths.length === 0) {
    usage();
  }
  return paths.map((path) => (isAbsolute(path) ? path : join(cwd(), path)));
};

const formatIssuePath = (segments: Array<string | number>): string => {
  if (segments.length === 0) {
    return "$";
  }
  return `$.${segments.join(".")}`;
};

const manifestPaths = parsePaths(process.argv.slice(2));
let hasError = false;

for (const manifestPath of manifestPaths) {
  let payloadRaw = "";
  try {
    payloadRaw = readFileSync(manifestPath, "utf8");
  } catch (error) {
    hasError = true;
    console.error(
      `[provider-manifest] Failed to read ${manifestPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    continue;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadRaw);
  } catch (error) {
    hasError = true;
    console.error(
      `[provider-manifest] Invalid JSON in ${manifestPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    continue;
  }

  const parsed = providerMarketplaceManifestSchema.safeParse(payload);
  if (!parsed.success) {
    hasError = true;
    console.error(`[provider-manifest] Validation failed for ${manifestPath}:`);
    for (const issue of parsed.error.issues) {
      console.error(`- ${formatIssuePath(issue.path)}: ${issue.message}`);
    }
    continue;
  }

  const manifest = parsed.data;
  console.log(
    `[provider-manifest] ${manifestPath}: OK (${manifest.provider.id}, ${String(
      manifest.tools.length,
    )} tools, ${String(manifest.env.length)} env requirements)`,
  );
}

if (hasError) {
  process.exit(1);
}
