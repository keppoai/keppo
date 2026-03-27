import type {
  GithubCheckRun,
  GithubBranch,
  GithubCommit,
  GithubCommitStatus,
  GithubFileContents,
  GithubCompareCommitsResult,
  GithubIssue,
  GithubIssueComment,
  GithubIssueEvent,
  GithubIssueTimelineEvent,
  GithubLabel,
  GithubMilestone,
  GithubPullRequest,
  GithubPullRequestFile,
  GithubPullRequestReview,
  GithubCodeSearchResult,
  GithubNotification,
  GithubRelease,
  GithubRepo,
  GithubRepoSearchResult,
  GithubSearchIssue,
  GithubWorkflowRun,
} from "./types.js";

export const seedGithubIssues = (): GithubIssue[] => [
  {
    id: 1,
    number: 1,
    title: "Example issue",
    state: "open",
    html_url: "https://example.test/issues/1",
  },
  {
    id: 12,
    number: 12,
    title: "Backlog issue",
    state: "open",
    html_url: "https://example.test/issues/12",
    labels: [],
    assignees: [],
  },
  {
    id: 22,
    number: 22,
    title: "Closed onboarding follow-up",
    state: "closed",
    html_url: "https://example.test/issues/22",
    labels: [],
    assignees: [],
  },
];

export const seedGithubPullRequests = (): GithubPullRequest[] => [
  {
    id: 5,
    number: 5,
    state: "open",
    title: "Improve provider conformance diagnostics",
    html_url: "https://example.test/pulls/5",
    merged: false,
    head: {
      ref: "feature/provider-conformance",
      sha: "abc123",
    },
    base: {
      ref: "main",
      sha: "def456",
    },
  },
  {
    id: 8,
    number: 8,
    state: "closed",
    title: "Stabilize queue retries",
    html_url: "https://example.test/pulls/8",
    merged: true,
    head: {
      ref: "feature/queue-retries",
      sha: "777777",
    },
    base: {
      ref: "main",
      sha: "888888",
    },
  },
];

export const seedGithubPullRequestFiles = (): GithubPullRequestFile[] => [
  {
    sha: "f1",
    filename: "packages/shared/src/providers/modules/github/connector.ts",
    status: "modified",
    additions: 42,
    deletions: 7,
    changes: 49,
    blob_url: "https://example.test/blob/f1",
  },
  {
    sha: "f2",
    filename: "tests/provider-conformance/action-matrix.ts",
    status: "modified",
    additions: 25,
    deletions: 3,
    changes: 28,
    blob_url: "https://example.test/blob/f2",
  },
];

export const seedGithubPullRequestReviews = (): GithubPullRequestReview[] => [
  {
    id: 301,
    state: "APPROVED",
    body: "Looks good to me.",
    pull_request_url: "https://example.test/pulls/5",
    dismissed: false,
  },
];

export const seedGithubCommits = (): GithubCommit[] => [
  {
    sha: "abc123",
    html_url: "https://example.test/commit/abc123",
    commit: {
      message: "Add provider matrix assertions",
    },
  },
  {
    sha: "def456",
    html_url: "https://example.test/commit/def456",
    commit: {
      message: "Stabilize fake gateway conformance",
    },
  },
];

export const seedGithubCompareCommits = (
  base: string,
  head: string,
): GithubCompareCommitsResult => {
  const commits = seedGithubCommits();
  return {
    status: "ahead",
    ahead_by: 2,
    behind_by: 0,
    total_commits: commits.length,
    commits,
    base_commit: { sha: base },
    merge_base_commit: { sha: head },
  };
};

export const seedGithubCommitStatus = (ref: string): GithubCommitStatus => {
  return {
    state: "success",
    sha: ref,
    statuses: [
      {
        context: "ci/build",
        state: "success",
      },
    ],
  };
};

export const seedGithubCheckRuns = (ref: string): GithubCheckRun[] => [
  {
    id: 401,
    name: "build",
    status: "completed",
    conclusion: "success",
    head_sha: ref,
  },
  {
    id: 402,
    name: "test",
    status: "completed",
    conclusion: "success",
    head_sha: ref,
  },
];

export const seedGithubWorkflowRuns = (): GithubWorkflowRun[] => [
  {
    id: 501,
    name: "CI",
    status: "completed",
    conclusion: "success",
    head_branch: "main",
    head_sha: "abc123",
    event: "push",
  },
  {
    id: 502,
    name: "Deploy",
    status: "in_progress",
    conclusion: null,
    head_branch: "main",
    head_sha: "def456",
    event: "workflow_dispatch",
  },
];

export const seedGithubReleases = (repo: string): GithubRelease[] => [
  {
    id: 801,
    tag_name: "v1.2.0",
    name: "v1.2.0",
    body: "Stability improvements and connector hardening.",
    target_commitish: "main",
    draft: false,
    prerelease: false,
    html_url: `https://example.test/${repo}/releases/tag/v1.2.0`,
    created_at: "2026-01-08T00:00:00Z",
    published_at: "2026-01-08T00:10:00Z",
  },
  {
    id: 802,
    tag_name: "v1.3.0-rc1",
    name: "v1.3.0-rc1",
    body: "Release candidate for upcoming changes.",
    target_commitish: "main",
    draft: false,
    prerelease: true,
    html_url: `https://example.test/${repo}/releases/tag/v1.3.0-rc1`,
    created_at: "2026-01-15T00:00:00Z",
    published_at: "2026-01-15T00:10:00Z",
  },
];

export const seedGithubMilestones = (repo: string): GithubMilestone[] => [
  {
    id: 901,
    number: 1,
    title: "Q1 Provider API",
    state: "open",
    description: "Stabilize provider coverage and conformance.",
    due_on: "2026-03-31T00:00:00Z",
    html_url: `https://example.test/${repo}/milestone/1`,
  },
  {
    id: 902,
    number: 2,
    title: "Q2 Scale",
    state: "closed",
    description: "Scale out workflows and runtime controls.",
    due_on: "2026-06-30T00:00:00Z",
    html_url: `https://example.test/${repo}/milestone/2`,
  },
];

export const seedGithubIssueComments = (
  repo: string,
  issueNumber: number,
): GithubIssueComment[] => [
  {
    id: 601,
    body: "Initial seeded comment",
    html_url: `https://example.test/${repo}/issues/${issueNumber}#issuecomment-601`,
    issue_url: `https://example.test/api/repos/${repo}/issues/${issueNumber}`,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

export const seedGithubIssueEvents = (repo: string, issueNumber: number): GithubIssueEvent[] => [
  {
    id: 1101,
    event: "labeled",
    actor: { login: "maintainer" },
    created_at: "2026-01-01T00:00:00Z",
    issue: {
      number: issueNumber,
      repository_url: `https://example.test/api/repos/${repo}`,
    },
  },
  {
    id: 1102,
    event: "assigned",
    actor: { login: "maintainer" },
    created_at: "2026-01-02T00:00:00Z",
    issue: {
      number: issueNumber,
      repository_url: `https://example.test/api/repos/${repo}`,
    },
  },
];

export const seedGithubIssueTimeline = (
  repo: string,
  issueNumber: number,
): GithubIssueTimelineEvent[] => [
  {
    id: 1201,
    event: "commented",
    created_at: "2026-01-03T00:00:00Z",
    issue_url: `https://example.test/api/repos/${repo}/issues/${issueNumber}`,
  },
  {
    id: 1202,
    event: "cross-referenced",
    created_at: "2026-01-04T00:00:00Z",
    source: {
      issue: {
        number: 5,
      },
    },
  },
];

export const seedGithubNotifications = (repo: string): GithubNotification[] => [
  {
    id: "thread_1",
    unread: true,
    reason: "assign",
    updated_at: "2026-01-05T00:00:00Z",
    repository: {
      full_name: repo,
    },
    subject: {
      title: "Example issue",
      type: "Issue",
      url: `https://example.test/api/repos/${repo}/issues/1`,
    },
  },
  {
    id: "thread_2",
    unread: false,
    reason: "subscribed",
    updated_at: "2026-01-06T00:00:00Z",
    repository: {
      full_name: repo,
    },
    subject: {
      title: "Improve provider conformance diagnostics",
      type: "PullRequest",
      url: `https://example.test/api/repos/${repo}/pulls/5`,
    },
  },
];

export const seedGithubRepo = (repo: string): GithubRepo => {
  const normalized = repo.trim();
  const parts = normalized.split("/", 2);
  const owner = parts[0] && parts[1] ? parts[0] : normalized;
  const name = parts[0] && parts[1] ? parts[1] : normalized;
  const fullName = owner === name ? owner : `${owner}/${name}`;
  return {
    id: 1000,
    name,
    full_name: fullName,
    html_url: `https://example.test/${fullName}`,
    default_branch: "main",
    private: false,
  };
};

export const seedGithubBranches = (): GithubBranch[] => [
  {
    name: "main",
    commit: { sha: "abc123" },
    protected: true,
  },
  {
    name: "feature/provider-matrix",
    commit: { sha: "def456" },
    protected: false,
  },
];

export const seedGithubFileContents = (repo: string, path = "README.md"): GithubFileContents => {
  const normalizedPath = path.trim().length > 0 ? path.trim() : "README.md";
  const name = normalizedPath.split("/").pop() ?? normalizedPath;
  const content = `# ${repo}\n\nSeeded file for provider conformance.\n`;
  return {
    type: "file",
    name,
    path: normalizedPath,
    sha: `sha_${normalizedPath.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}`,
    size: content.length,
    encoding: "base64",
    content: Buffer.from(content, "utf8").toString("base64"),
  };
};

export const seedGithubLabels = (): GithubLabel[] => [
  {
    id: 1001,
    name: "bug",
    color: "d73a4a",
    description: "Something is not working",
  },
  {
    id: 1002,
    name: "enhancement",
    color: "a2eeef",
    description: "New feature or request",
  },
];

export const buildSearchIssueFromIssue = (issue: GithubIssue, repo: string): GithubSearchIssue => {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    html_url: issue.html_url,
    repository_url: `https://example.test/api/repos/${repo}`,
  };
};

export const buildSearchIssueFromPullRequest = (
  pullRequest: GithubPullRequest,
  repo: string,
): GithubSearchIssue => {
  return {
    id: pullRequest.id,
    number: pullRequest.number,
    title: pullRequest.title,
    state: pullRequest.state,
    html_url: pullRequest.html_url,
    repository_url: `https://example.test/api/repos/${repo}`,
    pull_request: {
      html_url: pullRequest.html_url,
    },
  };
};

export const seedGithubCodeSearchResults = (repo: string): GithubCodeSearchResult[] => [
  {
    name: "connector.ts",
    path: "packages/shared/src/providers/modules/github/connector.ts",
    sha: "code_sha_1",
    html_url: `https://example.test/${repo}/blob/main/packages/shared/src/providers/modules/github/connector.ts`,
    repository: {
      full_name: repo,
    },
  },
  {
    name: "action-matrix.ts",
    path: "tests/provider-conformance/action-matrix.ts",
    sha: "code_sha_2",
    html_url: `https://example.test/${repo}/blob/main/tests/provider-conformance/action-matrix.ts`,
    repository: {
      full_name: repo,
    },
  },
];

export const seedGithubRepoSearchResults = (repos: GithubRepo[]): GithubRepoSearchResult[] => {
  return repos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    private: repo.private,
    html_url: repo.html_url,
    description: "Seeded repository for provider conformance.",
  }));
};
