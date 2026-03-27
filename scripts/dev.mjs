import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function stripIgnoredPortArgs(argv) {
  const ignoredPortArgs = [];
  const passthroughArgs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--port" || arg === "-p") {
      const next = argv[index + 1];
      if (next && !next.startsWith("-")) {
        ignoredPortArgs.push(`${arg} ${next}`);
        index += 1;
      } else {
        ignoredPortArgs.push(arg);
      }
      continue;
    }

    if (arg.startsWith("--port=") || arg.startsWith("-p=")) {
      ignoredPortArgs.push(arg);
      continue;
    }

    passthroughArgs.push(arg);
  }

  return { ignoredPortArgs, passthroughArgs };
}

export function formatIgnoredPortWarning(ignoredPortArgs) {
  return `Warning: ignoring user-supplied port flag${ignoredPortArgs.length === 1 ? "" : "s"} (${ignoredPortArgs.join(", ")}). Keppo dev uses fixed local ports.`;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    process.kill(process.pid, result.signal);
    return 1;
  }

  return result.status ?? 1;
}

export function main(argv = process.argv.slice(2)) {
  const { ignoredPortArgs, passthroughArgs } = stripIgnoredPortArgs(argv);

  if (ignoredPortArgs.length > 0) {
    console.warn(formatIgnoredPortWarning(ignoredPortArgs));
  }

  if (passthroughArgs.length > 0) {
    console.warn(
      `Warning: ignoring unsupported pnpm dev argument${passthroughArgs.length === 1 ? "" : "s"}: ${passthroughArgs.join(" ")}`,
    );
  }

  const freePortsExitCode = runCommand("pnpm", ["run", "free-dev-ports"]);
  if (freePortsExitCode !== 0) {
    return freePortsExitCode;
  }

  return runCommand("pnpm", ["exec", "run-p", "convex:dev", "dev:web"]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
