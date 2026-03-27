import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outputPath = process.env.OUTPUT_PATH;
const summaryPath = process.env.SUMMARY_PATH;
const githubOutputPath = process.env.GITHUB_OUTPUT;

if (!outputPath) {
  throw new Error("OUTPUT_PATH is required");
}
if (!summaryPath) {
  throw new Error("SUMMARY_PATH is required");
}

const ghJson = (args) =>
  JSON.parse(execFileSync("gh", args, { encoding: "utf8" }).trim());

const list = ghJson([
  "run",
  "list",
  "--workflow",
  "CI (main)",
  "--branch",
  "main",
  "--limit",
  "20",
  "--json",
  "databaseId,headSha,status,conclusion,createdAt,displayTitle,workflowName",
]);

const selectedRun = list.find(
  (run) =>
    run?.status === "completed" &&
    run?.conclusion !== "cancelled" &&
    run?.conclusion !== "skipped",
);

if (!selectedRun) {
  throw new Error("No completed non-cancelled CI (main) run found on main");
}

const runDetails = ghJson([
  "run",
  "view",
  String(selectedRun.databaseId),
  "--json",
  "databaseId,headSha,status,conclusion,workflowName,displayTitle,jobs,url",
]);

const isFailingConclusion = (value) =>
  ["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"].includes(
    value ?? "",
  );

const simplifyJob = (job) => ({
  id: job.databaseId,
  name: job.name,
  status: job.status,
  conclusion: job.conclusion,
  url: job.url,
  failedSteps: (job.steps ?? [])
    .filter((step) => isFailingConclusion(step.conclusion))
    .map((step) => ({
      number: step.number,
      name: step.name,
      conclusion: step.conclusion,
    })),
});

const jobs = (runDetails.jobs ?? []).map(simplifyJob);
const failingJobs = jobs.filter((job) => isFailingConclusion(job.conclusion));
const hasFailures = failingJobs.length > 0;

const context = {
  generatedAt: new Date().toISOString(),
  selectedRun: {
    id: runDetails.databaseId,
    url: runDetails.url,
    workflowName: runDetails.workflowName,
    displayTitle: runDetails.displayTitle,
    status: runDetails.status,
    conclusion: runDetails.conclusion,
    headSha: runDetails.headSha,
  },
  hasFailures,
  failingJobs,
  jobs,
};

const lines = [
  "# Get Main To Green",
  "",
  `Selected run: [${runDetails.databaseId}](${runDetails.url})`,
  `Workflow: ${runDetails.workflowName}`,
  `Commit: \`${runDetails.headSha}\``,
  `Conclusion: ${runDetails.conclusion}`,
  `Title: ${runDetails.displayTitle}`,
  "",
];

if (!hasFailures) {
  lines.push("Main is already green for the selected completed CI (main) run.");
} else {
  lines.push("## Failing jobs", "");
  for (const job of failingJobs) {
    lines.push(`- ${job.name} (${job.conclusion}): ${job.url}`);
    for (const step of job.failedSteps) {
      lines.push(`  - Step ${step.number}: ${step.name} (${step.conclusion})`);
    }
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(context, null, 2)}\n`);
fs.writeFileSync(summaryPath, `${lines.join("\n")}\n`);

if (githubOutputPath) {
  const outputs = {
    has_failures: hasFailures ? "true" : "false",
    target_sha: runDetails.headSha,
    run_id: String(runDetails.databaseId),
    run_url: runDetails.url,
  };

  for (const [key, value] of Object.entries(outputs)) {
    fs.appendFileSync(githubOutputPath, `${key}=${value}\n`);
  }
}
