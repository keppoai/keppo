import { BaseFakeClient } from "../base-fake-client.js";
import { createFakeProviderSdkErrorFactory, matchErrorCodes } from "../fake-error.js";
import { ProviderSdkError, type ProviderSdkCallLog } from "../port.js";
import {
  buildSearchIssueFromIssue,
  buildSearchIssueFromPullRequest,
  seedGithubBranches,
  seedGithubCheckRuns,
  seedGithubCommitStatus,
  seedGithubCommits,
  seedGithubCodeSearchResults,
  seedGithubFileContents,
  seedGithubCompareCommits,
  seedGithubIssueEvents,
  seedGithubIssueTimeline,
  seedGithubIssueComments,
  seedGithubIssues,
  seedGithubLabels,
  seedGithubMilestones,
  seedGithubNotifications,
  seedGithubPullRequestFiles,
  seedGithubPullRequestReviews,
  seedGithubPullRequests,
  seedGithubReleases,
  seedGithubRepo,
  seedGithubRepoSearchResults,
  seedGithubWorkflowRuns,
} from "./fixtures.js";
import type {
  GithubAddAssigneesArgs,
  GithubAddLabelsArgs,
  GithubCancelWorkflowRunArgs,
  GithubCreateDispatchEventArgs,
  GithubBranch,
  GithubCheckRun,
  GithubCommit,
  GithubCommitStatus,
  GithubCompareCommitsArgs,
  GithubCompareCommitsResult,
  GithubCreateLabelArgs,
  GithubCreateOrUpdateFileArgs,
  GithubCreateReviewArgs,
  GithubCreateReviewCommentArgs,
  GithubCreateReactionArgs,
  GithubCreateIssueArgs,
  GithubCreateIssueCommentArgs,
  GithubCreatePullRequestArgs,
  GithubDeleteCommentArgs,
  GithubDeleteReactionArgs,
  GithubDeleteResult,
  GithubDismissReviewArgs,
  GithubGetWorkflowJobLogsArgs,
  GithubGetIssueArgs,
  GithubGetFileContentsArgs,
  GithubGetLatestReleaseArgs,
  GithubGetCommitStatusArgs,
  GithubListIssueEventsArgs,
  GithubListIssueTimelineArgs,
  GithubListNotificationsArgs,
  GithubListOrgReposArgs,
  GithubListBranchesArgs,
  GithubListLabelsArgs,
  GithubListMilestonesArgs,
  GithubGetPullRequestArgs,
  GithubGetRepoArgs,
  GithubListReleasesArgs,
  GithubGetWorkflowRunArgs,
  GithubCodeSearchResult,
  GithubRepo,
  GithubRepoSearchResult,
  GithubFileContents,
  GithubFileWriteResult,
  GithubIssueEvent,
  GithubIssueTimelineEvent,
  GithubIssue,
  GithubIssueComment,
  GithubLabel,
  GithubNotification,
  GithubListCheckRunsArgs,
  GithubListCommitsArgs,
  GithubListIssueCommentsArgs,
  GithubListIssuesArgs,
  GithubMilestone,
  GithubListPullRequestFilesArgs,
  GithubListPullRequestCommitsArgs,
  GithubListPullRequestsArgs,
  GithubListReviewsArgs,
  GithubListWorkflowRunsArgs,
  GithubMergePullRequestArgs,
  GithubMergeResult,
  GithubPullRequest,
  GithubPullRequestFile,
  GithubPullRequestReview,
  GithubReaction,
  GithubRelease,
  GithubRequestReviewersArgs,
  GithubRerunFailedJobsArgs,
  GithubRerunWorkflowArgs,
  GithubCreateReleaseArgs,
  GithubCreateMilestoneArgs,
  GithubGenerateReleaseNotesArgs,
  GithubLockIssueArgs,
  GithubMarkNotificationsReadArgs,
  GithubRemoveAssigneesArgs,
  GithubRemoveLabelArgs,
  GithubRemoveReviewersArgs,
  GithubSearchCodeArgs,
  GithubReviewComment,
  GithubSearchRepositoriesArgs,
  GithubSearchIssue,
  GithubSearchIssuesArgs,
  GithubSdkPort,
  GithubTriggerWorkflowArgs,
  GithubUnlockIssueArgs,
  GithubUpdateCommentArgs,
  GithubUpdatePRBranchArgs,
  GithubUpdateIssueArgs,
  GithubUpdateReleaseArgs,
  GithubUpdateMilestoneArgs,
  GithubUpdatePullRequestArgs,
  GithubWorkflowJobLogs,
  GithubWorkflowRun,
} from "./types.js";
import type { CreateGithubClient } from "./client-interface.js";
import { createFakeGithubClient } from "./fake-client-adapter.js";

type GithubNamespaceState = {
  issueCount: number;
  commentCount: number;
  pullRequestCount: number;
  reviewCount: number;
  reviewCommentCount: number;
  workflowRunCount: number;
  mergeCount: number;
  reactionCount: number;
  releaseCount: number;
  milestoneCount: number;
  labelCount: number;
  fileRevisionCount: number;
  commitCount: number;
  issuesByRepo: Map<string, GithubIssue[]>;
  branchesByRepo: Map<string, GithubBranch[]>;
  fileContentsByRepoAndPath: Map<string, GithubFileContents>;
  labelsByRepo: Map<string, GithubLabel[]>;
  issueCommentsByRepoAndIssue: Map<string, GithubIssueComment[]>;
  pullRequestsByRepo: Map<string, GithubPullRequest[]>;
  pullRequestFilesByRepoAndNumber: Map<string, GithubPullRequestFile[]>;
  pullRequestReviewsByRepoAndNumber: Map<string, GithubPullRequestReview[]>;
  releasesByRepo: Map<string, GithubRelease[]>;
  milestonesByRepo: Map<string, GithubMilestone[]>;
  commitsByRepo: Map<string, GithubCommit[]>;
  checkRunsByRepoAndRef: Map<string, GithubCheckRun[]>;
  commitStatusByRepoAndRef: Map<string, GithubCommitStatus>;
  workflowRunsByRepo: Map<string, GithubWorkflowRun[]>;
  notificationsByRepo: Map<string, GithubNotification[]>;
  reactionsByRepoAndIssue: Map<string, GithubReaction[]>;
  reposByName: Map<string, GithubRepo>;
  idempotentResponses: Map<string, unknown>;
};

const DEFAULT_REPO = "org/repo";

const toProviderSdkError = createFakeProviderSdkErrorFactory("github", [
  {
    match: matchErrorCodes("missing_access_token", "invalid_access_token"),
    category: "auth",
    code: "invalid_token",
    status: 401,
    retryable: false,
  },
  {
    match: matchErrorCodes(
      "issue_not_found",
      "pull_request_not_found",
      "repo_not_found",
      "not_found",
    ),
    category: "not_found",
    code: "not_found",
    status: 404,
    retryable: false,
  },
  {
    match: matchErrorCodes("rate_limited"),
    category: "rate_limit",
    code: "rate_limited",
    status: 429,
    retryable: true,
  },
]);

const toTrimmedStringArray = (value: unknown): string[] => {
  return Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
    : [];
};

const toLabels = (value: string[]): GithubLabel[] => {
  return value.map((name, index) => ({
    id: index + 1,
    name,
    color: "ededed",
    description: "",
  }));
};

const toLabelNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        names.push(trimmed);
      }
      continue;
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (name.length > 0) {
        names.push(name);
      }
    }
  }
  return names;
};

const toAssignees = (value: string[]): Array<Record<string, unknown>> => {
  return value.map((login) => ({ login }));
};

const toAssigneeLogins = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const logins: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        logins.push(trimmed);
      }
      continue;
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      const login = typeof record.login === "string" ? record.login.trim() : "";
      if (login.length > 0) {
        logins.push(login);
      }
    }
  }
  return logins;
};

const cloneGithubEntity = <T extends object>(value: T): T => ({ ...value });
const isSeedRecord = (entry: unknown): entry is Record<string, unknown> =>
  !!entry && typeof entry === "object" && !Array.isArray(entry);

const mapSeedEntries = <T>(
  value: unknown,
  map: (entry: Record<string, unknown>) => T,
): T[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter(isSeedRecord).map(map);
};

export class InMemoryGithubEngine
  extends BaseFakeClient<GithubNamespaceState>
  implements GithubSdkPort
{
  constructor(options?: { callLog?: ProviderSdkCallLog }) {
    super({
      providerId: "github",
      ...(options?.callLog ? { callLog: options.callLog } : {}),
    });
  }

  async listIssues(args: GithubListIssuesArgs): Promise<GithubIssue[]> {
    return this.listRepoPageFiltered(
      args,
      "github.issues.listForRepo",
      { state: args.state },
      (state) => this.getOrCreateIssues(state, args.repo),
      (issue) => this.matchesStateFilter(issue.state, args.state),
    );
  }

  async getIssue(args: GithubGetIssueArgs): Promise<GithubIssue> {
    return this.getRepoEntity(args, "github.issues.get", { issue: args.issue }, (state) =>
      this.findIssue(state, args.repo, args.issue),
    );
  }

  async listIssueEvents(args: GithubListIssueEventsArgs): Promise<GithubIssueEvent[]> {
    return this.runGithubOperation(
      args,
      "github.issues.listEvents",
      this.withRepoArgs(args, {
        issue: args.issue,
        perPage: args.perPage,
      }),
      (state) => {
        const issue = this.findIssue(state, args.repo, args.issue);
        const repoKey = this.normalizeRepo(args.repo);
        const events = seedGithubIssueEvents(repoKey, Number(issue.number ?? args.issue));
        return this.takePage(events, args.perPage, cloneGithubEntity);
      },
    );
  }

  async listIssueTimeline(args: GithubListIssueTimelineArgs): Promise<GithubIssueTimelineEvent[]> {
    return this.runGithubOperation(
      args,
      "github.issues.listEventsForTimeline",
      this.withRepoArgs(args, {
        issue: args.issue,
        perPage: args.perPage,
      }),
      (state) => {
        const issue = this.findIssue(state, args.repo, args.issue);
        const repoKey = this.normalizeRepo(args.repo);
        const timeline = seedGithubIssueTimeline(repoKey, Number(issue.number ?? args.issue));
        return this.takePage(timeline, args.perPage, cloneGithubEntity);
      },
    );
  }

  async createIssue(args: GithubCreateIssueArgs): Promise<GithubIssue> {
    return this.runGithubCachedOperation(
      args,
      "github.issues.create",
      this.withRepoArgs(args, {
        title: args.title,
        body: args.body ?? "",
        labels: args.labels ?? [],
        assignees: args.assignees ?? [],
      }),
      (state) => {
        const repoKey = this.normalizeRepo(args.repo);
        const issues = this.getOrCreateIssues(state, repoKey);
        const nextIssueNumber = this.getNextIssueNumber(state, issues);
        const labelNames = toTrimmedStringArray(args.labels);
        const assigneeLogins = toTrimmedStringArray(args.assignees);
        const created: GithubIssue = {
          id: state.issueCount,
          number: nextIssueNumber,
          title: args.title,
          body: args.body ?? "",
          state: "open",
          html_url: `https://example.test/${repoKey}/issues/${nextIssueNumber}`,
          labels: toLabels(labelNames),
          assignees: toAssignees(assigneeLogins),
        };

        issues.unshift(created);
        return cloneGithubEntity(created);
      },
    );
  }

  async updateIssue(args: GithubUpdateIssueArgs): Promise<GithubIssue> {
    return this.runGithubCachedOperation(
      args,
      "github.issues.update",
      this.withRepoArgs(args, {
        issue: args.issue,
        title: args.title,
        body: args.body,
        state: args.state,
        labels: args.labels,
        assignees: args.assignees,
      }),
      (state) => {
        const issue = this.findIssue(state, args.repo, args.issue);
        this.assignDefined(issue, {
          title: args.title,
          body: args.body,
          state: args.state,
        });
        if (args.labels !== undefined) {
          issue.labels = toLabels(toTrimmedStringArray(args.labels));
        }
        if (args.assignees !== undefined) {
          issue.assignees = toAssignees(toTrimmedStringArray(args.assignees));
        }

        return cloneGithubEntity(issue);
      },
    );
  }

  async createIssueComment(args: GithubCreateIssueCommentArgs): Promise<GithubIssueComment> {
    return this.runGithubCachedOperation(
      args,
      "github.issues.createComment",
      this.withRepoArgs(args, {
        issue: args.issue,
        body: args.body,
      }),
      (state) => {
        this.findIssue(state, args.repo, args.issue);

        state.commentCount += 1;
        const repoKey = this.normalizeRepo(args.repo);
        const response: GithubIssueComment = {
          id: state.commentCount + 600,
          body: args.body,
          html_url: `https://example.test/${repoKey}/issues/${args.issue}#issuecomment-${state.commentCount + 600}`,
          issue_url: `https://example.test/api/repos/${repoKey}/issues/${args.issue}`,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        };
        const comments = this.getOrCreateIssueComments(state, repoKey, args.issue);
        comments.unshift(response);
        return { ...response };
      },
    );
  }

  async listPullRequests(args: GithubListPullRequestsArgs): Promise<GithubPullRequest[]> {
    return this.listRepoPageFiltered(
      args,
      "github.pulls.list",
      { state: args.state },
      (state) => this.getOrCreatePullRequests(state, args.repo),
      (pullRequest) => this.matchesStateFilter(pullRequest.state, args.state),
    );
  }

  async getPullRequest(args: GithubGetPullRequestArgs): Promise<GithubPullRequest> {
    return this.getRepoEntity(args, "github.pulls.get", { pullNumber: args.pullNumber }, (state) =>
      this.findPullRequest(state, args.repo, args.pullNumber),
    );
  }

  async createPullRequest(args: GithubCreatePullRequestArgs): Promise<GithubPullRequest> {
    return this.runGithubCachedOperation(
      args,
      "github.pulls.create",
      this.withRepoArgs(args, {
        title: args.title,
        head: args.head,
        base: args.base,
        body: args.body ?? "",
      }),
      (state) => {
        const repoKey = this.normalizeRepo(args.repo);
        const pullRequests = this.getOrCreatePullRequests(state, repoKey);
        state.pullRequestCount += 1;
        const nextPullNumber =
          pullRequests.reduce(
            (max, pullRequest) => Math.max(max, Number(pullRequest.number ?? 0)),
            0,
          ) + 1;

        const created: GithubPullRequest = {
          id: state.pullRequestCount + 100,
          number: nextPullNumber,
          state: "open",
          title: args.title,
          body: args.body ?? "",
          html_url: `https://example.test/${repoKey}/pull/${nextPullNumber}`,
          merged: false,
          head: {
            ref: args.head,
            sha: `head_${nextPullNumber}`,
          },
          base: {
            ref: args.base,
            sha: `base_${nextPullNumber}`,
          },
        };

        pullRequests.unshift(created);
        state.pullRequestFilesByRepoAndNumber.set(
          this.pullRequestFilesKey(repoKey, nextPullNumber),
          [
            {
              sha: `new_${nextPullNumber}`,
              filename: "README.md",
              status: "modified",
              additions: 4,
              deletions: 1,
              changes: 5,
              blob_url: `https://example.test/blob/new_${nextPullNumber}`,
            },
          ],
        );

        return cloneGithubEntity(created);
      },
    );
  }

  async mergePullRequest(args: GithubMergePullRequestArgs): Promise<GithubMergeResult> {
    return this.runGithubCachedOperation(
      args,
      "github.pulls.merge",
      this.withRepoArgs(args, {
        pullNumber: args.pullNumber,
        mergeMethod: args.mergeMethod ?? "merge",
        commitTitle: args.commitTitle ?? "",
      }),
      (state) => {
        const pullRequest = this.findPullRequest(state, args.repo, args.pullNumber);
        if (String(pullRequest.state ?? "open") !== "open") {
          throw new Error("pull_request_not_mergeable");
        }

        state.mergeCount += 1;
        pullRequest.state = "closed";
        pullRequest.merged = true;
        return {
          sha: `merge_sha_${args.pullNumber}_${state.mergeCount}`,
          merged: true,
          message: "Pull Request successfully merged",
        };
      },
    );
  }

  async listPullRequestFiles(
    args: GithubListPullRequestFilesArgs,
  ): Promise<GithubPullRequestFile[]> {
    return this.runGithubOperation(
      args,
      "github.pulls.listFiles",
      this.withRepoArgs(args, {
        pullNumber: args.pullNumber,
        perPage: args.perPage,
      }),
      (state) => {
        this.findPullRequest(state, args.repo, args.pullNumber);

        const repoKey = this.normalizeRepo(args.repo);
        const files = this.getOrCreatePullRequestFiles(state, repoKey, args.pullNumber);
        return this.takePage(files, args.perPage, cloneGithubEntity);
      },
    );
  }

  async addLabels(args: GithubAddLabelsArgs): Promise<GithubLabel[]> {
    return this.runGithubCachedOperation(
      args,
      "github.issues.addLabels",
      this.withRepoArgs(args, {
        issue: args.issue,
        labels: args.labels,
      }),
      (state) =>
        this.updateIssueLabels(state, args.repo, args.issue, (current) => {
          for (const label of toTrimmedStringArray(args.labels)) {
            current.add(label);
          }
        }),
    );
  }

  async removeLabel(args: GithubRemoveLabelArgs): Promise<GithubLabel[]> {
    return this.runGithubCachedOperation(
      args,
      "github.issues.removeLabel",
      this.withRepoArgs(args, {
        issue: args.issue,
        label: args.label,
      }),
      (state) =>
        this.updateIssueLabels(state, args.repo, args.issue, (current) => {
          current.delete(args.label);
        }),
    );
  }

  async addAssignees(args: GithubAddAssigneesArgs): Promise<GithubIssue> {
    return this.runGithubCachedOperation(
      args,
      "github.issues.addAssignees",
      this.withRepoArgs(args, {
        issue: args.issue,
        assignees: args.assignees,
      }),
      (state) =>
        this.updateIssueAssignees(state, args.repo, args.issue, (current) => {
          for (const assignee of toTrimmedStringArray(args.assignees)) {
            current.add(assignee);
          }
        }),
    );
  }

  async removeAssignees(args: GithubRemoveAssigneesArgs): Promise<GithubIssue> {
    return this.runGithubCachedOperation(
      args,
      "github.issues.removeAssignees",
      this.withRepoArgs(args, {
        issue: args.issue,
        assignees: args.assignees,
      }),
      (state) =>
        this.updateIssueAssignees(state, args.repo, args.issue, (current) => {
          for (const assignee of toTrimmedStringArray(args.assignees)) {
            current.delete(assignee);
          }
        }),
    );
  }

  async searchIssues(args: GithubSearchIssuesArgs): Promise<GithubSearchIssue[]> {
    return this.runGithubOperation(
      args,
      "github.search.issuesAndPullRequests",
      this.withNamespaceArgs(args, {
        query: args.query,
        perPage: args.perPage,
      }),
      (state) => {
        const repoFilters = this.extractRepoFilters(args.query);
        const terms = this.extractSearchTerms(args.query);
        const candidateRepos =
          repoFilters.length > 0
            ? repoFilters.map((repo) => this.normalizeRepo(repo))
            : [...state.reposByName.keys()];

        const results: GithubSearchIssue[] = [];
        for (const repo of candidateRepos) {
          this.ensureRepoState(state, repo);
          const issues = this.getOrCreateIssues(state, repo);
          const pulls = this.getOrCreatePullRequests(state, repo);

          for (const issue of issues) {
            if (!this.matchesSearchTerms(issue, terms)) {
              continue;
            }
            results.push(buildSearchIssueFromIssue(issue, repo));
          }

          for (const pullRequest of pulls) {
            if (!this.matchesSearchTerms(pullRequest, terms)) {
              continue;
            }
            results.push(buildSearchIssueFromPullRequest(pullRequest, repo));
          }
        }

        return this.takePage(results, args.perPage, (result) => ({ ...result }));
      },
    );
  }

  async createReview(args: GithubCreateReviewArgs): Promise<GithubPullRequestReview> {
    return this.runGithubCachedOperation(
      args,
      "github.pulls.createReview",
      this.withRepoArgs(args, {
        pullNumber: args.pullNumber,
        event: args.event,
        body: args.body ?? "",
        commitId: args.commitId,
      }),
      (state) => {
        this.findPullRequest(state, args.repo, args.pullNumber);
        state.reviewCount += 1;
        const repoKey = this.normalizeRepo(args.repo);
        const response: GithubPullRequestReview = {
          id: state.reviewCount + 300,
          body: args.body ?? "",
          state: args.event,
          pull_request_url: `https://example.test/${repoKey}/pull/${args.pullNumber}`,
          dismissed: false,
        };
        const reviews = this.getOrCreatePullRequestReviews(state, repoKey, args.pullNumber);
        reviews.unshift(response);

        return cloneGithubEntity(response);
      },
    );
  }

  async listReviews(args: GithubListReviewsArgs): Promise<GithubPullRequestReview[]> {
    return this.runGithubOperation(
      args,
      "github.pulls.listReviews",
      this.withRepoArgs(args, {
        pullNumber: args.pullNumber,
        perPage: args.perPage,
      }),
      (state) => {
        this.findPullRequest(state, args.repo, args.pullNumber);
        const repoKey = this.normalizeRepo(args.repo);
        const reviews = this.getOrCreatePullRequestReviews(state, repoKey, args.pullNumber);
        return this.takePage(reviews, args.perPage, cloneGithubEntity);
      },
    );
  }

  async dismissReview(args: GithubDismissReviewArgs): Promise<GithubPullRequestReview> {
    return this.runGithubCachedOperation(
      args,
      "github.pulls.dismissReview",
      this.withRepoArgs(args, {
        pullNumber: args.pullNumber,
        reviewId: args.reviewId,
        message: args.message,
      }),
      (state) => {
        this.findPullRequest(state, args.repo, args.pullNumber);
        const repoKey = this.normalizeRepo(args.repo);
        const reviews = this.getOrCreatePullRequestReviews(state, repoKey, args.pullNumber);
        const review = reviews.find((entry) => Number(entry.id ?? 0) === args.reviewId);
        if (!review) {
          throw new Error("review_not_found");
        }
        review.dismissed = true;
        review.state = "DISMISSED";
        review.body = args.message;

        return cloneGithubEntity(review);
      },
    );
  }

  async requestReviewers(args: GithubRequestReviewersArgs): Promise<GithubPullRequest> {
    return this.runGithubCachedOperation(
      args,
      "github.pulls.requestReviewers",
      this.withRepoArgs(args, {
        pullNumber: args.pullNumber,
        reviewers: args.reviewers,
      }),
      (state) =>
        this.updatePullRequestReviewers(state, args.repo, args.pullNumber, (current) => {
          for (const reviewer of toTrimmedStringArray(args.reviewers)) {
            current.add(reviewer);
          }
        }),
    );
  }

  async removeReviewers(args: GithubRemoveReviewersArgs): Promise<GithubPullRequest> {
    return this.runGithubCachedOperation(
      args,
      "github.pulls.removeRequestedReviewers",
      this.withRepoArgs(args, {
        pullNumber: args.pullNumber,
        reviewers: args.reviewers,
      }),
      (state) =>
        this.updatePullRequestReviewers(state, args.repo, args.pullNumber, (current) => {
          for (const reviewer of toTrimmedStringArray(args.reviewers)) {
            current.delete(reviewer);
          }
        }),
    );
  }

  async createReviewComment(args: GithubCreateReviewCommentArgs): Promise<GithubReviewComment> {
    return this.runGithubCachedOperation(
      args,
      "github.pulls.createReviewComment",
      this.withRepoArgs(args, {
        pullNumber: args.pullNumber,
        body: args.body,
        path: args.path,
        line: args.line,
        commitId: args.commitId,
      }),
      (state) => {
        this.findPullRequest(state, args.repo, args.pullNumber);
        state.reviewCommentCount += 1;
        const response: GithubReviewComment = {
          id: state.reviewCommentCount + 700,
          body: args.body,
          path: args.path,
          line: args.line,
          pull_request_review_id: null,
          html_url: `https://example.test/${this.normalizeRepo(args.repo)}/pull/${args.pullNumber}#discussion_r${state.reviewCommentCount + 700}`,
        };

        return { ...response };
      },
    );
  }

  async listCommits(args: GithubListCommitsArgs): Promise<GithubCommit[]> {
    return this.listRepoPageFiltered(
      args,
      "github.repos.listCommits",
      {
        sha: args.sha,
      },
      (state) => this.getOrCreateCommits(state, args.repo),
      (commit) =>
        !(args.sha && args.sha.trim().length > 0) || String(commit.sha ?? "").startsWith(args.sha),
    );
  }

  async compareCommits(args: GithubCompareCommitsArgs): Promise<GithubCompareCommitsResult> {
    return this.runGithubOperation(
      args,
      "github.repos.compareCommits",
      this.withRepoArgs(args, {
        base: args.base,
        head: args.head,
      }),
      (state) => {
        const commits = this.getOrCreateCommits(state, args.repo).map(cloneGithubEntity);
        return {
          ...seedGithubCompareCommits(args.base, args.head),
          commits,
        };
      },
    );
  }

  async getCommitStatus(args: GithubGetCommitStatusArgs): Promise<GithubCommitStatus> {
    return this.getRepoEntity(
      args,
      "github.repos.getCombinedStatusForRef",
      { ref: args.ref },
      (state) => this.getOrCreateCommitStatus(state, args.repo, args.ref),
    );
  }

  async listCheckRuns(args: GithubListCheckRunsArgs): Promise<GithubCheckRun[]> {
    return this.listRepoPage(args, "github.checks.listForRef", { ref: args.ref }, (state) =>
      this.getOrCreateCheckRuns(state, args.repo, args.ref),
    );
  }

  async listWorkflowRuns(args: GithubListWorkflowRunsArgs): Promise<GithubWorkflowRun[]> {
    return this.listRepoPageFiltered(
      args,
      "github.actions.listWorkflowRunsForRepo",
      {
        branch: args.branch,
        status: args.status,
      },
      (state) => this.getOrCreateWorkflowRuns(state, args.repo),
      (run) => {
        const branchMatch =
          args.branch === undefined || String(run.head_branch ?? "") === String(args.branch);
        const statusMatch =
          args.status === undefined || String(run.status ?? "") === String(args.status);
        return branchMatch && statusMatch;
      },
    );
  }

  async getWorkflowRun(args: GithubGetWorkflowRunArgs): Promise<GithubWorkflowRun> {
    return this.getRepoEntity(
      args,
      "github.actions.getWorkflowRun",
      { runId: args.runId },
      (state) => this.findWorkflowRun(state, args.repo, args.runId),
    );
  }

  async listNotifications(args: GithubListNotificationsArgs): Promise<GithubNotification[]> {
    return this.runGithubOperation(
      args,
      "github.activity.listNotificationsForAuthenticatedUser",
      this.withNamespaceArgs(args, {
        all: args.all ?? false,
        participating: args.participating ?? false,
        since: args.since,
        before: args.before,
        perPage: args.perPage,
      }),
      (state) => {
        const notifications = this.getOrCreateNotifications(state, DEFAULT_REPO);
        const filtered = notifications.filter((notification) => {
          if (args.all === true) {
            return true;
          }
          return Boolean(notification.unread);
        });
        return this.takePage(filtered, args.perPage, cloneGithubEntity);
      },
    );
  }

  async getWorkflowJobLogs(args: GithubGetWorkflowJobLogsArgs): Promise<GithubWorkflowJobLogs> {
    return this.runGithubRepoOperation(
      args,
      "github.actions.downloadJobLogsForWorkflowRun",
      { jobId: args.jobId },
      (state) => {
        const repoKey = this.normalizeRepo(args.repo);
        return {
          job_id: args.jobId,
          download_url: `https://example.test/${repoKey}/actions/jobs/${args.jobId}/logs`,
        };
      },
    );
  }

  async triggerWorkflow(args: GithubTriggerWorkflowArgs): Promise<Record<string, unknown>> {
    return this.runGithubRepoIdempotentOperation(
      args,
      "github.actions.createWorkflowDispatch",
      {
        workflowId: args.workflowId,
        ref: args.ref,
        inputs: args.inputs ?? {},
      },
      (state) => {
        state.workflowRunCount += 1;
        const workflowRuns = this.getOrCreateWorkflowRuns(state, args.repo);
        const runId = state.workflowRunCount + 500;
        const created: GithubWorkflowRun = {
          id: runId,
          name: String(args.workflowId),
          status: "queued",
          conclusion: null,
          head_branch: args.ref,
          head_sha: args.ref,
          event: "workflow_dispatch",
        };
        workflowRuns.unshift(created);
        return {
          workflowId: args.workflowId,
          ref: args.ref,
          runId,
          dispatched: true,
        };
      },
    );
  }

  async cancelWorkflowRun(args: GithubCancelWorkflowRunArgs): Promise<Record<string, unknown>> {
    return this.updateWorkflowRunState(
      args,
      "github.actions.cancelWorkflowRun",
      {},
      {
        status: "cancelled",
        conclusion: "cancelled",
        responseStatus: "cancel_requested",
      },
    );
  }

  async rerunWorkflow(args: GithubRerunWorkflowArgs): Promise<Record<string, unknown>> {
    return this.updateWorkflowRunState(
      args,
      "github.actions.reRunWorkflow",
      {
        enableDebugLogging: args.enableDebugLogging ?? false,
      },
      {
        status: "queued",
        conclusion: null,
        responseStatus: "rerun_requested",
      },
    );
  }

  async lockIssue(args: GithubLockIssueArgs): Promise<Record<string, unknown>> {
    return this.setIssueLock(args, "github.issues.lock", true, {
      lockReason: args.lockReason,
    });
  }

  async unlockIssue(args: GithubUnlockIssueArgs): Promise<Record<string, unknown>> {
    return this.setIssueLock(args, "github.issues.unlock", false);
  }

  async markNotificationsRead(
    args: GithubMarkNotificationsReadArgs,
  ): Promise<Record<string, unknown>> {
    return this.runGithubIdempotentOperation(
      args,
      "github.activity.markNotificationsAsRead",
      this.withNamespaceArgs(args, { lastReadAt: args.lastReadAt }),
      (state) => {
        const notifications = this.getOrCreateNotifications(state, DEFAULT_REPO);
        for (const notification of notifications) {
          notification.unread = false;
        }
        return {
          marked: true,
          ...(args.lastReadAt !== undefined ? { last_read_at: args.lastReadAt } : {}),
        };
      },
    );
  }

  async rerunFailedJobs(args: GithubRerunFailedJobsArgs): Promise<Record<string, unknown>> {
    return this.updateWorkflowRunState(
      args,
      "github.actions.reRunWorkflowFailedJobs",
      {
        enableDebugLogging: args.enableDebugLogging ?? false,
      },
      {
        status: "queued",
        conclusion: null,
        responseStatus: "rerun_failed_jobs_requested",
      },
    );
  }

  async updatePRBranch(args: GithubUpdatePRBranchArgs): Promise<Record<string, unknown>> {
    return this.runGithubIdempotentOperation(
      args,
      "github.pulls.updateBranch",
      this.withRepoArgs(args, {
        pullNumber: args.pullNumber,
        expectedHeadSha: args.expectedHeadSha,
      }),
      (state) => {
        const pullRequest = this.findPullRequest(state, args.repo, args.pullNumber);
        const head =
          pullRequest.head && typeof pullRequest.head === "object" ? pullRequest.head : {};
        const currentHeadSha = String((head as { sha?: unknown }).sha ?? "");
        if (
          args.expectedHeadSha &&
          currentHeadSha.length > 0 &&
          currentHeadSha !== args.expectedHeadSha
        ) {
          throw new Error("head_sha_mismatch");
        }
        pullRequest.head = {
          ...head,
          sha: `${currentHeadSha || "sha"}_updated`,
        };
        return {
          pull_number: args.pullNumber,
          updated: true,
        };
      },
    );
  }

  async createReaction(args: GithubCreateReactionArgs): Promise<GithubReaction> {
    return this.runGithubIdempotentOperation(
      args,
      "github.reactions.createForIssue",
      this.withRepoArgs(args, {
        issue: args.issue,
        content: args.content,
      }),
      (state) => {
        this.findIssue(state, args.repo, args.issue);
        state.reactionCount += 1;
        const reaction: GithubReaction = {
          id: state.reactionCount + 1300,
          content: args.content,
          user: {
            login: "keppo-bot",
          },
        };
        const reactions = this.getOrCreateIssueReactions(state, args.repo, args.issue);
        reactions.unshift(reaction);
        return cloneGithubEntity(reaction);
      },
    );
  }

  async deleteReaction(args: GithubDeleteReactionArgs): Promise<GithubDeleteResult> {
    return this.runGithubIdempotentOperation(
      args,
      "github.reactions.deleteForIssue",
      this.withRepoArgs(args, {
        issue: args.issue,
        reactionId: args.reactionId,
      }),
      (state) => {
        const removed = this.removeIssueReaction(state, args.repo, args.issue, args.reactionId);
        if (!removed) {
          throw new Error("reaction_not_found");
        }
        return {
          deleted: true,
          id: args.reactionId,
        };
      },
    );
  }

  async createDispatchEvent(args: GithubCreateDispatchEventArgs): Promise<Record<string, unknown>> {
    return this.runGithubRepoIdempotentOperation(
      args,
      "github.repos.createDispatchEvent",
      {
        eventType: args.eventType,
        clientPayload: args.clientPayload ?? {},
      },
      () => ({
        dispatched: true,
        event_type: args.eventType,
        client_payload: args.clientPayload ?? {},
      }),
    );
  }

  async updatePullRequest(args: GithubUpdatePullRequestArgs): Promise<GithubPullRequest> {
    return this.runGithubRepoIdempotentOperation(
      args,
      "github.pulls.update",
      {
        pullNumber: args.pullNumber,
        title: args.title,
        body: args.body,
        state: args.state,
        base: args.base,
      },
      (state) => {
        const pullRequest = this.findPullRequest(state, args.repo, args.pullNumber);
        this.assignDefined(pullRequest, {
          title: args.title,
          body: args.body,
          state: args.state,
        });
        if (args.base !== undefined) {
          pullRequest.base = {
            ...(pullRequest.base && typeof pullRequest.base === "object" ? pullRequest.base : {}),
            ref: args.base,
          };
        }
        return cloneGithubEntity(pullRequest);
      },
    );
  }

  async listPullRequestCommits(args: GithubListPullRequestCommitsArgs): Promise<GithubCommit[]> {
    return this.listRepoPage(
      args,
      "github.pulls.listCommits",
      { pullNumber: args.pullNumber },
      (state) => {
        this.findPullRequest(state, args.repo, args.pullNumber);
        return this.getOrCreateCommits(state, args.repo);
      },
    );
  }

  async listIssueComments(args: GithubListIssueCommentsArgs): Promise<GithubIssueComment[]> {
    return this.listRepoPage(args, "github.issues.listComments", { issue: args.issue }, (state) => {
      this.findIssue(state, args.repo, args.issue);
      return this.getOrCreateIssueComments(state, args.repo, args.issue);
    });
  }

  async listReleases(args: GithubListReleasesArgs): Promise<GithubRelease[]> {
    return this.listRepoPage(args, "github.repos.listReleases", {}, (state) =>
      this.getOrCreateReleases(state, args.repo),
    );
  }

  async getLatestRelease(args: GithubGetLatestReleaseArgs): Promise<GithubRelease> {
    return this.runGithubRepoOperation(args, "github.repos.getLatestRelease", {}, (state) => {
      const releases = this.getOrCreateReleases(state, args.repo);
      const latest =
        releases.find((release) => !release.draft && !release.prerelease) ?? releases.at(0);
      if (!latest) {
        throw new Error("release_not_found");
      }
      return cloneGithubEntity(latest);
    });
  }

  async createRelease(args: GithubCreateReleaseArgs): Promise<GithubRelease> {
    return this.runGithubRepoIdempotentOperation(
      args,
      "github.repos.createRelease",
      {
        tagName: args.tagName,
        targetCommitish: args.targetCommitish,
        name: args.name,
        body: args.body,
        draft: args.draft ?? false,
        prerelease: args.prerelease ?? false,
        generateReleaseNotes: args.generateReleaseNotes ?? false,
      },
      (state) => {
        const repoKey = this.normalizeRepo(args.repo);
        const releases = this.getOrCreateReleases(state, repoKey);
        if (releases.some((release) => String(release.tag_name) === args.tagName)) {
          throw new Error("release_tag_already_exists");
        }
        state.releaseCount += 1;
        const response: GithubRelease = {
          id: state.releaseCount + 800,
          tag_name: args.tagName,
          name: args.name ?? args.tagName,
          body: args.body ?? "",
          target_commitish: args.targetCommitish ?? "main",
          draft: args.draft ?? false,
          prerelease: args.prerelease ?? false,
          html_url: `https://example.test/${repoKey}/releases/tag/${args.tagName}`,
          created_at: "2026-01-20T00:00:00Z",
          published_at: args.draft ? null : "2026-01-20T00:10:00Z",
        };
        releases.unshift(response);
        return cloneGithubEntity(response);
      },
    );
  }

  async updateRelease(args: GithubUpdateReleaseArgs): Promise<GithubRelease> {
    return this.runGithubRepoIdempotentOperation(
      args,
      "github.repos.updateRelease",
      {
        releaseId: args.releaseId,
        tagName: args.tagName,
        targetCommitish: args.targetCommitish,
        name: args.name,
        body: args.body,
        draft: args.draft,
        prerelease: args.prerelease,
      },
      (state) => {
        const release = this.findRelease(state, args.repo, args.releaseId);
        this.assignDefined(release, {
          tag_name: args.tagName,
          target_commitish: args.targetCommitish,
          name: args.name,
          body: args.body,
          draft: args.draft,
          prerelease: args.prerelease,
        });
        return cloneGithubEntity(release);
      },
    );
  }

  async generateReleaseNotes(
    args: GithubGenerateReleaseNotesArgs,
  ): Promise<Record<string, unknown>> {
    return this.runGithubRepoIdempotentOperation(
      args,
      "github.repos.generateReleaseNotes",
      {
        tagName: args.tagName,
        targetCommitish: args.targetCommitish,
        previousTagName: args.previousTagName,
        configurationFilePath: args.configurationFilePath,
      },
      () => {
        const repoKey = this.normalizeRepo(args.repo);
        return {
          name: `Release ${args.tagName}`,
          body: `## What's Changed\n- Generated notes for ${repoKey}@${args.tagName}`,
          tag_name: args.tagName,
          previous_tag_name: args.previousTagName ?? "",
        };
      },
    );
  }

  async listMilestones(args: GithubListMilestonesArgs): Promise<GithubMilestone[]> {
    return this.listRepoPageFiltered(
      args,
      "github.issues.listMilestones",
      { state: args.state },
      (state) => this.getOrCreateMilestones(state, args.repo),
      (milestone) => this.matchesStateFilter(milestone.state, args.state),
    );
  }

  async createMilestone(args: GithubCreateMilestoneArgs): Promise<GithubMilestone> {
    return this.runGithubRepoIdempotentOperation(
      args,
      "github.issues.createMilestone",
      {
        title: args.title,
        state: args.state ?? "open",
        description: args.description,
        dueOn: args.dueOn,
      },
      (state) => {
        const repoKey = this.normalizeRepo(args.repo);
        const milestones = this.getOrCreateMilestones(state, repoKey);
        state.milestoneCount += 1;
        const nextNumber =
          milestones.reduce((max, milestone) => Math.max(max, Number(milestone.number ?? 0)), 0) +
          1;
        const response: GithubMilestone = {
          id: state.milestoneCount + 900,
          number: nextNumber,
          title: args.title,
          state: args.state ?? "open",
          description: args.description ?? "",
          due_on: args.dueOn ?? null,
          html_url: `https://example.test/${repoKey}/milestone/${nextNumber}`,
        };
        milestones.unshift(response);
        return cloneGithubEntity(response);
      },
    );
  }

  async updateMilestone(args: GithubUpdateMilestoneArgs): Promise<GithubMilestone> {
    return this.runGithubRepoIdempotentOperation(
      args,
      "github.issues.updateMilestone",
      {
        milestone: args.milestone,
        title: args.title,
        state: args.state,
        description: args.description,
        dueOn: args.dueOn,
      },
      (state) => {
        const milestone = this.findMilestone(state, args.repo, args.milestone);
        this.assignDefined(milestone, {
          title: args.title,
          state: args.state,
          description: args.description,
          due_on: args.dueOn,
        });
        return cloneGithubEntity(milestone);
      },
    );
  }

  async updateComment(args: GithubUpdateCommentArgs): Promise<GithubIssueComment> {
    return this.runGithubRepoIdempotentOperation(
      args,
      "github.issues.updateComment",
      {
        commentId: args.commentId,
        body: args.body,
      },
      (state) => {
        const comment = this.findIssueComment(state, args.repo, args.commentId);
        comment.body = args.body;
        comment.updated_at = "2026-01-02T00:00:00Z";
        return cloneGithubEntity(comment);
      },
    );
  }

  async deleteComment(args: GithubDeleteCommentArgs): Promise<GithubDeleteResult> {
    return this.runGithubRepoIdempotentOperation(
      args,
      "github.issues.deleteComment",
      { commentId: args.commentId },
      (state) => {
        const removed = this.removeIssueComment(state, args.repo, args.commentId);
        if (!removed) {
          throw new Error("comment_not_found");
        }
        return {
          deleted: true,
          id: args.commentId,
        };
      },
    );
  }

  async listBranches(args: GithubListBranchesArgs): Promise<GithubBranch[]> {
    return this.listRepoPage(args, "github.repos.listBranches", {}, (state) =>
      this.getOrCreateBranches(state, args.repo),
    );
  }

  async getFileContents(args: GithubGetFileContentsArgs): Promise<GithubFileContents> {
    return this.getRepoEntity(
      args,
      "github.repos.getContent",
      {
        path: args.path,
        ref: args.ref,
      },
      (state) => this.getOrCreateFileContents(state, args.repo, args.path),
    );
  }

  async createOrUpdateFile(args: GithubCreateOrUpdateFileArgs): Promise<GithubFileWriteResult> {
    return this.runGithubRepoIdempotentOperation(
      args,
      "github.repos.createOrUpdateFileContents",
      {
        path: args.path,
        message: args.message,
        sha: args.sha,
        branch: args.branch,
      },
      (state) => {
        const repoKey = this.normalizeRepo(args.repo);
        this.ensureRepoState(state, repoKey);
        const key = this.fileContentsKey(repoKey, args.path);
        const current = state.fileContentsByRepoAndPath.get(key);
        if (args.sha && current && String(current.sha) !== args.sha) {
          throw new Error("invalid_sha");
        }

        state.fileRevisionCount += 1;
        state.commitCount += 1;
        const content = Buffer.from(args.content, "utf8").toString("base64");
        const sha = `sha_${state.fileRevisionCount}`;
        const updated: GithubFileContents = {
          type: "file",
          name: args.path.split("/").pop() ?? args.path,
          path: args.path,
          sha,
          size: args.content.length,
          encoding: "base64",
          content,
        };
        state.fileContentsByRepoAndPath.set(key, updated);

        return {
          path: args.path,
          sha,
          content: cloneGithubEntity(updated),
          commit: {
            sha: `commit_${state.commitCount}`,
            message: args.message,
            url: `https://example.test/${repoKey}/commit/commit_${state.commitCount}`,
          },
        };
      },
    );
  }

  async listLabels(args: GithubListLabelsArgs): Promise<GithubLabel[]> {
    return this.listRepoPage(args, "github.issues.listLabelsForRepo", {}, (state) =>
      this.getOrCreateLabels(state, args.repo),
    );
  }

  async createLabel(args: GithubCreateLabelArgs): Promise<GithubLabel> {
    return this.runGithubRepoIdempotentOperation(
      args,
      "github.issues.createLabel",
      {
        name: args.name,
        color: args.color,
        description: args.description,
      },
      (state) => {
        const labels = this.getOrCreateLabels(state, args.repo);
        const found = labels.find(
          (label) => String(label.name ?? "").toLowerCase() === args.name.trim().toLowerCase(),
        );
        if (found) {
          found.color = args.color;
          if (args.description !== undefined) {
            found.description = args.description;
          }
          return cloneGithubEntity(found);
        }

        state.labelCount += 1;
        const created: GithubLabel = {
          id: state.labelCount,
          name: args.name,
          color: args.color,
          ...(args.description !== undefined ? { description: args.description } : {}),
        };
        labels.push(created);
        return cloneGithubEntity(created);
      },
    );
  }

  async searchCode(args: GithubSearchCodeArgs): Promise<GithubCodeSearchResult[]> {
    return this.runGithubOperation(
      args,
      "github.search.code",
      this.withNamespaceArgs(args, {
        query: args.query,
        perPage: args.perPage,
      }),
      (state) => {
        const repoFilters = this.extractRepoFilters(args.query);
        const candidateRepos =
          repoFilters.length > 0
            ? repoFilters.map((repo) => this.normalizeRepo(repo))
            : [...state.reposByName.keys()];

        const results: GithubCodeSearchResult[] = [];
        for (const repo of candidateRepos) {
          this.ensureRepoState(state, repo);
          for (const result of seedGithubCodeSearchResults(repo)) {
            results.push(cloneGithubEntity(result));
          }
        }

        return this.takePage(results, args.perPage, cloneGithubEntity);
      },
    );
  }

  async searchRepositories(args: GithubSearchRepositoriesArgs): Promise<GithubRepoSearchResult[]> {
    return this.runGithubOperation(
      args,
      "github.search.repos",
      this.withNamespaceArgs(args, {
        query: args.query,
        perPage: args.perPage,
      }),
      (state) => {
        const normalizedQuery = args.query.trim().toLowerCase();
        const repos = [...state.reposByName.values()].filter((repo) => {
          if (normalizedQuery.length === 0) {
            return true;
          }
          const haystack =
            `${String(repo.full_name ?? "")} ${String(repo.name ?? "")}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        });

        return this.takePage(seedGithubRepoSearchResults(repos), args.perPage, cloneGithubEntity);
      },
    );
  }

  async getRepo(args: GithubGetRepoArgs): Promise<GithubRepo> {
    return this.getRepoEntity(args, "github.repos.get", {}, (state) =>
      this.getOrCreateRepo(state, args.repo),
    );
  }

  async listOrgRepos(args: GithubListOrgReposArgs): Promise<GithubRepo[]> {
    return this.runGithubOperation(
      args,
      "github.repos.listForOrg",
      this.withNamespaceArgs(args, {
        org: args.org,
        type: args.type ?? "all",
        perPage: args.perPage,
      }),
      (state) => {
        const org = args.org.trim().toLowerCase();
        return this.takePage(
          [...state.reposByName.values()].filter((repo) => {
            const fullName = String(repo.full_name ?? "").toLowerCase();
            return fullName.startsWith(`${org}/`);
          }),
          args.perPage,
          (repo) => ({ ...repo }),
        );
      },
    );
  }

  seed(namespace: string, seed: Record<string, unknown>): void {
    const state = this.getState(namespace);
    const repo =
      typeof seed.repo === "string" && seed.repo.trim().length > 0 ? seed.repo : DEFAULT_REPO;
    const repoKey = this.normalizeRepo(repo);
    this.ensureRepoState(state, repoKey);

    this.seedRepoEntries(state.issuesByRepo, repoKey, seed.issues, (issue) => ({
      id: Number(issue.id ?? issue.number ?? 0),
      number: Number(issue.number ?? 0),
      title: String(issue.title ?? ""),
      body: String(issue.body ?? ""),
      state: String(issue.state ?? "open"),
      html_url: String(issue.html_url ?? `https://example.test/${repoKey}/issues/unknown`),
      labels: Array.isArray(issue.labels) ? issue.labels : [],
      assignees: Array.isArray(issue.assignees) ? issue.assignees : [],
      ...issue,
    }));

    this.seedRepoEntries(state.pullRequestsByRepo, repoKey, seed.pullRequests, (pullRequest) => ({
      id: Number(pullRequest.id ?? pullRequest.number ?? 0),
      number: Number(pullRequest.number ?? 0),
      state: String(pullRequest.state ?? "open"),
      title: String(pullRequest.title ?? ""),
      html_url: String(pullRequest.html_url ?? `https://example.test/${repoKey}/pull/unknown`),
      merged: Boolean(pullRequest.merged),
      ...pullRequest,
    }));

    this.seedRepoEntries(state.branchesByRepo, repoKey, seed.branches, (branch) => ({
      name: String(branch.name ?? "main"),
      commit:
        branch.commit && typeof branch.commit === "object"
          ? (branch.commit as Record<string, unknown>)
          : { sha: String(branch.sha ?? "abc123") },
      protected: Boolean(branch.protected),
      ...branch,
    }));

    this.seedRepoEntries(state.labelsByRepo, repoKey, seed.labels, (label) => ({
      id: Number(label.id ?? 0),
      name: String(label.name ?? ""),
      color: String(label.color ?? "ededed"),
      description:
        label.description === undefined || label.description === null
          ? null
          : String(label.description),
      ...label,
    }));

    if (Array.isArray(seed.files)) {
      for (const entry of seed.files) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          continue;
        }
        const file = entry as Record<string, unknown>;
        const path = String(file.path ?? "README.md");
        const key = this.fileContentsKey(repoKey, path);
        state.fileContentsByRepoAndPath.set(key, {
          type: "file",
          name: path.split("/").pop() ?? path,
          path,
          sha: String(file.sha ?? `sha_${path.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}`),
          size: typeof file.size === "number" ? file.size : String(file.content ?? "").length,
          encoding: String(file.encoding ?? "base64"),
          content: String(file.content ?? ""),
          ...file,
        });
      }
    }

    this.seedRepoEntries(state.releasesByRepo, repoKey, seed.releases, (release) => ({
      id: Number(release.id ?? 0),
      tag_name: String(release.tag_name ?? release.tagName ?? ""),
      name: release.name === undefined || release.name === null ? null : String(release.name),
      body: release.body === undefined || release.body === null ? null : String(release.body),
      target_commitish: String(release.target_commitish ?? release.targetCommitish ?? "main"),
      draft: Boolean(release.draft),
      prerelease: Boolean(release.prerelease),
      html_url: String(
        release.html_url ??
          `https://example.test/${repoKey}/releases/tag/${String(release.tag_name ?? release.tagName ?? "release")}`,
      ),
      created_at: String(release.created_at ?? "2026-01-20T00:00:00Z"),
      published_at: release.published_at === undefined ? null : String(release.published_at ?? ""),
      ...release,
    }));

    this.seedRepoEntries(state.milestonesByRepo, repoKey, seed.milestones, (milestone) => ({
      id: Number(milestone.id ?? milestone.number ?? 0),
      number: Number(milestone.number ?? 0),
      title: String(milestone.title ?? ""),
      state: String(milestone.state ?? "open"),
      description:
        milestone.description === undefined || milestone.description === null
          ? null
          : String(milestone.description),
      due_on:
        milestone.due_on === undefined && milestone.dueOn === undefined
          ? null
          : String(milestone.due_on ?? milestone.dueOn ?? ""),
      html_url: String(
        milestone.html_url ??
          `https://example.test/${repoKey}/milestone/${Number(milestone.number ?? 0)}`,
      ),
      ...milestone,
    }));
  }

  protected createDefaultState(): GithubNamespaceState {
    const created: GithubNamespaceState = {
      issueCount: 100,
      commentCount: 1,
      pullRequestCount: 100,
      reviewCount: 1,
      reviewCommentCount: 0,
      workflowRunCount: 2,
      mergeCount: 0,
      reactionCount: 0,
      releaseCount: 2,
      milestoneCount: 2,
      labelCount: 1100,
      fileRevisionCount: 1,
      commitCount: 1000,
      issuesByRepo: new Map(),
      branchesByRepo: new Map(),
      fileContentsByRepoAndPath: new Map(),
      labelsByRepo: new Map(),
      issueCommentsByRepoAndIssue: new Map(),
      pullRequestsByRepo: new Map(),
      pullRequestFilesByRepoAndNumber: new Map(),
      pullRequestReviewsByRepoAndNumber: new Map(),
      releasesByRepo: new Map(),
      milestonesByRepo: new Map(),
      commitsByRepo: new Map(),
      checkRunsByRepoAndRef: new Map(),
      commitStatusByRepoAndRef: new Map(),
      workflowRunsByRepo: new Map(),
      notificationsByRepo: new Map(),
      reactionsByRepoAndIssue: new Map(),
      reposByName: new Map(),
      idempotentResponses: new Map(),
    };

    this.ensureRepoState(created, this.normalizeRepo(DEFAULT_REPO));
    return created;
  }

  private ensureRepoState(state: GithubNamespaceState, repo: string): void {
    const repoKey = this.normalizeRepo(repo);
    this.ensureRepoSeed(state.reposByName, repoKey, () => seedGithubRepo(repoKey));
    this.ensureRepoSeed(state.branchesByRepo, repoKey, () => seedGithubBranches());
    this.ensureRepoSeed(state.labelsByRepo, repoKey, () => seedGithubLabels());
    this.ensureRepoSeed(
      state.fileContentsByRepoAndPath,
      this.fileContentsKey(repoKey, "README.md"),
      () => seedGithubFileContents(repoKey, "README.md"),
    );
    this.ensureRepoSeed(state.issuesByRepo, repoKey, () =>
      seedGithubIssues().map((issue) => ({
        ...issue,
        html_url: `https://example.test/${repoKey}/issues/${issue.number}`,
      })),
    );
    this.ensureRepoSeed(state.pullRequestsByRepo, repoKey, () =>
      seedGithubPullRequests().map((pullRequest) => ({
        ...pullRequest,
        html_url: `https://example.test/${repoKey}/pull/${pullRequest.number}`,
      })),
    );
    this.ensureRepoSeed(
      state.pullRequestFilesByRepoAndNumber,
      this.pullRequestFilesKey(repoKey, 5),
      () => seedGithubPullRequestFiles().map(cloneGithubEntity),
    );
    this.ensureRepoSeed(
      state.pullRequestReviewsByRepoAndNumber,
      this.pullRequestReviewsKey(repoKey, 5),
      () => seedGithubPullRequestReviews().map(cloneGithubEntity),
    );
    this.ensureRepoSeed(state.issueCommentsByRepoAndIssue, this.issueCommentsKey(repoKey, 1), () =>
      seedGithubIssueComments(repoKey, 1),
    );
    this.ensureRepoSeed(state.commitsByRepo, repoKey, () => seedGithubCommits());
    this.ensureRepoSeed(
      state.commitStatusByRepoAndRef,
      this.commitStatusKey(repoKey, "abc123"),
      () => seedGithubCommitStatus("abc123"),
    );
    this.ensureRepoSeed(state.checkRunsByRepoAndRef, this.checkRunsKey(repoKey, "abc123"), () =>
      seedGithubCheckRuns("abc123"),
    );
    this.ensureRepoSeed(state.workflowRunsByRepo, repoKey, () => seedGithubWorkflowRuns());
    this.ensureRepoSeed(state.notificationsByRepo, repoKey, () => seedGithubNotifications(repoKey));
    this.ensureRepoSeed(state.releasesByRepo, repoKey, () => seedGithubReleases(repoKey));
    this.ensureRepoSeed(state.milestonesByRepo, repoKey, () => seedGithubMilestones(repoKey));
  }

  private getOrCreateRepo(state: GithubNamespaceState, repo: string): GithubRepo {
    return this.getOrCreateRepoValue(state, repo, state.reposByName, (repoKey) =>
      seedGithubRepo(repoKey),
    );
  }

  private getOrCreateBranches(state: GithubNamespaceState, repo: string): GithubBranch[] {
    return this.getOrCreateRepoValue(state, repo, state.branchesByRepo, () => seedGithubBranches());
  }

  private getOrCreateFileContents(
    state: GithubNamespaceState,
    repo: string,
    path: string,
  ): GithubFileContents {
    return this.getOrCreateRepoScopedValue(
      state,
      repo,
      (repoKey) => this.fileContentsKey(repoKey, path),
      state.fileContentsByRepoAndPath,
      (repoKey) => seedGithubFileContents(repoKey, path),
    );
  }

  private getOrCreateLabels(state: GithubNamespaceState, repo: string): GithubLabel[] {
    return this.getOrCreateRepoValue(state, repo, state.labelsByRepo, () => seedGithubLabels());
  }

  private getOrCreateIssues(state: GithubNamespaceState, repo: string): GithubIssue[] {
    return this.getOrCreateRepoValue(state, repo, state.issuesByRepo, () => seedGithubIssues());
  }

  private getOrCreatePullRequests(state: GithubNamespaceState, repo: string): GithubPullRequest[] {
    return this.getOrCreateRepoValue(state, repo, state.pullRequestsByRepo, () =>
      seedGithubPullRequests(),
    );
  }

  private getOrCreatePullRequestFiles(
    state: GithubNamespaceState,
    repo: string,
    pullNumber: number,
  ): GithubPullRequestFile[] {
    return this.getOrCreateRepoScopedValue(
      state,
      repo,
      (repoKey) => this.pullRequestFilesKey(repoKey, pullNumber),
      state.pullRequestFilesByRepoAndNumber,
      () => [],
    );
  }

  private getOrCreatePullRequestReviews(
    state: GithubNamespaceState,
    repo: string,
    pullNumber: number,
  ): GithubPullRequestReview[] {
    return this.getOrCreateRepoScopedValue(
      state,
      repo,
      (repoKey) => this.pullRequestReviewsKey(repoKey, pullNumber),
      state.pullRequestReviewsByRepoAndNumber,
      () => [],
    );
  }

  private getOrCreateCommits(state: GithubNamespaceState, repo: string): GithubCommit[] {
    return this.getOrCreateRepoValue(state, repo, state.commitsByRepo, () => seedGithubCommits());
  }

  private getOrCreateCheckRuns(
    state: GithubNamespaceState,
    repo: string,
    ref: string,
  ): GithubCheckRun[] {
    return this.getOrCreateRepoScopedValue(
      state,
      repo,
      (repoKey) => this.checkRunsKey(repoKey, ref),
      state.checkRunsByRepoAndRef,
      () => seedGithubCheckRuns(ref),
    );
  }

  private getOrCreateCommitStatus(
    state: GithubNamespaceState,
    repo: string,
    ref: string,
  ): GithubCommitStatus {
    return this.getOrCreateRepoScopedValue(
      state,
      repo,
      (repoKey) => this.commitStatusKey(repoKey, ref),
      state.commitStatusByRepoAndRef,
      () => seedGithubCommitStatus(ref),
    );
  }

  private getOrCreateWorkflowRuns(state: GithubNamespaceState, repo: string): GithubWorkflowRun[] {
    return this.getOrCreateRepoValue(state, repo, state.workflowRunsByRepo, () =>
      seedGithubWorkflowRuns(),
    );
  }

  private getOrCreateNotifications(
    state: GithubNamespaceState,
    repo: string,
  ): GithubNotification[] {
    return this.getOrCreateRepoValue(state, repo, state.notificationsByRepo, (repoKey) =>
      seedGithubNotifications(repoKey),
    );
  }

  private getOrCreateIssueReactions(
    state: GithubNamespaceState,
    repo: string,
    issueNumber: number,
  ): GithubReaction[] {
    const repoKey = this.normalizeRepo(repo);
    this.ensureRepoState(state, repoKey);
    this.findIssue(state, repoKey, issueNumber);
    return this.getOrCreateRepoScopedValue(
      state,
      repoKey,
      (normalizedRepoKey) => this.issueReactionsKey(normalizedRepoKey, issueNumber),
      state.reactionsByRepoAndIssue,
      () => [],
    );
  }

  private getOrCreateIssueComments(
    state: GithubNamespaceState,
    repo: string,
    issueNumber: number,
  ): GithubIssueComment[] {
    return this.getOrCreateRepoScopedValue(
      state,
      repo,
      (repoKey) => this.issueCommentsKey(repoKey, issueNumber),
      state.issueCommentsByRepoAndIssue,
      (repoKey) => seedGithubIssueComments(repoKey, issueNumber),
    );
  }

  private getOrCreateReleases(state: GithubNamespaceState, repo: string): GithubRelease[] {
    return this.getOrCreateRepoValue(state, repo, state.releasesByRepo, (repoKey) =>
      seedGithubReleases(repoKey),
    );
  }

  private getOrCreateMilestones(state: GithubNamespaceState, repo: string): GithubMilestone[] {
    return this.getOrCreateRepoValue(state, repo, state.milestonesByRepo, (repoKey) =>
      seedGithubMilestones(repoKey),
    );
  }

  private getOrCreateRepoValue<T>(
    state: GithubNamespaceState,
    repo: string,
    store: Map<string, T>,
    create: (repoKey: string) => T,
  ): T {
    const repoKey = this.normalizeRepo(repo);
    this.ensureRepoState(state, repoKey);
    const existing = store.get(repoKey);
    if (existing !== undefined) {
      return existing;
    }
    const created = create(repoKey);
    store.set(repoKey, created);
    return created;
  }

  private seedRepoEntries<T>(
    store: Map<string, T[]>,
    repoKey: string,
    value: unknown,
    map: (entry: Record<string, unknown>) => T,
  ): void {
    const mapped = mapSeedEntries(value, map);
    if (mapped) {
      store.set(repoKey, mapped);
    }
  }

  private ensureRepoSeed<T>(store: Map<string, T>, key: string, create: () => T): void {
    if (!store.has(key)) {
      store.set(key, create());
    }
  }

  private getOrCreateRepoScopedValue<T>(
    state: GithubNamespaceState,
    repo: string,
    getKey: (repoKey: string) => string,
    store: Map<string, T>,
    create: (repoKey: string) => T,
  ): T {
    const repoKey = this.normalizeRepo(repo);
    this.ensureRepoState(state, repoKey);
    const key = getKey(repoKey);
    const existing = store.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created = create(repoKey);
    store.set(key, created);
    return created;
  }

  private findIssue(state: GithubNamespaceState, repo: string, issueNumber: number): GithubIssue {
    return this.findNumberedEntity(
      this.getOrCreateIssues(state, repo),
      issueNumber,
      "issue_not_found",
    );
  }

  private findPullRequest(
    state: GithubNamespaceState,
    repo: string,
    pullNumber: number,
  ): GithubPullRequest {
    return this.findNumberedEntity(
      this.getOrCreatePullRequests(state, repo),
      pullNumber,
      "pull_request_not_found",
    );
  }

  private findWorkflowRun(
    state: GithubNamespaceState,
    repo: string,
    runId: number,
  ): GithubWorkflowRun {
    return this.findIdentifiedEntity(
      this.getOrCreateWorkflowRuns(state, repo),
      runId,
      "workflow_run_not_found",
    );
  }

  private findIssueComment(
    state: GithubNamespaceState,
    repo: string,
    commentId: number,
  ): GithubIssueComment {
    return this.findRepoScopedEntityById(
      state,
      repo,
      state.issueCommentsByRepoAndIssue,
      commentId,
      "comment_not_found",
    );
  }

  private findRelease(state: GithubNamespaceState, repo: string, releaseId: number): GithubRelease {
    return this.findIdentifiedEntity(
      this.getOrCreateReleases(state, repo),
      releaseId,
      "release_not_found",
    );
  }

  private findMilestone(
    state: GithubNamespaceState,
    repo: string,
    milestoneNumber: number,
  ): GithubMilestone {
    return this.findNumberedEntity(
      this.getOrCreateMilestones(state, repo),
      milestoneNumber,
      "milestone_not_found",
    );
  }

  private removeIssueComment(
    state: GithubNamespaceState,
    repo: string,
    commentId: number,
  ): boolean {
    return this.removeRepoScopedEntityById(
      state,
      repo,
      state.issueCommentsByRepoAndIssue,
      commentId,
    );
  }

  private removeIssueReaction(
    state: GithubNamespaceState,
    repo: string,
    issueNumber: number,
    reactionId: number,
  ): boolean {
    const repoKey = this.normalizeRepo(repo);
    this.ensureRepoState(state, repoKey);
    const key = this.issueReactionsKey(repoKey, issueNumber);
    const reactions = state.reactionsByRepoAndIssue.get(key);
    if (!reactions) {
      return false;
    }
    return this.removeIdentifiedEntity(reactions, reactionId);
  }

  private getNextIssueNumber(state: GithubNamespaceState, issues: GithubIssue[]): number {
    state.issueCount += 1;
    const max = issues.reduce((current, issue) => Math.max(current, Number(issue.number ?? 0)), 0);
    return Math.max(max + 1, state.issueCount);
  }

  private findNumberedEntity<T extends { number?: unknown }>(
    entries: T[],
    number: number,
    errorCode: string,
  ): T {
    const found = entries.find((entry) => Number(entry.number ?? 0) === number);
    if (!found) {
      throw new Error(errorCode);
    }
    return found;
  }

  private findIdentifiedEntity<T extends { id?: unknown }>(
    entries: T[],
    id: number,
    errorCode: string,
  ): T {
    const found = entries.find((entry) => Number(entry.id ?? 0) === id);
    if (!found) {
      throw new Error(errorCode);
    }
    return found;
  }

  private findRepoScopedEntityById<T extends { id?: unknown }>(
    state: GithubNamespaceState,
    repo: string,
    store: Map<string, T[]>,
    id: number,
    errorCode: string,
  ): T {
    const repoKey = this.normalizeRepo(repo);
    this.ensureRepoState(state, repoKey);
    for (const [key, entries] of store.entries()) {
      if (!key.startsWith(`${repoKey}:`)) {
        continue;
      }
      const found = entries.find((entry) => Number(entry.id ?? 0) === id);
      if (found) {
        return found;
      }
    }
    throw new Error(errorCode);
  }

  private removeIdentifiedEntity<T extends { id?: unknown }>(entries: T[], id: number): boolean {
    const index = entries.findIndex((entry) => Number(entry.id ?? 0) === id);
    if (index < 0) {
      return false;
    }
    entries.splice(index, 1);
    return true;
  }

  private removeRepoScopedEntityById<T extends { id?: unknown }>(
    state: GithubNamespaceState,
    repo: string,
    store: Map<string, T[]>,
    id: number,
  ): boolean {
    const repoKey = this.normalizeRepo(repo);
    this.ensureRepoState(state, repoKey);
    for (const [key, entries] of store.entries()) {
      if (!key.startsWith(`${repoKey}:`)) {
        continue;
      }
      if (this.removeIdentifiedEntity(entries, id)) {
        return true;
      }
    }
    return false;
  }

  private takePage<T, TResult>(
    entries: readonly T[],
    perPage: number,
    map: (entry: T) => TResult,
  ): TResult[] {
    return entries.slice(0, Math.max(1, perPage)).map(map);
  }

  private matchesStateFilter(state: unknown, filter: string): boolean {
    return filter === "all" || String(state ?? "open") === filter;
  }

  private getRequestedReviewerLogins(pullRequest: GithubPullRequest): string[] {
    return Array.isArray(pullRequest.requested_reviewers)
      ? pullRequest.requested_reviewers
          .map((entry) =>
            entry && typeof entry === "object" ? String((entry as { login?: unknown }).login) : "",
          )
          .filter((entry) => entry.trim().length > 0)
      : [];
  }

  private withNamespaceArgs<
    TArgs extends { namespace?: string | undefined },
    TFields extends Record<string, unknown>,
  >(args: TArgs, fields: TFields): { namespace?: string | undefined } & TFields {
    return { namespace: args.namespace, ...fields };
  }

  private withRepoArgs<
    TArgs extends { namespace?: string | undefined; repo: string },
    TFields extends Record<string, unknown>,
  >(args: TArgs, fields: TFields): { namespace?: string | undefined; repo: string } & TFields {
    return { ...this.withNamespaceArgs(args, fields), repo: args.repo };
  }

  private listRepoPage<
    TArgs extends {
      namespace?: string | undefined;
      repo: string;
      perPage: number;
      accessToken?: string | null | undefined;
    },
    TEntry extends object,
  >(
    args: TArgs,
    method: string,
    fields: Record<string, unknown>,
    entries: (state: GithubNamespaceState) => readonly TEntry[],
  ): Promise<TEntry[]> {
    return this.runGithubRepoOperation(
      args,
      method,
      { ...fields, perPage: args.perPage },
      (state) => this.takePage(entries(state), args.perPage, cloneGithubEntity),
    );
  }

  private listRepoPageFiltered<
    TArgs extends {
      namespace?: string | undefined;
      repo: string;
      perPage: number;
      accessToken?: string | null | undefined;
    },
    TEntry extends object,
  >(
    args: TArgs,
    method: string,
    fields: Record<string, unknown>,
    entries: (state: GithubNamespaceState) => readonly TEntry[],
    include: (entry: TEntry) => boolean,
  ): Promise<TEntry[]> {
    return this.listRepoPage(args, method, fields, (state) => entries(state).filter(include));
  }

  private getRepoEntity<
    TArgs extends {
      namespace?: string | undefined;
      repo: string;
      accessToken?: string | null | undefined;
    },
    TResult extends object,
  >(
    args: TArgs,
    method: string,
    fields: Record<string, unknown>,
    read: (state: GithubNamespaceState) => TResult,
  ): Promise<TResult> {
    return this.runGithubRepoOperation(args, method, fields, (state) =>
      cloneGithubEntity(read(state)),
    );
  }

  private runGithubRepoOperation<
    TArgs extends {
      namespace?: string | undefined;
      repo: string;
      accessToken?: string | null | undefined;
    },
    TResult,
  >(
    args: TArgs,
    method: string,
    fields: Record<string, unknown>,
    execute: (state: GithubNamespaceState) => Promise<TResult> | TResult,
  ): Promise<TResult> {
    return this.runGithubOperation(args, method, this.withRepoArgs(args, fields), execute);
  }

  private runGithubRepoIdempotentOperation<
    TArgs extends {
      namespace?: string | undefined;
      repo: string;
      accessToken?: string | null | undefined;
      idempotencyKey?: string | undefined;
    },
    TResult,
  >(
    args: TArgs,
    method: string,
    fields: Record<string, unknown>,
    execute: (state: GithubNamespaceState) => Promise<TResult> | TResult,
  ): Promise<TResult> {
    return this.runGithubIdempotentOperation(
      args,
      method,
      this.withRepoArgs(args, fields),
      execute,
    );
  }

  private updateWorkflowRunState<
    TArgs extends {
      namespace?: string | undefined;
      repo: string;
      runId: number;
      accessToken?: string | null | undefined;
      idempotencyKey?: string | undefined;
    },
  >(
    args: TArgs,
    method: string,
    fields: Record<string, unknown>,
    update: {
      status: string;
      conclusion: string | null;
      responseStatus: string;
    },
  ): Promise<Record<string, unknown>> {
    return this.runGithubRepoIdempotentOperation(
      args,
      method,
      { ...fields, runId: args.runId },
      (state) => this.updateWorkflowRun(state, args.repo, args.runId, update),
    );
  }

  private setIssueLock<
    TArgs extends {
      namespace?: string | undefined;
      repo: string;
      issue: number;
      lockReason?: string | undefined;
      accessToken?: string | null | undefined;
      idempotencyKey?: string | undefined;
    },
  >(
    args: TArgs,
    method: string,
    locked: boolean,
    fields: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.runGithubRepoIdempotentOperation(
      args,
      method,
      { ...fields, issue: args.issue },
      (state) => this.setIssueLockState(state, args.repo, args.issue, locked, args.lockReason),
    );
  }

  private assignDefined<TTarget extends Record<string, unknown>>(
    target: TTarget,
    fields: Record<string, unknown>,
  ): void {
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        target[key as keyof TTarget] = value as TTarget[keyof TTarget];
      }
    }
  }

  private updateIssueLabels(
    state: GithubNamespaceState,
    repo: string,
    issueNumber: number,
    update: (current: Set<string>) => void,
  ): GithubLabel[] {
    const issue = this.findIssue(state, repo, issueNumber);
    const current = new Set(toLabelNames(issue.labels));
    update(current);
    const response = toLabels([...current]);
    issue.labels = response;
    return response.map((label) => ({ ...label }));
  }

  private updateIssueAssignees(
    state: GithubNamespaceState,
    repo: string,
    issueNumber: number,
    update: (current: Set<string>) => void,
  ): GithubIssue {
    const issue = this.findIssue(state, repo, issueNumber);
    const current = new Set(toAssigneeLogins(issue.assignees));
    update(current);
    issue.assignees = toAssignees([...current]);
    return cloneGithubEntity(issue);
  }

  private updatePullRequestReviewers(
    state: GithubNamespaceState,
    repo: string,
    pullNumber: number,
    update: (current: Set<string>) => void,
  ): GithubPullRequest {
    const pullRequest = this.findPullRequest(state, repo, pullNumber);
    const current = new Set(this.getRequestedReviewerLogins(pullRequest));
    update(current);
    pullRequest.requested_reviewers = [...current].map((login) => ({ login }));
    return cloneGithubEntity(pullRequest);
  }

  private updateWorkflowRun(
    state: GithubNamespaceState,
    repo: string,
    runId: number,
    update: {
      status: string;
      conclusion: string | null;
      responseStatus: string;
    },
  ): Record<string, unknown> {
    const workflowRun = this.findWorkflowRun(state, repo, runId);
    workflowRun.status = update.status;
    workflowRun.conclusion = update.conclusion;
    return {
      runId,
      status: update.responseStatus,
    };
  }

  private setIssueLockState(
    state: GithubNamespaceState,
    repo: string,
    issueNumber: number,
    locked: boolean,
    lockReason?: string,
  ): Record<string, unknown> {
    const issue = this.findIssue(state, repo, issueNumber);
    issue.locked = locked;
    if (locked) {
      if (lockReason !== undefined) {
        issue.active_lock_reason = lockReason;
      }
    } else {
      delete issue.active_lock_reason;
    }
    return {
      issue_number: issueNumber,
      locked,
      ...(locked && lockReason !== undefined ? { lock_reason: lockReason } : {}),
    };
  }

  private runGithubOperation<TResult>(
    args: { namespace?: string | undefined; accessToken?: string | null | undefined },
    method: string,
    normalizedArgs: unknown,
    execute: (state: GithubNamespaceState) => Promise<TResult> | TResult,
  ): Promise<TResult> {
    return this.runProviderOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      assertToken: (accessToken) => this.assertToken(accessToken),
      mapError: toProviderSdkError,
      execute,
    });
  }

  private runGithubCachedOperation<TResult>(
    args: {
      namespace?: string | undefined;
      accessToken?: string | null | undefined;
      idempotencyKey?: string | undefined;
    },
    method: string,
    normalizedArgs: unknown,
    execute: (state: GithubNamespaceState) => Promise<TResult> | TResult,
  ): Promise<TResult> {
    return this.runProviderCachedOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      accessToken: args.accessToken,
      assertToken: (accessToken) => this.assertToken(accessToken),
      mapError: toProviderSdkError,
      getCachedValue: (state) =>
        this.getIdempotentResponse<TResult>(state, method, args.idempotencyKey),
      setCachedValue: (state, response) =>
        this.setIdempotentResponse(state, method, args.idempotencyKey, response),
      execute,
    });
  }

  private runGithubIdempotentOperation<TResult>(
    args: {
      namespace?: string | undefined;
      accessToken?: string | null | undefined;
      idempotencyKey?: string | undefined;
    },
    method: string,
    normalizedArgs: unknown,
    execute: (state: GithubNamespaceState) => Promise<TResult> | TResult,
  ): Promise<TResult> {
    return this.runProviderIdempotentOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      accessToken: args.accessToken,
      assertToken: (accessToken) => this.assertToken(accessToken),
      mapError: toProviderSdkError,
      getResponses: (state) => state.idempotentResponses,
      execute,
    });
  }

  private extractRepoFilters(query: string): string[] {
    return query
      .split(/\s+/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.startsWith("repo:"))
      .map((segment) => segment.slice("repo:".length))
      .filter((segment) => segment.length > 0);
  }

  private extractSearchTerms(query: string): string[] {
    return query
      .split(/\s+/)
      .map((segment) => segment.trim().toLowerCase())
      .filter((segment) => segment.length > 0 && !segment.startsWith("repo:"));
  }

  private matchesSearchTerms(entity: Record<string, unknown>, terms: string[]): boolean {
    if (terms.length === 0) {
      return true;
    }
    const haystack = `${String(entity.title ?? "")} ${String(entity.body ?? "")}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }

  private pullRequestFilesKey(repo: string, pullNumber: number): string {
    return `${repo}#${pullNumber}`;
  }

  private fileContentsKey(repo: string, path: string): string {
    return `${repo}:file:${path.trim().toLowerCase()}`;
  }

  private pullRequestReviewsKey(repo: string, pullNumber: number): string {
    return `${repo}#review#${pullNumber}`;
  }

  private issueCommentsKey(repo: string, issueNumber: number): string {
    return `${repo}:${issueNumber}`;
  }

  private issueReactionsKey(repo: string, issueNumber: number): string {
    return `${repo}:reaction:${issueNumber}`;
  }

  private checkRunsKey(repo: string, ref: string): string {
    return `${repo}:checks:${ref}`;
  }

  private commitStatusKey(repo: string, ref: string): string {
    return `${repo}:status:${ref}`;
  }

  private normalizeRepo(value: string): string {
    return value.trim().toLowerCase() || DEFAULT_REPO;
  }

  private assertToken(accessToken: string | null | undefined): void {
    if (!accessToken || !accessToken.trim()) {
      throw new Error("missing_access_token");
    }
    const normalized = accessToken.trim();
    if (normalized.includes("invalid") || normalized.includes("expired")) {
      throw new Error("invalid_access_token");
    }
  }
}

export class FakeGithubClientStore {
  private readonly engine: InMemoryGithubEngine;
  readonly createClient: CreateGithubClient;

  constructor(options?: { callLog?: ProviderSdkCallLog }) {
    this.engine = new InMemoryGithubEngine(options);
    this.createClient = (accessToken: string, namespace?: string) => {
      return createFakeGithubClient(this.engine, accessToken, namespace);
    };
  }

  reset(namespace?: string): void {
    this.engine.reset(namespace);
  }

  seed(namespace: string, seed: Record<string, unknown>): void {
    this.engine.seed(namespace, seed);
  }
}

export const createFakeGithubClientStore = (options?: {
  callLog?: ProviderSdkCallLog;
}): FakeGithubClientStore => {
  return new FakeGithubClientStore(options);
};
