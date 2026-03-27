import { spawnSync } from "node:child_process";

type CheckResult = {
  passed: boolean;
  summary: string;
};

type CheckSuite = {
  name: string;
  run: () => Promise<CheckResult>;
};

const parseSuitesFromArgs = (argv: string[]): string[] => {
  const suites: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--suite") {
      continue;
    }
    const value = argv[index + 1];
    if (!value) {
      throw new Error("Missing value for --suite");
    }
    suites.push(value);
    index += 1;
  }
  return suites;
};

const runCommand = (command: string): Promise<CheckResult> => {
  const startedAt = Date.now();
  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  const durationMs = Date.now() - startedAt;
  const passed = result.status === 0;
  return Promise.resolve({
    passed,
    summary: `${passed ? "ok" : "failed"} (${(durationMs / 1000).toFixed(1)}s)`,
  });
};

const suites: CheckSuite[] = [
  {
    name: "barrels",
    run: () => runCommand("pnpm run check:barrels"),
  },
  {
    name: "provider-registry-snapshot",
    run: () => runCommand("pnpm run check:provider-registry-snapshot"),
  },
  {
    name: "provider-docs",
    run: () => runCommand("pnpm run check:provider-docs"),
  },
  {
    name: "provider-guardrails",
    run: () => runCommand("pnpm run check:provider-guardrails"),
  },
  {
    name: "provider-module-globals",
    run: () => runCommand("pnpm exec node scripts/check-provider-module-globals.mjs"),
  },
  {
    name: "sdk-type-compat",
    run: () => runCommand("pnpm run check:sdk-type-compat"),
  },
  {
    name: "unused-direct-deps",
    run: () => runCommand("pnpm run check:unused-direct-deps"),
  },
  {
    name: "typecheck",
    run: () => runCommand("pnpm run typecheck"),
  },
  {
    name: "type-safety-debt",
    run: () => runCommand("pnpm exec tsx ./scripts/check-type-safety-debt.ts"),
  },
  {
    name: "security-invariants",
    run: () => runCommand("pnpm exec node scripts/check-security-invariants.mjs"),
  },
  {
    name: "convex-env-manifest",
    run: () => runCommand("pnpm exec node scripts/check-convex-env-manifest.mjs"),
  },
  {
    name: "security-regressions",
    run: () =>
      runCommand(
        "pnpm --filter @keppo/web test -- app/lib/server/api-runtime/internal-auth.test.ts app/lib/server/api-runtime/env.test.ts src/lib/server-entry-webhook-routing.test.ts src/lib/billing-api.test.ts src/lib/mcp-api.test.ts src/lib/oauth-api.test.ts src/lib/webhook-api.test.ts && pnpm exec vitest run --config tests/convex/vitest.config.ts ./tests/convex/auth.test.ts ./tests/convex/e2e-shared.test.ts",
      ),
  },
  {
    name: "same-site-auth-cookie-calls",
    run: () => runCommand("pnpm run check:same-site-auth-cookie-calls"),
  },
  {
    name: "launch-security-defaults",
    run: () => runCommand("pnpm exec node scripts/check-launch-security-defaults.mjs"),
  },
  {
    name: "oss-artifacts",
    run: () => runCommand("pnpm exec node scripts/check-oss-artifacts.mjs"),
  },
  {
    name: "env-check",
    run: () => runCommand("pnpm run env:check -- --report-only"),
  },
];

const suiteByName = new Map(suites.map((suite) => [suite.name, suite]));
const main = async (): Promise<void> => {
  const requestedSuites = parseSuitesFromArgs(process.argv.slice(2));
  const selectedSuites =
    requestedSuites.length === 0
      ? suites
      : requestedSuites.map((suiteName) => {
          const suite = suiteByName.get(suiteName);
          if (!suite) {
            const knownSuites = suites.map((item) => item.name).join(", ");
            throw new Error(`Unknown suite "${suiteName}". Known suites: ${knownSuites}`);
          }
          return suite;
        });

  const rows: Array<{
    suite: string;
    status: "passed" | "failed";
    summary: string;
    durationMs: number;
  }> = [];

  for (const suite of selectedSuites) {
    console.log(`\n>>> Running suite: ${suite.name}`);
    const startedAt = Date.now();
    const result = await suite.run();
    const durationMs = Date.now() - startedAt;
    rows.push({
      suite: suite.name,
      status: result.passed ? "passed" : "failed",
      summary: result.summary,
      durationMs,
    });
  }

  console.log("\nCheck suite summary:");
  console.table(
    rows.map((row) => ({
      suite: row.suite,
      status: row.status,
      durationSec: (row.durationMs / 1000).toFixed(1),
      summary: row.summary,
    })),
  );

  if (rows.some((row) => row.status === "failed")) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
