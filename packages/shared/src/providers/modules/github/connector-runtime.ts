import { buildProviderIdempotencyKey } from "../../../provider-write-utils.js";
import { githubTools } from "../../../tool-definitions.js";
import { BaseConnector } from "../../../connectors/base-connector.js";
import type { Connector, ConnectorContext, PreparedWrite } from "../../../connectors/base.js";
import { createRealGithubSdk } from "../../../provider-sdk/github/real.js";
import type { GithubSdkPort } from "../../../provider-sdk/github/types.js";
import {
  createProviderCircuitBreaker,
  wrapObjectWithCircuitBreaker,
} from "../../../circuit-breaker.js";

const readGithubTools = [
  "github.listIssues",
  "github.getIssue",
  "github.listIssueEvents",
  "github.listIssueTimeline",
  "github.listPullRequests",
  "github.getPullRequest",
  "github.listPRFiles",
  "github.searchIssues",
  "github.searchCode",
  "github.searchRepositories",
  "github.getRepo",
  "github.listOrgRepos",
  "github.listReviews",
  "github.listCommits",
  "github.compareCommits",
  "github.getCommitStatus",
  "github.listCheckRuns",
  "github.listWorkflowRuns",
  "github.getWorkflowRun",
  "github.listNotifications",
  "github.getWorkflowJobLogs",
  "github.listPRCommits",
  "github.listIssueComments",
  "github.getLatestRelease",
  "github.listReleases",
  "github.listMilestones",
  "github.listBranches",
  "github.getFileContents",
  "github.listLabels",
] as const;

const writeGithubTools = [
  "github.commentIssue",
  "github.lockIssue",
  "github.unlockIssue",
  "github.createIssue",
  "github.updateIssue",
  "github.createPullRequest",
  "github.mergePullRequest",
  "github.addLabels",
  "github.removeLabel",
  "github.addAssignees",
  "github.removeAssignees",
  "github.createReview",
  "github.dismissReview",
  "github.requestReviewers",
  "github.removeReviewers",
  "github.createReviewComment",
  "github.createOrUpdateFile",
  "github.createLabel",
  "github.triggerWorkflow",
  "github.cancelWorkflowRun",
  "github.rerunWorkflow",
  "github.markNotificationsRead",
  "github.rerunFailedJobs",
  "github.updatePRBranch",
  "github.createReaction",
  "github.deleteReaction",
  "github.createDispatchEvent",
  "github.updatePullRequest",
  "github.updateComment",
  "github.deleteComment",
  "github.createRelease",
  "github.updateRelease",
  "github.generateReleaseNotes",
  "github.createMilestone",
  "github.updateMilestone",
] as const;

const requiredScopesByTool: Record<string, string[]> = {
  ...Object.fromEntries(readGithubTools.map((toolName) => [toolName, ["repo:read"]] as const)),
  ...Object.fromEntries(writeGithubTools.map((toolName) => [toolName, ["repo:write"]] as const)),
  "github.listOrgRepos": ["read:org"],
  "github.triggerWorkflow": ["repo:write", "workflow"],
  "github.cancelWorkflowRun": ["repo:write", "workflow"],
  "github.rerunWorkflow": ["repo:write", "workflow"],
  "github.rerunFailedJobs": ["repo:write", "workflow"],
};

const FAKE_GITHUB_ACCESS_TOKEN = process.env.KEPPO_FAKE_GITHUB_ACCESS_TOKEN?.trim();

const getToken = (context: ConnectorContext): string => {
  if (context.access_token) {
    return context.access_token;
  }
  if (FAKE_GITHUB_ACCESS_TOKEN) {
    return FAKE_GITHUB_ACCESS_TOKEN;
  }
  throw new Error("GitHub access token missing. Reconnect GitHub integration.");
};

const normalizeAllowlist = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.toLowerCase());
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
  }
  return [];
};

const enforceRepoAllowlist = (context: ConnectorContext, repo: string): void => {
  const allowedRepositories = normalizeAllowlist(
    context.metadata?.allowed_repositories ?? context.metadata?.allowedRepositories,
  );
  if (allowedRepositories.length === 0) {
    return;
  }

  const normalizedRepo = repo.trim().toLowerCase();
  if (!allowedRepositories.includes(normalizedRepo)) {
    throw new Error(`Repository ${repo} is not in the integration allowlist.`);
  }
};

const asStringArray = (value: unknown): string[] => {
  return Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
    : [];
};

const asStringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.trim();
    const normalizedValue = String(entry ?? "").trim();
    if (normalizedKey.length === 0 || normalizedValue.length === 0) {
      continue;
    }
    output[normalizedKey] = normalizedValue;
  }
  return output;
};

const resolveSearchQuery = (repo: string, query: string): string => {
  const trimmedQuery = query.trim();
  if (trimmedQuery.includes("repo:")) {
    return trimmedQuery;
  }
  if (trimmedQuery.length === 0) {
    return `repo:${repo}`;
  }
  return `repo:${repo} ${trimmedQuery}`;
};

const providerCircuitBreaker = createProviderCircuitBreaker("github");

type GithubReadToolName = (typeof readGithubTools)[number];

type GithubWriteToolName = (typeof writeGithubTools)[number];

type GithubReadDispatchInput = {
  validated: Record<string, unknown>;
  accessToken: string;
  namespace: string | undefined;
  context: ConnectorContext;
};

type GithubPrepareDispatchInput = {
  validated: Record<string, unknown>;
  context: ConnectorContext;
};

type GithubWriteDispatchInput = {
  normalizedPayload: Record<string, unknown>;
  accessToken: string;
  namespace: string | undefined;
  context: ConnectorContext;
  idempotencyKey: string;
};

export const createGithubConnector = (options?: { sdk?: GithubSdkPort }): Connector => {
  const sdk = wrapObjectWithCircuitBreaker(
    options?.sdk ?? createRealGithubSdk(),
    providerCircuitBreaker,
  );

  const readMap: Record<
    GithubReadToolName,
    (payload: GithubReadDispatchInput) => Promise<Record<string, unknown>>
  > = {
    "github.listIssues": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const state = String(validated.state ?? "open");
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);

      const issues = await sdk.listIssues({
        accessToken,
        namespace,
        repo,
        state: state === "closed" || state === "all" ? state : "open",
        perPage,
      });

      return {
        repo,
        issues,
      };
    },

    "github.getIssue": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const issue = Number(validated.issue ?? 0);
      enforceRepoAllowlist(context, repo);
      const issueDetails = await sdk.getIssue({
        accessToken,
        namespace,
        repo,
        issue,
      });
      return {
        repo,
        issue: issueDetails,
      };
    },

    "github.listIssueEvents": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const issue = Number(validated.issue ?? 0);
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);
      const events = await sdk.listIssueEvents({
        accessToken,
        namespace,
        repo,
        issue,
        perPage,
      });
      return {
        repo,
        issue,
        events,
      };
    },

    "github.listIssueTimeline": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const issue = Number(validated.issue ?? 0);
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);
      const timeline = await sdk.listIssueTimeline({
        accessToken,
        namespace,
        repo,
        issue,
        perPage,
      });
      return {
        repo,
        issue,
        timeline,
      };
    },

    "github.listPullRequests": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const state = String(validated.state ?? "open");
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);
      const pullRequests = await sdk.listPullRequests({
        accessToken,
        namespace,
        repo,
        state: state === "closed" || state === "all" ? state : "open",
        perPage,
      });
      return {
        repo,
        pullRequests,
      };
    },

    "github.getPullRequest": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const pullNumber = Number(validated.pullNumber ?? 0);
      enforceRepoAllowlist(context, repo);
      const pullRequest = await sdk.getPullRequest({
        accessToken,
        namespace,
        repo,
        pullNumber,
      });
      return {
        repo,
        pullRequest,
      };
    },

    "github.listPRFiles": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const pullNumber = Number(validated.pullNumber ?? 0);
      const perPage = Number(validated.perPage ?? 50);
      enforceRepoAllowlist(context, repo);
      const files = await sdk.listPullRequestFiles({
        accessToken,
        namespace,
        repo,
        pullNumber,
        perPage,
      });
      return {
        repo,
        pullNumber,
        files,
      };
    },

    "github.searchIssues": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const query = String(validated.query ?? "");
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);
      const searchQuery = resolveSearchQuery(repo, query);
      const results = await sdk.searchIssues({
        accessToken,
        namespace,
        query: searchQuery,
        perPage,
      });
      return {
        repo,
        query: searchQuery,
        results,
      };
    },

    "github.searchCode": async ({ validated, accessToken, namespace, context }) => {
      const query = String(validated.query ?? "");
      const perPage = Number(validated.perPage ?? 20);
      const results = await sdk.searchCode({
        accessToken,
        namespace,
        query,
        perPage,
      });
      return {
        query,
        results,
      };
    },

    "github.searchRepositories": async ({ validated, accessToken, namespace, context }) => {
      const query = String(validated.query ?? "");
      const perPage = Number(validated.perPage ?? 20);
      const repositories = await sdk.searchRepositories({
        accessToken,
        namespace,
        query,
        perPage,
      });
      return {
        query,
        repositories,
      };
    },

    "github.getRepo": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      const repository = await sdk.getRepo({
        accessToken,
        namespace,
        repo,
      });
      return {
        repo,
        repository,
      };
    },

    "github.listOrgRepos": async ({ validated, accessToken, namespace, context }) => {
      const org = String(validated.org ?? "");
      const perPage = Number(validated.perPage ?? 20);
      const typeValue = String(validated.type ?? "all");
      const type =
        typeValue === "public" ||
        typeValue === "private" ||
        typeValue === "forks" ||
        typeValue === "sources" ||
        typeValue === "member"
          ? typeValue
          : "all";
      const repositories = await sdk.listOrgRepos({
        accessToken,
        namespace,
        org,
        perPage,
        type,
      });
      return {
        org,
        repositories,
      };
    },

    "github.listReviews": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const pullNumber = Number(validated.pullNumber ?? 0);
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);
      const reviews = await sdk.listReviews({
        accessToken,
        namespace,
        repo,
        pullNumber,
        perPage,
      });
      return {
        repo,
        pullNumber,
        reviews,
      };
    },

    "github.listCommits": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);
      const commits = await sdk.listCommits({
        accessToken,
        namespace,
        repo,
        perPage,
        ...(validated.sha !== undefined ? { sha: String(validated.sha) } : {}),
      });
      return {
        repo,
        commits,
      };
    },

    "github.compareCommits": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const base = String(validated.base ?? "");
      const head = String(validated.head ?? "");
      enforceRepoAllowlist(context, repo);
      const comparison = await sdk.compareCommits({
        accessToken,
        namespace,
        repo,
        base,
        head,
      });
      return {
        repo,
        basehead: `${base}...${head}`,
        comparison,
      };
    },

    "github.getCommitStatus": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const ref = String(validated.ref ?? "");
      enforceRepoAllowlist(context, repo);
      const status = await sdk.getCommitStatus({
        accessToken,
        namespace,
        repo,
        ref,
      });
      return {
        repo,
        ref,
        status,
      };
    },

    "github.listCheckRuns": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const ref = String(validated.ref ?? "");
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);
      const checkRuns = await sdk.listCheckRuns({
        accessToken,
        namespace,
        repo,
        ref,
        perPage,
      });
      return {
        repo,
        ref,
        checkRuns,
      };
    },

    "github.listWorkflowRuns": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);
      const workflowRuns = await sdk.listWorkflowRuns({
        accessToken,
        namespace,
        repo,
        perPage,
        ...(validated.branch !== undefined ? { branch: String(validated.branch) } : {}),
        ...(validated.status !== undefined ? { status: String(validated.status) } : {}),
      });
      return {
        repo,
        workflowRuns,
      };
    },

    "github.getWorkflowRun": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const runId = Number(validated.runId ?? 0);
      enforceRepoAllowlist(context, repo);
      const workflowRun = await sdk.getWorkflowRun({
        accessToken,
        namespace,
        repo,
        runId,
      });
      return {
        repo,
        workflowRun,
      };
    },

    "github.listNotifications": async ({ validated, accessToken, namespace, context }) => {
      const perPage = Number(validated.perPage ?? 20);
      const notifications = await sdk.listNotifications({
        accessToken,
        namespace,
        perPage,
        ...(validated.all !== undefined ? { all: Boolean(validated.all) } : {}),
        ...(validated.participating !== undefined
          ? { participating: Boolean(validated.participating) }
          : {}),
        ...(validated.since !== undefined ? { since: String(validated.since) } : {}),
        ...(validated.before !== undefined ? { before: String(validated.before) } : {}),
      });
      return {
        notifications,
      };
    },

    "github.getWorkflowJobLogs": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const jobId = Number(validated.jobId ?? 0);
      enforceRepoAllowlist(context, repo);
      const logs = await sdk.getWorkflowJobLogs({
        accessToken,
        namespace,
        repo,
        jobId,
      });
      return {
        repo,
        jobId,
        logs,
      };
    },

    "github.listPRCommits": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const pullNumber = Number(validated.pullNumber ?? 0);
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);
      const commits = await sdk.listPullRequestCommits({
        accessToken,
        namespace,
        repo,
        pullNumber,
        perPage,
      });
      return {
        repo,
        pullNumber,
        commits,
      };
    },

    "github.listIssueComments": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const issue = Number(validated.issue ?? 0);
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);
      const comments = await sdk.listIssueComments({
        accessToken,
        namespace,
        repo,
        issue,
        perPage,
      });
      return {
        repo,
        issue,
        comments,
      };
    },

    "github.getLatestRelease": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      const release = await sdk.getLatestRelease({
        accessToken,
        namespace,
        repo,
      });
      return {
        repo,
        release,
      };
    },

    "github.listReleases": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);
      const releases = await sdk.listReleases({
        accessToken,
        namespace,
        repo,
        perPage,
      });
      return {
        repo,
        releases,
      };
    },

    "github.listMilestones": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const perPage = Number(validated.perPage ?? 20);
      const state = String(validated.state ?? "open");
      enforceRepoAllowlist(context, repo);
      const milestones = await sdk.listMilestones({
        accessToken,
        namespace,
        repo,
        state: state === "all" || state === "closed" ? state : "open",
        perPage,
      });
      return {
        repo,
        milestones,
      };
    },

    "github.listBranches": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);
      const branches = await sdk.listBranches({
        accessToken,
        namespace,
        repo,
        perPage,
      });
      return {
        repo,
        branches,
      };
    },

    "github.getFileContents": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const path = String(validated.path ?? "");
      enforceRepoAllowlist(context, repo);
      const file = await sdk.getFileContents({
        accessToken,
        namespace,
        repo,
        path,
        ...(validated.ref !== undefined ? { ref: String(validated.ref) } : {}),
      });
      return {
        repo,
        file,
      };
    },

    "github.listLabels": async ({ validated, accessToken, namespace, context }) => {
      const repo = String(validated.repo ?? "");
      const perPage = Number(validated.perPage ?? 20);
      enforceRepoAllowlist(context, repo);
      const labels = await sdk.listLabels({
        accessToken,
        namespace,
        repo,
        perPage,
      });
      return {
        repo,
        labels,
      };
    },
  };

  const prepareMap: Record<
    GithubWriteToolName,
    (payload: GithubPrepareDispatchInput) => Promise<PreparedWrite>
  > = {
    "github.commentIssue": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "comment_issue",
          repo,
          issue: Number(validated.issue ?? 0),
          body: String(validated.body ?? ""),
        },
        payload_preview: {
          repo,
          issue: Number(validated.issue ?? 0),
          comment_preview: String(validated.body ?? "").slice(0, 120),
        },
      };
    },

    "github.lockIssue": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "lock_issue",
          repo,
          issue: Number(validated.issue ?? 0),
          ...(validated.lockReason !== undefined
            ? { lockReason: String(validated.lockReason) }
            : {}),
        },
        payload_preview: {
          repo,
          issue: Number(validated.issue ?? 0),
          ...(validated.lockReason !== undefined
            ? { lockReason: String(validated.lockReason) }
            : {}),
        },
      };
    },

    "github.unlockIssue": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "unlock_issue",
          repo,
          issue: Number(validated.issue ?? 0),
        },
        payload_preview: {
          repo,
          issue: Number(validated.issue ?? 0),
        },
      };
    },

    "github.createIssue": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "create_issue",
          repo,
          title: String(validated.title ?? ""),
          body: String(validated.body ?? ""),
          labels: asStringArray(validated.labels),
          assignees: asStringArray(validated.assignees),
        },
        payload_preview: {
          repo,
          title: String(validated.title ?? ""),
          labels_count: asStringArray(validated.labels).length,
          assignees_count: asStringArray(validated.assignees).length,
        },
      };
    },

    "github.updateIssue": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "update_issue",
          repo,
          issue: Number(validated.issue ?? 0),
          ...(validated.title !== undefined ? { title: String(validated.title) } : {}),
          ...(validated.body !== undefined ? { body: String(validated.body) } : {}),
          ...(validated.state !== undefined ? { state: String(validated.state) } : {}),
          ...(validated.labels !== undefined ? { labels: asStringArray(validated.labels) } : {}),
          ...(validated.assignees !== undefined
            ? { assignees: asStringArray(validated.assignees) }
            : {}),
        },
        payload_preview: {
          repo,
          issue: Number(validated.issue ?? 0),
          fields: [
            ...(validated.title !== undefined ? ["title"] : []),
            ...(validated.body !== undefined ? ["body"] : []),
            ...(validated.state !== undefined ? ["state"] : []),
            ...(validated.labels !== undefined ? ["labels"] : []),
            ...(validated.assignees !== undefined ? ["assignees"] : []),
          ],
        },
      };
    },

    "github.createPullRequest": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "create_pull_request",
          repo,
          title: String(validated.title ?? ""),
          body: String(validated.body ?? ""),
          head: String(validated.head ?? ""),
          base: String(validated.base ?? ""),
        },
        payload_preview: {
          repo,
          title: String(validated.title ?? ""),
          head: String(validated.head ?? ""),
          base: String(validated.base ?? ""),
        },
      };
    },

    "github.mergePullRequest": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "merge_pull_request",
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          mergeMethod: String(validated.mergeMethod ?? "merge"),
          ...(validated.commitTitle !== undefined
            ? { commitTitle: String(validated.commitTitle) }
            : {}),
        },
        payload_preview: {
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          mergeMethod: String(validated.mergeMethod ?? "merge"),
        },
      };
    },

    "github.addLabels": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "add_labels",
          repo,
          issue: Number(validated.issue ?? 0),
          labels: asStringArray(validated.labels),
        },
        payload_preview: {
          repo,
          issue: Number(validated.issue ?? 0),
          labels: asStringArray(validated.labels),
        },
      };
    },

    "github.removeLabel": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "remove_label",
          repo,
          issue: Number(validated.issue ?? 0),
          label: String(validated.label ?? ""),
        },
        payload_preview: {
          repo,
          issue: Number(validated.issue ?? 0),
          label: String(validated.label ?? ""),
        },
      };
    },

    "github.addAssignees": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "add_assignees",
          repo,
          issue: Number(validated.issue ?? 0),
          assignees: asStringArray(validated.assignees),
        },
        payload_preview: {
          repo,
          issue: Number(validated.issue ?? 0),
          assignees: asStringArray(validated.assignees),
        },
      };
    },

    "github.removeAssignees": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "remove_assignees",
          repo,
          issue: Number(validated.issue ?? 0),
          assignees: asStringArray(validated.assignees),
        },
        payload_preview: {
          repo,
          issue: Number(validated.issue ?? 0),
          assignees: asStringArray(validated.assignees),
        },
      };
    },

    "github.createReview": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "create_review",
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          event: String(validated.event ?? "COMMENT"),
          ...(validated.body !== undefined ? { body: String(validated.body) } : {}),
          ...(validated.commitId !== undefined ? { commitId: String(validated.commitId) } : {}),
        },
        payload_preview: {
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          event: String(validated.event ?? "COMMENT"),
        },
      };
    },

    "github.dismissReview": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "dismiss_review",
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          reviewId: Number(validated.reviewId ?? 0),
          message: String(validated.message ?? ""),
        },
        payload_preview: {
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          reviewId: Number(validated.reviewId ?? 0),
        },
      };
    },

    "github.requestReviewers": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "request_reviewers",
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          reviewers: asStringArray(validated.reviewers),
        },
        payload_preview: {
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          reviewers: asStringArray(validated.reviewers),
        },
      };
    },

    "github.removeReviewers": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "remove_reviewers",
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          reviewers: asStringArray(validated.reviewers),
        },
        payload_preview: {
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          reviewers: asStringArray(validated.reviewers),
        },
      };
    },

    "github.createReviewComment": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "create_review_comment",
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          body: String(validated.body ?? ""),
          path: String(validated.path ?? ""),
          line: Number(validated.line ?? 0),
          ...(validated.commitId !== undefined ? { commitId: String(validated.commitId) } : {}),
        },
        payload_preview: {
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          path: String(validated.path ?? ""),
          line: Number(validated.line ?? 0),
        },
      };
    },

    "github.createOrUpdateFile": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "create_or_update_file",
          repo,
          path: String(validated.path ?? ""),
          message: String(validated.message ?? ""),
          content: String(validated.content ?? ""),
          ...(validated.sha !== undefined ? { sha: String(validated.sha) } : {}),
          ...(validated.branch !== undefined ? { branch: String(validated.branch) } : {}),
          ...(validated.committerName !== undefined
            ? { committerName: String(validated.committerName) }
            : {}),
          ...(validated.committerEmail !== undefined
            ? { committerEmail: String(validated.committerEmail) }
            : {}),
          ...(validated.authorName !== undefined
            ? { authorName: String(validated.authorName) }
            : {}),
          ...(validated.authorEmail !== undefined
            ? { authorEmail: String(validated.authorEmail) }
            : {}),
        },
        payload_preview: {
          repo,
          path: String(validated.path ?? ""),
          message_preview: String(validated.message ?? "").slice(0, 120),
          has_previous_sha: validated.sha !== undefined,
          content_length: String(validated.content ?? "").length,
        },
      };
    },

    "github.createLabel": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "create_label",
          repo,
          name: String(validated.name ?? ""),
          color: String(validated.color ?? "").toLowerCase(),
          ...(validated.description !== undefined
            ? { description: String(validated.description) }
            : {}),
        },
        payload_preview: {
          repo,
          name: String(validated.name ?? ""),
          color: String(validated.color ?? "").toLowerCase(),
        },
      };
    },

    "github.triggerWorkflow": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "trigger_workflow",
          repo,
          workflowId: String(validated.workflowId ?? ""),
          ref: String(validated.ref ?? ""),
          inputs: asStringRecord(validated.inputs),
        },
        payload_preview: {
          repo,
          workflowId: String(validated.workflowId ?? ""),
          ref: String(validated.ref ?? ""),
          inputs_count: Object.keys(asStringRecord(validated.inputs)).length,
        },
      };
    },

    "github.cancelWorkflowRun": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "cancel_workflow_run",
          repo,
          runId: Number(validated.runId ?? 0),
        },
        payload_preview: {
          repo,
          runId: Number(validated.runId ?? 0),
        },
      };
    },

    "github.rerunWorkflow": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "rerun_workflow",
          repo,
          runId: Number(validated.runId ?? 0),
          enableDebugLogging: Boolean(validated.enableDebugLogging ?? false),
        },
        payload_preview: {
          repo,
          runId: Number(validated.runId ?? 0),
          enableDebugLogging: Boolean(validated.enableDebugLogging ?? false),
        },
      };
    },

    "github.markNotificationsRead": async ({ validated, context }) => {
      return {
        normalized_payload: {
          type: "mark_notifications_read",
          ...(validated.lastReadAt !== undefined
            ? { lastReadAt: String(validated.lastReadAt) }
            : {}),
        },
        payload_preview:
          validated.lastReadAt !== undefined ? { lastReadAt: String(validated.lastReadAt) } : {},
      };
    },

    "github.rerunFailedJobs": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "rerun_failed_jobs",
          repo,
          runId: Number(validated.runId ?? 0),
          enableDebugLogging: Boolean(validated.enableDebugLogging ?? false),
        },
        payload_preview: {
          repo,
          runId: Number(validated.runId ?? 0),
          enableDebugLogging: Boolean(validated.enableDebugLogging ?? false),
        },
      };
    },

    "github.updatePRBranch": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "update_pr_branch",
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          ...(validated.expectedHeadSha !== undefined
            ? { expectedHeadSha: String(validated.expectedHeadSha) }
            : {}),
        },
        payload_preview: {
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          has_expected_head_sha: validated.expectedHeadSha !== undefined,
        },
      };
    },

    "github.createReaction": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "create_reaction",
          repo,
          issue: Number(validated.issue ?? 0),
          content: String(validated.content ?? ""),
        },
        payload_preview: {
          repo,
          issue: Number(validated.issue ?? 0),
          content: String(validated.content ?? ""),
        },
      };
    },

    "github.deleteReaction": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "delete_reaction",
          repo,
          issue: Number(validated.issue ?? 0),
          reactionId: Number(validated.reactionId ?? 0),
        },
        payload_preview: {
          repo,
          issue: Number(validated.issue ?? 0),
          reactionId: Number(validated.reactionId ?? 0),
        },
      };
    },

    "github.createDispatchEvent": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "create_dispatch_event",
          repo,
          eventType: String(validated.eventType ?? ""),
          clientPayload:
            validated.clientPayload &&
            typeof validated.clientPayload === "object" &&
            !Array.isArray(validated.clientPayload)
              ? (validated.clientPayload as Record<string, unknown>)
              : {},
        },
        payload_preview: {
          repo,
          eventType: String(validated.eventType ?? ""),
        },
      };
    },

    "github.updatePullRequest": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "update_pull_request",
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          ...(validated.title !== undefined ? { title: String(validated.title) } : {}),
          ...(validated.body !== undefined ? { body: String(validated.body) } : {}),
          ...(validated.state !== undefined ? { state: String(validated.state) } : {}),
          ...(validated.base !== undefined ? { base: String(validated.base) } : {}),
        },
        payload_preview: {
          repo,
          pullNumber: Number(validated.pullNumber ?? 0),
          fields: [
            ...(validated.title !== undefined ? ["title"] : []),
            ...(validated.body !== undefined ? ["body"] : []),
            ...(validated.state !== undefined ? ["state"] : []),
            ...(validated.base !== undefined ? ["base"] : []),
          ],
        },
      };
    },

    "github.updateComment": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "update_comment",
          repo,
          commentId: Number(validated.commentId ?? 0),
          body: String(validated.body ?? ""),
        },
        payload_preview: {
          repo,
          commentId: Number(validated.commentId ?? 0),
          body_preview: String(validated.body ?? "").slice(0, 120),
        },
      };
    },

    "github.deleteComment": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "delete_comment",
          repo,
          commentId: Number(validated.commentId ?? 0),
        },
        payload_preview: {
          repo,
          commentId: Number(validated.commentId ?? 0),
        },
      };
    },

    "github.createRelease": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "create_release",
          repo,
          tagName: String(validated.tagName ?? ""),
          ...(validated.targetCommitish !== undefined
            ? { targetCommitish: String(validated.targetCommitish) }
            : {}),
          ...(validated.name !== undefined ? { name: String(validated.name) } : {}),
          ...(validated.body !== undefined ? { body: String(validated.body) } : {}),
          draft: Boolean(validated.draft ?? false),
          prerelease: Boolean(validated.prerelease ?? false),
          generateReleaseNotes: Boolean(validated.generateReleaseNotes ?? false),
        },
        payload_preview: {
          repo,
          tagName: String(validated.tagName ?? ""),
          draft: Boolean(validated.draft ?? false),
          prerelease: Boolean(validated.prerelease ?? false),
        },
      };
    },

    "github.updateRelease": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "update_release",
          repo,
          releaseId: Number(validated.releaseId ?? 0),
          ...(validated.tagName !== undefined ? { tagName: String(validated.tagName) } : {}),
          ...(validated.targetCommitish !== undefined
            ? { targetCommitish: String(validated.targetCommitish) }
            : {}),
          ...(validated.name !== undefined ? { name: String(validated.name) } : {}),
          ...(validated.body !== undefined ? { body: String(validated.body) } : {}),
          ...(validated.draft !== undefined ? { draft: Boolean(validated.draft) } : {}),
          ...(validated.prerelease !== undefined
            ? { prerelease: Boolean(validated.prerelease) }
            : {}),
        },
        payload_preview: {
          repo,
          releaseId: Number(validated.releaseId ?? 0),
          fields: [
            ...(validated.tagName !== undefined ? ["tagName"] : []),
            ...(validated.targetCommitish !== undefined ? ["targetCommitish"] : []),
            ...(validated.name !== undefined ? ["name"] : []),
            ...(validated.body !== undefined ? ["body"] : []),
            ...(validated.draft !== undefined ? ["draft"] : []),
            ...(validated.prerelease !== undefined ? ["prerelease"] : []),
          ],
        },
      };
    },

    "github.generateReleaseNotes": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "generate_release_notes",
          repo,
          tagName: String(validated.tagName ?? ""),
          ...(validated.targetCommitish !== undefined
            ? { targetCommitish: String(validated.targetCommitish) }
            : {}),
          ...(validated.previousTagName !== undefined
            ? { previousTagName: String(validated.previousTagName) }
            : {}),
          ...(validated.configurationFilePath !== undefined
            ? { configurationFilePath: String(validated.configurationFilePath) }
            : {}),
        },
        payload_preview: {
          repo,
          tagName: String(validated.tagName ?? ""),
          previousTagName:
            validated.previousTagName !== undefined ? String(validated.previousTagName) : "",
        },
      };
    },

    "github.createMilestone": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "create_milestone",
          repo,
          title: String(validated.title ?? ""),
          state: String(validated.state ?? "open"),
          ...(validated.description !== undefined
            ? { description: String(validated.description) }
            : {}),
          ...(validated.dueOn !== undefined ? { dueOn: String(validated.dueOn) } : {}),
        },
        payload_preview: {
          repo,
          title: String(validated.title ?? ""),
          state: String(validated.state ?? "open"),
        },
      };
    },

    "github.updateMilestone": async ({ validated, context }) => {
      const repo = String(validated.repo ?? "");
      enforceRepoAllowlist(context, repo);
      return {
        normalized_payload: {
          type: "update_milestone",
          repo,
          milestone: Number(validated.milestone ?? 0),
          ...(validated.title !== undefined ? { title: String(validated.title) } : {}),
          ...(validated.state !== undefined ? { state: String(validated.state) } : {}),
          ...(validated.description !== undefined
            ? { description: String(validated.description) }
            : {}),
          ...(validated.dueOn !== undefined ? { dueOn: String(validated.dueOn) } : {}),
        },
        payload_preview: {
          repo,
          milestone: Number(validated.milestone ?? 0),
          fields: [
            ...(validated.title !== undefined ? ["title"] : []),
            ...(validated.state !== undefined ? ["state"] : []),
            ...(validated.description !== undefined ? ["description"] : []),
            ...(validated.dueOn !== undefined ? ["dueOn"] : []),
          ],
        },
      };
    },
  };

  const writeMap: Record<
    GithubWriteToolName,
    (payload: GithubWriteDispatchInput) => Promise<Record<string, unknown>>
  > = {
    "github.commentIssue": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const issue = Number(normalizedPayload.issue ?? 0);
      enforceRepoAllowlist(context, repo);

      await sdk.getIssue({
        accessToken,
        namespace,
        repo,
        issue,
      });

      const response = await sdk.createIssueComment({
        accessToken,
        namespace,
        repo,
        issue,
        body: String(normalizedPayload.body ?? ""),
        idempotencyKey,
      });

      return {
        status: "comment_posted",
        provider_action_id: String(response.id ?? `${repo}#${issue}#comment`),
        repo,
        issue,
      };
    },

    "github.lockIssue": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const issue = Number(normalizedPayload.issue ?? 0);
      enforceRepoAllowlist(context, repo);
      const response = await sdk.lockIssue({
        accessToken,
        namespace,
        repo,
        issue,
        ...(normalizedPayload.lockReason !== undefined
          ? {
              lockReason: String(normalizedPayload.lockReason) as
                | "off-topic"
                | "too heated"
                | "resolved"
                | "spam",
            }
          : {}),
        idempotencyKey,
      });
      return {
        status: "issue_locked",
        provider_action_id: `${repo}#issue#${issue}#lock`,
        repo,
        issue,
        locked: Boolean(response.locked ?? true),
      };
    },

    "github.unlockIssue": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const issue = Number(normalizedPayload.issue ?? 0);
      enforceRepoAllowlist(context, repo);
      const response = await sdk.unlockIssue({
        accessToken,
        namespace,
        repo,
        issue,
        idempotencyKey,
      });
      return {
        status: "issue_unlocked",
        provider_action_id: `${repo}#issue#${issue}#unlock`,
        repo,
        issue,
        locked: Boolean(response.locked ?? false),
      };
    },

    "github.createIssue": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      enforceRepoAllowlist(context, repo);
      const created = await sdk.createIssue({
        accessToken,
        namespace,
        repo,
        title: String(normalizedPayload.title ?? ""),
        body: String(normalizedPayload.body ?? ""),
        labels: asStringArray(normalizedPayload.labels),
        assignees: asStringArray(normalizedPayload.assignees),
        idempotencyKey,
      });
      return {
        status: "issue_created",
        provider_action_id: String(created.id ?? `${repo}#issue`),
        repo,
        issueNumber: Number(created.number ?? 0),
      };
    },

    "github.updateIssue": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const issue = Number(normalizedPayload.issue ?? 0);
      enforceRepoAllowlist(context, repo);
      const updated = await sdk.updateIssue({
        accessToken,
        namespace,
        repo,
        issue,
        ...(normalizedPayload.title !== undefined
          ? { title: String(normalizedPayload.title) }
          : {}),
        ...(normalizedPayload.body !== undefined ? { body: String(normalizedPayload.body) } : {}),
        ...(normalizedPayload.state !== undefined
          ? {
              state:
                String(normalizedPayload.state) === "closed"
                  ? ("closed" as const)
                  : ("open" as const),
            }
          : {}),
        ...(normalizedPayload.labels !== undefined
          ? { labels: asStringArray(normalizedPayload.labels) }
          : {}),
        ...(normalizedPayload.assignees !== undefined
          ? { assignees: asStringArray(normalizedPayload.assignees) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "issue_updated",
        provider_action_id: String(updated.id ?? `gh_issue_${issue}`),
        repo,
        issueNumber: Number(updated.number ?? issue),
      };
    },

    "github.createPullRequest": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      enforceRepoAllowlist(context, repo);
      const created = await sdk.createPullRequest({
        accessToken,
        namespace,
        repo,
        title: String(normalizedPayload.title ?? ""),
        body: String(normalizedPayload.body ?? ""),
        head: String(normalizedPayload.head ?? ""),
        base: String(normalizedPayload.base ?? ""),
        idempotencyKey,
      });
      return {
        status: "pull_request_created",
        provider_action_id: String(created.id ?? `${repo}#pull`),
        repo,
        pullNumber: Number(created.number ?? 0),
      };
    },

    "github.mergePullRequest": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const pullNumber = Number(normalizedPayload.pullNumber ?? 0);
      enforceRepoAllowlist(context, repo);
      const merged = await sdk.mergePullRequest({
        accessToken,
        namespace,
        repo,
        pullNumber,
        mergeMethod:
          String(normalizedPayload.mergeMethod ?? "merge") === "squash"
            ? "squash"
            : String(normalizedPayload.mergeMethod ?? "merge") === "rebase"
              ? "rebase"
              : "merge",
        ...(normalizedPayload.commitTitle !== undefined
          ? { commitTitle: String(normalizedPayload.commitTitle) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "pull_request_merged",
        provider_action_id: String(merged.sha ?? `${repo}#${pullNumber}#merge`),
        repo,
        pullNumber,
        merged: Boolean(merged.merged),
      };
    },

    "github.addLabels": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const issue = Number(normalizedPayload.issue ?? 0);
      enforceRepoAllowlist(context, repo);
      const labels = await sdk.addLabels({
        accessToken,
        namespace,
        repo,
        issue,
        labels: asStringArray(normalizedPayload.labels),
        idempotencyKey,
      });
      return {
        status: "labels_added",
        provider_action_id: `${repo}#${issue}`,
        repo,
        issue,
        labels,
      };
    },

    "github.removeLabel": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const issue = Number(normalizedPayload.issue ?? 0);
      enforceRepoAllowlist(context, repo);
      const labels = await sdk.removeLabel({
        accessToken,
        namespace,
        repo,
        issue,
        label: String(normalizedPayload.label ?? ""),
        idempotencyKey,
      });
      return {
        status: "label_removed",
        provider_action_id: `${repo}#${issue}`,
        repo,
        issue,
        labels,
      };
    },

    "github.addAssignees": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const issue = Number(normalizedPayload.issue ?? 0);
      enforceRepoAllowlist(context, repo);
      const updated = await sdk.addAssignees({
        accessToken,
        namespace,
        repo,
        issue,
        assignees: asStringArray(normalizedPayload.assignees),
        idempotencyKey,
      });
      return {
        status: "assignees_added",
        provider_action_id: String(updated.id ?? `${repo}#${issue}`),
        repo,
        issue,
      };
    },

    "github.removeAssignees": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const issue = Number(normalizedPayload.issue ?? 0);
      enforceRepoAllowlist(context, repo);
      const updated = await sdk.removeAssignees({
        accessToken,
        namespace,
        repo,
        issue,
        assignees: asStringArray(normalizedPayload.assignees),
        idempotencyKey,
      });
      return {
        status: "assignees_removed",
        provider_action_id: String(updated.id ?? `${repo}#${issue}`),
        repo,
        issue,
      };
    },

    "github.createReview": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const pullNumber = Number(normalizedPayload.pullNumber ?? 0);
      enforceRepoAllowlist(context, repo);
      const review = await sdk.createReview({
        accessToken,
        namespace,
        repo,
        pullNumber,
        event:
          String(normalizedPayload.event ?? "COMMENT") === "APPROVE"
            ? "APPROVE"
            : String(normalizedPayload.event ?? "COMMENT") === "REQUEST_CHANGES"
              ? "REQUEST_CHANGES"
              : "COMMENT",
        ...(normalizedPayload.body !== undefined ? { body: String(normalizedPayload.body) } : {}),
        ...(normalizedPayload.commitId !== undefined
          ? { commitId: String(normalizedPayload.commitId) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "review_submitted",
        provider_action_id: String(review.id ?? `${repo}#${pullNumber}#review`),
        repo,
        pullNumber,
        reviewId: Number(review.id ?? 0),
      };
    },

    "github.dismissReview": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const pullNumber = Number(normalizedPayload.pullNumber ?? 0);
      const reviewId = Number(normalizedPayload.reviewId ?? 0);
      enforceRepoAllowlist(context, repo);
      const review = await sdk.dismissReview({
        accessToken,
        namespace,
        repo,
        pullNumber,
        reviewId,
        message: String(normalizedPayload.message ?? ""),
        idempotencyKey,
      });
      return {
        status: "review_dismissed",
        provider_action_id: String(review.id ?? `${repo}#${pullNumber}#review#${reviewId}`),
        repo,
        pullNumber,
        reviewId,
      };
    },

    "github.requestReviewers": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const pullNumber = Number(normalizedPayload.pullNumber ?? 0);
      enforceRepoAllowlist(context, repo);
      const updated = await sdk.requestReviewers({
        accessToken,
        namespace,
        repo,
        pullNumber,
        reviewers: asStringArray(normalizedPayload.reviewers),
        idempotencyKey,
      });
      return {
        status: "reviewers_requested",
        provider_action_id: String(updated.id ?? `${repo}#${pullNumber}`),
        repo,
        pullNumber,
        reviewers: asStringArray(normalizedPayload.reviewers),
      };
    },

    "github.removeReviewers": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const pullNumber = Number(normalizedPayload.pullNumber ?? 0);
      enforceRepoAllowlist(context, repo);
      const updated = await sdk.removeReviewers({
        accessToken,
        namespace,
        repo,
        pullNumber,
        reviewers: asStringArray(normalizedPayload.reviewers),
        idempotencyKey,
      });
      return {
        status: "reviewers_removed",
        provider_action_id: String(updated.id ?? `${repo}#${pullNumber}`),
        repo,
        pullNumber,
        reviewers: asStringArray(normalizedPayload.reviewers),
      };
    },

    "github.createReviewComment": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const pullNumber = Number(normalizedPayload.pullNumber ?? 0);
      enforceRepoAllowlist(context, repo);
      const comment = await sdk.createReviewComment({
        accessToken,
        namespace,
        repo,
        pullNumber,
        body: String(normalizedPayload.body ?? ""),
        path: String(normalizedPayload.path ?? ""),
        line: Number(normalizedPayload.line ?? 0),
        ...(normalizedPayload.commitId !== undefined
          ? { commitId: String(normalizedPayload.commitId) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "review_comment_created",
        provider_action_id: String(comment.id ?? `${repo}#${pullNumber}#review-comment`),
        repo,
        pullNumber,
        commentId: Number(comment.id ?? 0),
      };
    },

    "github.createOrUpdateFile": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      enforceRepoAllowlist(context, repo);
      const result = await sdk.createOrUpdateFile({
        accessToken,
        namespace,
        repo,
        path: String(normalizedPayload.path ?? ""),
        message: String(normalizedPayload.message ?? ""),
        content: String(normalizedPayload.content ?? ""),
        ...(normalizedPayload.sha !== undefined ? { sha: String(normalizedPayload.sha) } : {}),
        ...(normalizedPayload.branch !== undefined
          ? { branch: String(normalizedPayload.branch) }
          : {}),
        ...(normalizedPayload.committerName !== undefined
          ? { committerName: String(normalizedPayload.committerName) }
          : {}),
        ...(normalizedPayload.committerEmail !== undefined
          ? { committerEmail: String(normalizedPayload.committerEmail) }
          : {}),
        ...(normalizedPayload.authorName !== undefined
          ? { authorName: String(normalizedPayload.authorName) }
          : {}),
        ...(normalizedPayload.authorEmail !== undefined
          ? { authorEmail: String(normalizedPayload.authorEmail) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "file_updated",
        provider_action_id: `${repo}#${String(normalizedPayload.path ?? "")}`,
        repo,
        path: String(result.path ?? normalizedPayload.path ?? ""),
        sha: String(result.sha ?? ""),
      };
    },

    "github.createLabel": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      enforceRepoAllowlist(context, repo);
      const label = await sdk.createLabel({
        accessToken,
        namespace,
        repo,
        name: String(normalizedPayload.name ?? ""),
        color: String(normalizedPayload.color ?? "").toLowerCase(),
        ...(normalizedPayload.description !== undefined
          ? { description: String(normalizedPayload.description) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "label_created",
        provider_action_id: String(label.id ?? `${repo}#label`),
        repo,
        name: String(label.name ?? normalizedPayload.name ?? ""),
      };
    },

    "github.triggerWorkflow": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      enforceRepoAllowlist(context, repo);
      const response = await sdk.triggerWorkflow({
        accessToken,
        namespace,
        repo,
        workflowId: String(normalizedPayload.workflowId ?? ""),
        ref: String(normalizedPayload.ref ?? ""),
        inputs: asStringRecord(normalizedPayload.inputs),
        idempotencyKey,
      });
      return {
        status: "workflow_triggered",
        provider_action_id: String(
          response.runId ?? `${repo}#${String(normalizedPayload.workflowId ?? "")}#dispatch`,
        ),
        repo,
        workflowId: String(normalizedPayload.workflowId ?? ""),
        runId: Number(response.runId ?? 0),
      };
    },

    "github.cancelWorkflowRun": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const runId = Number(normalizedPayload.runId ?? 0);
      enforceRepoAllowlist(context, repo);
      await sdk.cancelWorkflowRun({
        accessToken,
        namespace,
        repo,
        runId,
        idempotencyKey,
      });
      return {
        status: "workflow_cancel_requested",
        provider_action_id: `${repo}#run#${runId}`,
        repo,
        runId,
      };
    },

    "github.rerunWorkflow": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const runId = Number(normalizedPayload.runId ?? 0);
      enforceRepoAllowlist(context, repo);
      await sdk.rerunWorkflow({
        accessToken,
        namespace,
        repo,
        runId,
        ...(normalizedPayload.enableDebugLogging !== undefined
          ? { enableDebugLogging: Boolean(normalizedPayload.enableDebugLogging) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "workflow_rerun_requested",
        provider_action_id: `${repo}#run#${runId}`,
        repo,
        runId,
      };
    },

    "github.markNotificationsRead": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const response = await sdk.markNotificationsRead({
        accessToken,
        namespace,
        ...(normalizedPayload.lastReadAt !== undefined
          ? { lastReadAt: String(normalizedPayload.lastReadAt) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "notifications_marked_read",
        provider_action_id: `github#notifications#${String(response.last_read_at ?? "all")}`,
        marked: Boolean(response.marked ?? true),
      };
    },

    "github.rerunFailedJobs": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const runId = Number(normalizedPayload.runId ?? 0);
      enforceRepoAllowlist(context, repo);
      await sdk.rerunFailedJobs({
        accessToken,
        namespace,
        repo,
        runId,
        ...(normalizedPayload.enableDebugLogging !== undefined
          ? { enableDebugLogging: Boolean(normalizedPayload.enableDebugLogging) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "workflow_failed_jobs_rerun_requested",
        provider_action_id: `${repo}#run#${runId}#rerun-failed`,
        repo,
        runId,
      };
    },

    "github.updatePRBranch": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const pullNumber = Number(normalizedPayload.pullNumber ?? 0);
      enforceRepoAllowlist(context, repo);
      await sdk.updatePRBranch({
        accessToken,
        namespace,
        repo,
        pullNumber,
        ...(normalizedPayload.expectedHeadSha !== undefined
          ? { expectedHeadSha: String(normalizedPayload.expectedHeadSha) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "pull_request_branch_update_requested",
        provider_action_id: `${repo}#pull#${pullNumber}#branch`,
        repo,
        pullNumber,
      };
    },

    "github.createReaction": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const issue = Number(normalizedPayload.issue ?? 0);
      enforceRepoAllowlist(context, repo);
      const reaction = await sdk.createReaction({
        accessToken,
        namespace,
        repo,
        issue,
        content: String(normalizedPayload.content ?? "") as
          | "+1"
          | "-1"
          | "laugh"
          | "confused"
          | "heart"
          | "hooray"
          | "rocket"
          | "eyes",
        idempotencyKey,
      });
      return {
        status: "reaction_created",
        provider_action_id: String(reaction.id ?? `${repo}#${issue}#reaction`),
        repo,
        issue,
        reactionId: Number(reaction.id ?? 0),
      };
    },

    "github.deleteReaction": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const issue = Number(normalizedPayload.issue ?? 0);
      const reactionId = Number(normalizedPayload.reactionId ?? 0);
      enforceRepoAllowlist(context, repo);
      const result = await sdk.deleteReaction({
        accessToken,
        namespace,
        repo,
        issue,
        reactionId,
        idempotencyKey,
      });
      return {
        status: "reaction_deleted",
        provider_action_id: String(result.id ?? `${repo}#reaction#${reactionId}`),
        repo,
        issue,
        reactionId,
        deleted: Boolean(result.deleted),
      };
    },

    "github.createDispatchEvent": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      enforceRepoAllowlist(context, repo);
      await sdk.createDispatchEvent({
        accessToken,
        namespace,
        repo,
        eventType: String(normalizedPayload.eventType ?? ""),
        clientPayload:
          normalizedPayload.clientPayload &&
          typeof normalizedPayload.clientPayload === "object" &&
          !Array.isArray(normalizedPayload.clientPayload)
            ? (normalizedPayload.clientPayload as Record<string, unknown>)
            : {},
        idempotencyKey,
      });
      return {
        status: "dispatch_event_created",
        provider_action_id: `${repo}#dispatch#${String(normalizedPayload.eventType ?? "")}`,
        repo,
        eventType: String(normalizedPayload.eventType ?? ""),
      };
    },

    "github.updatePullRequest": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const pullNumber = Number(normalizedPayload.pullNumber ?? 0);
      enforceRepoAllowlist(context, repo);
      const updated = await sdk.updatePullRequest({
        accessToken,
        namespace,
        repo,
        pullNumber,
        ...(normalizedPayload.title !== undefined
          ? { title: String(normalizedPayload.title) }
          : {}),
        ...(normalizedPayload.body !== undefined ? { body: String(normalizedPayload.body) } : {}),
        ...(normalizedPayload.state !== undefined
          ? {
              state:
                String(normalizedPayload.state) === "closed"
                  ? ("closed" as const)
                  : ("open" as const),
            }
          : {}),
        ...(normalizedPayload.base !== undefined ? { base: String(normalizedPayload.base) } : {}),
        idempotencyKey,
      });
      return {
        status: "pull_request_updated",
        provider_action_id: String(updated.id ?? `${repo}#${pullNumber}`),
        repo,
        pullNumber,
      };
    },

    "github.updateComment": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const commentId = Number(normalizedPayload.commentId ?? 0);
      enforceRepoAllowlist(context, repo);
      const comment = await sdk.updateComment({
        accessToken,
        namespace,
        repo,
        commentId,
        body: String(normalizedPayload.body ?? ""),
        idempotencyKey,
      });
      return {
        status: "comment_updated",
        provider_action_id: String(comment.id ?? `${repo}#comment#${commentId}`),
        repo,
        commentId,
      };
    },

    "github.deleteComment": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const commentId = Number(normalizedPayload.commentId ?? 0);
      enforceRepoAllowlist(context, repo);
      const result = await sdk.deleteComment({
        accessToken,
        namespace,
        repo,
        commentId,
        idempotencyKey,
      });
      return {
        status: "comment_deleted",
        provider_action_id: String(result.id ?? `${repo}#comment#${commentId}`),
        repo,
        commentId,
        deleted: Boolean(result.deleted),
      };
    },

    "github.createRelease": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      enforceRepoAllowlist(context, repo);
      const release = await sdk.createRelease({
        accessToken,
        namespace,
        repo,
        tagName: String(normalizedPayload.tagName ?? ""),
        ...(normalizedPayload.targetCommitish !== undefined
          ? { targetCommitish: String(normalizedPayload.targetCommitish) }
          : {}),
        ...(normalizedPayload.name !== undefined ? { name: String(normalizedPayload.name) } : {}),
        ...(normalizedPayload.body !== undefined ? { body: String(normalizedPayload.body) } : {}),
        ...(normalizedPayload.draft !== undefined
          ? { draft: Boolean(normalizedPayload.draft) }
          : {}),
        ...(normalizedPayload.prerelease !== undefined
          ? { prerelease: Boolean(normalizedPayload.prerelease) }
          : {}),
        ...(normalizedPayload.generateReleaseNotes !== undefined
          ? { generateReleaseNotes: Boolean(normalizedPayload.generateReleaseNotes) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "release_created",
        provider_action_id: String(release.id ?? `${repo}#release`),
        repo,
        releaseId: Number(release.id ?? 0),
        tagName: String(release.tag_name ?? normalizedPayload.tagName ?? ""),
      };
    },

    "github.updateRelease": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const releaseId = Number(normalizedPayload.releaseId ?? 0);
      enforceRepoAllowlist(context, repo);
      const release = await sdk.updateRelease({
        accessToken,
        namespace,
        repo,
        releaseId,
        ...(normalizedPayload.tagName !== undefined
          ? { tagName: String(normalizedPayload.tagName) }
          : {}),
        ...(normalizedPayload.targetCommitish !== undefined
          ? { targetCommitish: String(normalizedPayload.targetCommitish) }
          : {}),
        ...(normalizedPayload.name !== undefined ? { name: String(normalizedPayload.name) } : {}),
        ...(normalizedPayload.body !== undefined ? { body: String(normalizedPayload.body) } : {}),
        ...(normalizedPayload.draft !== undefined
          ? { draft: Boolean(normalizedPayload.draft) }
          : {}),
        ...(normalizedPayload.prerelease !== undefined
          ? { prerelease: Boolean(normalizedPayload.prerelease) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "release_updated",
        provider_action_id: String(release.id ?? `${repo}#release#${releaseId}`),
        repo,
        releaseId: Number(release.id ?? releaseId),
        tagName: String(release.tag_name ?? normalizedPayload.tagName ?? ""),
      };
    },

    "github.generateReleaseNotes": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      enforceRepoAllowlist(context, repo);
      const notes = await sdk.generateReleaseNotes({
        accessToken,
        namespace,
        repo,
        tagName: String(normalizedPayload.tagName ?? ""),
        ...(normalizedPayload.targetCommitish !== undefined
          ? { targetCommitish: String(normalizedPayload.targetCommitish) }
          : {}),
        ...(normalizedPayload.previousTagName !== undefined
          ? { previousTagName: String(normalizedPayload.previousTagName) }
          : {}),
        ...(normalizedPayload.configurationFilePath !== undefined
          ? { configurationFilePath: String(normalizedPayload.configurationFilePath) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "release_notes_generated",
        provider_action_id: `${repo}#${String(normalizedPayload.tagName ?? "")}`,
        repo,
        tagName: String(normalizedPayload.tagName ?? ""),
        notes,
      };
    },

    "github.createMilestone": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      enforceRepoAllowlist(context, repo);
      const milestone = await sdk.createMilestone({
        accessToken,
        namespace,
        repo,
        title: String(normalizedPayload.title ?? ""),
        ...(normalizedPayload.state !== undefined
          ? {
              state:
                String(normalizedPayload.state) === "closed"
                  ? ("closed" as const)
                  : ("open" as const),
            }
          : {}),
        ...(normalizedPayload.description !== undefined
          ? { description: String(normalizedPayload.description) }
          : {}),
        ...(normalizedPayload.dueOn !== undefined
          ? { dueOn: String(normalizedPayload.dueOn) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "milestone_created",
        provider_action_id: String(milestone.id ?? `${repo}#milestone`),
        repo,
        milestone: Number(milestone.number ?? 0),
        title: String(milestone.title ?? normalizedPayload.title ?? ""),
      };
    },

    "github.updateMilestone": async ({
      normalizedPayload,
      accessToken,
      namespace,
      context,
      idempotencyKey,
    }) => {
      const repo = String(normalizedPayload.repo ?? "");
      const milestoneNumber = Number(normalizedPayload.milestone ?? 0);
      enforceRepoAllowlist(context, repo);
      const milestone = await sdk.updateMilestone({
        accessToken,
        namespace,
        repo,
        milestone: milestoneNumber,
        ...(normalizedPayload.title !== undefined
          ? { title: String(normalizedPayload.title) }
          : {}),
        ...(normalizedPayload.state !== undefined
          ? {
              state:
                String(normalizedPayload.state) === "closed"
                  ? ("closed" as const)
                  : ("open" as const),
            }
          : {}),
        ...(normalizedPayload.description !== undefined
          ? { description: String(normalizedPayload.description) }
          : {}),
        ...(normalizedPayload.dueOn !== undefined
          ? { dueOn: String(normalizedPayload.dueOn) }
          : {}),
        idempotencyKey,
      });
      return {
        status: "milestone_updated",
        provider_action_id: String(milestone.id ?? `${repo}#milestone#${milestoneNumber}`),
        repo,
        milestone: Number(milestone.number ?? milestoneNumber),
        state: String(milestone.state ?? "open"),
      };
    },
  };

  class GithubConnector extends BaseConnector<
    GithubReadDispatchInput,
    GithubPrepareDispatchInput,
    GithubWriteDispatchInput,
    typeof githubTools
  > {
    constructor() {
      super({
        provider: "github",
        tools: githubTools,
        requiredScopesByTool,
        readMap,
        prepareMap,
        writeMap,
      });
    }

    protected getToken(context: ConnectorContext): string {
      return getToken(context);
    }

    protected buildReadDispatchInput(
      _toolName: string,
      validated: Record<string, unknown>,
      context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): GithubReadDispatchInput {
      return {
        validated,
        accessToken: runtime.accessToken,
        namespace: runtime.namespace,
        context,
      };
    }

    protected buildPrepareDispatchInput(
      _toolName: string,
      validated: Record<string, unknown>,
      context: ConnectorContext,
    ): GithubPrepareDispatchInput {
      return {
        validated,
        context,
      };
    }

    protected buildWriteDispatchInput(
      toolName: string,
      normalizedPayload: Record<string, unknown>,
      context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): GithubWriteDispatchInput {
      return {
        normalizedPayload,
        accessToken: runtime.accessToken,
        namespace: runtime.namespace,
        context,
        idempotencyKey: buildProviderIdempotencyKey(toolName, normalizedPayload),
      };
    }

    protected override unsupportedToolMessage(
      phase: "read" | "prepare" | "write",
      toolName: string,
    ): string {
      if (phase === "read") {
        return `Unsupported GitHub read tool ${toolName}`;
      }
      return `Unsupported GitHub write tool ${toolName}`;
    }
  }

  return new GithubConnector();
};
const connector = createGithubConnector();

export default connector;
