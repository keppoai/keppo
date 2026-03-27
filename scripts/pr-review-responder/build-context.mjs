import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = Number.parseInt(process.env.PR_NUMBER ?? "", 10);
const prUrl = process.env.PR_URL;
const ciConclusion = process.env.CI_CONCLUSION ?? "";
const outputPath = process.env.OUTPUT_PATH;
const summaryPath = process.env.SUMMARY_PATH;
const githubOutputPath = process.env.GITHUB_OUTPUT;

if (!token) throw new Error("GITHUB_TOKEN is required");
if (!repository) throw new Error("GITHUB_REPOSITORY is required");
if (!Number.isFinite(prNumber)) throw new Error("PR_NUMBER is required");
if (!outputPath) throw new Error("OUTPUT_PATH is required");
if (!summaryPath) throw new Error("SUMMARY_PATH is required");
if (!githubOutputPath) throw new Error("GITHUB_OUTPUT is required");

const [owner, repo] = repository.split("/");
if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);

const trustedAuthors = new Set([
  "wwwillchen",
  "wwwillchen-bot",
  "gemini-code-assist",
  "greptile-apps",
  "cubic-dev-ai",
  "cursor",
  "github-actions",
  "keppo-bot",
  "chatgpt-codex-connector",
  "devin-ai-integration",
]);

const normalizeLogin = (login) => (login || "").replace(/\[bot\]$/i, "");

const api = async (pathname) => {
  const response = await fetch(`https://api.github.com/${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "keppo-pr-review-responder",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${pathname} failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

const graphql = async (query, variables) => {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "keppo-pr-review-responder",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(`GitHub GraphQL returned errors: ${json.errors.map((error) => error.message).join("; ")}`);
  }
  return json.data;
};

const pr = await api(`repos/${owner}/${repo}/pulls/${prNumber}`);
const headSha = pr.head?.sha ?? "";
const [checks, reviews, issueComments] = await Promise.all([
  headSha
    ? api(`repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100`)
    : Promise.resolve({ check_runs: [] }),
  api(`repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100`),
  api(`repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`),
]);

const threadQuery = `
  query($owner: String!, $repo: String!, $pr: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            comments(first: 20) {
              nodes {
                id
                databaseId
                body
                url
                author {
                  login
                }
                createdAt
              }
            }
          }
        }
      }
    }
  }
`;

const trustedThreads = [];
const untrustedCommentAuthors = new Set();
let after = null;

while (true) {
  const data = await graphql(threadQuery, { owner, repo, pr: prNumber, after });
  const reviewThreads = data.repository.pullRequest.reviewThreads;

  for (const thread of reviewThreads.nodes ?? []) {
    if (thread.isResolved) continue;

    const firstComment = thread.comments?.nodes?.[0];
    const firstAuthor = normalizeLogin(firstComment?.author?.login);
    if (!trustedAuthors.has(firstAuthor)) {
      if (firstAuthor) untrustedCommentAuthors.add(firstAuthor);
      continue;
    }

    trustedThreads.push({
      id: thread.id,
      isOutdated: thread.isOutdated,
      path: thread.path,
      line: thread.line,
      replyCommentId: firstComment?.databaseId ?? null,
      comments: (thread.comments?.nodes ?? [])
        .filter((comment) => trustedAuthors.has(normalizeLogin(comment.author?.login)))
        .map((comment) => ({
          id: comment.id,
          databaseId: comment.databaseId,
          author: normalizeLogin(comment.author?.login),
          body: comment.body,
          url: comment.url,
          createdAt: comment.createdAt,
        })),
    });
  }

  if (!reviewThreads.pageInfo?.hasNextPage) break;
  after = reviewThreads.pageInfo.endCursor;
}

// Collect top-level review bodies from trusted authors.
// Only include reviews with non-empty body text (skip reviews that are just thread containers).
// Exclude DISMISSED reviews since they've been invalidated.
const trustedReviews = (reviews ?? [])
  .filter((review) => {
    const author = normalizeLogin(review.user?.login);
    return (
      trustedAuthors.has(author) &&
      typeof review.body === "string" &&
      review.body.trim() !== "" &&
      review.state !== "DISMISSED"
    );
  })
  .map((review) => ({
    id: review.id,
    author: normalizeLogin(review.user?.login),
    state: review.state,
    body: review.body,
    url: review.html_url,
    submittedAt: review.submitted_at,
  }));

// Collect top-level issue comments (PR conversation comments) from trusted authors.
const trustedIssueComments = (issueComments ?? [])
  .filter((comment) => {
    const author = normalizeLogin(comment.user?.login);
    return trustedAuthors.has(author) && typeof comment.body === "string" && comment.body.trim() !== "";
  })
  .map((comment) => ({
    id: comment.id,
    author: normalizeLogin(comment.user?.login),
    body: comment.body,
    url: comment.html_url,
    createdAt: comment.created_at,
  }));

const failingChecks = (checks.check_runs ?? [])
  .filter((check) => check.status !== "completed" || !["success", "neutral", "skipped"].includes(check.conclusion ?? ""))
  .map((check) => ({
    id: check.id,
    name: check.name,
    status: check.status,
    conclusion: check.conclusion,
    detailsUrl: check.details_url,
    summary: check.output?.summary ?? "",
    text: check.output?.text ?? "",
  }));

const payload = {
  generatedAt: new Date().toISOString(),
  pullRequest: {
    number: pr.number,
    url: prUrl ?? pr.html_url,
    title: pr.title,
    body: pr.body ?? "",
    author: normalizeLogin(pr.user?.login),
    baseRef: pr.base?.ref ?? "",
    headRef: pr.head?.ref ?? "",
    headSha,
    labels: (pr.labels ?? []).map((label) => label.name),
    ciConclusion,
  },
  trustedThreads,
  trustedReviews,
  trustedIssueComments,
  untrustedCommentAuthors: [...untrustedCommentAuthors].sort(),
  failingChecks,
};

const lines = [
  "# PR Review Context",
  "",
  `- PR: #${pr.number} ${pr.title}`,
  `- URL: ${prUrl ?? pr.html_url}`,
  `- Author: ${normalizeLogin(pr.user?.login)}`,
  `- CI conclusion: ${ciConclusion || "unknown"}`,
  `- Non-success checks: ${failingChecks.length}`,
];

// Build a unified chronological timeline of all trusted PR activity,
// mirroring the order shown in the GitHub PR conversation UI.
const timelineEntries = [];

for (const review of trustedReviews) {
  timelineEntries.push({
    timestamp: review.submittedAt,
    kind: "review",
    text: `[${review.state}] by ${review.author}: ${review.body.slice(0, 200)}`,
  });
}

for (const comment of trustedIssueComments) {
  timelineEntries.push({
    timestamp: comment.createdAt,
    kind: "comment",
    text: `by ${comment.author}: ${comment.body.slice(0, 200)}`,
  });
}

for (const thread of trustedThreads) {
  const firstComment = thread.comments[0];
  timelineEntries.push({
    timestamp: firstComment?.createdAt,
    kind: "thread",
    text: `${thread.path}:${thread.line ?? "?"} (${thread.isOutdated ? "outdated" : "active"}) by ${firstComment?.author ?? "unknown"}: ${(firstComment?.body ?? "").slice(0, 200)}`,
  });
}

timelineEntries.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));

if (timelineEntries.length > 0) {
  lines.push("", "## Trusted Activity (chronological)", "");
  for (const entry of timelineEntries) {
    const ts = entry.timestamp ? entry.timestamp.replace("T", " ").replace("Z", " UTC") : "unknown";
    lines.push(`- [${ts}] (${entry.kind}) ${entry.text}`);
  }
}

if (failingChecks.length > 0) {
  lines.push("", "## Non-Success Checks", "");
  for (const check of failingChecks) {
    lines.push(`- ${check.name} [${check.status}/${check.conclusion ?? "pending"}]`);
  }
}

if (payload.untrustedCommentAuthors.length > 0) {
  lines.push("", `Untrusted commenters skipped: ${payload.untrustedCommentAuthors.join(", ")}`);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const serializedPayload = JSON.stringify(payload, null, 2);
fs.writeFileSync(outputPath, serializedPayload);
fs.writeFileSync(summaryPath, `${lines.join("\n")}\n`);

const contextHash = crypto.createHash("sha256").update(serializedPayload).digest("hex");
fs.writeFileSync(`${outputPath}.sha256`, `${contextHash}\n`);

const delimiter = `EOF_${crypto.randomUUID()}`;
fs.appendFileSync(
  githubOutputPath,
  `context_summary<<${delimiter}\n${lines.join("\n")}\n${delimiter}\n`,
);
fs.appendFileSync(githubOutputPath, `context_sha=${contextHash}\n`);
