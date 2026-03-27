import { spawnSync } from "node:child_process";

const runBase = (label, env, args = []) => {
  process.stdout.write(`\n[meta] ${label}\n`);
  const result = spawnSync("pnpm", ["run", "test:e2e:base", "--", ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
    },
  });

  if (result.status !== 0) {
    throw new Error(`Meta check failed: ${label}`);
  }
};

const runNoiseCheck = () => {
  const result = spawnSync("pnpm", ["run", "test:e2e:noise:check"], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error("Meta check failed: e2e noise check");
  }
};

process.stdout.write(`\n[meta] infra stack-manager vitest\n`);
const vitestResult = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "tests/e2e/infra/stack-manager.test.ts"],
  {
    stdio: "inherit",
    env: process.env,
  },
);

if (vitestResult.status !== 0) {
  throw new Error("Meta check failed: infra stack-manager vitest");
}

process.stdout.write(`\n[meta] e2e authoring\n`);
const authoringResult = spawnSync("pnpm", ["run", "test:e2e:authoring:check"], {
  stdio: "inherit",
  env: process.env,
});

if (authoringResult.status !== 0) {
  throw new Error("Meta check failed: e2e authoring");
}

runBase("workers=1", { E2E_WORKERS: "1" });
runNoiseCheck();
runBase("workers=1 repeat=2", { E2E_WORKERS: "1" }, ["--repeat-each=2"]);
runNoiseCheck();
