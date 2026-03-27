import { withHeaderIdempotencyKey } from "../client-adapter-utils.js";

import type { GithubClient } from "./client-interface.js";
import type { GithubSdkPort } from "./types.js";

const toRepoIdentifier = (owner: string, repo: string): string => {
  if (owner === repo) {
    return owner;
  }
  return `${owner}/${repo}`;
};

export const createFakeGithubClient = (
  engine: GithubSdkPort,
  accessToken: string,
  namespace?: string,
): GithubClient => {
  return {
    issues: {
      listForRepo: async ({ owner, repo, state, per_page }) => {
        const data = await engine.listIssues({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          state,
          perPage: per_page,
        });
        return { data };
      },
      get: async ({ owner, repo, issue_number }) => {
        const data = await engine.getIssue({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
        });
        return { data };
      },
      listEvents: async ({ owner, repo, issue_number, per_page }) => {
        const data = await engine.listIssueEvents({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
          perPage: per_page,
        });
        return { data };
      },
      listEventsForTimeline: async ({ owner, repo, issue_number, per_page }) => {
        const data = await engine.listIssueTimeline({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
          perPage: per_page,
        });
        return { data };
      },
      create: async ({ owner, repo, title, body, labels, assignees, headers }) => {
        const data = await engine.createIssue({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          title,
          ...(body !== undefined ? { body } : {}),
          ...(labels !== undefined ? { labels } : {}),
          ...(assignees !== undefined ? { assignees } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      update: async ({
        owner,
        repo,
        issue_number,
        title,
        body,
        state,
        labels,
        assignees,
        headers,
      }) => {
        const data = await engine.updateIssue({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
          ...(title !== undefined ? { title } : {}),
          ...(body !== undefined ? { body } : {}),
          ...(state !== undefined ? { state } : {}),
          ...(labels !== undefined ? { labels } : {}),
          ...(assignees !== undefined ? { assignees } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      createComment: async ({ owner, repo, issue_number, body, headers }) => {
        const data = await engine.createIssueComment({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
          body,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      listComments: async ({ owner, repo, issue_number, per_page }) => {
        const data = await engine.listIssueComments({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
          perPage: per_page,
        });
        return { data };
      },
      updateComment: async ({ owner, repo, comment_id, body, headers }) => {
        const data = await engine.updateComment({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          commentId: comment_id,
          body,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      deleteComment: async ({ owner, repo, comment_id, headers }) => {
        const data = await engine.deleteComment({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          commentId: comment_id,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      addLabels: async ({ owner, repo, issue_number, labels, headers }) => {
        const data = await engine.addLabels({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
          labels,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      removeLabel: async ({ owner, repo, issue_number, name, headers }) => {
        const data = await engine.removeLabel({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
          label: name,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      addAssignees: async ({ owner, repo, issue_number, assignees, headers }) => {
        const data = await engine.addAssignees({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
          assignees,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      removeAssignees: async ({ owner, repo, issue_number, assignees, headers }) => {
        const data = await engine.removeAssignees({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
          assignees,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      listMilestones: async ({ owner, repo, state, per_page }) => {
        const data = await engine.listMilestones({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          state,
          perPage: per_page,
        });
        return { data };
      },
      listLabelsForRepo: async ({ owner, repo, per_page }) => {
        const data = await engine.listLabels({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          perPage: per_page,
        });
        return { data };
      },
      createLabel: async ({ owner, repo, name, color, description, headers }) => {
        const data = await engine.createLabel({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          name,
          color,
          ...(description !== undefined ? { description } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      createMilestone: async ({ owner, repo, title, state, description, due_on, headers }) => {
        const data = await engine.createMilestone({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          title,
          ...(state !== undefined ? { state } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(due_on !== undefined ? { dueOn: due_on } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      updateMilestone: async ({
        owner,
        repo,
        milestone_number,
        title,
        state,
        description,
        due_on,
        headers,
      }) => {
        const data = await engine.updateMilestone({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          milestone: milestone_number,
          ...(title !== undefined ? { title } : {}),
          ...(state !== undefined ? { state } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(due_on !== undefined ? { dueOn: due_on } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      lock: async ({ owner, repo, issue_number, lock_reason, headers }) => {
        const data = await engine.lockIssue({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
          ...(lock_reason !== undefined ? { lockReason: lock_reason } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      unlock: async ({ owner, repo, issue_number, headers }) => {
        const data = await engine.unlockIssue({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
    },
    pulls: {
      list: async ({ owner, repo, state, per_page }) => {
        const data = await engine.listPullRequests({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          state,
          perPage: per_page,
        });
        return { data };
      },
      get: async ({ owner, repo, pull_number }) => {
        const data = await engine.getPullRequest({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          pullNumber: pull_number,
        });
        return { data };
      },
      create: async ({ owner, repo, title, head, base, body, headers }) => {
        const data = await engine.createPullRequest({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          title,
          head,
          base,
          ...(body !== undefined ? { body } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      merge: async ({ owner, repo, pull_number, merge_method, commit_title, headers }) => {
        const data = await engine.mergePullRequest({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          pullNumber: pull_number,
          ...(merge_method !== undefined ? { mergeMethod: merge_method } : {}),
          ...(commit_title !== undefined ? { commitTitle: commit_title } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      listFiles: async ({ owner, repo, pull_number, per_page }) => {
        const data = await engine.listPullRequestFiles({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          pullNumber: pull_number,
          perPage: per_page,
        });
        return { data };
      },
      createReview: async ({ owner, repo, pull_number, event, body, commit_id, headers }) => {
        const data = await engine.createReview({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          pullNumber: pull_number,
          event,
          ...(body !== undefined ? { body } : {}),
          ...(commit_id !== undefined ? { commitId: commit_id } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      listReviews: async ({ owner, repo, pull_number, per_page }) => {
        const data = await engine.listReviews({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          pullNumber: pull_number,
          perPage: per_page,
        });
        return { data };
      },
      dismissReview: async ({ owner, repo, pull_number, review_id, message, headers }) => {
        const data = await engine.dismissReview({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          pullNumber: pull_number,
          reviewId: review_id,
          message,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      requestReviewers: async ({ owner, repo, pull_number, reviewers, headers }) => {
        const data = await engine.requestReviewers({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          pullNumber: pull_number,
          reviewers,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      removeRequestedReviewers: async ({ owner, repo, pull_number, reviewers, headers }) => {
        const data = await engine.removeReviewers({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          pullNumber: pull_number,
          reviewers,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      createReviewComment: async ({
        owner,
        repo,
        pull_number,
        body,
        commit_id,
        path,
        line,
        headers,
      }) => {
        const data = await engine.createReviewComment({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          pullNumber: pull_number,
          body,
          path,
          line,
          ...(commit_id !== undefined ? { commitId: commit_id } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      update: async ({ owner, repo, pull_number, title, body, state, base, headers }) => {
        const data = await engine.updatePullRequest({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          pullNumber: pull_number,
          ...(title !== undefined ? { title } : {}),
          ...(body !== undefined ? { body } : {}),
          ...(state !== undefined ? { state } : {}),
          ...(base !== undefined ? { base } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      updateBranch: async ({ owner, repo, pull_number, expected_head_sha, headers }) => {
        const data = await engine.updatePRBranch({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          pullNumber: pull_number,
          ...(expected_head_sha !== undefined ? { expectedHeadSha: expected_head_sha } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      listCommits: async ({ owner, repo, pull_number, per_page }) => {
        const data = await engine.listPullRequestCommits({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          pullNumber: pull_number,
          perPage: per_page,
        });
        return { data };
      },
    },
    search: {
      issuesAndPullRequests: async ({ q, per_page }) => {
        const items = await engine.searchIssues({
          accessToken,
          namespace,
          query: q,
          perPage: per_page,
        });
        return { data: { items } };
      },
      code: async ({ q, per_page }) => {
        const items = await engine.searchCode({
          accessToken,
          namespace,
          query: q,
          perPage: per_page,
        });
        return { data: { total_count: items.length, incomplete_results: false, items } };
      },
      repos: async ({ q, per_page }) => {
        const items = await engine.searchRepositories({
          accessToken,
          namespace,
          query: q,
          perPage: per_page,
        });
        return { data: { total_count: items.length, incomplete_results: false, items } };
      },
    },
    repos: {
      get: async ({ owner, repo }) => {
        const data = await engine.getRepo({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
        });
        return { data };
      },
      listBranches: async ({ owner, repo, per_page }) => {
        const data = await engine.listBranches({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          perPage: per_page,
        });
        return { data };
      },
      getContent: async ({ owner, repo, path, ref }) => {
        const data = await engine.getFileContents({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          path,
          ...(ref !== undefined ? { ref } : {}),
        });
        return { data };
      },
      createOrUpdateFileContents: async ({
        owner,
        repo,
        path,
        message,
        content,
        sha,
        branch,
        committer,
        author,
        headers,
      }) => {
        const data = await engine.createOrUpdateFile({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          path,
          message,
          content,
          ...(sha !== undefined ? { sha } : {}),
          ...(branch !== undefined ? { branch } : {}),
          ...(committer?.name ? { committerName: committer.name } : {}),
          ...(committer?.email ? { committerEmail: committer.email } : {}),
          ...(author?.name ? { authorName: author.name } : {}),
          ...(author?.email ? { authorEmail: author.email } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      listCommits: async ({ owner, repo, per_page, sha }) => {
        const data = await engine.listCommits({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          perPage: per_page,
          ...(sha !== undefined ? { sha } : {}),
        });
        return { data };
      },
      compareCommits: async ({ owner, repo, base, head }) => {
        const data = await engine.compareCommits({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          base,
          head,
        });
        return { data };
      },
      getCombinedStatusForRef: async ({ owner, repo, ref }) => {
        const data = await engine.getCommitStatus({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          ref,
        });
        return { data };
      },
      listReleases: async ({ owner, repo, per_page }) => {
        const data = await engine.listReleases({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          perPage: per_page,
        });
        return { data };
      },
      getLatestRelease: async ({ owner, repo }) => {
        const data = await engine.getLatestRelease({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
        });
        return { data };
      },
      createRelease: async ({
        owner,
        repo,
        tag_name,
        target_commitish,
        name,
        body,
        draft,
        prerelease,
        generate_release_notes,
        headers,
      }) => {
        const data = await engine.createRelease({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          tagName: tag_name,
          ...(target_commitish !== undefined ? { targetCommitish: target_commitish } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(body !== undefined ? { body } : {}),
          ...(draft !== undefined ? { draft } : {}),
          ...(prerelease !== undefined ? { prerelease } : {}),
          ...(generate_release_notes !== undefined
            ? { generateReleaseNotes: generate_release_notes }
            : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      updateRelease: async ({
        owner,
        repo,
        release_id,
        tag_name,
        target_commitish,
        name,
        body,
        draft,
        prerelease,
        headers,
      }) => {
        const data = await engine.updateRelease({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          releaseId: release_id,
          ...(tag_name !== undefined ? { tagName: tag_name } : {}),
          ...(target_commitish !== undefined ? { targetCommitish: target_commitish } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(body !== undefined ? { body } : {}),
          ...(draft !== undefined ? { draft } : {}),
          ...(prerelease !== undefined ? { prerelease } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      generateReleaseNotes: async ({
        owner,
        repo,
        tag_name,
        target_commitish,
        previous_tag_name,
        configuration_file_path,
        headers,
      }) => {
        const data = await engine.generateReleaseNotes({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          tagName: tag_name,
          ...(target_commitish !== undefined ? { targetCommitish: target_commitish } : {}),
          ...(previous_tag_name !== undefined ? { previousTagName: previous_tag_name } : {}),
          ...(configuration_file_path !== undefined
            ? { configurationFilePath: configuration_file_path }
            : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      listForOrg: async ({ org, type, per_page }) => {
        const data = await engine.listOrgRepos({
          accessToken,
          namespace,
          org,
          ...(type !== undefined ? { type } : {}),
          perPage: per_page,
        });
        return { data };
      },
      createDispatchEvent: async ({ owner, repo, event_type, client_payload, headers }) => {
        const data = await engine.createDispatchEvent({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          eventType: event_type,
          ...(client_payload !== undefined ? { clientPayload: client_payload } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
    },
    checks: {
      listForRef: async ({ owner, repo, ref, per_page }) => {
        const check_runs = await engine.listCheckRuns({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          ref,
          perPage: per_page,
        });
        return {
          data: {
            total_count: check_runs.length,
            check_runs,
          },
        };
      },
    },
    actions: {
      listWorkflowRunsForRepo: async ({ owner, repo, per_page, branch, status }) => {
        const workflow_runs = await engine.listWorkflowRuns({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          perPage: per_page,
          ...(branch !== undefined ? { branch } : {}),
          ...(status !== undefined ? { status } : {}),
        });
        return {
          data: {
            total_count: workflow_runs.length,
            workflow_runs,
          },
        };
      },
      getWorkflowRun: async ({ owner, repo, run_id }) => {
        const data = await engine.getWorkflowRun({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          runId: run_id,
        });
        return { data };
      },
      createWorkflowDispatch: async ({ owner, repo, workflow_id, ref, inputs, headers }) => {
        const data = await engine.triggerWorkflow({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          workflowId: workflow_id,
          ref,
          ...(inputs !== undefined ? { inputs } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      cancelWorkflowRun: async ({ owner, repo, run_id, headers }) => {
        const data = await engine.cancelWorkflowRun({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          runId: run_id,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      reRunWorkflow: async ({ owner, repo, run_id, enable_debug_logging, headers }) => {
        const data = await engine.rerunWorkflow({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          runId: run_id,
          ...(enable_debug_logging !== undefined
            ? { enableDebugLogging: enable_debug_logging }
            : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      reRunWorkflowFailedJobs: async ({ owner, repo, run_id, enable_debug_logging, headers }) => {
        const data = await engine.rerunFailedJobs({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          runId: run_id,
          ...(enable_debug_logging !== undefined
            ? { enableDebugLogging: enable_debug_logging }
            : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      downloadJobLogsForWorkflowRun: async ({ owner, repo, job_id }) => {
        const data = await engine.getWorkflowJobLogs({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          jobId: job_id,
        });
        return { data };
      },
    },
    activity: {
      listNotificationsForAuthenticatedUser: async ({
        all,
        participating,
        since,
        before,
        per_page,
      }) => {
        const data = await engine.listNotifications({
          accessToken,
          namespace,
          ...(all !== undefined ? { all } : {}),
          ...(participating !== undefined ? { participating } : {}),
          ...(since !== undefined ? { since } : {}),
          ...(before !== undefined ? { before } : {}),
          perPage: per_page,
        });
        return { data };
      },
      markNotificationsAsRead: async ({ last_read_at, headers }) => {
        const data = await engine.markNotificationsRead({
          accessToken,
          namespace,
          ...(last_read_at !== undefined ? { lastReadAt: last_read_at } : {}),
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
    },
    reactions: {
      createForIssue: async ({ owner, repo, issue_number, content, headers }) => {
        const data = await engine.createReaction({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
          content,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
      deleteForIssue: async ({ owner, repo, issue_number, reaction_id, headers }) => {
        const data = await engine.deleteReaction({
          accessToken,
          namespace,
          repo: toRepoIdentifier(owner, repo),
          issue: issue_number,
          reactionId: reaction_id,
          ...withHeaderIdempotencyKey(headers),
        });
        return { data };
      },
    },
  };
};
