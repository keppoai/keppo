import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = Number.parseInt(process.env.PR_NUMBER ?? "", 10);
const outputPath = process.env.OUTPUT_PATH;
const githubOutputPath = process.env.GITHUB_OUTPUT;

if (!token) throw new Error("GITHUB_TOKEN is required");
if (!repository) throw new Error("GITHUB_REPOSITORY is required");
if (!Number.isFinite(prNumber)) throw new Error("PR_NUMBER is required");
if (!outputPath) throw new Error("OUTPUT_PATH is required");
if (!githubOutputPath) throw new Error("GITHUB_OUTPUT is required");

const [owner, repo] = repository.split("/");
if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "User-Agent": "keppo-pr-review",
  "X-GitHub-Api-Version": "2022-11-28",
};

const api = async (pathname, accept = headers.Accept) => {
  const response = await fetch(`https://api.github.com/${pathname}`, {
    headers: {
      ...headers,
      Accept: accept,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${pathname} failed: ${response.status} ${response.statusText}`);
  }
  return response;
};

const pullRequestResponse = await api(`repos/${owner}/${repo}/pulls/${prNumber}`);
const pullRequest = await pullRequestResponse.json();

const files = [];
for (let page = 1; page <= 10; page += 1) {
  const response = await api(
    `repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
  );
  const pageFiles = await response.json();
  files.push(...pageFiles);
  if (pageFiles.length < 100) break;
}

let diff = "";
let diffTruncated = false;
try {
  const diffResponse = await api(
    `repos/${owner}/${repo}/pulls/${prNumber}`,
    "application/vnd.github.v3.diff",
  );
  diff = await diffResponse.text();
  const maxDiffBytes = 180 * 1024;
  diffTruncated = diff.length > maxDiffBytes;
  if (diffTruncated) {
    diff = diff.slice(0, maxDiffBytes);
  }
} catch {
  // GitHub returns 406 when the diff is too large to generate.
  // Fall back to per-file patches already collected above.
  diffTruncated = true;
}

const maxPatchChars = 12000;
const normalizedFiles = files.map((file) => {
  const patch = typeof file.patch === "string" ? file.patch : "";
  return {
    path: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: patch.slice(0, maxPatchChars),
    patchTruncated: patch.length > maxPatchChars,
  };
});

const payload = {
  generatedAt: new Date().toISOString(),
  repository,
  pullRequest: {
    number: pullRequest.number,
    title: pullRequest.title,
    body: pullRequest.body ?? "",
    url: pullRequest.html_url,
    author: pullRequest.user?.login ?? "",
    baseRef: pullRequest.base?.ref ?? "",
    headRef: pullRequest.head?.ref ?? "",
    changedFiles: pullRequest.changed_files ?? normalizedFiles.length,
    additions: pullRequest.additions ?? 0,
    deletions: pullRequest.deletions ?? 0,
  },
  files: normalizedFiles,
  diff,
  diffTruncated,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const serialized = JSON.stringify(payload, null, 2);
fs.writeFileSync(outputPath, serialized);

const contextSha = crypto.createHash("sha256").update(serialized).digest("hex");
fs.appendFileSync(githubOutputPath, `context_sha=${contextSha}\n`);
