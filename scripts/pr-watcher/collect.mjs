/**
 * PR Watcher — collect PR signals and prepare context for Claude evaluation.
 *
 * Pure data collector. Fetches review comments, CI status, unresolved review
 * threads, and fix-pr history, then either:
 * - Makes deterministic decisions for clear-cut cases (draft, closed, terminal
 *   label, fix-pr:failed, max attempts)
 * - Writes a context file for Claude to evaluate when LLM judgment is needed
 *
 * Required env:
 *   GITHUB_TOKEN         — token with pull-requests:read, checks:read
 *   GITHUB_REPOSITORY    — owner/repo
 *   PR_NUMBER            — pull request number
 *   GITHUB_OUTPUT        — path to $GITHUB_OUTPUT file
 *   CONTEXT_OUTPUT_PATH  — where to write Claude's evaluation context
 */

import fs from "node:fs";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = Number.parseInt(process.env.PR_NUMBER ?? "", 10);
const githubOutputPath = process.env.GITHUB_OUTPUT;
const contextOutputPath = process.env.CONTEXT_OUTPUT_PATH;

if (!token) throw new Error("GITHUB_TOKEN is required");
if (!repository) throw new Error("GITHUB_REPOSITORY is required");
if (!Number.isFinite(prNumber)) throw new Error("PR_NUMBER is required");
if (!githubOutputPath) throw new Error("GITHUB_OUTPUT is required");

const [owner, repo] = repository.split("/");
if (!owner || !repo)
  throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "User-Agent": "keppo-pr-watcher",
  "X-GitHub-Api-Version": "2022-11-28",
};

const api = async (pathname) => {
  const response = await fetch(`https://api.github.com/${pathname}`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API ${pathname} failed: ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
};

/** Paginate a REST list endpoint. maxPages caps fetches for perf. */
const paginate = async (pathname, { maxPages = 10 } = {}) => {
  const items = [];
  let page = 1;
  while (page <= maxPages) {
    const sep = pathname.includes("?") ? "&" : "?";
    const url = `${pathname}${sep}per_page=100&page=${page}`;
    const response = await fetch(`https://api.github.com/${url}`, { headers });
    if (!response.ok) {
      throw new Error(
        `GitHub API ${url} failed: ${response.status} ${response.statusText}`,
      );
    }
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) break;
    items.push(...data);
    page++;
  }
  return items;
};

const graphql = async (query, variables) => {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(
      `GitHub GraphQL failed: ${response.status} ${response.statusText}`,
    );
  }
  const body = await response.json();
  if (body.errors) {
    throw new Error(
      `GitHub GraphQL errors: ${JSON.stringify(body.errors)}`,
    );
  }
  return body.data;
};

const normalizeLogin = (login) => (login || "").replace(/\[bot\]$/i, "");

const setOutput = (key, value) => {
  // Sanitize newlines to prevent GITHUB_OUTPUT injection
  const safe = String(value).replace(/\r?\n/g, " ");
  fs.appendFileSync(githubOutputPath, `${key}=${safe}\n`);
};

const skip = (reason) => {
  console.log(`SKIP: ${reason}`);
  setOutput("action", "skip");
  setOutput("reason", reason);
  process.exit(0);
};

// ---------------------------------------------------------------------------
// 1. Fetch PR metadata
// ---------------------------------------------------------------------------

const pr = await api(`repos/${owner}/${repo}/pulls/${prNumber}`);
const headSha = pr.head.sha;
const prLabels = new Set((pr.labels || []).map((l) => l.name));

console.log(`PR #${prNumber} — HEAD ${headSha}`);
console.log(`Labels: ${[...prLabels].join(", ") || "(none)"}`);

// ---------------------------------------------------------------------------
// 2. Guard: deterministic skip conditions
// ---------------------------------------------------------------------------

const terminalLabels = [
  "pr=ready-to-merge",
  "pr=needs-human-review",
  "pr=max-auto-fix",
];
const activeFixLabels = ["/fix-pr", "fix-pr:pending"];

if (pr.draft) skip("PR is a draft");
if (pr.state !== "open") skip(`PR is ${pr.state}`);
if (prLabels.has("no-pr-watcher")) skip("PR has no-pr-watcher label — opted out");

for (const label of terminalLabels) {
  if (prLabels.has(label)) skip(`PR already has terminal label: ${label}`);
}
for (const label of activeFixLabels) {
  if (prLabels.has(label)) skip(`Fix is active: ${label}`);
}

// ---------------------------------------------------------------------------
// 3. Deterministic: fix-pr:failed → escalate
// ---------------------------------------------------------------------------

if (prLabels.has("fix-pr:failed")) {
  console.log("fix-pr:failed detected — escalating to pr=needs-human-review");
  setOutput("action", "label");
  setOutput("label", "pr=needs-human-review");
  setOutput("reason", "fix-pr workflow failed — requires human intervention");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 4. Deterministic: max fix-pr attempts
// ---------------------------------------------------------------------------

// Count /fix-pr label events with early exit — no need to fetch all timeline
// events, just enough to determine if we've hit the threshold.
let fixPrCount = 0;
let timelinePage = 1;
const maxFixPrThreshold = 3;
while (timelinePage <= 10) {
  const sep = `repos/${owner}/${repo}/issues/${prNumber}/timeline`.includes("?") ? "&" : "?";
  const url = `repos/${owner}/${repo}/issues/${prNumber}/timeline${sep}per_page=100&page=${timelinePage}`;
  const response = await fetch(`https://api.github.com/${url}`, { headers });
  if (!response.ok) break;
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) break;
  for (const e of data) {
    if (e.event === "labeled" && e.label?.name === "/fix-pr") {
      fixPrCount++;
    }
  }
  if (fixPrCount >= maxFixPrThreshold) break;
  timelinePage++;
}
console.log(`fix-pr attempt count (from timeline): ${fixPrCount}`);

if (fixPrCount >= 3) {
  console.log("fix-pr count >= 3 — applying pr=max-auto-fix");
  setOutput("action", "label");
  setOutput("label", "pr=max-auto-fix");
  setOutput("reason", `Exceeded max auto-fix attempts (${fixPrCount})`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 5. Collect review comments (only from trusted author)
// ---------------------------------------------------------------------------

// Fetch the LAST few pages of comments (newest) — we only need the latest
// Claude and Codex review markers. GitHub returns comments in ascending order,
// so we first determine total pages, then fetch from the end.
const perPage = 100;
const firstPageResponse = await fetch(
  `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=${perPage}&page=1`,
  { headers },
);
if (!firstPageResponse.ok) {
  throw new Error(
    `GitHub API comments failed: ${firstPageResponse.status} ${firstPageResponse.statusText}`,
  );
}
// Parse the Link header to find the last page number
const linkHeader = firstPageResponse.headers.get("link") || "";
const lastPageMatch = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);
const lastPage = lastPageMatch ? Number.parseInt(lastPageMatch[1], 10) : 1;

// Fetch the last 2 pages (most recent comments)
const comments = [];
const startPage = Math.max(1, lastPage - 1);
for (let page = startPage; page <= lastPage; page++) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=${perPage}&page=${page}`,
    { headers },
  );
  if (!response.ok) break;
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) break;
  comments.push(...data);
}
console.log(
  `Fetched ${comments.length} comments from pages ${startPage}-${lastPage}`,
);

const trustedReviewAuthor = "keppo-bot";

const findLatestReview = (marker) => {
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i];
    const author = normalizeLogin(c.user?.login ?? "");
    if (author === trustedReviewAuthor && (c.body || "").includes(marker)) {
      return c;
    }
  }
  return null;
};

const claudeReview = findLatestReview("<!-- pr-review:claude -->");
const codexReview = findLatestReview("<!-- pr-review:codex -->");

console.log(`Claude review: ${claudeReview ? "found" : "not found"}`);
console.log(`Codex review: ${codexReview ? "found" : "not found"}`);

if (!claudeReview && !codexReview) {
  // Use skip-notify instead of skip so the workflow can optionally post
  // a comment — "no review found" is unusual and the PR author should know.
  console.log(
    "No review comments found — neither Claude nor Codex markers present in keppo-bot comments",
  );
  setOutput("action", "skip-notify");
  setOutput(
    "reason",
    "No review comments found from keppo-bot — PR Review workflow may not have completed successfully",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 6. Check CI status via statusCheckRollup
// ---------------------------------------------------------------------------

const statusQuery = `
  query($owner: String!, $repo: String!, $sha: GitObjectID!) {
    repository(owner: $owner, name: $repo) {
      object(oid: $sha) {
        ... on Commit {
          statusCheckRollup {
            state
            contexts(first: 100) {
              nodes {
                ... on CheckRun {
                  __typename
                  name
                  status
                  conclusion
                }
                ... on StatusContext {
                  __typename
                  context
                  state
                }
              }
            }
          }
        }
      }
    }
  }
`;

const statusData = await graphql(statusQuery, { owner, repo, sha: headSha });
const rollup = statusData.repository.object?.statusCheckRollup;

if (!rollup) {
  skip("No status check rollup found for HEAD SHA");
}

const allContexts = rollup.contexts?.nodes || [];

// Check both CheckRun and StatusContext entries
const checkRuns = allContexts.filter((n) => n.__typename === "CheckRun");
const statusContexts = allContexts.filter(
  (n) => n.__typename === "StatusContext",
);

const pendingCheckRuns = checkRuns.filter((r) => r.status !== "COMPLETED");
const pendingStatuses = statusContexts.filter(
  (s) => s.state === "PENDING" || s.state === "EXPECTED",
);
const pendingNames = [
  ...pendingCheckRuns.map((r) => r.name),
  ...pendingStatuses.map((s) => s.context),
];
if (pendingNames.length > 0) {
  skip(
    `${pendingNames.length} check(s) still in progress: ${pendingNames.join(", ")}`,
  );
}

const failConclusions = new Set([
  "FAILURE",
  "TIMED_OUT",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
]);
const failedCheckRuns = checkRuns.filter((r) =>
  failConclusions.has(r.conclusion),
);
const failedStatuses = statusContexts.filter(
  (s) => s.state === "FAILURE" || s.state === "ERROR",
);
const failedNames = [
  ...failedCheckRuns.map((r) => r.name),
  ...failedStatuses.map((s) => s.context),
];
let checksPassing = failedNames.length === 0;

// Fail-closed: if rollup reports >100 contexts, we may miss some.
// Use the rollup aggregate state as an authoritative override.
if (checksPassing && rollup.state !== "SUCCESS") {
  console.log(
    `WARNING: No individual failures found but rollup state is ${rollup.state} — treating as failing`,
  );
  checksPassing = false;
}

console.log(
  `Checks: ${checksPassing ? "passing" : "failing"} (${failedNames.length} failures)`,
);

// ---------------------------------------------------------------------------
// 7. Query unresolved review threads
// ---------------------------------------------------------------------------

const threadsQuery = `
  query($owner: String!, $repo: String!, $prNumber: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        reviewThreads(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isResolved
            isOutdated
            comments(first: 1) {
              nodes {
                author { login }
                body
              }
            }
          }
        }
      }
    }
  }
`;

// Fetch threads with early exit — stop once we have enough unresolved threads
// for the context cap (50), no need to fetch all 2000.
const maxUnresolvedForContext = 50;
const threads = [];
const unresolvedThreads = [];
let threadsCursor = null;
let threadPages = 0;
const maxThreadPages = 10;
while (threadPages++ < maxThreadPages) {
  const threadsData = await graphql(threadsQuery, {
    owner,
    repo,
    prNumber,
    after: threadsCursor,
  });
  const page = threadsData.repository.pullRequest.reviewThreads;
  const nodes = page.nodes || [];
  threads.push(...nodes);
  for (const t of nodes) {
    if (!t.isResolved && !t.isOutdated) {
      unresolvedThreads.push(t);
    }
  }
  if (!page.pageInfo.hasNextPage) break;
  // Stop early if we already have enough unresolved threads for context
  if (unresolvedThreads.length >= maxUnresolvedForContext) break;
  threadsCursor = page.pageInfo.endCursor;
}
console.log(`Unresolved threads: ${unresolvedThreads.length}`);

// ---------------------------------------------------------------------------
// 8. Write context for Claude and signal the workflow
// ---------------------------------------------------------------------------

const context = {
  prNumber,
  headSha,
  fixPrCount,
  checksPassing,
  failedChecks: failedNames,
  claudeReview: claudeReview
    ? {
        body: claudeReview.body.slice(0, 4000),
        truncated: claudeReview.body.length > 4000,
      }
    : null,
  codexReview: codexReview
    ? {
        body: codexReview.body.slice(0, 4000),
        truncated: codexReview.body.length > 4000,
      }
    : null,
  unresolvedThreads: unresolvedThreads.slice(0, 50).map((t) => ({
    author: normalizeLogin(t.comments.nodes[0]?.author?.login ?? ""),
    body: (t.comments.nodes[0]?.body ?? "").slice(0, 2000),
  })),
  unresolvedThreadsTruncated: unresolvedThreads.length > 50,
  unresolvedThreadsTotal: unresolvedThreads.length,
};

if (context.claudeReview?.truncated) {
  console.log(
    `WARNING: Claude review body truncated at 4000 chars (original: ${claudeReview.body.length})`,
  );
}
if (context.codexReview?.truncated) {
  console.log(
    `WARNING: Codex review body truncated at 4000 chars (original: ${codexReview.body.length})`,
  );
}

if (contextOutputPath) {
  const dir = contextOutputPath.substring(
    0,
    contextOutputPath.lastIndexOf("/"),
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(contextOutputPath, JSON.stringify(context, null, 2));
  console.log(`Wrote evaluation context to ${contextOutputPath}`);
}

setOutput("action", "needs-evaluation");
setOutput("reason", "Context collected — needs Claude evaluation");
