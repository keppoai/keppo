import { spawnSync } from "node:child_process";

const PORTS = [3000, 8787, 5173, 3210, 3211, 3212];
const failures = [];

for (const port of PORTS) {
  const check = spawnSync("lsof", ["-ti", `tcp:${port}`], {
    encoding: "utf8",
  });

  if (check.error) {
    console.error(`Unable to inspect port ${port}. Is lsof installed?`, check.error.message);
    process.exitCode = 1;
    continue;
  }

  const pids = check.stdout.trim().split(/\s+/).filter(Boolean);
  if (pids.length === 0) {
    console.log(`Port ${port} is free.`);
    continue;
  }

  console.log(`Port ${port} in use by PID(s): ${pids.join(", ")}. Killing...`);
  for (const pid of pids) {
    const killResult = spawnSync("kill", ["-9", pid], { encoding: "utf8" });
    if (killResult.status !== 0) {
      failures.push({ pid, port, error: killResult.stderr?.trim() ?? "unknown error" });
    }
  }
}

if (failures.length > 0) {
  console.error("Some ports could not be freed:");
  for (const failure of failures) {
    console.error(`- port ${failure.port}, PID ${failure.pid}: ${failure.error}`);
  }
  process.exit(1);
}
