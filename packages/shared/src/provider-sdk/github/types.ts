import type { ProviderSdkPort } from "../port.js";

export type GithubSdkContext = {
  accessToken: string;
  namespace?: string | undefined;
};

export type GithubIssue = Record<string, unknown> & {
  id: number;
  number: number;
  title: string;
  state: string;
  html_url?: string | undefined;
  body?: string | null | undefined;
  labels?: Array<Record<string, unknown>> | undefined;
  assignees?: Array<Record<string, unknown>> | undefined;
};

export type GithubIssueComment = Record<string, unknown> & {
  id: number;
  body: string;
  html_url: string;
  issue_url: string;
  created_at: string;
  updated_at: string;
};

export type GithubIssueEvent = Record<string, unknown> & {
  id: number;
  event: string;
  actor?: Record<string, unknown> | undefined;
  created_at?: string | undefined;
};

export type GithubIssueTimelineEvent = Record<string, unknown> & {
  id: number;
  event?: string | undefined;
  created_at?: string | undefined;
};

export type GithubPullRequest = Record<string, unknown> & {
  id: number;
  number: number;
  state: string;
  title: string;
  html_url?: string | undefined;
  body?: string | null | undefined;
  head?: Record<string, unknown> | undefined;
  base?: Record<string, unknown> | undefined;
  merged?: boolean | undefined;
};

export type GithubPullRequestFile = Record<string, unknown> & {
  sha: string | null;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  blob_url?: string | undefined;
};

export type GithubLabel = Record<string, unknown> & {
  id: number;
  name: string;
  color: string;
  description?: string | null | undefined;
};

export type GithubPullRequestReview = Record<string, unknown> & {
  id: number;
  body?: string | null | undefined;
  state: string;
  pull_request_url?: string | undefined;
  dismissed?: boolean | undefined;
};

export type GithubReviewComment = Record<string, unknown> & {
  id: number;
  body: string;
  path: string;
  line: number;
  pull_request_review_id?: number | null | undefined;
  html_url?: string | undefined;
};

export type GithubSearchIssue = Record<string, unknown> & {
  id: number;
  number: number;
  title: string;
  state: string;
  html_url?: string | undefined;
  pull_request?: Record<string, unknown> | undefined;
};

export type GithubCodeSearchResult = Record<string, unknown> & {
  name: string;
  path: string;
  sha?: string | undefined;
  repository?: Record<string, unknown> | undefined;
  html_url?: string | undefined;
};

export type GithubRepoSearchResult = Record<string, unknown> & {
  id: number;
  name: string;
  full_name: string;
  private?: boolean | undefined;
  html_url?: string | undefined;
  description?: string | null | undefined;
};

export type GithubNotification = Record<string, unknown> & {
  id: string;
  unread: boolean;
  reason?: string | undefined;
  updated_at?: string | undefined;
  subject?: Record<string, unknown> | undefined;
  repository?: Record<string, unknown> | undefined;
};

export type GithubRepo = Record<string, unknown> & {
  id: number;
  name: string;
  full_name: string;
  html_url?: string | undefined;
  default_branch?: string | undefined;
  private?: boolean | undefined;
};

export type GithubBranch = Record<string, unknown> & {
  name: string;
  commit?: Record<string, unknown> | undefined;
  protected?: boolean | undefined;
};

export type GithubFileContents = Record<string, unknown> & {
  type: string;
  name: string;
  path: string;
  sha: string;
  size?: number | undefined;
  content?: string | undefined;
  encoding?: string | undefined;
};

export type GithubFileWriteResult = Record<string, unknown> & {
  path: string;
  sha: string;
  content?: GithubFileContents | undefined;
  commit?: Record<string, unknown> | undefined;
};

export type GithubMergeResult = Record<string, unknown> & {
  sha: string;
  merged: boolean;
  message: string;
};

export type GithubCommit = Record<string, unknown> & {
  sha: string;
  html_url?: string | undefined;
  commit?: Record<string, unknown> | undefined;
};

export type GithubCompareCommitsResult = Record<string, unknown> & {
  status?: string | undefined;
  ahead_by?: number | undefined;
  behind_by?: number | undefined;
  total_commits?: number | undefined;
  commits?: GithubCommit[] | undefined;
};

export type GithubCommitStatus = Record<string, unknown> & {
  state: string;
  sha?: string | undefined;
  statuses?: Array<Record<string, unknown>> | undefined;
};

export type GithubCheckRun = Record<string, unknown> & {
  id: number;
  name: string;
  status: string;
  conclusion?: string | null | undefined;
  head_sha?: string | undefined;
};

export type GithubWorkflowRun = Record<string, unknown> & {
  id: number;
  name?: string | undefined;
  status?: string | undefined;
  conclusion?: string | null | undefined;
  head_branch?: string | undefined;
  head_sha?: string | undefined;
  event?: string | undefined;
};

export type GithubWorkflowJobLogs = Record<string, unknown> & {
  job_id: number;
  download_url: string;
};

export type GithubRelease = Record<string, unknown> & {
  id: number;
  tag_name: string;
  name?: string | null | undefined;
  body?: string | null | undefined;
  target_commitish?: string | undefined;
  draft?: boolean | undefined;
  prerelease?: boolean | undefined;
  html_url?: string | undefined;
  created_at?: string | undefined;
  published_at?: string | null | undefined;
};

export type GithubMilestone = Record<string, unknown> & {
  id: number;
  number: number;
  title: string;
  state: string;
  description?: string | null | undefined;
  due_on?: string | null | undefined;
  html_url?: string | undefined;
};

export type GithubDeleteResult = Record<string, unknown> & {
  deleted: boolean;
  id?: number | undefined;
};

export type GithubReaction = Record<string, unknown> & {
  id: number;
  content: string;
  user?: Record<string, unknown> | undefined;
};

export type GithubIssueState = "open" | "closed" | "all";
export type GithubPullRequestState = "open" | "closed" | "all";
export type GithubMergeMethod = "merge" | "squash" | "rebase";
export type GithubReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export type GithubListIssuesArgs = GithubSdkContext & {
  repo: string;
  state: GithubIssueState;
  perPage: number;
};

export type GithubGetIssueArgs = GithubSdkContext & {
  repo: string;
  issue: number;
};

export type GithubListIssueEventsArgs = GithubSdkContext & {
  repo: string;
  issue: number;
  perPage: number;
};

export type GithubListIssueTimelineArgs = GithubSdkContext & {
  repo: string;
  issue: number;
  perPage: number;
};

export type GithubCreateIssueArgs = GithubSdkContext & {
  repo: string;
  title: string;
  body?: string | undefined;
  labels?: string[] | undefined;
  assignees?: string[] | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubUpdateIssueArgs = GithubSdkContext & {
  repo: string;
  issue: number;
  title?: string | undefined;
  body?: string | undefined;
  state?: Exclude<GithubIssueState, "all"> | undefined;
  labels?: string[] | undefined;
  assignees?: string[] | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubCreateIssueCommentArgs = GithubSdkContext & {
  repo: string;
  issue: number;
  body: string;
  idempotencyKey?: string | undefined;
};

export type GithubListPullRequestsArgs = GithubSdkContext & {
  repo: string;
  state: GithubPullRequestState;
  perPage: number;
};

export type GithubGetPullRequestArgs = GithubSdkContext & {
  repo: string;
  pullNumber: number;
};

export type GithubCreatePullRequestArgs = GithubSdkContext & {
  repo: string;
  title: string;
  head: string;
  base: string;
  body?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubMergePullRequestArgs = GithubSdkContext & {
  repo: string;
  pullNumber: number;
  mergeMethod?: GithubMergeMethod | undefined;
  commitTitle?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubListPullRequestFilesArgs = GithubSdkContext & {
  repo: string;
  pullNumber: number;
  perPage: number;
};

export type GithubAddLabelsArgs = GithubSdkContext & {
  repo: string;
  issue: number;
  labels: string[];
  idempotencyKey?: string | undefined;
};

export type GithubRemoveLabelArgs = GithubSdkContext & {
  repo: string;
  issue: number;
  label: string;
  idempotencyKey?: string | undefined;
};

export type GithubAddAssigneesArgs = GithubSdkContext & {
  repo: string;
  issue: number;
  assignees: string[];
  idempotencyKey?: string | undefined;
};

export type GithubRemoveAssigneesArgs = GithubSdkContext & {
  repo: string;
  issue: number;
  assignees: string[];
  idempotencyKey?: string | undefined;
};

export type GithubSearchIssuesArgs = GithubSdkContext & {
  query: string;
  perPage: number;
};

export type GithubSearchCodeArgs = GithubSdkContext & {
  query: string;
  perPage: number;
};

export type GithubSearchRepositoriesArgs = GithubSdkContext & {
  query: string;
  perPage: number;
};

export type GithubGetRepoArgs = GithubSdkContext & {
  repo: string;
};

export type GithubListOrgReposArgs = GithubSdkContext & {
  org: string;
  type?: "all" | "public" | "private" | "forks" | "sources" | "member" | undefined;
  perPage: number;
};

export type GithubListBranchesArgs = GithubSdkContext & {
  repo: string;
  perPage: number;
};

export type GithubGetFileContentsArgs = GithubSdkContext & {
  repo: string;
  path: string;
  ref?: string | undefined;
};

export type GithubCreateOrUpdateFileArgs = GithubSdkContext & {
  repo: string;
  path: string;
  message: string;
  content: string;
  sha?: string | undefined;
  branch?: string | undefined;
  committerName?: string | undefined;
  committerEmail?: string | undefined;
  authorName?: string | undefined;
  authorEmail?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubListLabelsArgs = GithubSdkContext & {
  repo: string;
  perPage: number;
};

export type GithubCreateLabelArgs = GithubSdkContext & {
  repo: string;
  name: string;
  color: string;
  description?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubCreateReviewArgs = GithubSdkContext & {
  repo: string;
  pullNumber: number;
  event: GithubReviewEvent;
  body?: string | undefined;
  commitId?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubListReviewsArgs = GithubSdkContext & {
  repo: string;
  pullNumber: number;
  perPage: number;
};

export type GithubDismissReviewArgs = GithubSdkContext & {
  repo: string;
  pullNumber: number;
  reviewId: number;
  message: string;
  idempotencyKey?: string | undefined;
};

export type GithubRequestReviewersArgs = GithubSdkContext & {
  repo: string;
  pullNumber: number;
  reviewers: string[];
  idempotencyKey?: string | undefined;
};

export type GithubRemoveReviewersArgs = GithubSdkContext & {
  repo: string;
  pullNumber: number;
  reviewers: string[];
  idempotencyKey?: string | undefined;
};

export type GithubCreateReviewCommentArgs = GithubSdkContext & {
  repo: string;
  pullNumber: number;
  body: string;
  path: string;
  line: number;
  commitId?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubListCommitsArgs = GithubSdkContext & {
  repo: string;
  perPage: number;
  sha?: string | undefined;
};

export type GithubCompareCommitsArgs = GithubSdkContext & {
  repo: string;
  base: string;
  head: string;
};

export type GithubGetCommitStatusArgs = GithubSdkContext & {
  repo: string;
  ref: string;
};

export type GithubListCheckRunsArgs = GithubSdkContext & {
  repo: string;
  ref: string;
  perPage: number;
};

export type GithubListWorkflowRunsArgs = GithubSdkContext & {
  repo: string;
  perPage: number;
  branch?: string | undefined;
  status?: string | undefined;
};

export type GithubGetWorkflowRunArgs = GithubSdkContext & {
  repo: string;
  runId: number;
};

export type GithubListNotificationsArgs = GithubSdkContext & {
  all?: boolean | undefined;
  participating?: boolean | undefined;
  since?: string | undefined;
  before?: string | undefined;
  perPage: number;
};

export type GithubGetWorkflowJobLogsArgs = GithubSdkContext & {
  repo: string;
  jobId: number;
};

export type GithubTriggerWorkflowArgs = GithubSdkContext & {
  repo: string;
  workflowId: string;
  ref: string;
  inputs?: Record<string, string> | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubCancelWorkflowRunArgs = GithubSdkContext & {
  repo: string;
  runId: number;
  idempotencyKey?: string | undefined;
};

export type GithubRerunWorkflowArgs = GithubSdkContext & {
  repo: string;
  runId: number;
  enableDebugLogging?: boolean | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubUpdatePullRequestArgs = GithubSdkContext & {
  repo: string;
  pullNumber: number;
  title?: string | undefined;
  body?: string | undefined;
  state?: Exclude<GithubPullRequestState, "all"> | undefined;
  base?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubLockIssueArgs = GithubSdkContext & {
  repo: string;
  issue: number;
  lockReason?: "off-topic" | "too heated" | "resolved" | "spam" | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubUnlockIssueArgs = GithubSdkContext & {
  repo: string;
  issue: number;
  idempotencyKey?: string | undefined;
};

export type GithubMarkNotificationsReadArgs = GithubSdkContext & {
  lastReadAt?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubRerunFailedJobsArgs = GithubSdkContext & {
  repo: string;
  runId: number;
  enableDebugLogging?: boolean | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubUpdatePRBranchArgs = GithubSdkContext & {
  repo: string;
  pullNumber: number;
  expectedHeadSha?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubCreateReactionArgs = GithubSdkContext & {
  repo: string;
  issue: number;
  content: "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes";
  idempotencyKey?: string | undefined;
};

export type GithubDeleteReactionArgs = GithubSdkContext & {
  repo: string;
  issue: number;
  reactionId: number;
  idempotencyKey?: string | undefined;
};

export type GithubCreateDispatchEventArgs = GithubSdkContext & {
  repo: string;
  eventType: string;
  clientPayload?: Record<string, unknown> | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubListPullRequestCommitsArgs = GithubSdkContext & {
  repo: string;
  pullNumber: number;
  perPage: number;
};

export type GithubListIssueCommentsArgs = GithubSdkContext & {
  repo: string;
  issue: number;
  perPage: number;
};

export type GithubListReleasesArgs = GithubSdkContext & {
  repo: string;
  perPage: number;
};

export type GithubGetLatestReleaseArgs = GithubSdkContext & {
  repo: string;
};

export type GithubCreateReleaseArgs = GithubSdkContext & {
  repo: string;
  tagName: string;
  targetCommitish?: string | undefined;
  name?: string | undefined;
  body?: string | undefined;
  draft?: boolean | undefined;
  prerelease?: boolean | undefined;
  generateReleaseNotes?: boolean | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubUpdateReleaseArgs = GithubSdkContext & {
  repo: string;
  releaseId: number;
  tagName?: string | undefined;
  targetCommitish?: string | undefined;
  name?: string | undefined;
  body?: string | undefined;
  draft?: boolean | undefined;
  prerelease?: boolean | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubGenerateReleaseNotesArgs = GithubSdkContext & {
  repo: string;
  tagName: string;
  targetCommitish?: string | undefined;
  previousTagName?: string | undefined;
  configurationFilePath?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubListMilestonesArgs = GithubSdkContext & {
  repo: string;
  state: GithubIssueState;
  perPage: number;
};

export type GithubCreateMilestoneArgs = GithubSdkContext & {
  repo: string;
  title: string;
  state?: Exclude<GithubIssueState, "all"> | undefined;
  description?: string | undefined;
  dueOn?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubUpdateMilestoneArgs = GithubSdkContext & {
  repo: string;
  milestone: number;
  title?: string | undefined;
  state?: Exclude<GithubIssueState, "all"> | undefined;
  description?: string | undefined;
  dueOn?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type GithubUpdateCommentArgs = GithubSdkContext & {
  repo: string;
  commentId: number;
  body: string;
  idempotencyKey?: string | undefined;
};

export type GithubDeleteCommentArgs = GithubSdkContext & {
  repo: string;
  commentId: number;
  idempotencyKey?: string | undefined;
};

export interface GithubSdkPort extends ProviderSdkPort {
  listIssues(args: GithubListIssuesArgs): Promise<GithubIssue[]>;
  getIssue(args: GithubGetIssueArgs): Promise<GithubIssue>;
  listIssueEvents(args: GithubListIssueEventsArgs): Promise<GithubIssueEvent[]>;
  listIssueTimeline(args: GithubListIssueTimelineArgs): Promise<GithubIssueTimelineEvent[]>;
  createIssue(args: GithubCreateIssueArgs): Promise<GithubIssue>;
  updateIssue(args: GithubUpdateIssueArgs): Promise<GithubIssue>;
  createIssueComment(args: GithubCreateIssueCommentArgs): Promise<GithubIssueComment>;
  listPullRequests(args: GithubListPullRequestsArgs): Promise<GithubPullRequest[]>;
  getPullRequest(args: GithubGetPullRequestArgs): Promise<GithubPullRequest>;
  createPullRequest(args: GithubCreatePullRequestArgs): Promise<GithubPullRequest>;
  mergePullRequest(args: GithubMergePullRequestArgs): Promise<GithubMergeResult>;
  listPullRequestFiles(args: GithubListPullRequestFilesArgs): Promise<GithubPullRequestFile[]>;
  addLabels(args: GithubAddLabelsArgs): Promise<GithubLabel[]>;
  removeLabel(args: GithubRemoveLabelArgs): Promise<GithubLabel[]>;
  addAssignees(args: GithubAddAssigneesArgs): Promise<GithubIssue>;
  removeAssignees(args: GithubRemoveAssigneesArgs): Promise<GithubIssue>;
  searchIssues(args: GithubSearchIssuesArgs): Promise<GithubSearchIssue[]>;
  searchCode(args: GithubSearchCodeArgs): Promise<GithubCodeSearchResult[]>;
  searchRepositories(args: GithubSearchRepositoriesArgs): Promise<GithubRepoSearchResult[]>;
  getRepo(args: GithubGetRepoArgs): Promise<GithubRepo>;
  listOrgRepos(args: GithubListOrgReposArgs): Promise<GithubRepo[]>;
  listBranches(args: GithubListBranchesArgs): Promise<GithubBranch[]>;
  getFileContents(args: GithubGetFileContentsArgs): Promise<GithubFileContents>;
  createOrUpdateFile(args: GithubCreateOrUpdateFileArgs): Promise<GithubFileWriteResult>;
  listLabels(args: GithubListLabelsArgs): Promise<GithubLabel[]>;
  createLabel(args: GithubCreateLabelArgs): Promise<GithubLabel>;
  createReview(args: GithubCreateReviewArgs): Promise<GithubPullRequestReview>;
  listReviews(args: GithubListReviewsArgs): Promise<GithubPullRequestReview[]>;
  dismissReview(args: GithubDismissReviewArgs): Promise<GithubPullRequestReview>;
  requestReviewers(args: GithubRequestReviewersArgs): Promise<GithubPullRequest>;
  removeReviewers(args: GithubRemoveReviewersArgs): Promise<GithubPullRequest>;
  createReviewComment(args: GithubCreateReviewCommentArgs): Promise<GithubReviewComment>;
  listCommits(args: GithubListCommitsArgs): Promise<GithubCommit[]>;
  compareCommits(args: GithubCompareCommitsArgs): Promise<GithubCompareCommitsResult>;
  getCommitStatus(args: GithubGetCommitStatusArgs): Promise<GithubCommitStatus>;
  listCheckRuns(args: GithubListCheckRunsArgs): Promise<GithubCheckRun[]>;
  listWorkflowRuns(args: GithubListWorkflowRunsArgs): Promise<GithubWorkflowRun[]>;
  getWorkflowRun(args: GithubGetWorkflowRunArgs): Promise<GithubWorkflowRun>;
  listNotifications(args: GithubListNotificationsArgs): Promise<GithubNotification[]>;
  getWorkflowJobLogs(args: GithubGetWorkflowJobLogsArgs): Promise<GithubWorkflowJobLogs>;
  triggerWorkflow(args: GithubTriggerWorkflowArgs): Promise<Record<string, unknown>>;
  cancelWorkflowRun(args: GithubCancelWorkflowRunArgs): Promise<Record<string, unknown>>;
  rerunWorkflow(args: GithubRerunWorkflowArgs): Promise<Record<string, unknown>>;
  lockIssue(args: GithubLockIssueArgs): Promise<Record<string, unknown>>;
  unlockIssue(args: GithubUnlockIssueArgs): Promise<Record<string, unknown>>;
  markNotificationsRead(args: GithubMarkNotificationsReadArgs): Promise<Record<string, unknown>>;
  rerunFailedJobs(args: GithubRerunFailedJobsArgs): Promise<Record<string, unknown>>;
  updatePRBranch(args: GithubUpdatePRBranchArgs): Promise<Record<string, unknown>>;
  createReaction(args: GithubCreateReactionArgs): Promise<GithubReaction>;
  deleteReaction(args: GithubDeleteReactionArgs): Promise<GithubDeleteResult>;
  createDispatchEvent(args: GithubCreateDispatchEventArgs): Promise<Record<string, unknown>>;
  updatePullRequest(args: GithubUpdatePullRequestArgs): Promise<GithubPullRequest>;
  listPullRequestCommits(args: GithubListPullRequestCommitsArgs): Promise<GithubCommit[]>;
  listIssueComments(args: GithubListIssueCommentsArgs): Promise<GithubIssueComment[]>;
  listReleases(args: GithubListReleasesArgs): Promise<GithubRelease[]>;
  getLatestRelease(args: GithubGetLatestReleaseArgs): Promise<GithubRelease>;
  createRelease(args: GithubCreateReleaseArgs): Promise<GithubRelease>;
  updateRelease(args: GithubUpdateReleaseArgs): Promise<GithubRelease>;
  generateReleaseNotes(args: GithubGenerateReleaseNotesArgs): Promise<Record<string, unknown>>;
  listMilestones(args: GithubListMilestonesArgs): Promise<GithubMilestone[]>;
  createMilestone(args: GithubCreateMilestoneArgs): Promise<GithubMilestone>;
  updateMilestone(args: GithubUpdateMilestoneArgs): Promise<GithubMilestone>;
  updateComment(args: GithubUpdateCommentArgs): Promise<GithubIssueComment>;
  deleteComment(args: GithubDeleteCommentArgs): Promise<GithubDeleteResult>;
}
