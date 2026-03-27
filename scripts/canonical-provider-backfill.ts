import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

type BackfillChange = {
  table: "integrations" | "workspace_integrations" | "audit_events";
  document_id: string;
  field: "provider" | "integration_provider";
  before: string;
  after: "google" | "stripe" | "slack" | "github" | "notion" | "reddit" | "x" | "custom";
};

type BackfillExport = {
  changes: BackfillChange[];
  invalid_entries: Array<{
    table: "integrations" | "workspace_integrations" | "audit_events";
    document_id: string;
    field: "provider" | "integration_provider";
    value: string;
    reason: string;
  }>;
};

const usage = (): never => {
  console.error(
    [
      "Usage:",
      "  pnpm exec tsx scripts/canonical-provider-backfill.ts preview [sampleLimit]",
      "  pnpm exec tsx scripts/canonical-provider-backfill.ts validate [sampleLimit]",
      "  pnpm exec tsx scripts/canonical-provider-backfill.ts export [outputPath]",
      "  pnpm exec tsx scripts/canonical-provider-backfill.ts apply [sampleLimit]",
      "  pnpm exec tsx scripts/canonical-provider-backfill.ts rollback <backupPath>",
    ].join("\n"),
  );
  process.exit(1);
};

const runConvex = (functionName: string, args: Record<string, unknown>): string => {
  const cmd = ["exec", "convex", "run", functionName, JSON.stringify(args)];
  const result = spawnSync("pnpm", cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || "(no stderr)";
    const stdout = result.stdout?.trim() || "(no stdout)";
    throw new Error(
      `convex run failed (${functionName})\nstdout:\n${stdout}\n\nstderr:\n${stderr}`,
    );
  }

  return result.stdout.trim();
};

const parseConvexJson = <T>(output: string): T => {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]) as T;
    } catch {
      // Keep scanning up for the structured result line.
    }
  }

  throw new Error(`Unable to parse Convex JSON output:\n${output}`);
};

const printJson = (value: unknown): void => {
  console.log(JSON.stringify(value, null, 2));
};

const chunk = <T>(entries: T[], size: number): T[][] => {
  if (size <= 0) {
    return [entries];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < entries.length; index += size) {
    chunks.push(entries.slice(index, index + size));
  }
  return chunks;
};

const mode = process.argv[2];
if (!mode) {
  usage();
}

if (mode === "preview") {
  const sampleLimit = Number(process.argv[3] ?? 100);
  const result = parseConvexJson(
    runConvex("internal.provider_migrations.previewCanonicalProviderBackfill", {
      sampleLimit,
    }),
  );
  printJson(result);
  process.exit(0);
}

if (mode === "validate") {
  const sampleLimit = Number(process.argv[3] ?? 100);
  const result = parseConvexJson(
    runConvex("internal.provider_migrations.validateCanonicalProviderStorage", {
      sampleLimit,
    }),
  );
  printJson(result);
  process.exit(0);
}

if (mode === "export") {
  const outputPath = resolve(process.argv[3] ?? "tmp/canonical-provider-backfill.backup.json");
  const result = parseConvexJson<BackfillExport>(
    runConvex("internal.provider_migrations.listCanonicalProviderBackfillChanges", {}),
  );
  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`Wrote backup to ${outputPath}`);
  console.log(
    `changes=${String(result.changes.length)} invalid_entries=${String(result.invalid_entries.length)}`,
  );
  process.exit(0);
}

if (mode === "apply") {
  const sampleLimit = Number(process.argv[3] ?? 100);
  const result = parseConvexJson(
    runConvex("internal.provider_migrations.applyCanonicalProviderBackfill", {
      sampleLimit,
      dryRun: false,
    }),
  );
  printJson(result);
  process.exit(0);
}

if (mode === "rollback") {
  const backupPath = process.argv[3];
  if (!backupPath) {
    usage();
  }

  const backup = JSON.parse(readFileSync(resolve(backupPath), "utf8")) as BackfillExport;
  const chunks = chunk(backup.changes, 100);
  let rolledBack = 0;
  let skipped = 0;

  for (const [index, current] of chunks.entries()) {
    const result = parseConvexJson<{ rolled_back: number; skipped_missing_documents: number }>(
      runConvex("internal.provider_migrations.rollbackCanonicalProviderBackfill", {
        entries: current,
      }),
    );
    rolledBack += result.rolled_back;
    skipped += result.skipped_missing_documents;
    console.log(
      `rollback chunk ${String(index + 1)}/${String(chunks.length)} rolled_back=${String(result.rolled_back)} skipped=${String(result.skipped_missing_documents)}`,
    );
  }

  printJson({
    rolled_back: rolledBack,
    skipped_missing_documents: skipped,
  });
  process.exit(0);
}

usage();
