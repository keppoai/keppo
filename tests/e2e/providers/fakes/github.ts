import {
  createFakeGithubClientStore,
  createFakeGithubSdk,
  type FakeGithubClientStore,
} from "../../../../packages/shared/src/provider-sdk/github/fake.js";
import { BaseProviderFake } from "../base-fake";
import type { ProviderReadRequest, ProviderWriteRequest } from "../contract/provider-contract";

const defaultFakeToken = (): string =>
  process.env.KEPPO_FAKE_GITHUB_ACCESS_TOKEN ?? "fake_github_access_token";

const parseBody = (input: unknown): Record<string, unknown> => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string" && input.trim().length > 0) {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return Object.fromEntries(new URLSearchParams(input).entries());
    }
  }
  return {};
};

const parseLimit = (value: string | undefined, fallback = 20): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
};

const parseStringRecord = (value: unknown): Record<string, string> => {
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

const decodeMaybeBase64 = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length % 4 !== 0) {
    return value;
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    return value;
  }
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (
      Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/g, "") ===
      trimmed.replace(/=+$/g, "")
    ) {
      return decoded;
    }
    return value;
  } catch {
    return value;
  }
};

export class GithubFake extends BaseProviderFake {
  private readonly clientStore: FakeGithubClientStore = createFakeGithubClientStore();
  private readonly sdk = createFakeGithubSdk({ clientStore: this.clientStore });

  override async listResources(request: ProviderReadRequest): Promise<Record<string, unknown>> {
    if (request.resource === "issues") {
      const repo = request.query.repo ?? "keppo";
      const issues = await this.sdk.listIssues({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        state:
          request.query.state === "closed" || request.query.state === "all"
            ? request.query.state
            : "open",
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        items: issues,
      };
    }

    if (request.resource === "branches") {
      const repo = request.query.repo ?? "keppo";
      const branches = await this.sdk.listBranches({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        items: branches,
      };
    }

    if (request.resource === "pulls") {
      const repo = request.query.repo ?? "keppo";
      const pulls = await this.sdk.listPullRequests({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        state:
          request.query.state === "closed" || request.query.state === "all"
            ? request.query.state
            : "open",
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        items: pulls,
      };
    }

    if (request.resource === "pulls/files") {
      const repo = request.query.repo ?? "keppo";
      const pullNumber = Number(request.query.pull_number ?? "0");
      const files = await this.sdk.listPullRequestFiles({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        pullNumber,
        perPage: parseLimit(request.query.per_page, 50),
      });
      return {
        items: files,
      };
    }

    if (request.resource === "pulls/reviews") {
      const repo = request.query.repo ?? "keppo";
      const pullNumber = Number(request.query.pull_number ?? "0");
      const reviews = await this.sdk.listReviews({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        pullNumber,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        items: reviews,
      };
    }

    if (request.resource === "commits") {
      const repo = request.query.repo ?? "keppo";
      const commits = await this.sdk.listCommits({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        perPage: parseLimit(request.query.per_page, 20),
        sha: request.query.sha || undefined,
      });
      return {
        items: commits,
      };
    }

    if (request.resource === "pulls/commits") {
      const repo = request.query.repo ?? "keppo";
      const pullNumber = Number(request.query.pull_number ?? "0");
      const commits = await this.sdk.listPullRequestCommits({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        pullNumber,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        items: commits,
      };
    }

    if (request.resource === "checks") {
      const repo = request.query.repo ?? "keppo";
      const ref = request.query.ref ?? "abc123";
      const checkRuns = await this.sdk.listCheckRuns({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        ref,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        total_count: checkRuns.length,
        check_runs: checkRuns,
      };
    }

    if (request.resource === "actions/runs") {
      const repo = request.query.repo ?? "keppo";
      const workflowRuns = await this.sdk.listWorkflowRuns({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        perPage: parseLimit(request.query.per_page, 20),
        branch: request.query.branch || undefined,
        status: request.query.status || undefined,
      });
      return {
        total_count: workflowRuns.length,
        workflow_runs: workflowRuns,
      };
    }

    if (request.resource === "issues/comments") {
      const repo = request.query.repo ?? "keppo";
      const issue = Number(request.query.issue_number ?? "0");
      const comments = await this.sdk.listIssueComments({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        issue,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        items: comments,
      };
    }

    if (request.resource === "issues/events") {
      const repo = request.query.repo ?? "keppo";
      const issue = Number(request.query.issue_number ?? "0");
      const events = await this.sdk.listIssueEvents({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        issue,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        items: events,
      };
    }

    if (request.resource === "issues/timeline") {
      const repo = request.query.repo ?? "keppo";
      const issue = Number(request.query.issue_number ?? "0");
      const timeline = await this.sdk.listIssueTimeline({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        issue,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        items: timeline,
      };
    }

    if (request.resource === "releases") {
      const repo = request.query.repo ?? "keppo";
      const releases = await this.sdk.listReleases({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        items: releases,
      };
    }

    if (request.resource === "milestones") {
      const repo = request.query.repo ?? "keppo";
      const state =
        request.query.state === "all" || request.query.state === "closed"
          ? request.query.state
          : "open";
      const milestones = await this.sdk.listMilestones({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        state,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        items: milestones,
      };
    }

    if (request.resource === "labels") {
      const repo = request.query.repo ?? "keppo";
      const labels = await this.sdk.listLabels({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        items: labels,
      };
    }

    if (request.resource === "search/issues") {
      const query = request.query.q ?? "";
      const results = await this.sdk.searchIssues({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        query,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        total_count: results.length,
        incomplete_results: false,
        items: results,
      };
    }

    if (request.resource === "search/code") {
      const query = request.query.q ?? "";
      const results = await this.sdk.searchCode({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        query,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        total_count: results.length,
        incomplete_results: false,
        items: results,
      };
    }

    if (request.resource === "search/repositories") {
      const query = request.query.q ?? "";
      const repositories = await this.sdk.searchRepositories({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        query,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        total_count: repositories.length,
        incomplete_results: false,
        items: repositories,
      };
    }

    if (request.resource === "notifications") {
      const notifications = await this.sdk.listNotifications({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        all: request.query.all === "true",
        participating: request.query.participating === "true",
        since: request.query.since || undefined,
        before: request.query.before || undefined,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        items: notifications,
      };
    }

    if (request.resource === "org/repos") {
      const org = request.query.org ?? "org";
      const type =
        request.query.type === "public" ||
        request.query.type === "private" ||
        request.query.type === "forks" ||
        request.query.type === "sources" ||
        request.query.type === "member"
          ? request.query.type
          : "all";
      const repos = await this.sdk.listOrgRepos({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        org,
        type,
        perPage: parseLimit(request.query.per_page, 20),
      });
      return {
        items: repos,
      };
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override async readResource(request: ProviderReadRequest): Promise<Record<string, unknown>> {
    if (request.resource.startsWith("issues/")) {
      const issue = Number(request.resource.replace("issues/", ""));
      return await this.sdk.getIssue({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: request.query.repo ?? "keppo",
        issue,
      });
    }

    if (request.resource.startsWith("pulls/")) {
      const pullNumber = Number(request.resource.replace("pulls/", ""));
      return await this.sdk.getPullRequest({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: request.query.repo ?? "keppo",
        pullNumber,
      });
    }

    if (request.resource.startsWith("repos/")) {
      const repo = request.resource.replace("repos/", "");
      return await this.sdk.getRepo({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
      });
    }

    if (request.resource.startsWith("contents/")) {
      const path = request.resource.replace("contents/", "");
      return await this.sdk.getFileContents({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: request.query.repo ?? "keppo",
        path,
        ref: request.query.ref || undefined,
      });
    }

    if (request.resource.startsWith("compare/")) {
      const repo = request.query.repo ?? "keppo";
      const basehead = request.resource.replace("compare/", "");
      const [base = "", head = ""] = basehead.split("...", 2);
      return await this.sdk.compareCommits({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        base,
        head,
      });
    }

    if (request.resource.startsWith("commit-status/")) {
      const repo = request.query.repo ?? "keppo";
      const ref = request.resource.replace("commit-status/", "");
      return await this.sdk.getCommitStatus({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        ref,
      });
    }

    if (request.resource.startsWith("actions/runs/")) {
      const repo = request.query.repo ?? "keppo";
      const runId = Number(request.resource.replace("actions/runs/", ""));
      return await this.sdk.getWorkflowRun({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        runId,
      });
    }

    if (request.resource.startsWith("actions/jobs/")) {
      const repo = request.query.repo ?? "keppo";
      const jobId = Number(request.resource.replace("actions/jobs/", "").replace("/logs", ""));
      return await this.sdk.getWorkflowJobLogs({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo,
        jobId,
      });
    }

    if (request.resource === "releases/latest") {
      return await this.sdk.getLatestRelease({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: request.query.repo ?? "keppo",
      });
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override async writeResource(request: ProviderWriteRequest): Promise<Record<string, unknown>> {
    const payload = parseBody(request.body);
    const idempotencyKey =
      request.headers.get("x-idempotency-key") ??
      request.headers.get("Idempotency-Key") ??
      undefined;

    if (request.resource === "issues/comment") {
      return await this.sdk.createIssueComment({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        issue: Number(payload.issue ?? 1),
        body: String(payload.body ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "issues/create") {
      return await this.sdk.createIssue({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        title: String(payload.title ?? ""),
        body: typeof payload.body === "string" ? payload.body : undefined,
        labels: parseStringArray(payload.labels),
        assignees: parseStringArray(payload.assignees),
        idempotencyKey,
      });
    }

    if (request.resource === "issues/update") {
      return await this.sdk.updateIssue({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        issue: Number(payload.issue ?? payload.issue_number ?? 1),
        title: typeof payload.title === "string" ? payload.title : undefined,
        body: typeof payload.body === "string" ? payload.body : undefined,
        state: payload.state === "closed" || payload.state === "open" ? payload.state : undefined,
        labels: payload.labels !== undefined ? parseStringArray(payload.labels) : undefined,
        assignees:
          payload.assignees !== undefined ? parseStringArray(payload.assignees) : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "issues/lock") {
      return await this.sdk.lockIssue({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        issue: Number(payload.issue ?? payload.issue_number ?? 1),
        lockReason:
          payload.lockReason === "off-topic" ||
          payload.lockReason === "too heated" ||
          payload.lockReason === "resolved" ||
          payload.lockReason === "spam"
            ? payload.lockReason
            : payload.lock_reason === "off-topic" ||
                payload.lock_reason === "too heated" ||
                payload.lock_reason === "resolved" ||
                payload.lock_reason === "spam"
              ? payload.lock_reason
              : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "issues/unlock") {
      return await this.sdk.unlockIssue({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        issue: Number(payload.issue ?? payload.issue_number ?? 1),
        idempotencyKey,
      });
    }

    if (request.resource === "pulls/create") {
      return await this.sdk.createPullRequest({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        title: String(payload.title ?? ""),
        head: String(payload.head ?? ""),
        base: String(payload.base ?? ""),
        body: typeof payload.body === "string" ? payload.body : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "pulls/merge") {
      return await this.sdk.mergePullRequest({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        pullNumber: Number(payload.pullNumber ?? payload.pull_number ?? 0),
        mergeMethod:
          payload.merge_method === "squash" || payload.merge_method === "rebase"
            ? payload.merge_method
            : payload.mergeMethod === "squash" || payload.mergeMethod === "rebase"
              ? payload.mergeMethod
              : "merge",
        commitTitle:
          typeof payload.commit_title === "string"
            ? payload.commit_title
            : typeof payload.commitTitle === "string"
              ? payload.commitTitle
              : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "issues/labels/add") {
      return await this.sdk.addLabels({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        issue: Number(payload.issue ?? payload.issue_number ?? 1),
        labels: parseStringArray(payload.labels),
        idempotencyKey,
      });
    }

    if (request.resource === "issues/labels/remove") {
      return await this.sdk.removeLabel({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        issue: Number(payload.issue ?? payload.issue_number ?? 1),
        label: String(payload.label ?? payload.name ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "issues/assignees/add") {
      return await this.sdk.addAssignees({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        issue: Number(payload.issue ?? payload.issue_number ?? 1),
        assignees: parseStringArray(payload.assignees),
        idempotencyKey,
      });
    }

    if (request.resource === "issues/assignees/remove") {
      return await this.sdk.removeAssignees({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        issue: Number(payload.issue ?? payload.issue_number ?? 1),
        assignees: parseStringArray(payload.assignees),
        idempotencyKey,
      });
    }

    if (request.resource === "pulls/reviews/create") {
      return await this.sdk.createReview({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        pullNumber: Number(payload.pullNumber ?? payload.pull_number ?? 0),
        event:
          payload.event === "APPROVE" || payload.event === "REQUEST_CHANGES"
            ? payload.event
            : "COMMENT",
        body: typeof payload.body === "string" ? payload.body : undefined,
        commitId:
          typeof payload.commit_id === "string"
            ? payload.commit_id
            : typeof payload.commitId === "string"
              ? payload.commitId
              : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "pulls/reviews/dismiss") {
      return await this.sdk.dismissReview({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        pullNumber: Number(payload.pullNumber ?? payload.pull_number ?? 0),
        reviewId: Number(payload.reviewId ?? payload.review_id ?? 0),
        message: String(payload.message ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "pulls/reviewers/request") {
      return await this.sdk.requestReviewers({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        pullNumber: Number(payload.pullNumber ?? payload.pull_number ?? 0),
        reviewers: parseStringArray(payload.reviewers),
        idempotencyKey,
      });
    }

    if (request.resource === "pulls/reviewers/remove") {
      return await this.sdk.removeReviewers({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        pullNumber: Number(payload.pullNumber ?? payload.pull_number ?? 0),
        reviewers: parseStringArray(payload.reviewers),
        idempotencyKey,
      });
    }

    if (request.resource === "pulls/comments/create") {
      return await this.sdk.createReviewComment({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        pullNumber: Number(payload.pullNumber ?? payload.pull_number ?? 0),
        body: String(payload.body ?? ""),
        path: String(payload.path ?? ""),
        line: Number(payload.line ?? 0),
        commitId:
          typeof payload.commit_id === "string"
            ? payload.commit_id
            : typeof payload.commitId === "string"
              ? payload.commitId
              : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "contents/upsert") {
      return await this.sdk.createOrUpdateFile({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        path: String(payload.path ?? ""),
        message: String(payload.message ?? ""),
        content: decodeMaybeBase64(String(payload.content ?? "")),
        sha: typeof payload.sha === "string" ? payload.sha : undefined,
        branch: typeof payload.branch === "string" ? payload.branch : undefined,
        committerName:
          typeof payload.committerName === "string"
            ? payload.committerName
            : typeof payload.committer_name === "string"
              ? payload.committer_name
              : undefined,
        committerEmail:
          typeof payload.committerEmail === "string"
            ? payload.committerEmail
            : typeof payload.committer_email === "string"
              ? payload.committer_email
              : undefined,
        authorName:
          typeof payload.authorName === "string"
            ? payload.authorName
            : typeof payload.author_name === "string"
              ? payload.author_name
              : undefined,
        authorEmail:
          typeof payload.authorEmail === "string"
            ? payload.authorEmail
            : typeof payload.author_email === "string"
              ? payload.author_email
              : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "labels/create") {
      return await this.sdk.createLabel({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        name: String(payload.name ?? ""),
        color: String(payload.color ?? "").toLowerCase(),
        description: typeof payload.description === "string" ? payload.description : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "actions/workflows/dispatch") {
      return await this.sdk.triggerWorkflow({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        workflowId: String(payload.workflowId ?? payload.workflow_id ?? ""),
        ref: String(payload.ref ?? ""),
        inputs: parseStringRecord(payload.inputs),
        idempotencyKey,
      });
    }

    if (request.resource === "actions/runs/cancel") {
      return await this.sdk.cancelWorkflowRun({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        runId: Number(payload.runId ?? payload.run_id ?? 0),
        idempotencyKey,
      });
    }

    if (request.resource === "actions/runs/rerun") {
      return await this.sdk.rerunWorkflow({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        runId: Number(payload.runId ?? payload.run_id ?? 0),
        enableDebugLogging:
          payload.enable_debug_logging === true || payload.enableDebugLogging === true,
        idempotencyKey,
      });
    }

    if (request.resource === "notifications/read") {
      return await this.sdk.markNotificationsRead({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        lastReadAt:
          typeof payload.lastReadAt === "string"
            ? payload.lastReadAt
            : typeof payload.last_read_at === "string"
              ? payload.last_read_at
              : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "actions/runs/rerun-failed") {
      return await this.sdk.rerunFailedJobs({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        runId: Number(payload.runId ?? payload.run_id ?? 0),
        enableDebugLogging:
          payload.enable_debug_logging === true || payload.enableDebugLogging === true,
        idempotencyKey,
      });
    }

    if (request.resource === "pulls/update-branch") {
      return await this.sdk.updatePRBranch({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        pullNumber: Number(payload.pullNumber ?? payload.pull_number ?? 0),
        expectedHeadSha:
          typeof payload.expectedHeadSha === "string"
            ? payload.expectedHeadSha
            : typeof payload.expected_head_sha === "string"
              ? payload.expected_head_sha
              : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "reactions/create") {
      return await this.sdk.createReaction({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        issue: Number(payload.issue ?? payload.issue_number ?? 1),
        content:
          payload.content === "+1" ||
          payload.content === "-1" ||
          payload.content === "laugh" ||
          payload.content === "confused" ||
          payload.content === "heart" ||
          payload.content === "hooray" ||
          payload.content === "rocket" ||
          payload.content === "eyes"
            ? payload.content
            : "+1",
        idempotencyKey,
      });
    }

    if (request.resource === "reactions/delete") {
      return await this.sdk.deleteReaction({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        issue: Number(payload.issue ?? payload.issue_number ?? 1),
        reactionId: Number(payload.reactionId ?? payload.reaction_id ?? 0),
        idempotencyKey,
      });
    }

    if (request.resource === "repos/dispatch") {
      return await this.sdk.createDispatchEvent({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        eventType: String(payload.eventType ?? payload.event_type ?? ""),
        clientPayload:
          payload.clientPayload &&
          typeof payload.clientPayload === "object" &&
          !Array.isArray(payload.clientPayload)
            ? (payload.clientPayload as Record<string, unknown>)
            : payload.client_payload &&
                typeof payload.client_payload === "object" &&
                !Array.isArray(payload.client_payload)
              ? (payload.client_payload as Record<string, unknown>)
              : {},
        idempotencyKey,
      });
    }

    if (request.resource === "pulls/update") {
      return await this.sdk.updatePullRequest({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        pullNumber: Number(payload.pullNumber ?? payload.pull_number ?? 0),
        title: typeof payload.title === "string" ? payload.title : undefined,
        body: typeof payload.body === "string" ? payload.body : undefined,
        state: payload.state === "closed" || payload.state === "open" ? payload.state : undefined,
        base: typeof payload.base === "string" ? payload.base : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "issues/comments/update") {
      return await this.sdk.updateComment({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        commentId: Number(payload.commentId ?? payload.comment_id ?? 0),
        body: String(payload.body ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "issues/comments/delete") {
      return await this.sdk.deleteComment({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        commentId: Number(payload.commentId ?? payload.comment_id ?? 0),
        idempotencyKey,
      });
    }

    if (request.resource === "releases/create") {
      return await this.sdk.createRelease({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        tagName: String(payload.tagName ?? payload.tag_name ?? ""),
        targetCommitish:
          typeof payload.targetCommitish === "string"
            ? payload.targetCommitish
            : typeof payload.target_commitish === "string"
              ? payload.target_commitish
              : undefined,
        name: typeof payload.name === "string" ? payload.name : undefined,
        body: typeof payload.body === "string" ? payload.body : undefined,
        draft: payload.draft === true,
        prerelease: payload.prerelease === true,
        generateReleaseNotes:
          payload.generateReleaseNotes === true || payload.generate_release_notes === true,
        idempotencyKey,
      });
    }

    if (request.resource === "releases/update") {
      return await this.sdk.updateRelease({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        releaseId: Number(payload.releaseId ?? payload.release_id ?? 0),
        tagName:
          typeof payload.tagName === "string"
            ? payload.tagName
            : typeof payload.tag_name === "string"
              ? payload.tag_name
              : undefined,
        targetCommitish:
          typeof payload.targetCommitish === "string"
            ? payload.targetCommitish
            : typeof payload.target_commitish === "string"
              ? payload.target_commitish
              : undefined,
        name: typeof payload.name === "string" ? payload.name : undefined,
        body: typeof payload.body === "string" ? payload.body : undefined,
        draft: typeof payload.draft === "boolean" ? payload.draft : undefined,
        prerelease: typeof payload.prerelease === "boolean" ? payload.prerelease : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "releases/notes") {
      return await this.sdk.generateReleaseNotes({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        tagName: String(payload.tagName ?? payload.tag_name ?? ""),
        targetCommitish:
          typeof payload.targetCommitish === "string"
            ? payload.targetCommitish
            : typeof payload.target_commitish === "string"
              ? payload.target_commitish
              : undefined,
        previousTagName:
          typeof payload.previousTagName === "string"
            ? payload.previousTagName
            : typeof payload.previous_tag_name === "string"
              ? payload.previous_tag_name
              : undefined,
        configurationFilePath:
          typeof payload.configurationFilePath === "string"
            ? payload.configurationFilePath
            : typeof payload.configuration_file_path === "string"
              ? payload.configuration_file_path
              : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "milestones/create") {
      return await this.sdk.createMilestone({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        title: String(payload.title ?? ""),
        state: payload.state === "closed" ? "closed" : "open",
        description: typeof payload.description === "string" ? payload.description : undefined,
        dueOn:
          typeof payload.dueOn === "string"
            ? payload.dueOn
            : typeof payload.due_on === "string"
              ? payload.due_on
              : undefined,
        idempotencyKey,
      });
    }

    if (request.resource === "milestones/update") {
      return await this.sdk.updateMilestone({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        repo: String(payload.repo ?? "keppo"),
        milestone: Number(payload.milestone ?? payload.milestone_number ?? 0),
        title: typeof payload.title === "string" ? payload.title : undefined,
        state: payload.state === "closed" || payload.state === "open" ? payload.state : undefined,
        description: typeof payload.description === "string" ? payload.description : undefined,
        dueOn:
          typeof payload.dueOn === "string"
            ? payload.dueOn
            : typeof payload.due_on === "string"
              ? payload.due_on
              : undefined,
        idempotencyKey,
      });
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override reset(namespace?: string): void {
    super.reset(namespace);
    this.clientStore.reset(namespace);
  }

  override seed(namespace: string, seedData: Record<string, unknown>): void {
    super.seed(namespace, seedData);
    this.clientStore.seed(namespace, seedData);
  }

  getSdkCalls(namespace?: string): Array<Record<string, unknown>> {
    return this.sdk.callLog.list(namespace);
  }
}
