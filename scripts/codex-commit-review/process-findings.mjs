import fs from "node:fs";

const actionsPath = process.env.ACTIONS_PATH;
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const runId = process.env.GITHUB_RUN_ID;

if (!actionsPath || !repo || !token) {
  throw new Error(
    "ACTIONS_PATH, GITHUB_REPOSITORY, and GITHUB_TOKEN are required",
  );
}

if (!fs.existsSync(actionsPath)) {
  console.log("No actions file found. Nothing to process.");
  process.exit(0);
}

const content = fs.readFileSync(actionsPath, "utf8").trim();
if (!content) {
  console.log("Actions file is empty. Nothing to process.");
  process.exit(0);
}

const lines = content.split("\n").filter((l) => l.trim());
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

// Fetch existing open issues to deduplicate
async function getExistingIssueTitles() {
  const titles = new Set();
  let page = 1;
  while (true) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}&labels=`,
      { headers },
    );
    if (!response.ok) break;
    const issues = await response.json();
    if (issues.length === 0) break;
    for (const issue of issues) titles.add(issue.title);
    if (issues.length < 100) break;
    page++;
  }
  return titles;
}

const existingTitles = await getExistingIssueTitles();
let issuesCreated = 0;
let advisoriesCreated = 0;
let errors = 0;

for (const line of lines) {
  let action;
  try {
    action = JSON.parse(line);
  } catch (e) {
    console.error(`Skipping malformed JSONL line: ${e.message}`);
    errors++;
    continue;
  }

  try {
    if (action.type === "issue") {
      const title = String(action.title || "").slice(0, 256);
      if (existingTitles.has(title)) {
        console.log(`Skipping duplicate issue: ${title}`);
        continue;
      }
      const description = String(action.description || "");
      const body = [
        description,
        "",
        "---",
        `_Filed by [Codex Commit Review](https://github.com/${repo}/actions/runs/${runId})_`,
      ].join("\n");

      const labels = ["/issue-to-pr"];

      const response = await fetch(
        `https://api.github.com/repos/${repo}/issues`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ title, body, labels }),
        },
      );

      if (!response.ok) {
        const err = await response.text();
        console.error(
          `Failed to create issue "${title}": ${response.status} ${err}`,
        );
        errors++;
        continue;
      }

      const issue = await response.json();
      console.log(`Created issue #${issue.number}: ${title}`);
      issuesCreated++;
    } else if (action.type === "security-advisory") {
      // Create the security advisory (full details)
      const summary = String(action.summary || action.title || "").slice(
        0,
        256,
      );
      const description = String(action.description || "");
      const severity = ["critical", "high", "moderate", "low"].includes(
        action.severity,
      )
        ? action.severity
        : "high";

      const advisoryBody = {
        summary,
        description,
        severity,
        vulnerabilities: [
          {
            package: {
              ecosystem: "other",
              name: repo.split("/")[1] || "unknown",
            },
            vulnerable_version_range: null,
            patched_versions: null,
            vulnerable_functions: action.vulnerable_functions || [],
          },
        ],
      };

      const advisoryResponse = await fetch(
        `https://api.github.com/repos/${repo}/security-advisories`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(advisoryBody),
        },
      );

      if (!advisoryResponse.ok) {
        const err = await advisoryResponse.text();
        console.error(
          `Failed to create security advisory: ${advisoryResponse.status} ${err}`,
        );
        errors++;
        continue;
      }

      const advisory = await advisoryResponse.json();
      console.log(`Created security advisory: ${advisory.ghsa_id}`);
      advisoriesCreated++;

      // Create a vague reminder issue (NO exploit details or agent-derived content)
      const issueResponse = await fetch(
        `https://api.github.com/repos/${repo}/issues`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: `[Security] Review new security advisory`,
            body: [
              "A security advisory has been filed for this repository.",
              "",
              "**Action required:** Please review the repository security advisories for details.",
              "",
              "Do not discuss specific vulnerability details in this issue.",
              "",
              "---",
              `_Filed by [Codex Commit Review](https://github.com/${repo}/actions/runs/${runId})_`,
            ].join("\n"),
            labels: [],
          }),
        },
      );

      if (!issueResponse.ok) {
        const err = await issueResponse.text();
        console.error(
          `Failed to create security reminder issue: ${issueResponse.status} ${err}`,
        );
        errors++;
      } else {
        const issue = await issueResponse.json();
        console.log(`Created security reminder issue #${issue.number}`);
        issuesCreated++;
      }
    } else {
      console.warn(`Unknown action type: ${action.type}`);
    }
  } catch (e) {
    console.error(`Error processing action: ${e.message}`);
    errors++;
  }
}

console.log(
  `\nSummary: ${issuesCreated} issues, ${advisoriesCreated} advisories, ${errors} errors`,
);
if (errors > 0 && issuesCreated === 0 && advisoriesCreated === 0) {
  process.exit(1);
}
