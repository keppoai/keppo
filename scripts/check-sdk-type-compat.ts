import { spawnSync } from "node:child_process";

const command = "pnpm";
const args = ["exec", "tsgo", "-p", "packages/shared/tsconfig.json", "--noEmit"];

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
