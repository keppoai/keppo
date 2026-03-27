import { readFile } from "node:fs/promises";
import path from "node:path";

type BoundaryCheck = {
  file: string;
  name: string;
  regex: RegExp;
  expectedBuilder: string;
};

const repoRoot = process.cwd();

const checks: BoundaryCheck[] = [
  {
    file: "convex/automation_runs.ts",
    name: "manual dispatch enqueue",
    regex: /ctx\.scheduler\s*\.runAfter\(\s*0,\s*refs\.dispatchAutomationRun,\s*([\s\S]*?)\s*\)/g,
    expectedBuilder: "buildDispatchAutomationRunArgs",
  },
  {
    file: "cloud/convex/automation_scheduler.ts",
    name: "scheduled and event dispatch enqueue",
    regex: /ctx\.scheduler\s*\.runAfter\(\s*0,\s*refs\.dispatchAutomationRun,\s*([\s\S]*?)\s*\)/g,
    expectedBuilder: "buildDispatchAutomationRunArgs",
  },
  {
    file: "cloud/convex/automation_scheduler.ts",
    name: "timeout termination enqueue",
    regex: /ctx\.scheduler\s*\.runAfter\(\s*0,\s*refs\.terminateAutomationRun,\s*([\s\S]*?)\s*\)/g,
    expectedBuilder: "buildTerminateAutomationRunArgs",
  },
  {
    file: "cloud/convex/automation_scheduler.ts",
    name: "dispatch audit context lookup",
    regex: /ctx\.runQuery\(\s*refs\.getDispatchAuditContext,\s*([\s\S]*?)\s*\)/g,
    expectedBuilder: "buildGetDispatchAuditContextArgs",
  },
];

const formatSnippet = (snippet: string) => snippet.replace(/\s+/g, " ").trim().slice(0, 180);

const main = async () => {
  const errors: string[] = [];

  for (const check of checks) {
    const filePath = path.join(repoRoot, check.file);
    const source = await readFile(filePath, "utf8");
    const matches = [...source.matchAll(check.regex)];

    if (matches.length === 0) {
      errors.push(`${check.file}: missing ${check.name} call to validate`);
      continue;
    }

    for (const match of matches) {
      const argsSource = match[1] ?? "";
      if (!argsSource.includes(check.expectedBuilder)) {
        errors.push(
          `${check.file}: ${check.name} must use ${check.expectedBuilder}(...), found ${formatSnippet(argsSource)}`,
        );
      }
      if (/\bautomation_run_id\b/.test(argsSource)) {
        errors.push(
          `${check.file}: ${check.name} must keep internal scheduler args camelCase, found ${formatSnippet(argsSource)}`,
        );
      }
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  console.log("automation scheduler contract check passed");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
