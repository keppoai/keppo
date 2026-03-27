import fs from "node:fs";
import path from "node:path";

const lookbackDays = parseInt(process.env.LOOKBACK_DAYS || "3", 10);
const outputPath = process.env.OUTPUT_PATH;
const repo = process.env.GITHUB_REPOSITORY;
const githubOutput = process.env.GITHUB_OUTPUT;

if (!outputPath || !repo) {
  throw new Error("OUTPUT_PATH and GITHUB_REPOSITORY are required");
}

const token = process.env.GITHUB_TOKEN;
if (!token) {
  throw new Error("GITHUB_TOKEN is required");
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

const since = new Date();
since.setDate(since.getDate() - lookbackDays);
const sinceDate = since.toISOString().split("T")[0];

const DOCS_PATTERNS = [
  /\.md$/i,
  /^docs\//,
  /^LICENSE/i,
  /^CHANGELOG/i,
  /^\.github\/prompts\//,
  /^CLAUDE\.md$/i,
  /^AGENTS\.md$/i,
];

function isDocsOnly(files) {
  return (
    files.length > 0 && files.every((f) => DOCS_PATTERNS.some((p) => p.test(f)))
  );
}

async function graphql(query, variables = {}) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json();
  if (data.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }
  return data.data;
}

const SEARCH_QUERY = `
  query($searchQuery: String!, $cursor: String) {
    search(query: $searchQuery, type: ISSUE, first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          title
          body
          author { login }
          mergedAt
          changedFiles
          additions
          deletions
          files(first: 100) {
            pageInfo { hasNextPage }
            nodes { path }
          }
          reviewThreads(first: 100) {
            nodes {
              isResolved
              comments(first: 20) {
                nodes {
                  author { login }
                  body
                  path
                  line
                  createdAt
                }
              }
            }
          }
          reviews(first: 20) {
            nodes {
              author { login }
              state
              body
            }
          }
        }
      }
    }
  }
`;

async function main() {
  const searchQuery = `repo:${repo} is:pr is:merged merged:>=${sinceDate}`;

  // Paginate through all merged PRs
  const allPRs = [];
  let cursor = null;
  while (true) {
    const data = await graphql(SEARCH_QUERY, { searchQuery, cursor });
    const search = data.search;
    allPRs.push(...search.nodes.filter((n) => n.number));
    if (!search.pageInfo.hasNextPage) break;
    cursor = search.pageInfo.endCursor;
  }

  // Filter out docs-only PRs
  const nonTrivialPRs = allPRs.filter((pr) => {
    const files = (pr.files?.nodes || []).map((f) => f.path);
    const hasMoreFiles = pr.files?.pageInfo?.hasNextPage === true;
    if (!hasMoreFiles && isDocsOnly(files)) {
      console.log(`Skipping PR #${pr.number} (docs-only): ${pr.title}`);
      return false;
    }
    return true;
  });

  console.log(
    `Found ${allPRs.length} merged PRs, ${nonTrivialPRs.length} non-trivial`,
  );

  // Fetch diffs for non-trivial PRs
  const MAX_DIFF_BYTES = 200 * 1024;
  const prs = [];

  for (const pr of nonTrivialPRs) {
    try {
      const diffResponse = await fetch(
        `https://api.github.com/repos/${repo}/pulls/${pr.number}`,
        {
          headers: {
            ...headers,
            Accept: "application/vnd.github.v3.diff",
          },
        },
      );
      if (!diffResponse.ok) {
        console.error(
          `Failed to fetch diff for PR #${pr.number}: ${diffResponse.status}`,
        );
        continue;
      }
      let diff = await diffResponse.text();
      let diffTruncated = false;
      if (diff.length > MAX_DIFF_BYTES) {
        diff = diff.slice(0, MAX_DIFF_BYTES);
        diffTruncated = true;
      }

      prs.push({
        number: pr.number,
        title: pr.title,
        body: pr.body || "",
        author: pr.author?.login || "unknown",
        mergedAt: pr.mergedAt,
        changedFiles: pr.changedFiles,
        additions: pr.additions,
        deletions: pr.deletions,
        files: (pr.files?.nodes || []).map((f) => f.path),
        diff,
        diffTruncated,
        reviewThreads: (pr.reviewThreads?.nodes || []).map((thread) => ({
          isResolved: thread.isResolved,
          comments: (thread.comments?.nodes || []).map((c) => ({
            author: c.author?.login || "unknown",
            body: c.body || "",
            path: c.path || "",
            line: c.line || null,
            createdAt: c.createdAt || "",
          })),
        })),
        reviews: (pr.reviews?.nodes || []).map((r) => ({
          author: r.author?.login || "unknown",
          state: r.state,
          body: r.body || "",
        })),
      });
    } catch (error) {
      console.error(
        `Failed to fetch diff for PR #${pr.number}: ${error.message}`,
      );
    }
  }

  // Write output
  const output = {
    generated_at: new Date().toISOString(),
    lookback_days: lookbackDays,
    repository: repo,
    total_prs_found: allPRs.length,
    docs_only_skipped: allPRs.length - nonTrivialPRs.length,
    prs,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  if (githubOutput) {
    fs.appendFileSync(githubOutput, `pr_count=${prs.length}\n`);
  }

  console.log(`Wrote context for ${prs.length} PRs to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
