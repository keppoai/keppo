export type GithubClientHeaders = Record<string, string>;

export interface GithubClient {
  issues: {
    listForRepo(params: {
      owner: string;
      repo: string;
      state: "open" | "closed" | "all";
      per_page: number;
    }): Promise<{ data: unknown }>;
    get(params: { owner: string; repo: string; issue_number: number }): Promise<{ data: unknown }>;
    listEvents(params: {
      owner: string;
      repo: string;
      issue_number: number;
      per_page: number;
    }): Promise<{ data: unknown }>;
    listEventsForTimeline(params: {
      owner: string;
      repo: string;
      issue_number: number;
      per_page: number;
    }): Promise<{ data: unknown }>;
    create(params: {
      owner: string;
      repo: string;
      title: string;
      body?: string;
      labels?: string[];
      assignees?: string[];
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    update(params: {
      owner: string;
      repo: string;
      issue_number: number;
      title?: string;
      body?: string;
      state?: "open" | "closed";
      labels?: string[];
      assignees?: string[];
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    createComment(params: {
      owner: string;
      repo: string;
      issue_number: number;
      body: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    listComments(params: {
      owner: string;
      repo: string;
      issue_number: number;
      per_page: number;
    }): Promise<{ data: unknown }>;
    updateComment(params: {
      owner: string;
      repo: string;
      comment_id: number;
      body: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    deleteComment(params: {
      owner: string;
      repo: string;
      comment_id: number;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    addLabels(params: {
      owner: string;
      repo: string;
      issue_number: number;
      labels: string[];
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    removeLabel(params: {
      owner: string;
      repo: string;
      issue_number: number;
      name: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    addAssignees(params: {
      owner: string;
      repo: string;
      issue_number: number;
      assignees: string[];
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    removeAssignees(params: {
      owner: string;
      repo: string;
      issue_number: number;
      assignees: string[];
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    listMilestones(params: {
      owner: string;
      repo: string;
      state: "open" | "closed" | "all";
      per_page: number;
    }): Promise<{ data: unknown }>;
    listLabelsForRepo(params: {
      owner: string;
      repo: string;
      per_page: number;
    }): Promise<{ data: unknown }>;
    createLabel(params: {
      owner: string;
      repo: string;
      name: string;
      color: string;
      description?: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    createMilestone(params: {
      owner: string;
      repo: string;
      title: string;
      state?: "open" | "closed";
      description?: string;
      due_on?: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    updateMilestone(params: {
      owner: string;
      repo: string;
      milestone_number: number;
      title?: string;
      state?: "open" | "closed";
      description?: string;
      due_on?: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    lock(params: {
      owner: string;
      repo: string;
      issue_number: number;
      lock_reason?: "off-topic" | "too heated" | "resolved" | "spam";
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    unlock(params: {
      owner: string;
      repo: string;
      issue_number: number;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
  };
  pulls: {
    list(params: {
      owner: string;
      repo: string;
      state: "open" | "closed" | "all";
      per_page: number;
    }): Promise<{ data: unknown }>;
    get(params: { owner: string; repo: string; pull_number: number }): Promise<{ data: unknown }>;
    create(params: {
      owner: string;
      repo: string;
      title: string;
      head: string;
      base: string;
      body?: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    merge(params: {
      owner: string;
      repo: string;
      pull_number: number;
      merge_method?: "merge" | "squash" | "rebase";
      commit_title?: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    listFiles(params: {
      owner: string;
      repo: string;
      pull_number: number;
      per_page: number;
    }): Promise<{ data: unknown }>;
    createReview(params: {
      owner: string;
      repo: string;
      pull_number: number;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
      commit_id?: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    listReviews(params: {
      owner: string;
      repo: string;
      pull_number: number;
      per_page: number;
    }): Promise<{ data: unknown }>;
    dismissReview(params: {
      owner: string;
      repo: string;
      pull_number: number;
      review_id: number;
      message: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    requestReviewers(params: {
      owner: string;
      repo: string;
      pull_number: number;
      reviewers: string[];
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    removeRequestedReviewers(params: {
      owner: string;
      repo: string;
      pull_number: number;
      reviewers: string[];
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    createReviewComment(params: {
      owner: string;
      repo: string;
      pull_number: number;
      body: string;
      commit_id?: string;
      path: string;
      line: number;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    update(params: {
      owner: string;
      repo: string;
      pull_number: number;
      title?: string;
      body?: string;
      state?: "open" | "closed";
      base?: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    updateBranch(params: {
      owner: string;
      repo: string;
      pull_number: number;
      expected_head_sha?: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    listCommits(params: {
      owner: string;
      repo: string;
      pull_number: number;
      per_page: number;
    }): Promise<{ data: unknown }>;
  };
  search: {
    issuesAndPullRequests(params: { q: string; per_page: number }): Promise<{ data: unknown }>;
    code(params: { q: string; per_page: number }): Promise<{ data: unknown }>;
    repos(params: { q: string; per_page: number }): Promise<{ data: unknown }>;
  };
  repos: {
    get(params: { owner: string; repo: string }): Promise<{ data: unknown }>;
    listBranches(params: {
      owner: string;
      repo: string;
      per_page: number;
    }): Promise<{ data: unknown }>;
    getContent(params: {
      owner: string;
      repo: string;
      path: string;
      ref?: string;
    }): Promise<{ data: unknown }>;
    createOrUpdateFileContents(params: {
      owner: string;
      repo: string;
      path: string;
      message: string;
      content: string;
      sha?: string;
      branch?: string;
      committer?: { name: string; email: string };
      author?: { name: string; email: string };
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    listCommits(params: {
      owner: string;
      repo: string;
      per_page: number;
      sha?: string;
    }): Promise<{ data: unknown }>;
    compareCommits(params: {
      owner: string;
      repo: string;
      base: string;
      head: string;
    }): Promise<{ data: unknown }>;
    getCombinedStatusForRef(params: {
      owner: string;
      repo: string;
      ref: string;
    }): Promise<{ data: unknown }>;
    listReleases(params: {
      owner: string;
      repo: string;
      per_page: number;
    }): Promise<{ data: unknown }>;
    getLatestRelease(params: { owner: string; repo: string }): Promise<{ data: unknown }>;
    createRelease(params: {
      owner: string;
      repo: string;
      tag_name: string;
      target_commitish?: string;
      name?: string;
      body?: string;
      draft?: boolean;
      prerelease?: boolean;
      generate_release_notes?: boolean;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    updateRelease(params: {
      owner: string;
      repo: string;
      release_id: number;
      tag_name?: string;
      target_commitish?: string;
      name?: string;
      body?: string;
      draft?: boolean;
      prerelease?: boolean;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    generateReleaseNotes(params: {
      owner: string;
      repo: string;
      tag_name: string;
      target_commitish?: string;
      previous_tag_name?: string;
      configuration_file_path?: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    listForOrg(params: {
      org: string;
      type?: "all" | "public" | "private" | "forks" | "sources" | "member";
      per_page: number;
    }): Promise<{ data: unknown }>;
    createDispatchEvent(params: {
      owner: string;
      repo: string;
      event_type: string;
      client_payload?: Record<string, unknown>;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
  };
  checks: {
    listForRef(params: {
      owner: string;
      repo: string;
      ref: string;
      per_page: number;
    }): Promise<{ data: unknown }>;
  };
  actions: {
    listWorkflowRunsForRepo(params: {
      owner: string;
      repo: string;
      per_page: number;
      branch?: string;
      status?: string;
    }): Promise<{ data: unknown }>;
    getWorkflowRun(params: {
      owner: string;
      repo: string;
      run_id: number;
    }): Promise<{ data: unknown }>;
    createWorkflowDispatch(params: {
      owner: string;
      repo: string;
      workflow_id: string;
      ref: string;
      inputs?: Record<string, string>;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    cancelWorkflowRun(params: {
      owner: string;
      repo: string;
      run_id: number;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    reRunWorkflow(params: {
      owner: string;
      repo: string;
      run_id: number;
      enable_debug_logging?: boolean;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    reRunWorkflowFailedJobs(params: {
      owner: string;
      repo: string;
      run_id: number;
      enable_debug_logging?: boolean;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    downloadJobLogsForWorkflowRun(params: {
      owner: string;
      repo: string;
      job_id: number;
    }): Promise<{ data: unknown }>;
  };
  activity: {
    listNotificationsForAuthenticatedUser(params: {
      all?: boolean;
      participating?: boolean;
      since?: string;
      before?: string;
      per_page: number;
    }): Promise<{ data: unknown }>;
    markNotificationsAsRead(params: {
      last_read_at?: string;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
  };
  reactions: {
    createForIssue(params: {
      owner: string;
      repo: string;
      issue_number: number;
      content: "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes";
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
    deleteForIssue(params: {
      owner: string;
      repo: string;
      issue_number: number;
      reaction_id: number;
      headers?: GithubClientHeaders;
    }): Promise<{ data: unknown }>;
  };
}

export type CreateGithubClient = (accessToken: string, namespace?: string) => GithubClient;
