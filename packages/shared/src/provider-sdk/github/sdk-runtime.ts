import type { ProviderSdkCallLog, ProviderSdkRuntime } from "../port.js";
import { BaseSdkPort } from "../base-sdk.js";
import { toProviderSdkError } from "./errors.js";
import type { CreateGithubClient } from "./client-interface.js";
import type {
  GithubAddAssigneesArgs,
  GithubAddLabelsArgs,
  GithubCancelWorkflowRunArgs,
  GithubCheckRun,
  GithubCommit,
  GithubCommitStatus,
  GithubCompareCommitsArgs,
  GithubCompareCommitsResult,
  GithubCreateDispatchEventArgs,
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
  GithubGenerateReleaseNotesArgs,
  GithubGetLatestReleaseArgs,
  GithubGetWorkflowJobLogsArgs,
  GithubGetIssueArgs,
  GithubGetCommitStatusArgs,
  GithubListIssueEventsArgs,
  GithubListIssueTimelineArgs,
  GithubListNotificationsArgs,
  GithubListOrgReposArgs,
  GithubListMilestonesArgs,
  GithubListBranchesArgs,
  GithubGetFileContentsArgs,
  GithubCreateOrUpdateFileArgs,
  GithubListLabelsArgs,
  GithubCreateLabelArgs,
  GithubGetPullRequestArgs,
  GithubGetRepoArgs,
  GithubListReleasesArgs,
  GithubGetWorkflowRunArgs,
  GithubBranch,
  GithubFileContents,
  GithubFileWriteResult,
  GithubIssue,
  GithubIssueComment,
  GithubIssueEvent,
  GithubIssueTimelineEvent,
  GithubLabel,
  GithubCodeSearchResult,
  GithubRepoSearchResult,
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
  GithubRepo,
  GithubRelease,
  GithubRequestReviewersArgs,
  GithubRerunFailedJobsArgs,
  GithubRerunWorkflowArgs,
  GithubCreateReleaseArgs,
  GithubCreateMilestoneArgs,
  GithubLockIssueArgs,
  GithubMarkNotificationsReadArgs,
  GithubRemoveAssigneesArgs,
  GithubRemoveLabelArgs,
  GithubRemoveReviewersArgs,
  GithubSearchCodeArgs,
  GithubSearchIssue,
  GithubSearchRepositoriesArgs,
  GithubSearchIssuesArgs,
  GithubSdkPort,
  GithubTriggerWorkflowArgs,
  GithubUnlockIssueArgs,
  GithubUpdateCommentArgs,
  GithubUpdateIssueArgs,
  GithubUpdatePRBranchArgs,
  GithubUpdateReleaseArgs,
  GithubUpdateMilestoneArgs,
  GithubUpdatePullRequestArgs,
  GithubWorkflowJobLogs,
  GithubReviewComment,
  GithubReaction,
  GithubWorkflowRun,
} from "./types.js";

const parseRepoIdentifier = (value: string): { owner: string; repo: string } => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("missing_repo");
  }

  const [owner, repo] = trimmed.split("/", 2);
  if (owner && repo) {
    return {
      owner,
      repo,
    };
  }

  return {
    owner: trimmed,
    repo: trimmed,
  };
};

const parseJsonIfNeeded = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const toBase64 = (value: string): string => {
  return Buffer.from(value, "utf8").toString("base64");
};

export class GithubSdk extends BaseSdkPort<CreateGithubClient> implements GithubSdkPort {
  constructor(options: {
    createClient: CreateGithubClient;
    runtime?: ProviderSdkRuntime;
    callLog?: ProviderSdkCallLog;
  }) {
    super({
      providerId: "github",
      createClient: options.createClient,
      ...(options.runtime ? { runtime: options.runtime } : {}),
      ...(options.callLog ? { callLog: options.callLog } : {}),
    });
  }

  async listIssues(args: GithubListIssuesArgs): Promise<GithubIssue[]> {
    const method = "github.issues.listForRepo";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      state: args.state,
      perPage: args.perPage,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.listForRepo({
        owner: target.owner,
        repo: target.repo,
        state: args.state,
        per_page: args.perPage,
      });

      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubIssue[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getIssue(args: GithubGetIssueArgs): Promise<GithubIssue> {
    const method = "github.issues.get";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.get({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
      });

      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object" ? (parsed as GithubIssue) : ({} as GithubIssue);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listIssueEvents(args: GithubListIssueEventsArgs): Promise<GithubIssueEvent[]> {
    const method = "github.issues.listEvents";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
      perPage: args.perPage,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.listEvents({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
        per_page: args.perPage,
      });

      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubIssueEvent[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listIssueTimeline(args: GithubListIssueTimelineArgs): Promise<GithubIssueTimelineEvent[]> {
    const method = "github.issues.listEventsForTimeline";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
      perPage: args.perPage,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.listEventsForTimeline({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
        per_page: args.perPage,
      });

      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubIssueTimelineEvent[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createIssue(args: GithubCreateIssueArgs): Promise<GithubIssue> {
    const method = "github.issues.create";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      title: args.title,
      body: args.body ?? "",
      labels: args.labels ?? [],
      assignees: args.assignees ?? [],
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.create({
        owner: target.owner,
        repo: target.repo,
        title: args.title,
        ...(args.body ? { body: args.body } : {}),
        ...(args.labels && args.labels.length > 0 ? { labels: args.labels } : {}),
        ...(args.assignees && args.assignees.length > 0 ? { assignees: args.assignees } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });

      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object" ? (parsed as GithubIssue) : ({} as GithubIssue);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async updateIssue(args: GithubUpdateIssueArgs): Promise<GithubIssue> {
    const method = "github.issues.update";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
      title: args.title,
      body: args.body,
      state: args.state,
      labels: args.labels,
      assignees: args.assignees,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.update({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.state !== undefined ? { state: args.state } : {}),
        ...(args.labels !== undefined ? { labels: args.labels } : {}),
        ...(args.assignees !== undefined ? { assignees: args.assignees } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });

      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object" ? (parsed as GithubIssue) : ({} as GithubIssue);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async createIssueComment(args: GithubCreateIssueCommentArgs): Promise<GithubIssueComment> {
    const method = "github.issues.createComment";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
      body: args.body,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.createComment({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
        body: args.body,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });

      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubIssueComment)
          : {
              id: 0,
              body: "",
              html_url: "",
              issue_url: "",
              created_at: "",
              updated_at: "",
            };
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listPullRequests(args: GithubListPullRequestsArgs): Promise<GithubPullRequest[]> {
    const method = "github.pulls.list";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      state: args.state,
      perPage: args.perPage,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.list({
        owner: target.owner,
        repo: target.repo,
        state: args.state,
        per_page: args.perPage,
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubPullRequest[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getPullRequest(args: GithubGetPullRequestArgs): Promise<GithubPullRequest> {
    const method = "github.pulls.get";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      pullNumber: args.pullNumber,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.get({
        owner: target.owner,
        repo: target.repo,
        pull_number: args.pullNumber,
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubPullRequest)
          : ({} as GithubPullRequest);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createPullRequest(args: GithubCreatePullRequestArgs): Promise<GithubPullRequest> {
    const method = "github.pulls.create";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      title: args.title,
      head: args.head,
      base: args.base,
      body: args.body ?? "",
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.create({
        owner: target.owner,
        repo: target.repo,
        title: args.title,
        head: args.head,
        base: args.base,
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubPullRequest)
          : ({} as GithubPullRequest);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async mergePullRequest(args: GithubMergePullRequestArgs): Promise<GithubMergeResult> {
    const method = "github.pulls.merge";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      pullNumber: args.pullNumber,
      mergeMethod: args.mergeMethod ?? "merge",
      commitTitle: args.commitTitle ?? "",
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.merge({
        owner: target.owner,
        repo: target.repo,
        pull_number: args.pullNumber,
        ...(args.mergeMethod !== undefined ? { merge_method: args.mergeMethod } : {}),
        ...(args.commitTitle !== undefined ? { commit_title: args.commitTitle } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubMergeResult)
          : ({} as GithubMergeResult);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listPullRequestFiles(
    args: GithubListPullRequestFilesArgs,
  ): Promise<GithubPullRequestFile[]> {
    const method = "github.pulls.listFiles";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      pullNumber: args.pullNumber,
      perPage: args.perPage,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.listFiles({
        owner: target.owner,
        repo: target.repo,
        pull_number: args.pullNumber,
        per_page: args.perPage,
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubPullRequestFile[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async addLabels(args: GithubAddLabelsArgs): Promise<GithubLabel[]> {
    const method = "github.issues.addLabels";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
      labels: args.labels,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.addLabels({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
        labels: args.labels,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubLabel[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async removeLabel(args: GithubRemoveLabelArgs): Promise<GithubLabel[]> {
    const method = "github.issues.removeLabel";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
      label: args.label,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.removeLabel({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
        name: args.label,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubLabel[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async addAssignees(args: GithubAddAssigneesArgs): Promise<GithubIssue> {
    const method = "github.issues.addAssignees";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
      assignees: args.assignees,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.addAssignees({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
        assignees: args.assignees,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object" ? (parsed as GithubIssue) : ({} as GithubIssue);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async removeAssignees(args: GithubRemoveAssigneesArgs): Promise<GithubIssue> {
    const method = "github.issues.removeAssignees";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
      assignees: args.assignees,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.removeAssignees({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
        assignees: args.assignees,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object" ? (parsed as GithubIssue) : ({} as GithubIssue);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async searchIssues(args: GithubSearchIssuesArgs): Promise<GithubSearchIssue[]> {
    const method = "github.search.issuesAndPullRequests";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      perPage: args.perPage,
    };

    try {
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.search.issuesAndPullRequests({
        q: args.query,
        per_page: args.perPage,
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { items?: unknown[] }).items)
          ? ((parsed as { items: unknown[] }).items as GithubSearchIssue[])
          : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listReviews(args: GithubListReviewsArgs): Promise<GithubPullRequestReview[]> {
    const method = "github.pulls.listReviews";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      pullNumber: args.pullNumber,
      perPage: args.perPage,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.listReviews({
        owner: target.owner,
        repo: target.repo,
        pull_number: args.pullNumber,
        per_page: args.perPage,
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubPullRequestReview[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listCommits(args: GithubListCommitsArgs): Promise<GithubCommit[]> {
    const method = "github.repos.listCommits";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      perPage: args.perPage,
      sha: args.sha,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.listCommits({
        owner: target.owner,
        repo: target.repo,
        per_page: args.perPage,
        ...(args.sha !== undefined ? { sha: args.sha } : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubCommit[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async compareCommits(args: GithubCompareCommitsArgs): Promise<GithubCompareCommitsResult> {
    const method = "github.repos.compareCommits";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      base: args.base,
      head: args.head,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.compareCommits({
        owner: target.owner,
        repo: target.repo,
        base: args.base,
        head: args.head,
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubCompareCommitsResult)
          : ({} as GithubCompareCommitsResult);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getCommitStatus(args: GithubGetCommitStatusArgs): Promise<GithubCommitStatus> {
    const method = "github.repos.getCombinedStatusForRef";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      ref: args.ref,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.getCombinedStatusForRef({
        owner: target.owner,
        repo: target.repo,
        ref: args.ref,
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubCommitStatus)
          : ({ state: "unknown" } as GithubCommitStatus);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listCheckRuns(args: GithubListCheckRunsArgs): Promise<GithubCheckRun[]> {
    const method = "github.checks.listForRef";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      ref: args.ref,
      perPage: args.perPage,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.checks.listForRef({
        owner: target.owner,
        repo: target.repo,
        ref: args.ref,
        per_page: args.perPage,
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { check_runs?: unknown[] }).check_runs)
          ? ((parsed as { check_runs: unknown[] }).check_runs as GithubCheckRun[])
          : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listWorkflowRuns(args: GithubListWorkflowRunsArgs): Promise<GithubWorkflowRun[]> {
    const method = "github.actions.listWorkflowRunsForRepo";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      perPage: args.perPage,
      branch: args.branch,
      status: args.status,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.actions.listWorkflowRunsForRepo({
        owner: target.owner,
        repo: target.repo,
        per_page: args.perPage,
        ...(args.branch !== undefined ? { branch: args.branch } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { workflow_runs?: unknown[] }).workflow_runs)
          ? ((parsed as { workflow_runs: unknown[] }).workflow_runs as GithubWorkflowRun[])
          : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getWorkflowRun(args: GithubGetWorkflowRunArgs): Promise<GithubWorkflowRun> {
    const method = "github.actions.getWorkflowRun";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      runId: args.runId,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.actions.getWorkflowRun({
        owner: target.owner,
        repo: target.repo,
        run_id: args.runId,
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubWorkflowRun)
          : ({ id: args.runId } as GithubWorkflowRun);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listPullRequestCommits(args: GithubListPullRequestCommitsArgs): Promise<GithubCommit[]> {
    const method = "github.pulls.listCommits";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      pullNumber: args.pullNumber,
      perPage: args.perPage,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.listCommits({
        owner: target.owner,
        repo: target.repo,
        pull_number: args.pullNumber,
        per_page: args.perPage,
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubCommit[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listIssueComments(args: GithubListIssueCommentsArgs): Promise<GithubIssueComment[]> {
    const method = "github.issues.listComments";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
      perPage: args.perPage,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.listComments({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
        per_page: args.perPage,
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubIssueComment[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listReleases(args: GithubListReleasesArgs): Promise<GithubRelease[]> {
    const method = "github.repos.listReleases";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      perPage: args.perPage,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.listReleases({
        owner: target.owner,
        repo: target.repo,
        per_page: args.perPage,
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubRelease[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getLatestRelease(args: GithubGetLatestReleaseArgs): Promise<GithubRelease> {
    const method = "github.repos.getLatestRelease";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.getLatestRelease({
        owner: target.owner,
        repo: target.repo,
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubRelease)
          : ({ id: 0, tag_name: "" } as GithubRelease);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createRelease(args: GithubCreateReleaseArgs): Promise<GithubRelease> {
    const method = "github.repos.createRelease";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      tagName: args.tagName,
      targetCommitish: args.targetCommitish,
      name: args.name,
      body: args.body,
      draft: args.draft ?? false,
      prerelease: args.prerelease ?? false,
      generateReleaseNotes: args.generateReleaseNotes ?? false,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.createRelease({
        owner: target.owner,
        repo: target.repo,
        tag_name: args.tagName,
        ...(args.targetCommitish !== undefined ? { target_commitish: args.targetCommitish } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.draft !== undefined ? { draft: args.draft } : {}),
        ...(args.prerelease !== undefined ? { prerelease: args.prerelease } : {}),
        ...(args.generateReleaseNotes !== undefined
          ? { generate_release_notes: args.generateReleaseNotes }
          : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubRelease)
          : ({ id: 0, tag_name: args.tagName } as GithubRelease);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async updateRelease(args: GithubUpdateReleaseArgs): Promise<GithubRelease> {
    const method = "github.repos.updateRelease";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      releaseId: args.releaseId,
      tagName: args.tagName,
      targetCommitish: args.targetCommitish,
      name: args.name,
      body: args.body,
      draft: args.draft,
      prerelease: args.prerelease,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.updateRelease({
        owner: target.owner,
        repo: target.repo,
        release_id: args.releaseId,
        ...(args.tagName !== undefined ? { tag_name: args.tagName } : {}),
        ...(args.targetCommitish !== undefined ? { target_commitish: args.targetCommitish } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.draft !== undefined ? { draft: args.draft } : {}),
        ...(args.prerelease !== undefined ? { prerelease: args.prerelease } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubRelease)
          : ({ id: args.releaseId, tag_name: args.tagName ?? "" } as GithubRelease);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async generateReleaseNotes(
    args: GithubGenerateReleaseNotesArgs,
  ): Promise<Record<string, unknown>> {
    const method = "github.repos.generateReleaseNotes";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      tagName: args.tagName,
      targetCommitish: args.targetCommitish,
      previousTagName: args.previousTagName,
      configurationFilePath: args.configurationFilePath,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.generateReleaseNotes({
        owner: target.owner,
        repo: target.repo,
        tag_name: args.tagName,
        ...(args.targetCommitish !== undefined ? { target_commitish: args.targetCommitish } : {}),
        ...(args.previousTagName !== undefined ? { previous_tag_name: args.previousTagName } : {}),
        ...(args.configurationFilePath !== undefined
          ? { configuration_file_path: args.configurationFilePath }
          : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {
              name: `Release ${args.tagName}`,
              body: `## What's Changed\n- Generated notes for ${args.tagName}`,
            };
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listMilestones(args: GithubListMilestonesArgs): Promise<GithubMilestone[]> {
    const method = "github.issues.listMilestones";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      state: args.state,
      perPage: args.perPage,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.listMilestones({
        owner: target.owner,
        repo: target.repo,
        state: args.state,
        per_page: args.perPage,
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubMilestone[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createMilestone(args: GithubCreateMilestoneArgs): Promise<GithubMilestone> {
    const method = "github.issues.createMilestone";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      title: args.title,
      state: args.state ?? "open",
      description: args.description,
      dueOn: args.dueOn,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.createMilestone({
        owner: target.owner,
        repo: target.repo,
        title: args.title,
        ...(args.state !== undefined ? { state: args.state } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.dueOn !== undefined ? { due_on: args.dueOn } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubMilestone)
          : ({
              id: 0,
              number: 0,
              title: args.title,
              state: args.state ?? "open",
            } as GithubMilestone);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async updateMilestone(args: GithubUpdateMilestoneArgs): Promise<GithubMilestone> {
    const method = "github.issues.updateMilestone";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      milestone: args.milestone,
      title: args.title,
      state: args.state,
      description: args.description,
      dueOn: args.dueOn,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.updateMilestone({
        owner: target.owner,
        repo: target.repo,
        milestone_number: args.milestone,
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.state !== undefined ? { state: args.state } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.dueOn !== undefined ? { due_on: args.dueOn } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubMilestone)
          : ({
              id: args.milestone,
              number: args.milestone,
              title: args.title ?? "",
              state: args.state ?? "open",
            } as GithubMilestone);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async createReview(args: GithubCreateReviewArgs): Promise<GithubPullRequestReview> {
    const method = "github.pulls.createReview";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      pullNumber: args.pullNumber,
      event: args.event,
      body: args.body ?? "",
      commitId: args.commitId,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.createReview({
        owner: target.owner,
        repo: target.repo,
        pull_number: args.pullNumber,
        event: args.event,
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.commitId !== undefined ? { commit_id: args.commitId } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubPullRequestReview)
          : ({ id: 0, state: "PENDING" } as GithubPullRequestReview);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async dismissReview(args: GithubDismissReviewArgs): Promise<GithubPullRequestReview> {
    const method = "github.pulls.dismissReview";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      pullNumber: args.pullNumber,
      reviewId: args.reviewId,
      message: args.message,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.dismissReview({
        owner: target.owner,
        repo: target.repo,
        pull_number: args.pullNumber,
        review_id: args.reviewId,
        message: args.message,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubPullRequestReview)
          : ({ id: args.reviewId, state: "DISMISSED" } as GithubPullRequestReview);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async requestReviewers(args: GithubRequestReviewersArgs): Promise<GithubPullRequest> {
    const method = "github.pulls.requestReviewers";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      pullNumber: args.pullNumber,
      reviewers: args.reviewers,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.requestReviewers({
        owner: target.owner,
        repo: target.repo,
        pull_number: args.pullNumber,
        reviewers: args.reviewers,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubPullRequest)
          : ({} as GithubPullRequest);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async removeReviewers(args: GithubRemoveReviewersArgs): Promise<GithubPullRequest> {
    const method = "github.pulls.removeRequestedReviewers";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      pullNumber: args.pullNumber,
      reviewers: args.reviewers,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.removeRequestedReviewers({
        owner: target.owner,
        repo: target.repo,
        pull_number: args.pullNumber,
        reviewers: args.reviewers,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubPullRequest)
          : ({} as GithubPullRequest);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async createReviewComment(args: GithubCreateReviewCommentArgs): Promise<GithubReviewComment> {
    const method = "github.pulls.createReviewComment";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      pullNumber: args.pullNumber,
      body: args.body,
      path: args.path,
      line: args.line,
      commitId: args.commitId,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.createReviewComment({
        owner: target.owner,
        repo: target.repo,
        pull_number: args.pullNumber,
        body: args.body,
        path: args.path,
        line: args.line,
        ...(args.commitId !== undefined ? { commit_id: args.commitId } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubReviewComment)
          : ({
              id: 0,
              body: args.body,
              path: args.path,
              line: args.line,
            } as GithubReviewComment);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listNotifications(args: GithubListNotificationsArgs): Promise<GithubNotification[]> {
    const method = "github.activity.listNotificationsForAuthenticatedUser";
    const normalizedArgs = {
      namespace: args.namespace,
      all: args.all ?? false,
      participating: args.participating ?? false,
      since: args.since,
      before: args.before,
      perPage: args.perPage,
    };

    try {
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.activity.listNotificationsForAuthenticatedUser({
        ...(args.all !== undefined ? { all: args.all } : {}),
        ...(args.participating !== undefined ? { participating: args.participating } : {}),
        ...(args.since !== undefined ? { since: args.since } : {}),
        ...(args.before !== undefined ? { before: args.before } : {}),
        per_page: args.perPage,
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubNotification[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getWorkflowJobLogs(args: GithubGetWorkflowJobLogsArgs): Promise<GithubWorkflowJobLogs> {
    const method = "github.actions.downloadJobLogsForWorkflowRun";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      jobId: args.jobId,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.actions.downloadJobLogsForWorkflowRun({
        owner: target.owner,
        repo: target.repo,
        job_id: args.jobId,
      });

      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? ({
              job_id: Number((parsed as { job_id?: unknown }).job_id ?? args.jobId),
              download_url: String(
                (parsed as { download_url?: unknown }).download_url ??
                  `https://example.test/${target.owner}/${target.repo}/actions/jobs/${args.jobId}/logs`,
              ),
              ...(parsed as Record<string, unknown>),
            } as GithubWorkflowJobLogs)
          : ({
              job_id: args.jobId,
              download_url: `https://example.test/${target.owner}/${target.repo}/actions/jobs/${args.jobId}/logs`,
            } as GithubWorkflowJobLogs);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async triggerWorkflow(args: GithubTriggerWorkflowArgs): Promise<Record<string, unknown>> {
    const method = "github.actions.createWorkflowDispatch";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      workflowId: args.workflowId,
      ref: args.ref,
      inputs: args.inputs ?? {},
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.actions.createWorkflowDispatch({
        owner: target.owner,
        repo: target.repo,
        workflow_id: args.workflowId,
        ref: args.ref,
        ...(args.inputs !== undefined ? { inputs: args.inputs } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {
              workflowId: args.workflowId,
              ref: args.ref,
              dispatched: true,
            };
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async cancelWorkflowRun(args: GithubCancelWorkflowRunArgs): Promise<Record<string, unknown>> {
    const method = "github.actions.cancelWorkflowRun";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      runId: args.runId,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.actions.cancelWorkflowRun({
        owner: target.owner,
        repo: target.repo,
        run_id: args.runId,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {
              runId: args.runId,
              status: "cancel_requested",
            };
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async rerunWorkflow(args: GithubRerunWorkflowArgs): Promise<Record<string, unknown>> {
    const method = "github.actions.reRunWorkflow";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      runId: args.runId,
      enableDebugLogging: args.enableDebugLogging ?? false,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.actions.reRunWorkflow({
        owner: target.owner,
        repo: target.repo,
        run_id: args.runId,
        ...(args.enableDebugLogging !== undefined
          ? { enable_debug_logging: args.enableDebugLogging }
          : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {
              runId: args.runId,
              status: "rerun_requested",
            };
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async lockIssue(args: GithubLockIssueArgs): Promise<Record<string, unknown>> {
    const method = "github.issues.lock";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
      lockReason: args.lockReason,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.lock({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
        ...(args.lockReason !== undefined ? { lock_reason: args.lockReason } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? ({ ...parsed, locked: true, issue_number: args.issue } as Record<string, unknown>)
          : ({ locked: true, issue_number: args.issue } as Record<string, unknown>);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async unlockIssue(args: GithubUnlockIssueArgs): Promise<Record<string, unknown>> {
    const method = "github.issues.unlock";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.unlock({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? ({ ...parsed, locked: false, issue_number: args.issue } as Record<string, unknown>)
          : ({ locked: false, issue_number: args.issue } as Record<string, unknown>);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async markNotificationsRead(
    args: GithubMarkNotificationsReadArgs,
  ): Promise<Record<string, unknown>> {
    const method = "github.activity.markNotificationsAsRead";
    const normalizedArgs = {
      namespace: args.namespace,
      lastReadAt: args.lastReadAt,
    };

    try {
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.activity.markNotificationsAsRead({
        ...(args.lastReadAt !== undefined ? { last_read_at: args.lastReadAt } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? ({ ...parsed, marked: true } as Record<string, unknown>)
          : ({ marked: true } as Record<string, unknown>);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async rerunFailedJobs(args: GithubRerunFailedJobsArgs): Promise<Record<string, unknown>> {
    const method = "github.actions.reRunWorkflowFailedJobs";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      runId: args.runId,
      enableDebugLogging: args.enableDebugLogging ?? false,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.actions.reRunWorkflowFailedJobs({
        owner: target.owner,
        repo: target.repo,
        run_id: args.runId,
        ...(args.enableDebugLogging !== undefined
          ? { enable_debug_logging: args.enableDebugLogging }
          : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? ({ ...parsed, runId: args.runId, status: "rerun_failed_jobs_requested" } as Record<
              string,
              unknown
            >)
          : ({ runId: args.runId, status: "rerun_failed_jobs_requested" } as Record<
              string,
              unknown
            >);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async updatePRBranch(args: GithubUpdatePRBranchArgs): Promise<Record<string, unknown>> {
    const method = "github.pulls.updateBranch";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      pullNumber: args.pullNumber,
      expectedHeadSha: args.expectedHeadSha,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.updateBranch({
        owner: target.owner,
        repo: target.repo,
        pull_number: args.pullNumber,
        ...(args.expectedHeadSha !== undefined ? { expected_head_sha: args.expectedHeadSha } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? ({ ...parsed, pull_number: args.pullNumber, updated: true } as Record<string, unknown>)
          : ({ pull_number: args.pullNumber, updated: true } as Record<string, unknown>);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async createReaction(args: GithubCreateReactionArgs): Promise<GithubReaction> {
    const method = "github.reactions.createForIssue";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
      content: args.content,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.reactions.createForIssue({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
        content: args.content,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });

      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubReaction)
          : ({
              id: 0,
              content: args.content,
            } as GithubReaction);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async deleteReaction(args: GithubDeleteReactionArgs): Promise<GithubDeleteResult> {
    const method = "github.reactions.deleteForIssue";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      issue: args.issue,
      reactionId: args.reactionId,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.reactions.deleteForIssue({
        owner: target.owner,
        repo: target.repo,
        issue_number: args.issue,
        reaction_id: args.reactionId,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? ({ deleted: true, id: args.reactionId, ...parsed } as GithubDeleteResult)
          : ({
              deleted: true,
              id: args.reactionId,
            } as GithubDeleteResult);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async createDispatchEvent(args: GithubCreateDispatchEventArgs): Promise<Record<string, unknown>> {
    const method = "github.repos.createDispatchEvent";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      eventType: args.eventType,
      clientPayload: args.clientPayload ?? {},
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.createDispatchEvent({
        owner: target.owner,
        repo: target.repo,
        event_type: args.eventType,
        ...(args.clientPayload !== undefined ? { client_payload: args.clientPayload } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? ({ ...parsed, dispatched: true } as Record<string, unknown>)
          : ({
              dispatched: true,
              event_type: args.eventType,
            } as Record<string, unknown>);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async updatePullRequest(args: GithubUpdatePullRequestArgs): Promise<GithubPullRequest> {
    const method = "github.pulls.update";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      pullNumber: args.pullNumber,
      title: args.title,
      body: args.body,
      state: args.state,
      base: args.base,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.pulls.update({
        owner: target.owner,
        repo: target.repo,
        pull_number: args.pullNumber,
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.state !== undefined ? { state: args.state } : {}),
        ...(args.base !== undefined ? { base: args.base } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubPullRequest)
          : ({} as GithubPullRequest);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async updateComment(args: GithubUpdateCommentArgs): Promise<GithubIssueComment> {
    const method = "github.issues.updateComment";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      commentId: args.commentId,
      body: args.body,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.updateComment({
        owner: target.owner,
        repo: target.repo,
        comment_id: args.commentId,
        body: args.body,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? (parsed as GithubIssueComment)
          : {
              id: args.commentId,
              body: args.body,
              html_url: "",
              issue_url: "",
              created_at: "",
              updated_at: "",
            };
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async deleteComment(args: GithubDeleteCommentArgs): Promise<GithubDeleteResult> {
    const method = "github.issues.deleteComment";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      commentId: args.commentId,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.deleteComment({
        owner: target.owner,
        repo: target.repo,
        comment_id: args.commentId,
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as GithubDeleteResult)
          : {
              deleted: true,
              id: args.commentId,
            };
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async searchCode(args: GithubSearchCodeArgs): Promise<GithubCodeSearchResult[]> {
    const method = "github.search.code";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      perPage: args.perPage,
    };

    try {
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.search.code({
        q: args.query,
        per_page: args.perPage,
      });

      const parsed = parseJsonIfNeeded(data);
      const items =
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { items?: unknown[] }).items)
          ? ((parsed as { items: GithubCodeSearchResult[] }).items ?? [])
          : [];
      this.captureOk(args.namespace, method, normalizedArgs, items);
      return items;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async searchRepositories(args: GithubSearchRepositoriesArgs): Promise<GithubRepoSearchResult[]> {
    const method = "github.search.repos";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      perPage: args.perPage,
    };

    try {
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.search.repos({
        q: args.query,
        per_page: args.perPage,
      });

      const parsed = parseJsonIfNeeded(data);
      const items =
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { items?: unknown[] }).items)
          ? ((parsed as { items: GithubRepoSearchResult[] }).items ?? [])
          : [];
      this.captureOk(args.namespace, method, normalizedArgs, items);
      return items;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getRepo(args: GithubGetRepoArgs): Promise<GithubRepo> {
    const method = "github.repos.get";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.get({
        owner: target.owner,
        repo: target.repo,
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object" ? (parsed as GithubRepo) : ({} as GithubRepo);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listOrgRepos(args: GithubListOrgReposArgs): Promise<GithubRepo[]> {
    const method = "github.repos.listForOrg";
    const normalizedArgs = {
      namespace: args.namespace,
      org: args.org,
      type: args.type ?? "all",
      perPage: args.perPage,
    };

    try {
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.listForOrg({
        org: args.org,
        ...(args.type !== undefined ? { type: args.type } : {}),
        per_page: args.perPage,
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubRepo[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listBranches(args: GithubListBranchesArgs): Promise<GithubBranch[]> {
    const method = "github.repos.listBranches";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      perPage: args.perPage,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.listBranches({
        owner: target.owner,
        repo: target.repo,
        per_page: args.perPage,
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubBranch[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getFileContents(args: GithubGetFileContentsArgs): Promise<GithubFileContents> {
    const method = "github.repos.getContent";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      path: args.path,
      ref: args.ref,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.getContent({
        owner: target.owner,
        repo: target.repo,
        path: args.path,
        ...(args.ref !== undefined ? { ref: args.ref } : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object"
          ? Array.isArray(parsed)
            ? ({
                type: "dir",
                name: args.path.split("/").pop() ?? args.path,
                path: args.path,
                sha: "",
                entries: parsed,
              } as GithubFileContents)
            : (parsed as GithubFileContents)
          : ({
              type: "file",
              name: args.path.split("/").pop() ?? args.path,
              path: args.path,
              sha: "",
            } as GithubFileContents);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createOrUpdateFile(args: GithubCreateOrUpdateFileArgs): Promise<GithubFileWriteResult> {
    const method = "github.repos.createOrUpdateFileContents";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      path: args.path,
      message: args.message,
      sha: args.sha,
      branch: args.branch,
      committerName: args.committerName,
      committerEmail: args.committerEmail,
      authorName: args.authorName,
      authorEmail: args.authorEmail,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.repos.createOrUpdateFileContents({
        owner: target.owner,
        repo: target.repo,
        path: args.path,
        message: args.message,
        content: toBase64(args.content),
        ...(args.sha !== undefined ? { sha: args.sha } : {}),
        ...(args.branch !== undefined ? { branch: args.branch } : {}),
        ...(args.committerName && args.committerEmail
          ? {
              committer: {
                name: args.committerName,
                email: args.committerEmail,
              },
            }
          : {}),
        ...(args.authorName && args.authorEmail
          ? {
              author: {
                name: args.authorName,
                email: args.authorEmail,
              },
            }
          : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as GithubFileWriteResult)
          : ({
              path: args.path,
              sha: args.sha ?? "",
            } as GithubFileWriteResult);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listLabels(args: GithubListLabelsArgs): Promise<GithubLabel[]> {
    const method = "github.issues.listLabelsForRepo";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      perPage: args.perPage,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.listLabelsForRepo({
        owner: target.owner,
        repo: target.repo,
        per_page: args.perPage,
      });
      const parsed = parseJsonIfNeeded(data);
      const response = Array.isArray(parsed) ? (parsed as GithubLabel[]) : [];
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createLabel(args: GithubCreateLabelArgs): Promise<GithubLabel> {
    const method = "github.issues.createLabel";
    const normalizedArgs = {
      namespace: args.namespace,
      repo: args.repo,
      name: args.name,
      color: args.color,
      description: args.description,
    };

    try {
      const target = parseRepoIdentifier(args.repo);
      const octokit = this.createClient(args.accessToken, args.namespace);
      const { data } = await octokit.issues.createLabel({
        owner: target.owner,
        repo: target.repo,
        name: args.name,
        color: args.color,
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.idempotencyKey
          ? {
              headers: {
                "x-idempotency-key": args.idempotencyKey,
              },
            }
          : {}),
      });
      const parsed = parseJsonIfNeeded(data);
      const response =
        parsed && typeof parsed === "object" ? (parsed as GithubLabel) : ({} as GithubLabel);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }
}
