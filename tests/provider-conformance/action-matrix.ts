export type ManagedProviderId =
  | "google"
  | "stripe"
  | "github"
  | "slack"
  | "notion"
  | "reddit"
  | "x"
  | "custom";

export type ActionCapability = "read" | "write";

export type SdkCallExpectation = {
  method: string;
  requireIdempotencyKey?: boolean;
  assertArgs?: (args: Record<string, unknown>) => boolean;
};

export type ConformanceOutputValueType =
  | "array"
  | "object"
  | "string"
  | "number"
  | "boolean"
  | "null";

export type ProviderConformanceErrorKind =
  | "invalid_input"
  | "not_connected"
  | "auth"
  | "rate_limited"
  | "not_found"
  | "unknown";

export type ProviderActionGoldenResultExpectation = {
  status: string | string[];
  hasActionId?: boolean;
  outputShape?: Record<string, ConformanceOutputValueType | ConformanceOutputValueType[]>;
};

export type ProviderActionGoldenErrorExpectation = {
  kind: ProviderConformanceErrorKind;
  messageIncludes?: string[];
};

export type ProviderActionGoldenExpectations = {
  positive: ProviderActionGoldenResultExpectation;
  negative: ProviderActionGoldenErrorExpectation;
  idempotency?: ProviderActionGoldenResultExpectation;
};

export type ProviderActionScenario = {
  toolName: string;
  capability: ActionCapability;
  positiveInput: Record<string, unknown>;
  negativeInput: Record<string, unknown>;
  negativeMode?: "invalid_input" | "not_connected";
  expectedSdkCalls?: SdkCallExpectation[];
  golden?: ProviderActionGoldenExpectations;
};

export type ProviderActionPack = {
  providerId: ManagedProviderId;
  gatewayProviderId?: string;
  scenarios: ProviderActionScenario[];
};

const asStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
};

const hasArgs = (args: Record<string, unknown>, expected: Record<string, unknown>): boolean => {
  for (const [key, value] of Object.entries(expected)) {
    if (args[key] !== value) {
      return false;
    }
  }
  return true;
};

const outputShapeByTool: Record<string, Record<string, ConformanceOutputValueType>> = {
  "gmail.searchThreads": { threads: "array" },
  "gmail.listUnread": { threads: "array" },
  "gmail.fetchMessageBody": {
    messageId: "string",
    body: "string",
    to: ["array", "string"],
    subject: "string",
  },
  "gmail.fetchAttachmentsMetadata": {
    messageId: "string",
    attachments: "array",
  },
  "gmail.getProfile": {
    emailAddress: "string",
    historyId: "string",
    messagesTotal: "number",
    threadsTotal: "number",
  },
  "gmail.getThread": {
    threadId: "string",
    historyId: "string",
    messages: "array",
  },
  "gmail.listLabels": {
    labels: "array",
  },
  "gmail.listDrafts": {
    drafts: "array",
  },
  "gmail.getDraft": {
    draftId: "string",
    messageId: "string",
    threadId: "string",
    to: ["array", "string"],
    subject: "string",
    body: "string",
  },
  "gmail.listHistory": {
    startHistoryId: "string",
    historyId: "string",
    records: "array",
  },
  "gmail.downloadAttachment": {
    messageId: "string",
    attachmentId: "string",
    data: "string",
    size: "number",
  },
  "gmail.listFilters": {
    filters: "array",
  },
  "gmail.listSendAsAliases": {
    aliases: "array",
  },
  "gmail.getVacation": {
    enableAutoReply: "boolean",
    responseSubject: "string",
    responseBodyPlainText: "string",
    responseBodyHtml: "string",
    restrictToContacts: "boolean",
    restrictToDomain: "boolean",
    startTime: "string",
    endTime: "string",
  },
  "gmail.getLabel": {
    labelId: "string",
    name: "string",
    type: "string",
    labelListVisibility: "string",
    messageListVisibility: "string",
    messagesTotal: "number",
    messagesUnread: "number",
    threadsTotal: "number",
    threadsUnread: "number",
  },
  "gmail.updateLabel": {
    status: "string",
    labelId: "string",
    name: "string",
    labelListVisibility: "string",
    messageListVisibility: "string",
  },
  "gmail.deleteLabel": {
    status: "string",
    labelId: "string",
  },
  "gmail.getFilter": {
    filterId: "string",
    criteria: "object",
    action: "object",
  },
  "gmail.getSendAsAlias": {
    sendAsEmail: "string",
    displayName: "string",
    replyToAddress: "string",
    isPrimary: "boolean",
    isDefault: "boolean",
    treatAsAlias: "boolean",
    signature: "string",
  },
  "gmail.updateSendAsAlias": {
    status: "string",
    sendAsEmail: "string",
    displayName: "string",
    replyToAddress: "string",
    treatAsAlias: "boolean",
    signature: "string",
  },
  "stripe.lookupCustomer": {
    found: "boolean",
    customer: "object",
  },
  "stripe.listSubscriptions": {
    customerId: "string",
    subscriptions: "array",
  },
  "stripe.listCharges": {
    customerId: "string",
    charges: "array",
  },
  "stripe.invoiceHistory": {
    customerId: "string",
    invoices: "array",
  },
  "stripe.searchCharges": {
    query: "string",
    charges: "array",
  },
  "stripe.searchSubscriptions": {
    query: "string",
    subscriptions: "array",
  },
  "stripe.searchInvoices": {
    query: "string",
    invoices: "array",
  },
  "stripe.getPaymentIntent": {
    customerId: "string",
    payment_intent: "object",
  },
  "stripe.listPaymentIntents": {
    customerId: "string",
    payment_intents: "array",
  },
  "stripe.searchPaymentIntents": {
    query: "string",
    payment_intents: "array",
  },
  "stripe.getCoupon": {
    coupon: "object",
  },
  "stripe.listCoupons": {
    coupons: "array",
  },
  "stripe.getPromotionCode": {
    promotion_code: "object",
  },
  "stripe.listPromotionCodes": {
    promotion_codes: "array",
  },
  "stripe.getProduct": {
    product: "object",
  },
  "stripe.listProducts": {
    products: "array",
  },
  "stripe.getPrice": {
    price: "object",
  },
  "stripe.listPrices": {
    prices: "array",
  },
  "stripe.getBalanceTransaction": {
    balance_transaction: "object",
  },
  "stripe.listGlobalBalanceTransactions": {
    balance_transactions: "array",
  },
  "stripe.getCreditNote": {
    credit_note: "object",
  },
  "stripe.previewCreditNote": {
    credit_note_preview: "object",
  },
  "github.listIssues": {
    repo: "string",
    issues: "array",
  },
  "github.getIssue": {
    repo: "string",
    issue: "object",
  },
  "github.listIssueEvents": {
    repo: "string",
    issue: "number",
    events: "array",
  },
  "github.listIssueTimeline": {
    repo: "string",
    issue: "number",
    timeline: "array",
  },
  "github.listPullRequests": {
    repo: "string",
    pullRequests: "array",
  },
  "github.getPullRequest": {
    repo: "string",
    pullRequest: "object",
  },
  "github.listPRFiles": {
    repo: "string",
    pullNumber: "number",
    files: "array",
  },
  "github.searchIssues": {
    repo: "string",
    query: "string",
    results: "array",
  },
  "github.searchCode": {
    query: "string",
    results: "array",
  },
  "github.searchRepositories": {
    query: "string",
    repositories: "array",
  },
  "github.getRepo": {
    repo: "string",
    repository: "object",
  },
  "github.listOrgRepos": {
    org: "string",
    repositories: "array",
  },
  "github.listReviews": {
    repo: "string",
    pullNumber: "number",
    reviews: "array",
  },
  "github.listCommits": {
    repo: "string",
    commits: "array",
  },
  "github.compareCommits": {
    repo: "string",
    basehead: "string",
    comparison: "object",
  },
  "github.getCommitStatus": {
    repo: "string",
    ref: "string",
    status: "object",
  },
  "github.listCheckRuns": {
    repo: "string",
    ref: "string",
    checkRuns: "array",
  },
  "github.listWorkflowRuns": {
    repo: "string",
    workflowRuns: "array",
  },
  "github.getWorkflowRun": {
    repo: "string",
    workflowRun: "object",
  },
  "github.listNotifications": {
    notifications: "array",
  },
  "github.getWorkflowJobLogs": {
    repo: "string",
    jobId: "number",
    logs: "object",
  },
  "github.listPRCommits": {
    repo: "string",
    pullNumber: "number",
    commits: "array",
  },
  "github.listIssueComments": {
    repo: "string",
    issue: "number",
    comments: "array",
  },
  "github.getLatestRelease": {
    repo: "string",
    release: "object",
  },
  "github.listReleases": {
    repo: "string",
    releases: "array",
  },
  "github.listMilestones": {
    repo: "string",
    milestones: "array",
  },
  "github.listBranches": {
    repo: "string",
    branches: "array",
  },
  "github.getFileContents": {
    repo: "string",
    file: "object",
  },
  "github.listLabels": {
    repo: "string",
    labels: "array",
  },
  "slack.listChannels": { channels: "array" },
  "slack.getChannelHistory": {
    channel: "string",
    messages: "array",
  },
  "slack.getThreadReplies": {
    channel: "string",
    threadTs: "string",
    replies: "array",
  },
  "slack.getReactions": {
    channel: "string",
    ts: "string",
    reactions: "array",
  },
  "slack.listUsers": {
    users: "array",
  },
  "slack.getUserInfo": {
    user: "object",
  },
  "slack.getChannelInfo": {
    channel: "object",
  },
  "slack.searchMessages": {
    query: "string",
    messages: "array",
  },
  "slack.listChannelMembers": {
    channel: "string",
    members: "array",
  },
  "slack.listScheduledMessages": {
    scheduled_messages: "array",
  },
  "slack.listBookmarks": {
    channel: "string",
    bookmarks: "array",
  },
  "slack.listReminders": {
    reminders: "array",
  },
  "slack.listUserGroups": {
    user_groups: "array",
  },
  "slack.listUserGroupMembers": {
    user_group_id: "string",
    members: "array",
  },
  "slack.getUserPresence": {
    presence: "object",
  },
  "slack.listReactions": {
    reactions: "array",
  },
  "slack.getPermalink": {
    channel: "string",
    ts: "string",
    permalink: "string",
  },
  "slack.listPins": {
    channel: "string",
    pins: "array",
  },
  "slack.listFiles": {
    files: "array",
  },
  "slack.getFileInfo": {
    file: "object",
  },
  "slack.getUserProfile": {
    profile: "object",
  },
  "slack.searchFiles": {
    query: "string",
    files: "array",
  },
  "notion.searchPages": {
    query: "string",
    pages: "array",
  },
  "notion.getPage": {
    pageId: "string",
    title: "string",
    archived: "boolean",
  },
  "notion.getPageAsMarkdown": {
    pageId: "string",
    title: "string",
    markdown: "string",
    blockCount: "number",
  },
  "notion.queryDatabase": {
    databaseId: "string",
    query: "string",
    results: "array",
  },
  "notion.getDatabase": {
    database: "object",
  },
  "notion.getBlockChildren": {
    blockId: "string",
    children: "array",
  },
  "notion.getBlock": {
    blockId: "string",
    type: "string",
    hasChildren: "boolean",
  },
  "notion.listComments": {
    pageId: "string",
    comments: "array",
  },
  "notion.getComment": {
    comment: "object",
  },
  "notion.getPageProperty": {
    pageId: "string",
    propertyId: "string",
    type: "string",
  },
  "notion.listUsers": {
    users: "array",
  },
  "notion.getUser": {
    user: "object",
  },
  "notion.getBotUser": {
    botUser: "object",
  },
  "reddit.searchPosts": {
    subreddit: "string",
    query: "string",
    posts: "array",
  },
  "reddit.getPostComments": {
    subreddit: "string",
    postId: "string",
    post: "object",
    comments: "array",
  },
  "reddit.getInfo": {
    thingIds: "array",
    items: "array",
  },
  "reddit.listHot": {
    subreddit: "string",
    posts: "array",
  },
  "reddit.listNew": {
    subreddit: "string",
    posts: "array",
  },
  "reddit.listTop": {
    subreddit: "string",
    posts: "array",
  },
  "reddit.listRising": {
    subreddit: "string",
    posts: "array",
  },
  "reddit.listControversial": {
    subreddit: "string",
    posts: "array",
  },
  "reddit.searchSubreddits": {
    query: "string",
    subreddits: "array",
  },
  "reddit.getUserOverview": {
    username: "string",
    posts: "array",
    comments: "array",
  },
  "reddit.getUserAbout": {
    user: "object",
  },
  "reddit.listInbox": {
    messages: "array",
  },
  "reddit.listUnreadMessages": {
    messages: "array",
  },
  "reddit.listSentMessages": {
    messages: "array",
  },
  "reddit.listMentions": {
    messages: "array",
  },
  "reddit.getSubredditInfo": {
    subreddit: "object",
  },
  "reddit.getModQueue": {
    subreddit: "string",
    items: "array",
  },
  "reddit.getReports": {
    subreddit: "string",
    items: "array",
  },
  "reddit.getModLog": {
    subreddit: "string",
    entries: "array",
  },
  "reddit.getSubredditRules": {
    subreddit: "string",
    rules: "array",
  },
  "reddit.listModmail": {
    subreddit: "string",
    conversations: "array",
  },
  "reddit.getModmail": {
    conversationId: "string",
    conversation: "object",
  },
  "reddit.getMe": {
    me: "object",
  },
  "x.searchPosts": {
    query: "string",
    posts: "array",
  },
  "x.getPost": {
    post: "object",
  },
  "x.getPosts": {
    postIds: "array",
    posts: "array",
  },
  "x.getUserTimeline": {
    userId: "string",
    posts: "array",
  },
  "x.getUserMentions": {
    userId: "string",
    posts: "array",
  },
  "x.getUserByUsername": {
    user: "object",
  },
  "x.getUserById": {
    user: "object",
  },
  "x.getMe": {
    me: "object",
  },
  "x.getDMEvents": {
    events: "array",
  },
  "x.getQuoteTweets": {
    postId: "string",
    posts: "array",
  },
  "x.getFollowers": {
    userId: "string",
    users: "array",
  },
  "x.getFollowing": {
    userId: "string",
    users: "array",
  },
  "x.getLikingUsers": {
    postId: "string",
    users: "array",
  },
  "x.getLikedPosts": {
    userId: "string",
    posts: "array",
  },
  "x.getRepostedBy": {
    postId: "string",
    users: "array",
  },
  "x.getBlockedUsers": {
    userId: "string",
    users: "array",
  },
  "x.getMutedUsers": {
    userId: "string",
    users: "array",
  },
  "x.getBookmarks": {
    userId: "string",
    posts: "array",
  },
  "x.searchUsers": {
    query: "string",
    users: "array",
  },
  "x.getUsersByUsernames": {
    usernames: "array",
    users: "array",
  },
  "x.getList": {
    list: "object",
  },
  "x.getOwnedLists": {
    userId: "string",
    lists: "array",
  },
  "x.getListMembers": {
    listId: "string",
    users: "array",
  },
  "x.getListTweets": {
    listId: "string",
    posts: "array",
  },
  "x.getHomeTimeline": {
    userId: "string",
    posts: "array",
  },
  "x.searchAllPosts": {
    query: "string",
    posts: "array",
  },
  "x.getPostCounts": {
    query: "string",
    counts: "object",
  },
  "custom.callRead": {
    status: "string",
    tool: "string",
    output: "object",
  },
};

const toNegativeGoldenExpectation = (
  mode: ProviderActionScenario["negativeMode"],
): ProviderActionGoldenErrorExpectation => {
  if (mode === "not_connected") {
    return {
      kind: "not_connected",
      messageIncludes: ["not connected"],
    };
  }
  return {
    kind: "invalid_input",
    messageIncludes: ["invalid input"],
  };
};

const withGoldenExpectations = (scenario: ProviderActionScenario): ProviderActionScenario => {
  if (scenario.golden) {
    return scenario;
  }

  if (scenario.capability === "read") {
    return {
      ...scenario,
      golden: {
        positive: {
          status: "succeeded",
          outputShape: outputShapeByTool[scenario.toolName] ?? {},
        },
        negative: toNegativeGoldenExpectation(scenario.negativeMode),
      },
    };
  }

  return {
    ...scenario,
    golden: {
      positive: {
        status: ["succeeded", "approval_required"],
        hasActionId: true,
      },
      negative: toNegativeGoldenExpectation(scenario.negativeMode),
      idempotency: {
        status: "idempotent_replay",
        hasActionId: true,
      },
    },
  };
};

const providerActionPackDefinitions: ProviderActionPack[] = [
  {
    providerId: "google",
    gatewayProviderId: "gmail",
    scenarios: [
      {
        toolName: "gmail.searchThreads",
        capability: "read",
        positiveInput: { query: "is:unread", limit: 1 },
        negativeInput: { query: "is:unread", limit: 0 },
        expectedSdkCalls: [
          {
            method: "gmail.users.messages.list",
            assertArgs: (args) => hasArgs(args, { query: "is:unread", maxResults: 1 }),
          },
          {
            method: "gmail.users.messages.get",
            assertArgs: (args) => String(args.messageId ?? "").length > 0,
          },
        ],
      },
      {
        toolName: "gmail.listUnread",
        capability: "read",
        positiveInput: { limit: 1 },
        negativeInput: { limit: 0 },
        expectedSdkCalls: [
          {
            method: "gmail.users.messages.list",
            assertArgs: (args) => hasArgs(args, { query: "is:unread", maxResults: 1 }),
          },
          {
            method: "gmail.users.messages.get",
            assertArgs: (args) => String(args.messageId ?? "").length > 0,
          },
        ],
      },
      {
        toolName: "gmail.fetchMessageBody",
        capability: "read",
        positiveInput: { messageId: "msg_seed_1" },
        negativeInput: { messageId: "" },
        expectedSdkCalls: [
          {
            method: "gmail.users.messages.get",
            assertArgs: (args) => hasArgs(args, { messageId: "msg_seed_1", format: "full" }),
          },
        ],
      },
      {
        toolName: "gmail.fetchAttachmentsMetadata",
        capability: "read",
        positiveInput: { messageId: "msg_seed_1" },
        negativeInput: { messageId: "" },
        expectedSdkCalls: [
          {
            method: "gmail.users.messages.get",
            assertArgs: (args) => hasArgs(args, { messageId: "msg_seed_1", format: "full" }),
          },
        ],
      },
      {
        toolName: "gmail.sendEmail",
        capability: "write",
        positiveInput: {
          to: ["provider@example.com"],
          cc: [],
          bcc: [],
          subject: "Action matrix",
          body: "gmail send",
        },
        negativeInput: {
          to: [],
          subject: "Action matrix",
          body: "gmail send",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.messages.send",
            requireIdempotencyKey: true,
          },
        ],
      },
      {
        toolName: "gmail.replyToThread",
        capability: "write",
        positiveInput: {
          threadId: "thr_seed_1",
          to: ["support@example.com"],
          body: "gmail reply",
        },
        negativeInput: {
          threadId: "",
          to: ["support@example.com"],
          body: "gmail reply",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.messages.send",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { threadId: "thr_seed_1" }),
          },
        ],
      },
      {
        toolName: "gmail.applyLabel",
        capability: "write",
        positiveInput: {
          threadId: "thr_seed_1",
          label: "STARRED",
        },
        negativeInput: {
          threadId: "",
          label: "STARRED",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.threads.modify",
            requireIdempotencyKey: true,
            assertArgs: (args) => {
              return (
                hasArgs(args, { threadId: "thr_seed_1" }) &&
                asStringArray(args.addLabelIds).includes("STARRED")
              );
            },
          },
        ],
      },
      {
        toolName: "gmail.archive",
        capability: "write",
        positiveInput: {
          threadId: "thr_seed_1",
        },
        negativeInput: {
          threadId: "thr_seed_1",
        },
        negativeMode: "not_connected",
        expectedSdkCalls: [
          {
            method: "gmail.users.threads.modify",
            requireIdempotencyKey: true,
            assertArgs: (args) => {
              return (
                hasArgs(args, { threadId: "thr_seed_1" }) &&
                asStringArray(args.removeLabelIds).includes("INBOX")
              );
            },
          },
        ],
      },
      {
        toolName: "gmail.getProfile",
        capability: "read",
        positiveInput: {},
        negativeInput: { _reserved: "invalid" },
        expectedSdkCalls: [
          {
            method: "gmail.users.getProfile",
          },
        ],
      },
      {
        toolName: "gmail.getThread",
        capability: "read",
        positiveInput: { threadId: "thr_seed_1" },
        negativeInput: { threadId: "" },
        expectedSdkCalls: [
          {
            method: "gmail.users.threads.get",
            assertArgs: (args) => hasArgs(args, { threadId: "thr_seed_1", format: "full" }),
          },
        ],
      },
      {
        toolName: "gmail.listLabels",
        capability: "read",
        positiveInput: {},
        negativeInput: { _reserved: "invalid" },
        expectedSdkCalls: [
          {
            method: "gmail.users.labels.list",
          },
        ],
      },
      {
        toolName: "gmail.createLabel",
        capability: "write",
        positiveInput: {
          name: "Needs-Response",
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
        negativeInput: {
          name: "",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.labels.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { name: "Needs-Response" }),
          },
        ],
      },
      {
        toolName: "gmail.createDraft",
        capability: "write",
        positiveInput: {
          to: ["support@example.com"],
          cc: [],
          bcc: [],
          subject: "Draft message",
          body: "Draft body",
          threadId: "thr_seed_1",
        },
        negativeInput: {
          to: [],
          subject: "Draft message",
          body: "Draft body",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.drafts.create",
            requireIdempotencyKey: true,
          },
        ],
      },
      {
        toolName: "gmail.listDrafts",
        capability: "read",
        positiveInput: { limit: 2 },
        negativeInput: { limit: 0 },
        expectedSdkCalls: [
          {
            method: "gmail.users.drafts.list",
            assertArgs: (args) => hasArgs(args, { maxResults: 2 }),
          },
        ],
      },
      {
        toolName: "gmail.getDraft",
        capability: "read",
        positiveInput: { draftId: "dr_seed_1" },
        negativeInput: { draftId: "" },
        expectedSdkCalls: [
          {
            method: "gmail.users.drafts.get",
            assertArgs: (args) => hasArgs(args, { draftId: "dr_seed_1", format: "full" }),
          },
        ],
      },
      {
        toolName: "gmail.updateDraft",
        capability: "write",
        positiveInput: {
          draftId: "dr_seed_1",
          to: ["support@example.com"],
          cc: [],
          bcc: [],
          subject: "Updated draft",
          body: "Updated draft body",
          threadId: "thr_seed_1",
        },
        negativeInput: {
          draftId: "",
          to: ["support@example.com"],
          subject: "Updated draft",
          body: "Updated draft body",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.drafts.update",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { draftId: "dr_seed_1" }),
          },
        ],
      },
      {
        toolName: "gmail.sendDraft",
        capability: "write",
        positiveInput: {
          draftId: "dr_seed_1",
        },
        negativeInput: {
          draftId: "",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.drafts.send",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { draftId: "dr_seed_1" }),
          },
        ],
      },
      {
        toolName: "gmail.batchModifyMessages",
        capability: "write",
        positiveInput: {
          messageIds: ["msg_seed_1", "msg_seed_2"],
          addLabelIds: ["Label_1"],
          removeLabelIds: ["UNREAD"],
        },
        negativeInput: {
          messageIds: [],
          addLabelIds: [],
          removeLabelIds: [],
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.messages.batchModify",
            requireIdempotencyKey: true,
            assertArgs: (args) => {
              return (
                asStringArray(args.messageIds).length === 2 &&
                asStringArray(args.addLabelIds).includes("Label_1") &&
                asStringArray(args.removeLabelIds).includes("UNREAD")
              );
            },
          },
        ],
      },
      {
        toolName: "gmail.listHistory",
        capability: "read",
        positiveInput: { startHistoryId: "1000", limit: 10 },
        negativeInput: { startHistoryId: "", limit: 10 },
        expectedSdkCalls: [
          {
            method: "gmail.users.history.list",
            assertArgs: (args) => hasArgs(args, { startHistoryId: "1000", maxResults: 10 }),
          },
        ],
      },
      {
        toolName: "gmail.watch",
        capability: "write",
        positiveInput: {
          topicName: "projects/example/topics/support-mail",
          labelIds: ["INBOX"],
          labelFilterBehavior: "include",
        },
        negativeInput: {
          topicName: "",
          labelIds: [],
          labelFilterBehavior: "include",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.watch",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                topicName: "projects/example/topics/support-mail",
                labelFilterBehavior: "include",
              }),
          },
        ],
      },
      {
        toolName: "gmail.stopWatch",
        capability: "write",
        positiveInput: {},
        negativeInput: { _reserved: "invalid" },
        expectedSdkCalls: [
          {
            method: "gmail.users.stop",
            requireIdempotencyKey: true,
          },
        ],
      },
      {
        toolName: "gmail.trashThread",
        capability: "write",
        positiveInput: {
          threadId: "thr_seed_1",
        },
        negativeInput: {
          threadId: "",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.threads.trash",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { threadId: "thr_seed_1" }),
          },
        ],
      },
      {
        toolName: "gmail.untrashThread",
        capability: "write",
        positiveInput: {
          threadId: "thr_seed_1",
        },
        negativeInput: {
          threadId: "",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.threads.untrash",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { threadId: "thr_seed_1" }),
          },
        ],
      },
      {
        toolName: "gmail.trashMessage",
        capability: "write",
        positiveInput: {
          messageId: "msg_seed_2",
        },
        negativeInput: {
          messageId: "",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.messages.trash",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { messageId: "msg_seed_2" }),
          },
        ],
      },
      {
        toolName: "gmail.untrashMessage",
        capability: "write",
        positiveInput: {
          messageId: "msg_seed_2",
        },
        negativeInput: {
          messageId: "",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.messages.untrash",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { messageId: "msg_seed_2" }),
          },
        ],
      },
      {
        toolName: "gmail.downloadAttachment",
        capability: "read",
        positiveInput: {
          messageId: "msg_seed_1",
          attachmentId: "att_seed_1",
        },
        negativeInput: {
          messageId: "msg_seed_1",
          attachmentId: "",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.messages.attachments.get",
            assertArgs: (args) =>
              hasArgs(args, {
                messageId: "msg_seed_1",
                attachmentId: "att_seed_1",
              }),
          },
        ],
      },
      {
        toolName: "gmail.deleteDraft",
        capability: "write",
        positiveInput: {
          draftId: "dr_2",
        },
        negativeInput: {
          draftId: "",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.drafts.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { draftId: "dr_2" }),
          },
        ],
      },
      {
        toolName: "gmail.listFilters",
        capability: "read",
        positiveInput: {},
        negativeInput: { _reserved: "invalid" },
        expectedSdkCalls: [
          {
            method: "gmail.users.settings.filters.list",
          },
        ],
      },
      {
        toolName: "gmail.getFilter",
        capability: "read",
        positiveInput: {
          filterId: "filter_1",
        },
        negativeInput: {
          filterId: "",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.settings.filters.get",
            assertArgs: (args) => hasArgs(args, { filterId: "filter_1" }),
          },
        ],
      },
      {
        toolName: "gmail.createFilter",
        capability: "write",
        positiveInput: {
          criteria: {
            from: "alerts@example.com",
            hasAttachment: true,
          },
          action: {
            addLabelIds: ["Label_1"],
            removeLabelIds: ["INBOX"],
          },
        },
        negativeInput: {
          criteria: {},
          action: {},
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.settings.filters.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => {
              const criteria = (args.criteria ?? {}) as Record<string, unknown>;
              const action = (args.action ?? {}) as Record<string, unknown>;
              return (
                criteria.from === "alerts@example.com" &&
                criteria.hasAttachment === true &&
                asStringArray(action.addLabelIds).includes("Label_1")
              );
            },
          },
        ],
      },
      {
        toolName: "gmail.deleteFilter",
        capability: "write",
        positiveInput: {
          filterId: "filter_1",
        },
        negativeInput: {
          filterId: "",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.settings.filters.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { filterId: "filter_1" }),
          },
        ],
      },
      {
        toolName: "gmail.listSendAsAliases",
        capability: "read",
        positiveInput: {},
        negativeInput: { _reserved: "invalid" },
        expectedSdkCalls: [
          {
            method: "gmail.users.settings.sendAs.list",
          },
        ],
      },
      {
        toolName: "gmail.getVacation",
        capability: "read",
        positiveInput: {},
        negativeInput: { _reserved: "invalid" },
        expectedSdkCalls: [
          {
            method: "gmail.users.settings.getVacation",
          },
        ],
      },
      {
        toolName: "gmail.updateVacation",
        capability: "write",
        positiveInput: {
          enableAutoReply: true,
          responseSubject: "OOO",
          responseBodyPlainText: "I am away",
          responseBodyHtml: "<p>I am away</p>",
          restrictToContacts: true,
          restrictToDomain: false,
        },
        negativeInput: {
          enableAutoReply: "true",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.settings.updateVacation",
            requireIdempotencyKey: true,
            assertArgs: (args) => {
              const vacation = (args.vacation ?? {}) as Record<string, unknown>;
              return (
                vacation.enableAutoReply === true &&
                vacation.responseSubject === "OOO" &&
                vacation.restrictToContacts === true
              );
            },
          },
        ],
      },
      {
        toolName: "gmail.removeLabel",
        capability: "write",
        positiveInput: {
          threadId: "thr_seed_1",
          label: "STARRED",
        },
        negativeInput: {
          threadId: "",
          label: "STARRED",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.threads.modify",
            requireIdempotencyKey: true,
            assertArgs: (args) => {
              return (
                hasArgs(args, { threadId: "thr_seed_1" }) &&
                asStringArray(args.removeLabelIds).includes("STARRED")
              );
            },
          },
        ],
      },
      {
        toolName: "gmail.getLabel",
        capability: "read",
        positiveInput: {
          labelId: "Label_1",
        },
        negativeInput: {
          labelId: "",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.labels.get",
            assertArgs: (args) => hasArgs(args, { labelId: "Label_1" }),
          },
        ],
      },
      {
        toolName: "gmail.updateLabel",
        capability: "write",
        positiveInput: {
          labelId: "Label_1",
          name: "Needs-Response-Updated",
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
        negativeInput: {
          labelId: "Label_1",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.labels.update",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { labelId: "Label_1" }),
          },
        ],
      },
      {
        toolName: "gmail.deleteLabel",
        capability: "write",
        positiveInput: {
          labelId: "Label_1",
        },
        negativeInput: {
          labelId: "",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.labels.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { labelId: "Label_1" }),
          },
        ],
      },
      {
        toolName: "gmail.getSendAsAlias",
        capability: "read",
        positiveInput: {
          sendAsEmail: "support@example.com",
        },
        negativeInput: {
          sendAsEmail: "",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.settings.sendAs.get",
            assertArgs: (args) => hasArgs(args, { sendAsEmail: "support@example.com" }),
          },
        ],
      },
      {
        toolName: "gmail.updateSendAsAlias",
        capability: "write",
        positiveInput: {
          sendAsEmail: "support@example.com",
          displayName: "Support Ops",
          signature: "Thanks,\nSupport Ops",
          treatAsAlias: true,
        },
        negativeInput: {
          sendAsEmail: "support@example.com",
        },
        expectedSdkCalls: [
          {
            method: "gmail.users.settings.sendAs.update",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { sendAsEmail: "support@example.com" }),
          },
        ],
      },
    ],
  },
  {
    providerId: "stripe",
    gatewayProviderId: "stripe",
    scenarios: [
      {
        toolName: "stripe.lookupCustomer",
        capability: "read",
        positiveInput: { customerId: "cus_100" },
        negativeInput: { customerId: "" },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
        ],
      },
      {
        toolName: "stripe.listSubscriptions",
        capability: "read",
        positiveInput: { customerId: "cus_100" },
        negativeInput: { customerId: "" },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
        ],
      },
      {
        toolName: "stripe.listCharges",
        capability: "read",
        positiveInput: { customerId: "cus_100" },
        negativeInput: { customerId: "" },
        expectedSdkCalls: [
          {
            method: "stripe.charges.list",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
        ],
      },
      {
        toolName: "stripe.invoiceHistory",
        capability: "read",
        positiveInput: { customerId: "cus_100" },
        negativeInput: { customerId: "" },
        expectedSdkCalls: [
          {
            method: "stripe.invoices.list",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
        ],
      },
      {
        toolName: "stripe.issueRefund",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          chargeId: "ch_cus_100",
          amount: 49,
          currency: "usd",
        },
        negativeInput: {
          customerId: "cus_100",
          chargeId: "",
          amount: 49,
          currency: "usd",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.charges.list",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.refunds.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", chargeId: "ch_cus_100" }),
          },
        ],
      },
      {
        toolName: "stripe.cancelSubscription",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          subscriptionId: "sub_100",
          atPeriodEnd: false,
        },
        negativeInput: {
          customerId: "cus_100",
          subscriptionId: "",
          atPeriodEnd: false,
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.subscriptions.cancel",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { subscriptionId: "sub_100" }),
          },
        ],
      },
      {
        toolName: "stripe.adjustBalance",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          amount: 5,
          currency: "usd",
          reason: "matrix adjustment",
        },
        negativeInput: {
          customerId: "cus_100",
          amount: 5,
          currency: "usd",
          reason: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.customers.createBalanceTransaction",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", amount: 5 }),
          },
        ],
      },
      {
        toolName: "stripe.searchCustomers",
        capability: "read",
        positiveInput: { query: "customer@example.com", limit: 10 },
        negativeInput: { query: "", limit: 10 },
        expectedSdkCalls: [
          {
            method: "stripe.customers.search",
            assertArgs: (args) => hasArgs(args, { query: "customer@example.com", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.updateCustomer",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          email: "updated@example.com",
        },
        negativeInput: {
          customerId: "cus_100",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.customers.update",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", email: "updated@example.com" }),
          },
        ],
      },
      {
        toolName: "stripe.getSubscription",
        capability: "read",
        positiveInput: { customerId: "cus_100", subscriptionId: "sub_100" },
        negativeInput: { customerId: "cus_100", subscriptionId: "" },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.subscriptions.retrieve",
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", subscriptionId: "sub_100" }),
          },
        ],
      },
      {
        toolName: "stripe.updateSubscription",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          subscriptionId: "sub_100",
          priceId: "price_pro",
          quantity: 2,
        },
        negativeInput: {
          customerId: "cus_100",
          subscriptionId: "sub_100",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.subscriptions.update",
            requireIdempotencyKey: true,
          },
        ],
      },
      {
        toolName: "stripe.resumeSubscription",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          subscriptionId: "sub_100",
        },
        negativeInput: {
          customerId: "cus_100",
          subscriptionId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.subscriptions.resume",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", subscriptionId: "sub_100" }),
          },
        ],
      },
      {
        toolName: "stripe.getInvoice",
        capability: "read",
        positiveInput: { customerId: "cus_100", invoiceId: "in_cus_100_1" },
        negativeInput: { customerId: "cus_100", invoiceId: "" },
        expectedSdkCalls: [
          {
            method: "stripe.invoices.retrieve",
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", invoiceId: "in_cus_100_1" }),
          },
        ],
      },
      {
        toolName: "stripe.previewInvoice",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          subscriptionId: "sub_100",
          priceId: "price_pro",
          quantity: 2,
        },
        negativeInput: {
          customerId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.invoices.createPreview",
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", subscriptionId: "sub_100" }),
          },
        ],
      },
      {
        toolName: "stripe.sendInvoice",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          invoiceId: "in_cus_100_1",
        },
        negativeInput: {
          customerId: "cus_100",
          invoiceId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.invoices.sendInvoice",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", invoiceId: "in_cus_100_1" }),
          },
        ],
      },
      {
        toolName: "stripe.voidInvoice",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          invoiceId: "in_cus_100_1",
        },
        negativeInput: {
          customerId: "cus_100",
          invoiceId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.invoices.voidInvoice",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", invoiceId: "in_cus_100_1" }),
          },
        ],
      },
      {
        toolName: "stripe.payInvoice",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          invoiceId: "in_cus_100_1",
        },
        negativeInput: {
          customerId: "cus_100",
          invoiceId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.invoices.pay",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", invoiceId: "in_cus_100_1" }),
          },
        ],
      },
      {
        toolName: "stripe.listPaymentMethods",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          type: "card",
        },
        negativeInput: {
          customerId: "",
          type: "card",
        },
        expectedSdkCalls: [
          {
            method: "stripe.paymentMethods.list",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", type: "card" }),
          },
        ],
      },
      {
        toolName: "stripe.getRefund",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          refundId: "re_seed_1",
        },
        negativeInput: {
          customerId: "cus_100",
          refundId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.refunds.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", refundId: "re_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.listRefunds",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          limit: 10,
        },
        negativeInput: {
          customerId: "cus_100",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "stripe.refunds.list",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.getCharge",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          chargeId: "ch_cus_100",
        },
        negativeInput: {
          customerId: "cus_100",
          chargeId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.charges.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", chargeId: "ch_cus_100" }),
          },
        ],
      },
      {
        toolName: "stripe.createCreditNote",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          invoiceId: "in_cus_100_1",
          amount: 500,
          reason: "order_change",
        },
        negativeInput: {
          customerId: "cus_100",
          invoiceId: "",
          amount: 500,
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.creditNotes.create",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", invoiceId: "in_cus_100_1", amount: 500 }),
          },
        ],
      },
      {
        toolName: "stripe.listCreditNotes",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          limit: 10,
        },
        negativeInput: {
          customerId: "cus_100",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "stripe.creditNotes.list",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.getDispute",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          disputeId: "dp_seed_1",
        },
        negativeInput: {
          customerId: "cus_100",
          disputeId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.disputes.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", disputeId: "dp_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.listDisputes",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          limit: 10,
        },
        negativeInput: {
          customerId: "cus_100",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "stripe.disputes.list",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.updateDispute",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          disputeId: "dp_seed_1",
          evidenceSummary: "customer confirmed delivery",
        },
        negativeInput: {
          customerId: "cus_100",
          disputeId: "dp_seed_1",
          evidenceSummary: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.disputes.update",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", disputeId: "dp_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.closeDispute",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          disputeId: "dp_seed_1",
        },
        negativeInput: {
          customerId: "cus_100",
          disputeId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.disputes.close",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", disputeId: "dp_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.createPortalSession",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          returnUrl: "https://example.test/account",
        },
        negativeInput: {
          customerId: "cus_100",
          returnUrl: "not-a-url",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.billingPortal.sessions.create",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", returnUrl: "https://example.test/account" }),
          },
        ],
      },
      {
        toolName: "stripe.listBalanceTransactions",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          limit: 10,
        },
        negativeInput: {
          customerId: "cus_100",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.listBalanceTransactions",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.searchCharges",
        capability: "read",
        positiveInput: {
          query: "cus_100",
          limit: 10,
        },
        negativeInput: {
          query: "",
          limit: 10,
        },
        expectedSdkCalls: [
          {
            method: "stripe.charges.search",
            assertArgs: (args) => hasArgs(args, { query: "cus_100", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.searchSubscriptions",
        capability: "read",
        positiveInput: {
          query: "sub_100",
          limit: 10,
        },
        negativeInput: {
          query: "",
          limit: 10,
        },
        expectedSdkCalls: [
          {
            method: "stripe.subscriptions.search",
            assertArgs: (args) => hasArgs(args, { query: "sub_100", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.searchInvoices",
        capability: "read",
        positiveInput: {
          query: "in_cus_100",
          limit: 10,
        },
        negativeInput: {
          query: "",
          limit: 10,
        },
        expectedSdkCalls: [
          {
            method: "stripe.invoices.search",
            assertArgs: (args) => hasArgs(args, { query: "in_cus_100", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.getPaymentIntent",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          paymentIntentId: "pi_seed_1",
        },
        negativeInput: {
          customerId: "cus_100",
          paymentIntentId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.paymentIntents.retrieve",
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", paymentIntentId: "pi_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.listPaymentIntents",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          limit: 10,
        },
        negativeInput: {
          customerId: "cus_100",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "stripe.paymentIntents.list",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.searchPaymentIntents",
        capability: "read",
        positiveInput: {
          query: "pi_seed_1",
          limit: 10,
        },
        negativeInput: {
          query: "",
          limit: 10,
        },
        expectedSdkCalls: [
          {
            method: "stripe.paymentIntents.search",
            assertArgs: (args) => hasArgs(args, { query: "pi_seed_1", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.detachPaymentMethod",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          paymentMethodId: "pm_card_1",
        },
        negativeInput: {
          customerId: "cus_100",
          paymentMethodId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.paymentMethods.detach",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", paymentMethodId: "pm_card_1" }),
          },
        ],
      },
      {
        toolName: "stripe.cancelRefund",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          refundId: "re_seed_1",
        },
        negativeInput: {
          customerId: "cus_100",
          refundId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.refunds.cancel",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", refundId: "re_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.updateRefund",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          refundId: "re_seed_1",
          metadata: {
            resolution: "manual_review",
          },
        },
        negativeInput: {
          customerId: "cus_100",
          refundId: "",
          metadata: {
            resolution: "manual_review",
          },
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.refunds.update",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                customerId: "cus_100",
                refundId: "re_seed_1",
              }),
          },
        ],
      },
      {
        toolName: "stripe.getCoupon",
        capability: "read",
        positiveInput: {
          couponId: "cpn_seed_1",
        },
        negativeInput: {
          couponId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.coupons.retrieve",
            assertArgs: (args) => hasArgs(args, { couponId: "cpn_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.listCoupons",
        capability: "read",
        positiveInput: {
          limit: 10,
        },
        negativeInput: {
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "stripe.coupons.list",
            assertArgs: (args) => hasArgs(args, { limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.getPromotionCode",
        capability: "read",
        positiveInput: {
          promotionCodeId: "promo_seed_1",
        },
        negativeInput: {
          promotionCodeId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.promotionCodes.retrieve",
            assertArgs: (args) => hasArgs(args, { promotionCodeId: "promo_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.listPromotionCodes",
        capability: "read",
        positiveInput: {
          code: "WELCOME",
          limit: 10,
        },
        negativeInput: {
          code: "WELCOME",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "stripe.promotionCodes.list",
            assertArgs: (args) => hasArgs(args, { code: "WELCOME", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.createInvoiceItem",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          amount: 400,
          currency: "usd",
          description: "manual adjustment",
          invoiceId: "in_cus_100_1",
        },
        negativeInput: {
          customerId: "cus_100",
          amount: 400,
          currency: "us",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.invoiceItems.create",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", amount: 400, currency: "usd" }),
          },
        ],
      },
      {
        toolName: "stripe.deleteInvoiceItem",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          invoiceItemId: "ii_seed_1",
        },
        negativeInput: {
          customerId: "cus_100",
          invoiceItemId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.invoiceItems.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", invoiceItemId: "ii_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.getProduct",
        capability: "read",
        positiveInput: {
          productId: "prod_seed_1",
        },
        negativeInput: {
          productId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.products.retrieve",
            assertArgs: (args) => hasArgs(args, { productId: "prod_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.listProducts",
        capability: "read",
        positiveInput: {
          active: true,
          limit: 10,
        },
        negativeInput: {
          active: true,
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "stripe.products.list",
            assertArgs: (args) => hasArgs(args, { active: true, limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.getPrice",
        capability: "read",
        positiveInput: {
          priceId: "price_seed_1",
        },
        negativeInput: {
          priceId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.prices.retrieve",
            assertArgs: (args) => hasArgs(args, { priceId: "price_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.listPrices",
        capability: "read",
        positiveInput: {
          productId: "prod_seed_1",
          active: true,
          limit: 10,
        },
        negativeInput: {
          productId: "prod_seed_1",
          active: true,
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "stripe.prices.list",
            assertArgs: (args) =>
              hasArgs(args, { productId: "prod_seed_1", active: true, limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.getBalanceTransaction",
        capability: "read",
        positiveInput: {
          balanceTransactionId: "cbtxn_seed_1",
        },
        negativeInput: {
          balanceTransactionId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.balanceTransactions.retrieve",
            assertArgs: (args) => hasArgs(args, { balanceTransactionId: "cbtxn_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.listGlobalBalanceTransactions",
        capability: "read",
        positiveInput: {
          limit: 10,
        },
        negativeInput: {
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "stripe.balanceTransactions.list",
            assertArgs: (args) => hasArgs(args, { limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.getCreditNote",
        capability: "read",
        positiveInput: {
          creditNoteId: "cn_seed_1",
        },
        negativeInput: {
          creditNoteId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.creditNotes.retrieve",
            assertArgs: (args) => hasArgs(args, { creditNoteId: "cn_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.previewCreditNote",
        capability: "read",
        positiveInput: {
          invoiceId: "in_cus_100_1",
          amount: 500,
          reason: "order_change",
        },
        negativeInput: {
          invoiceId: "",
          amount: 500,
        },
        expectedSdkCalls: [
          {
            method: "stripe.creditNotes.preview",
            assertArgs: (args) =>
              hasArgs(args, {
                invoiceId: "in_cus_100_1",
                amount: 500,
                reason: "order_change",
              }),
          },
        ],
      },
      {
        toolName: "stripe.listSubscriptionItems",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          subscriptionId: "sub_100",
          limit: 10,
        },
        negativeInput: {
          customerId: "cus_100",
          subscriptionId: "",
          limit: 10,
        },
        expectedSdkCalls: [
          {
            method: "stripe.subscriptionItems.list",
            assertArgs: (args) =>
              hasArgs(args, {
                customerId: "cus_100",
                subscriptionId: "sub_100",
                limit: 10,
              }),
          },
        ],
      },
      {
        toolName: "stripe.createSubscriptionItem",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          subscriptionId: "sub_100",
          priceId: "price_seed_1",
          quantity: 2,
        },
        negativeInput: {
          customerId: "cus_100",
          subscriptionId: "sub_100",
          priceId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.subscriptionItems.create",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                customerId: "cus_100",
                subscriptionId: "sub_100",
                priceId: "price_seed_1",
                quantity: 2,
              }),
          },
        ],
      },
      {
        toolName: "stripe.updateSubscriptionItem",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          subscriptionItemId: "si_seed_1",
          quantity: 3,
        },
        negativeInput: {
          customerId: "cus_100",
          subscriptionItemId: "",
          quantity: 3,
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.subscriptionItems.update",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                customerId: "cus_100",
                subscriptionItemId: "si_seed_1",
                quantity: 3,
              }),
          },
        ],
      },
      {
        toolName: "stripe.deleteSubscriptionItem",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          subscriptionItemId: "si_seed_1",
        },
        negativeInput: {
          customerId: "cus_100",
          subscriptionItemId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.subscriptionItems.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                customerId: "cus_100",
                subscriptionItemId: "si_seed_1",
              }),
          },
        ],
      },
      {
        toolName: "stripe.getSubscriptionSchedule",
        capability: "read",
        positiveInput: {
          subscriptionScheduleId: "sub_sched_seed_1",
        },
        negativeInput: {
          subscriptionScheduleId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.subscriptionSchedules.retrieve",
            assertArgs: (args) => hasArgs(args, { subscriptionScheduleId: "sub_sched_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.listSubscriptionSchedules",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          limit: 10,
        },
        negativeInput: {
          customerId: "cus_100",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "stripe.subscriptionSchedules.list",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.updateSubscriptionSchedule",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          subscriptionScheduleId: "sub_sched_seed_1",
          endBehavior: "release",
        },
        negativeInput: {
          customerId: "cus_100",
          subscriptionScheduleId: "",
          endBehavior: "release",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.subscriptionSchedules.update",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                customerId: "cus_100",
                subscriptionScheduleId: "sub_sched_seed_1",
                endBehavior: "release",
              }),
          },
        ],
      },
      {
        toolName: "stripe.cancelSubscriptionSchedule",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          subscriptionScheduleId: "sub_sched_seed_1",
        },
        negativeInput: {
          customerId: "cus_100",
          subscriptionScheduleId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.subscriptionSchedules.cancel",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                customerId: "cus_100",
                subscriptionScheduleId: "sub_sched_seed_1",
              }),
          },
        ],
      },
      {
        toolName: "stripe.listCustomerTaxIds",
        capability: "read",
        positiveInput: {
          customerId: "cus_100",
          limit: 10,
        },
        negativeInput: {
          customerId: "",
          limit: 10,
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.listTaxIds",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.createCustomerTaxId",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          type: "eu_vat",
          value: "DE123456789",
        },
        negativeInput: {
          customerId: "cus_100",
          type: "",
          value: "DE123456789",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.customers.createTaxId",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", type: "eu_vat", value: "DE123456789" }),
          },
        ],
      },
      {
        toolName: "stripe.deleteCustomerTaxId",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          taxId: "txi_seed_1",
        },
        negativeInput: {
          customerId: "cus_100",
          taxId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.customers.deleteTaxId",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", taxId: "txi_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.createCoupon",
        capability: "write",
        positiveInput: {
          name: "Loyalty 15",
          percentOff: 15,
          duration: "once",
        },
        negativeInput: {
          name: "bad",
        },
        expectedSdkCalls: [
          {
            method: "stripe.coupons.create",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                name: "Loyalty 15",
                percentOff: 15,
                duration: "once",
              }),
          },
        ],
      },
      {
        toolName: "stripe.createPromotionCode",
        capability: "write",
        positiveInput: {
          couponId: "cpn_seed_1",
          code: "LOYAL15",
        },
        negativeInput: {
          couponId: "",
          code: "LOYAL15",
        },
        expectedSdkCalls: [
          {
            method: "stripe.promotionCodes.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { couponId: "cpn_seed_1", code: "LOYAL15" }),
          },
        ],
      },
      {
        toolName: "stripe.getCheckoutSession",
        capability: "read",
        positiveInput: {
          checkoutSessionId: "cs_seed_1",
        },
        negativeInput: {
          checkoutSessionId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.checkout.sessions.retrieve",
            assertArgs: (args) => hasArgs(args, { checkoutSessionId: "cs_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.createCheckoutSession",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          successUrl: "https://example.test/success",
          cancelUrl: "https://example.test/cancel",
          mode: "payment",
          priceId: "price_seed_1",
          quantity: 1,
        },
        negativeInput: {
          customerId: "cus_100",
          successUrl: "not-a-url",
          cancelUrl: "https://example.test/cancel",
          mode: "payment",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.checkout.sessions.create",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                customerId: "cus_100",
                successUrl: "https://example.test/success",
                cancelUrl: "https://example.test/cancel",
                mode: "payment",
                priceId: "price_seed_1",
                quantity: 1,
              }),
          },
        ],
      },
      {
        toolName: "stripe.createSetupIntent",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          paymentMethodType: "card",
          usage: "off_session",
        },
        negativeInput: {
          customerId: "",
          paymentMethodType: "card",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.setupIntents.create",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                customerId: "cus_100",
                paymentMethodType: "card",
                usage: "off_session",
              }),
          },
        ],
      },
      {
        toolName: "stripe.listEvents",
        capability: "read",
        positiveInput: {
          type: "invoice",
          limit: 10,
        },
        negativeInput: {
          type: "invoice",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "stripe.events.list",
            assertArgs: (args) => hasArgs(args, { type: "invoice", limit: 10 }),
          },
        ],
      },
      {
        toolName: "stripe.getEvent",
        capability: "read",
        positiveInput: {
          eventId: "evt_seed_1",
        },
        negativeInput: {
          eventId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.events.retrieve",
            assertArgs: (args) => hasArgs(args, { eventId: "evt_seed_1" }),
          },
        ],
      },
      {
        toolName: "stripe.updateCharge",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          chargeId: "ch_cus_100",
          description: "Charge reviewed",
        },
        negativeInput: {
          customerId: "cus_100",
          chargeId: "",
          description: "Charge reviewed",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.charges.update",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                customerId: "cus_100",
                chargeId: "ch_cus_100",
                description: "Charge reviewed",
              }),
          },
        ],
      },
      {
        toolName: "stripe.createInvoice",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          autoAdvance: false,
          collectionMethod: "send_invoice",
          daysUntilDue: 7,
          description: "One-off invoice",
        },
        negativeInput: {
          customerId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.invoices.create",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                customerId: "cus_100",
                autoAdvance: false,
                collectionMethod: "send_invoice",
                daysUntilDue: 7,
                description: "One-off invoice",
              }),
          },
        ],
      },
      {
        toolName: "stripe.createSubscription",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          priceId: "price_seed_1",
          quantity: 1,
          trialPeriodDays: 14,
        },
        negativeInput: {
          customerId: "cus_100",
          priceId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.subscriptions.create",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                customerId: "cus_100",
                priceId: "price_seed_1",
                quantity: 1,
                trialPeriodDays: 14,
              }),
          },
        ],
      },
      {
        toolName: "stripe.deleteCustomerDiscount",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
        },
        negativeInput: {
          customerId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.customers.deleteDiscount",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
        ],
      },
      {
        toolName: "stripe.deleteSubscriptionDiscount",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          subscriptionId: "sub_100",
        },
        negativeInput: {
          customerId: "cus_100",
          subscriptionId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.subscriptions.deleteDiscount",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", subscriptionId: "sub_100" }),
          },
        ],
      },
      {
        toolName: "stripe.finalizeInvoice",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          invoiceId: "in_cus_100_1",
        },
        negativeInput: {
          customerId: "cus_100",
          invoiceId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.invoices.finalizeInvoice",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", invoiceId: "in_cus_100_1" }),
          },
        ],
      },
      {
        toolName: "stripe.markUncollectible",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          invoiceId: "in_cus_100_1",
        },
        negativeInput: {
          customerId: "cus_100",
          invoiceId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.invoices.markUncollectible",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", invoiceId: "in_cus_100_1" }),
          },
        ],
      },
      {
        toolName: "stripe.voidCreditNote",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          creditNoteId: "cn_seed_1",
        },
        negativeInput: {
          customerId: "cus_100",
          creditNoteId: "",
        },
        expectedSdkCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.creditNotes.voidCreditNote",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { customerId: "cus_100", creditNoteId: "cn_seed_1" }),
          },
        ],
      },
    ],
  },
  {
    providerId: "github",
    gatewayProviderId: "github",
    scenarios: [
      {
        toolName: "github.listIssues",
        capability: "read",
        positiveInput: { repo: "keppo", state: "open", perPage: 10 },
        negativeInput: { repo: "" },
        expectedSdkCalls: [
          {
            method: "github.issues.listForRepo",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", state: "open", perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.getIssue",
        capability: "read",
        positiveInput: { repo: "keppo", issue: 1 },
        negativeInput: { repo: "keppo", issue: 0 },
        expectedSdkCalls: [
          {
            method: "github.issues.get",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1 }),
          },
        ],
      },
      {
        toolName: "github.listIssueEvents",
        capability: "read",
        positiveInput: { repo: "keppo", issue: 1, perPage: 10 },
        negativeInput: { repo: "keppo", issue: 0, perPage: 10 },
        expectedSdkCalls: [
          {
            method: "github.issues.listEvents",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1, perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.listIssueTimeline",
        capability: "read",
        positiveInput: { repo: "keppo", issue: 1, perPage: 10 },
        negativeInput: { repo: "keppo", issue: 0, perPage: 10 },
        expectedSdkCalls: [
          {
            method: "github.issues.listEventsForTimeline",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1, perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.listPullRequests",
        capability: "read",
        positiveInput: { repo: "keppo", state: "open", perPage: 10 },
        negativeInput: { repo: "" },
        expectedSdkCalls: [
          {
            method: "github.pulls.list",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", state: "open", perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.getPullRequest",
        capability: "read",
        positiveInput: { repo: "keppo", pullNumber: 5 },
        negativeInput: { repo: "keppo", pullNumber: 0 },
        expectedSdkCalls: [
          {
            method: "github.pulls.get",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", pullNumber: 5 }),
          },
        ],
      },
      {
        toolName: "github.listPRFiles",
        capability: "read",
        positiveInput: { repo: "keppo", pullNumber: 5, perPage: 20 },
        negativeInput: { repo: "keppo", pullNumber: 0, perPage: 20 },
        expectedSdkCalls: [
          {
            method: "github.pulls.listFiles",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", pullNumber: 5, perPage: 20 }),
          },
        ],
      },
      {
        toolName: "github.searchIssues",
        capability: "read",
        positiveInput: { repo: "keppo", query: "label:bug", perPage: 5 },
        negativeInput: { repo: "", query: "label:bug", perPage: 5 },
        expectedSdkCalls: [
          {
            method: "github.search.issuesAndPullRequests",
            assertArgs: (args) =>
              hasArgs(args, { perPage: 5 }) &&
              typeof args.query === "string" &&
              String(args.query).includes("repo:keppo"),
          },
        ],
      },
      {
        toolName: "github.searchCode",
        capability: "read",
        positiveInput: { query: "repo:keppo connector", perPage: 5 },
        negativeInput: { query: "", perPage: 5 },
        expectedSdkCalls: [
          {
            method: "github.search.code",
            assertArgs: (args) => hasArgs(args, { query: "repo:keppo connector", perPage: 5 }),
          },
        ],
      },
      {
        toolName: "github.searchRepositories",
        capability: "read",
        positiveInput: { query: "keppo", perPage: 5 },
        negativeInput: { query: "", perPage: 5 },
        expectedSdkCalls: [
          {
            method: "github.search.repos",
            assertArgs: (args) => hasArgs(args, { query: "keppo", perPage: 5 }),
          },
        ],
      },
      {
        toolName: "github.getRepo",
        capability: "read",
        positiveInput: { repo: "keppo" },
        negativeInput: { repo: "" },
        expectedSdkCalls: [
          {
            method: "github.repos.get",
            assertArgs: (args) => hasArgs(args, { repo: "keppo" }),
          },
        ],
      },
      {
        toolName: "github.listOrgRepos",
        capability: "read",
        positiveInput: { org: "org", type: "all", perPage: 10 },
        negativeInput: { org: "", type: "all", perPage: 10 },
        expectedSdkCalls: [
          {
            method: "github.repos.listForOrg",
            assertArgs: (args) => hasArgs(args, { org: "org", type: "all", perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.listBranches",
        capability: "read",
        positiveInput: { repo: "keppo", perPage: 10 },
        negativeInput: { repo: "", perPage: 10 },
        expectedSdkCalls: [
          {
            method: "github.repos.listBranches",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.getFileContents",
        capability: "read",
        positiveInput: { repo: "keppo", path: "README.md", ref: "main" },
        negativeInput: { repo: "keppo", path: "" },
        expectedSdkCalls: [
          {
            method: "github.repos.getContent",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", path: "README.md", ref: "main" }),
          },
        ],
      },
      {
        toolName: "github.listLabels",
        capability: "read",
        positiveInput: { repo: "keppo", perPage: 10 },
        negativeInput: { repo: "", perPage: 10 },
        expectedSdkCalls: [
          {
            method: "github.issues.listLabelsForRepo",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.commentIssue",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          body: "matrix comment",
        },
        negativeInput: {
          repo: "keppo",
          issue: 1,
          body: "",
        },
        expectedSdkCalls: [
          {
            method: "github.issues.get",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1 }),
          },
          {
            method: "github.issues.createComment",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1 }),
          },
        ],
      },
      {
        toolName: "github.lockIssue",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          lockReason: "resolved",
        },
        negativeInput: {
          repo: "keppo",
          issue: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.issues.lock",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { repo: "keppo", issue: 1, lockReason: "resolved" }),
          },
        ],
      },
      {
        toolName: "github.unlockIssue",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
        },
        negativeInput: {
          repo: "keppo",
          issue: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.issues.unlock",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1 }),
          },
        ],
      },
      {
        toolName: "github.createIssue",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          title: "matrix issue",
          body: "matrix body",
          labels: ["bug"],
          assignees: ["octocat"],
        },
        negativeInput: {
          repo: "keppo",
          title: "",
        },
        expectedSdkCalls: [
          {
            method: "github.issues.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", title: "matrix issue" }),
          },
        ],
      },
      {
        toolName: "github.updateIssue",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          state: "closed",
          labels: ["bug", "triaged"],
        },
        negativeInput: {
          repo: "keppo",
          issue: 1,
        },
        expectedSdkCalls: [
          {
            method: "github.issues.update",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1, state: "closed" }),
          },
        ],
      },
      {
        toolName: "github.createPullRequest",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          title: "matrix pr",
          head: "feature/matrix",
          base: "main",
          body: "matrix body",
        },
        negativeInput: {
          repo: "keppo",
          title: "matrix pr",
          head: "",
          base: "main",
        },
        expectedSdkCalls: [
          {
            method: "github.pulls.create",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { repo: "keppo", title: "matrix pr", head: "feature/matrix" }),
          },
        ],
      },
      {
        toolName: "github.mergePullRequest",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          pullNumber: 5,
          mergeMethod: "squash",
        },
        negativeInput: {
          repo: "keppo",
          pullNumber: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.pulls.merge",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { repo: "keppo", pullNumber: 5, mergeMethod: "squash" }),
          },
        ],
      },
      {
        toolName: "github.addLabels",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          labels: ["bug", "triaged"],
        },
        negativeInput: {
          repo: "keppo",
          issue: 1,
          labels: [],
        },
        expectedSdkCalls: [
          {
            method: "github.issues.addLabels",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1 }),
          },
        ],
      },
      {
        toolName: "github.createLabel",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          name: "triaged",
          color: "0e8a16",
          description: "Ready for triage",
        },
        negativeInput: {
          repo: "keppo",
          name: "",
          color: "0e8a16",
        },
        expectedSdkCalls: [
          {
            method: "github.issues.createLabel",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                repo: "keppo",
                name: "triaged",
                color: "0e8a16",
              }),
          },
        ],
      },
      {
        toolName: "github.createOrUpdateFile",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          path: "docs/status.md",
          message: "Update status",
          content: "status: green",
          branch: "main",
        },
        negativeInput: {
          repo: "keppo",
          path: "",
          message: "Update status",
          content: "status: green",
        },
        expectedSdkCalls: [
          {
            method: "github.repos.createOrUpdateFileContents",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                repo: "keppo",
                path: "docs/status.md",
                message: "Update status",
                branch: "main",
              }),
          },
        ],
      },
      {
        toolName: "github.removeLabel",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          label: "bug",
        },
        negativeInput: {
          repo: "keppo",
          issue: 1,
          label: "",
        },
        expectedSdkCalls: [
          {
            method: "github.issues.removeLabel",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1, label: "bug" }),
          },
        ],
      },
      {
        toolName: "github.addAssignees",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          assignees: ["octocat"],
        },
        negativeInput: {
          repo: "keppo",
          issue: 0,
          assignees: ["octocat"],
        },
        expectedSdkCalls: [
          {
            method: "github.issues.addAssignees",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1 }),
          },
        ],
      },
      {
        toolName: "github.removeAssignees",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          assignees: ["octocat"],
        },
        negativeInput: {
          repo: "keppo",
          issue: 0,
          assignees: ["octocat"],
        },
        expectedSdkCalls: [
          {
            method: "github.issues.removeAssignees",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1 }),
          },
        ],
      },
      {
        toolName: "github.createReview",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          pullNumber: 5,
          event: "APPROVE",
          body: "Looks good from matrix",
        },
        negativeInput: {
          repo: "keppo",
          pullNumber: 0,
          event: "APPROVE",
          body: "Looks good from matrix",
        },
        expectedSdkCalls: [
          {
            method: "github.pulls.createReview",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", pullNumber: 5, event: "APPROVE" }),
          },
        ],
      },
      {
        toolName: "github.listReviews",
        capability: "read",
        positiveInput: {
          repo: "keppo",
          pullNumber: 5,
          perPage: 10,
        },
        negativeInput: {
          repo: "keppo",
          pullNumber: 0,
          perPage: 10,
        },
        expectedSdkCalls: [
          {
            method: "github.pulls.listReviews",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", pullNumber: 5, perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.dismissReview",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          pullNumber: 5,
          reviewId: 301,
          message: "Superseded by a newer review",
        },
        negativeInput: {
          repo: "keppo",
          pullNumber: 5,
          reviewId: 0,
          message: "Superseded by a newer review",
        },
        expectedSdkCalls: [
          {
            method: "github.pulls.dismissReview",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", pullNumber: 5, reviewId: 301 }),
          },
        ],
      },
      {
        toolName: "github.requestReviewers",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          pullNumber: 5,
          reviewers: ["octocat"],
        },
        negativeInput: {
          repo: "keppo",
          pullNumber: 5,
          reviewers: [],
        },
        expectedSdkCalls: [
          {
            method: "github.pulls.requestReviewers",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", pullNumber: 5 }),
          },
        ],
      },
      {
        toolName: "github.removeReviewers",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          pullNumber: 5,
          reviewers: ["octocat"],
        },
        negativeInput: {
          repo: "keppo",
          pullNumber: 5,
          reviewers: [],
        },
        expectedSdkCalls: [
          {
            method: "github.pulls.removeRequestedReviewers",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", pullNumber: 5 }),
          },
        ],
      },
      {
        toolName: "github.createReviewComment",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          pullNumber: 5,
          body: "Please adjust this line.",
          path: "README.md",
          line: 1,
        },
        negativeInput: {
          repo: "keppo",
          pullNumber: 5,
          body: "Please adjust this line.",
          path: "",
          line: 1,
        },
        expectedSdkCalls: [
          {
            method: "github.pulls.createReviewComment",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { repo: "keppo", pullNumber: 5, path: "README.md", line: 1 }),
          },
        ],
      },
      {
        toolName: "github.listCommits",
        capability: "read",
        positiveInput: {
          repo: "keppo",
          perPage: 10,
          sha: "abc",
        },
        negativeInput: {
          repo: "keppo",
          perPage: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.repos.listCommits",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", perPage: 10, sha: "abc" }),
          },
        ],
      },
      {
        toolName: "github.compareCommits",
        capability: "read",
        positiveInput: {
          repo: "keppo",
          base: "main",
          head: "feature/matrix",
        },
        negativeInput: {
          repo: "",
          base: "main",
          head: "feature/matrix",
        },
        expectedSdkCalls: [
          {
            method: "github.repos.compareCommits",
            assertArgs: (args) =>
              hasArgs(args, { repo: "keppo", base: "main", head: "feature/matrix" }),
          },
        ],
      },
      {
        toolName: "github.getCommitStatus",
        capability: "read",
        positiveInput: {
          repo: "keppo",
          ref: "abc123",
        },
        negativeInput: {
          repo: "keppo",
          ref: "",
        },
        expectedSdkCalls: [
          {
            method: "github.repos.getCombinedStatusForRef",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", ref: "abc123" }),
          },
        ],
      },
      {
        toolName: "github.listCheckRuns",
        capability: "read",
        positiveInput: {
          repo: "keppo",
          ref: "abc123",
          perPage: 5,
        },
        negativeInput: {
          repo: "keppo",
          ref: "abc123",
          perPage: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.checks.listForRef",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", ref: "abc123", perPage: 5 }),
          },
        ],
      },
      {
        toolName: "github.listWorkflowRuns",
        capability: "read",
        positiveInput: {
          repo: "keppo",
          perPage: 10,
          branch: "main",
          status: "completed",
        },
        negativeInput: {
          repo: "keppo",
          perPage: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.actions.listWorkflowRunsForRepo",
            assertArgs: (args) =>
              hasArgs(args, {
                repo: "keppo",
                perPage: 10,
                branch: "main",
                status: "completed",
              }),
          },
        ],
      },
      {
        toolName: "github.getWorkflowRun",
        capability: "read",
        positiveInput: {
          repo: "keppo",
          runId: 501,
        },
        negativeInput: {
          repo: "keppo",
          runId: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.actions.getWorkflowRun",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", runId: 501 }),
          },
        ],
      },
      {
        toolName: "github.listNotifications",
        capability: "read",
        positiveInput: {
          all: true,
          participating: false,
          perPage: 10,
        },
        negativeInput: {
          all: true,
          participating: false,
          perPage: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.activity.listNotificationsForAuthenticatedUser",
            assertArgs: (args) => hasArgs(args, { all: true, participating: false, perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.getWorkflowJobLogs",
        capability: "read",
        positiveInput: {
          repo: "keppo",
          jobId: 7001,
        },
        negativeInput: {
          repo: "keppo",
          jobId: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.actions.downloadJobLogsForWorkflowRun",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", jobId: 7001 }),
          },
        ],
      },
      {
        toolName: "github.triggerWorkflow",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          workflowId: "ci.yml",
          ref: "main",
          inputs: { env: "staging" },
        },
        negativeInput: {
          repo: "keppo",
          workflowId: "",
          ref: "main",
          inputs: { env: "staging" },
        },
        expectedSdkCalls: [
          {
            method: "github.actions.createWorkflowDispatch",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { repo: "keppo", workflowId: "ci.yml", ref: "main" }),
          },
        ],
      },
      {
        toolName: "github.cancelWorkflowRun",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          runId: 501,
        },
        negativeInput: {
          repo: "keppo",
          runId: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.actions.cancelWorkflowRun",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", runId: 501 }),
          },
        ],
      },
      {
        toolName: "github.rerunWorkflow",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          runId: 501,
          enableDebugLogging: true,
        },
        negativeInput: {
          repo: "keppo",
          runId: 0,
          enableDebugLogging: true,
        },
        expectedSdkCalls: [
          {
            method: "github.actions.reRunWorkflow",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", runId: 501 }),
          },
        ],
      },
      {
        toolName: "github.markNotificationsRead",
        capability: "write",
        positiveInput: {
          lastReadAt: "2026-01-10T00:00:00Z",
        },
        negativeInput: {
          lastReadAt: "not-a-date",
        },
        expectedSdkCalls: [
          {
            method: "github.activity.markNotificationsAsRead",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { lastReadAt: "2026-01-10T00:00:00Z" }),
          },
        ],
      },
      {
        toolName: "github.rerunFailedJobs",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          runId: 501,
          enableDebugLogging: true,
        },
        negativeInput: {
          repo: "keppo",
          runId: 0,
          enableDebugLogging: true,
        },
        expectedSdkCalls: [
          {
            method: "github.actions.reRunWorkflowFailedJobs",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", runId: 501 }),
          },
        ],
      },
      {
        toolName: "github.updatePRBranch",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          pullNumber: 5,
          expectedHeadSha: "abc123",
        },
        negativeInput: {
          repo: "keppo",
          pullNumber: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.pulls.updateBranch",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", pullNumber: 5 }),
          },
        ],
      },
      {
        toolName: "github.createReaction",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          content: "+1",
        },
        negativeInput: {
          repo: "keppo",
          issue: 1,
          content: "smile",
        },
        expectedSdkCalls: [
          {
            method: "github.reactions.createForIssue",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1, content: "+1" }),
          },
        ],
      },
      {
        toolName: "github.deleteReaction",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          reactionId: 1301,
        },
        negativeInput: {
          repo: "keppo",
          issue: 1,
          reactionId: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.reactions.deleteForIssue",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1, reactionId: 1301 }),
          },
        ],
      },
      {
        toolName: "github.createDispatchEvent",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          eventType: "keppo.dispatch",
          clientPayload: {
            environment: "staging",
          },
        },
        negativeInput: {
          repo: "keppo",
          eventType: "",
        },
        expectedSdkCalls: [
          {
            method: "github.repos.createDispatchEvent",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                repo: "keppo",
                eventType: "keppo.dispatch",
              }),
          },
        ],
      },
      {
        toolName: "github.updatePullRequest",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          pullNumber: 5,
          title: "Updated from matrix",
        },
        negativeInput: {
          repo: "keppo",
          pullNumber: 5,
        },
        expectedSdkCalls: [
          {
            method: "github.pulls.update",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", pullNumber: 5 }),
          },
        ],
      },
      {
        toolName: "github.listPRCommits",
        capability: "read",
        positiveInput: {
          repo: "keppo",
          pullNumber: 5,
          perPage: 10,
        },
        negativeInput: {
          repo: "keppo",
          pullNumber: 0,
          perPage: 10,
        },
        expectedSdkCalls: [
          {
            method: "github.pulls.listCommits",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", pullNumber: 5, perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.listIssueComments",
        capability: "read",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          perPage: 10,
        },
        negativeInput: {
          repo: "keppo",
          issue: 0,
          perPage: 10,
        },
        expectedSdkCalls: [
          {
            method: "github.issues.listComments",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1, perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.getLatestRelease",
        capability: "read",
        positiveInput: {
          repo: "keppo",
        },
        negativeInput: {
          repo: "",
        },
        expectedSdkCalls: [
          {
            method: "github.repos.getLatestRelease",
            assertArgs: (args) => hasArgs(args, { repo: "keppo" }),
          },
        ],
      },
      {
        toolName: "github.listReleases",
        capability: "read",
        positiveInput: {
          repo: "keppo",
          perPage: 10,
        },
        negativeInput: {
          repo: "keppo",
          perPage: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.repos.listReleases",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.listMilestones",
        capability: "read",
        positiveInput: {
          repo: "keppo",
          state: "open",
          perPage: 10,
        },
        negativeInput: {
          repo: "keppo",
          state: "open",
          perPage: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.issues.listMilestones",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", state: "open", perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.createRelease",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          tagName: "v1.4.0",
          targetCommitish: "main",
          name: "v1.4.0",
          body: "Release from matrix",
          draft: false,
          prerelease: false,
          generateReleaseNotes: true,
        },
        negativeInput: {
          repo: "keppo",
          tagName: "",
        },
        expectedSdkCalls: [
          {
            method: "github.repos.createRelease",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", tagName: "v1.4.0" }),
          },
        ],
      },
      {
        toolName: "github.updateRelease",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          releaseId: 801,
          name: "v1.2.0 patched",
        },
        negativeInput: {
          repo: "keppo",
          releaseId: 0,
          name: "v1.2.0 patched",
        },
        expectedSdkCalls: [
          {
            method: "github.repos.updateRelease",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", releaseId: 801 }),
          },
        ],
      },
      {
        toolName: "github.generateReleaseNotes",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          tagName: "v1.4.0",
          targetCommitish: "main",
          previousTagName: "v1.3.0",
        },
        negativeInput: {
          repo: "keppo",
          tagName: "",
        },
        expectedSdkCalls: [
          {
            method: "github.repos.generateReleaseNotes",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", tagName: "v1.4.0" }),
          },
        ],
      },
      {
        toolName: "github.createMilestone",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          title: "Q3 rollout",
          state: "open",
          description: "Milestone from matrix",
          dueOn: "2026-09-30T00:00:00Z",
        },
        negativeInput: {
          repo: "keppo",
          title: "",
        },
        expectedSdkCalls: [
          {
            method: "github.issues.createMilestone",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", title: "Q3 rollout" }),
          },
        ],
      },
      {
        toolName: "github.updateMilestone",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          milestone: 1,
          state: "closed",
        },
        negativeInput: {
          repo: "keppo",
          milestone: 0,
          state: "closed",
        },
        expectedSdkCalls: [
          {
            method: "github.issues.updateMilestone",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", milestone: 1 }),
          },
        ],
      },
      {
        toolName: "github.updateComment",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          commentId: 601,
          body: "Updated via matrix",
        },
        negativeInput: {
          repo: "keppo",
          commentId: 601,
          body: "",
        },
        expectedSdkCalls: [
          {
            method: "github.issues.updateComment",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", commentId: 601 }),
          },
        ],
      },
      {
        toolName: "github.deleteComment",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          commentId: 601,
        },
        negativeInput: {
          repo: "keppo",
          commentId: 0,
        },
        expectedSdkCalls: [
          {
            method: "github.issues.deleteComment",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", commentId: 601 }),
          },
        ],
      },
    ],
  },
  {
    providerId: "slack",
    gatewayProviderId: "slack",
    scenarios: [
      {
        toolName: "slack.listChannels",
        capability: "read",
        positiveInput: {},
        negativeInput: {},
        negativeMode: "not_connected",
        expectedSdkCalls: [
          {
            method: "slack.conversations.list",
          },
        ],
      },
      {
        toolName: "slack.getChannelHistory",
        capability: "read",
        positiveInput: {
          channel: "#support",
          limit: 10,
        },
        negativeInput: {
          channel: "",
          limit: 10,
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.history",
            assertArgs: (args) => hasArgs(args, { channel: "#support", limit: 10 }),
          },
        ],
      },
      {
        toolName: "slack.getThreadReplies",
        capability: "read",
        positiveInput: {
          channel: "#support",
          threadTs: "1700000000.000001",
          limit: 10,
        },
        negativeInput: {
          channel: "#support",
          threadTs: "",
          limit: 10,
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.replies",
            assertArgs: (args) =>
              hasArgs(args, {
                channel: "#support",
                threadTs: "1700000000.000001",
                limit: 10,
              }),
          },
        ],
      },
      {
        toolName: "slack.getReactions",
        capability: "read",
        positiveInput: {
          channel: "#support",
          ts: "1700000000.000001",
        },
        negativeInput: {
          channel: "#support",
          ts: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.reactions.get",
            assertArgs: (args) => hasArgs(args, { channel: "#support", ts: "1700000000.000001" }),
          },
        ],
      },
      {
        toolName: "slack.listUsers",
        capability: "read",
        positiveInput: {
          limit: 20,
        },
        negativeInput: {
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "slack.users.list",
            assertArgs: (args) => hasArgs(args, { limit: 20 }),
          },
        ],
      },
      {
        toolName: "slack.getUserInfo",
        capability: "read",
        positiveInput: {
          userId: "U001",
        },
        negativeInput: {
          userId: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.users.info",
            assertArgs: (args) => hasArgs(args, { userId: "U001" }),
          },
        ],
      },
      {
        toolName: "slack.getChannelInfo",
        capability: "read",
        positiveInput: {
          channel: "#support",
        },
        negativeInput: {
          channel: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.info",
            assertArgs: (args) => hasArgs(args, { channel: "#support" }),
          },
        ],
      },
      {
        toolName: "slack.searchMessages",
        capability: "read",
        positiveInput: {
          query: "refund",
          limit: 10,
        },
        negativeInput: {
          query: "",
          limit: 10,
        },
        expectedSdkCalls: [
          {
            method: "slack.search.messages",
            assertArgs: (args) => hasArgs(args, { query: "refund", limit: 10 }),
          },
        ],
      },
      {
        toolName: "slack.postMessage",
        capability: "write",
        positiveInput: {
          channel: "#support",
          text: "matrix slack",
        },
        negativeInput: {
          channel: "",
          text: "matrix slack",
        },
        expectedSdkCalls: [
          {
            method: "slack.chat.postMessage",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#support" }),
          },
        ],
      },
      {
        toolName: "slack.updateMessage",
        capability: "write",
        positiveInput: {
          channel: "#support",
          ts: "1700000000.000001",
          text: "matrix slack update",
        },
        negativeInput: {
          channel: "#support",
          ts: "",
          text: "matrix slack update",
        },
        expectedSdkCalls: [
          {
            method: "slack.chat.update",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#support", ts: "1700000000.000001" }),
          },
        ],
      },
      {
        toolName: "slack.deleteMessage",
        capability: "write",
        positiveInput: {
          channel: "#ops",
          ts: "1700000000.000004",
        },
        negativeInput: {
          channel: "#ops",
          ts: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.chat.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#ops", ts: "1700000000.000004" }),
          },
        ],
      },
      {
        toolName: "slack.addReaction",
        capability: "write",
        positiveInput: {
          channel: "#support",
          ts: "1700000000.000002",
          name: "white_check_mark",
        },
        negativeInput: {
          channel: "#support",
          ts: "1700000000.000002",
          name: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.reactions.add",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                channel: "#support",
                ts: "1700000000.000002",
                name: "white_check_mark",
              }),
          },
        ],
      },
      {
        toolName: "slack.postEphemeral",
        capability: "write",
        positiveInput: {
          channel: "#support",
          userId: "U001",
          text: "matrix slack ephemeral",
        },
        negativeInput: {
          channel: "#support",
          userId: "",
          text: "matrix slack ephemeral",
        },
        expectedSdkCalls: [
          {
            method: "slack.chat.postEphemeral",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#support", userId: "U001" }),
          },
        ],
      },
      {
        toolName: "slack.uploadFile",
        capability: "write",
        positiveInput: {
          channel: "#support",
          filename: "handoff.txt",
          content: "matrix slack upload",
          title: "Matrix Upload",
        },
        negativeInput: {
          channel: "#support",
          filename: "",
          content: "matrix slack upload",
          title: "Matrix Upload",
        },
        expectedSdkCalls: [
          {
            method: "slack.files.uploadV2",
            requireIdempotencyKey: true,
          },
        ],
      },
      {
        toolName: "slack.createChannel",
        capability: "write",
        positiveInput: {
          name: "matrix-channel",
          isPrivate: false,
        },
        negativeInput: {
          name: "",
          isPrivate: false,
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { name: "matrix-channel" }),
          },
        ],
      },
      {
        toolName: "slack.inviteToChannel",
        capability: "write",
        positiveInput: {
          channel: "#support",
          userIds: ["U001", "U002"],
        },
        negativeInput: {
          channel: "#support",
          userIds: [],
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.invite",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { channel: "#support" }) &&
              asStringArray(args.userIds).includes("U001") &&
              asStringArray(args.userIds).includes("U002"),
          },
        ],
      },
      {
        toolName: "slack.joinChannel",
        capability: "write",
        positiveInput: {
          channel: "#support",
        },
        negativeInput: {
          channel: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.join",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#support" }),
          },
        ],
      },
      {
        toolName: "slack.listChannelMembers",
        capability: "read",
        positiveInput: {
          channel: "#support",
          limit: 10,
        },
        negativeInput: {
          channel: "",
          limit: 10,
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.members",
            assertArgs: (args) => hasArgs(args, { channel: "#support", limit: 10 }),
          },
        ],
      },
      {
        toolName: "slack.markChannelRead",
        capability: "write",
        positiveInput: {
          channel: "#support",
          ts: "1700000000.000004",
        },
        negativeInput: {
          channel: "#support",
          ts: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.mark",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#support", ts: "1700000000.000004" }),
          },
        ],
      },
      {
        toolName: "slack.archiveChannel",
        capability: "write",
        positiveInput: {
          channel: "#ops",
        },
        negativeInput: {
          channel: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.archive",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#ops" }),
          },
        ],
      },
      {
        toolName: "slack.unarchiveChannel",
        capability: "write",
        positiveInput: {
          channel: "#ops",
        },
        negativeInput: {
          channel: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.unarchive",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#ops" }),
          },
        ],
      },
      {
        toolName: "slack.setChannelPurpose",
        capability: "write",
        positiveInput: {
          channel: "#support",
          purpose: "Matrix purpose",
        },
        negativeInput: {
          channel: "#support",
          purpose: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.setPurpose",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#support", purpose: "Matrix purpose" }),
          },
        ],
      },
      {
        toolName: "slack.setChannelTopic",
        capability: "write",
        positiveInput: {
          channel: "#support",
          topic: "Matrix topic",
        },
        negativeInput: {
          channel: "#support",
          topic: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.setTopic",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#support", topic: "Matrix topic" }),
          },
        ],
      },
      {
        toolName: "slack.openDM",
        capability: "write",
        positiveInput: {
          userIds: ["U001", "U002"],
        },
        negativeInput: {
          userIds: [],
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.open",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              asStringArray(args.userIds).includes("U001") &&
              asStringArray(args.userIds).includes("U002"),
          },
        ],
      },
      {
        toolName: "slack.renameChannel",
        capability: "write",
        positiveInput: {
          channel: "#ops",
          name: "ops-matrix",
        },
        negativeInput: {
          channel: "#ops",
          name: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.rename",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#ops", name: "ops-matrix" }),
          },
        ],
      },
      {
        toolName: "slack.kickFromChannel",
        capability: "write",
        positiveInput: {
          channel: "#support",
          userId: "U002",
        },
        negativeInput: {
          channel: "#support",
          userId: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.kick",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#support", userId: "U002" }),
          },
        ],
      },
      {
        toolName: "slack.leaveChannel",
        capability: "write",
        positiveInput: {
          channel: "#eng-internal",
        },
        negativeInput: {
          channel: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.leave",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#eng-internal" }),
          },
        ],
      },
      {
        toolName: "slack.closeDM",
        capability: "write",
        positiveInput: {
          channel: "#support",
        },
        negativeInput: {
          channel: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.conversations.close",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#support" }),
          },
        ],
      },
      {
        toolName: "slack.listBookmarks",
        capability: "read",
        positiveInput: {
          channel: "#support",
        },
        negativeInput: {
          channel: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.bookmarks.list",
            assertArgs: (args) => hasArgs(args, { channel: "#support" }),
          },
        ],
      },
      {
        toolName: "slack.addBookmark",
        capability: "write",
        positiveInput: {
          channel: "#support",
          title: "Ops runbook",
          link: "https://docs.example.test/runbooks/ops",
          emoji: ":bookmark_tabs:",
        },
        negativeInput: {
          channel: "#support",
          title: "",
          link: "https://docs.example.test/runbooks/ops",
        },
        expectedSdkCalls: [
          {
            method: "slack.bookmarks.add",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                channel: "#support",
                title: "Ops runbook",
                link: "https://docs.example.test/runbooks/ops",
              }),
          },
        ],
      },
      {
        toolName: "slack.editBookmark",
        capability: "write",
        positiveInput: {
          channel: "#support",
          bookmarkId: "Bk000001",
          title: "Escalation Playbook",
        },
        negativeInput: {
          channel: "#support",
          bookmarkId: "",
          title: "Escalation Playbook",
        },
        expectedSdkCalls: [
          {
            method: "slack.bookmarks.edit",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                channel: "#support",
                bookmarkId: "Bk000001",
                title: "Escalation Playbook",
              }),
          },
        ],
      },
      {
        toolName: "slack.removeBookmark",
        capability: "write",
        positiveInput: {
          channel: "#support",
          bookmarkId: "Bk000001",
        },
        negativeInput: {
          channel: "#support",
          bookmarkId: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.bookmarks.remove",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#support", bookmarkId: "Bk000001" }),
          },
        ],
      },
      {
        toolName: "slack.listReminders",
        capability: "read",
        positiveInput: {},
        negativeInput: {
          userId: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.reminders.list",
          },
        ],
      },
      {
        toolName: "slack.addReminder",
        capability: "write",
        positiveInput: {
          text: "Follow up with premium customers",
          time: 1900000200,
          userId: "U001",
        },
        negativeInput: {
          text: "",
          time: 1900000200,
        },
        expectedSdkCalls: [
          {
            method: "slack.reminders.add",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                text: "Follow up with premium customers",
                time: 1900000200,
                userId: "U001",
              }),
          },
        ],
      },
      {
        toolName: "slack.deleteReminder",
        capability: "write",
        positiveInput: {
          reminderId: "Rm000001",
        },
        negativeInput: {
          reminderId: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.reminders.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { reminderId: "Rm000001" }),
          },
        ],
      },
      {
        toolName: "slack.listUserGroups",
        capability: "read",
        positiveInput: {
          includeDisabled: false,
        },
        negativeInput: {
          _reserved: "invalid",
        },
        expectedSdkCalls: [
          {
            method: "slack.usergroups.list",
            assertArgs: (args) => hasArgs(args, { includeDisabled: false }),
          },
        ],
      },
      {
        toolName: "slack.listUserGroupMembers",
        capability: "read",
        positiveInput: {
          userGroupId: "S001",
          includeDisabled: false,
        },
        negativeInput: {
          userGroupId: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.usergroups.users.list",
            assertArgs: (args) => hasArgs(args, { userGroupId: "S001", includeDisabled: false }),
          },
        ],
      },
      {
        toolName: "slack.getUserPresence",
        capability: "read",
        positiveInput: {
          userId: "U001",
        },
        negativeInput: {
          userId: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.users.getPresence",
            assertArgs: (args) => hasArgs(args, { userId: "U001" }),
          },
        ],
      },
      {
        toolName: "slack.listReactions",
        capability: "read",
        positiveInput: {
          userId: "U001",
          limit: 10,
        },
        negativeInput: {
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "slack.reactions.list",
            assertArgs: (args) => hasArgs(args, { userId: "U001", limit: 10 }),
          },
        ],
      },
      {
        toolName: "slack.meMessage",
        capability: "write",
        positiveInput: {
          channel: "#support",
          text: "working on this issue",
        },
        negativeInput: {
          channel: "#support",
          text: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.chat.meMessage",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { channel: "#support", text: "working on this issue" }),
          },
        ],
      },
      {
        toolName: "slack.scheduleMessage",
        capability: "write",
        positiveInput: {
          channel: "#support",
          text: "scheduled from matrix",
          postAt: 1900000001,
        },
        negativeInput: {
          channel: "#support",
          text: "",
          postAt: 1900000001,
        },
        expectedSdkCalls: [
          {
            method: "slack.chat.scheduleMessage",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                channel: "#support",
                text: "scheduled from matrix",
                postAt: 1900000001,
              }),
          },
        ],
      },
      {
        toolName: "slack.deleteScheduledMessage",
        capability: "write",
        positiveInput: {
          channel: "#support",
          scheduledMessageId: "Q000001",
        },
        negativeInput: {
          channel: "#support",
          scheduledMessageId: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.chat.deleteScheduledMessage",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { channel: "#support", scheduledMessageId: "Q000001" }),
          },
        ],
      },
      {
        toolName: "slack.listScheduledMessages",
        capability: "read",
        positiveInput: {
          channel: "#support",
          limit: 5,
        },
        negativeInput: {
          channel: "#support",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "slack.chat.scheduledMessages.list",
            assertArgs: (args) => hasArgs(args, { channel: "#support", limit: 5 }),
          },
        ],
      },
      {
        toolName: "slack.getPermalink",
        capability: "read",
        positiveInput: {
          channel: "#support",
          ts: "1700000000.000001",
        },
        negativeInput: {
          channel: "#support",
          ts: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.chat.getPermalink",
            assertArgs: (args) => hasArgs(args, { channel: "#support", ts: "1700000000.000001" }),
          },
        ],
      },
      {
        toolName: "slack.removeReaction",
        capability: "write",
        positiveInput: {
          channel: "#support",
          ts: "1700000000.000001",
          name: "eyes",
        },
        negativeInput: {
          channel: "#support",
          ts: "1700000000.000001",
          name: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.reactions.remove",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { channel: "#support", ts: "1700000000.000001", name: "eyes" }),
          },
        ],
      },
      {
        toolName: "slack.pinMessage",
        capability: "write",
        positiveInput: {
          channel: "#support",
          ts: "1700000000.000001",
        },
        negativeInput: {
          channel: "#support",
          ts: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.pins.add",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#support", ts: "1700000000.000001" }),
          },
        ],
      },
      {
        toolName: "slack.unpinMessage",
        capability: "write",
        positiveInput: {
          channel: "#support",
          ts: "1700000000.000001",
        },
        negativeInput: {
          channel: "#support",
          ts: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.pins.remove",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { channel: "#support", ts: "1700000000.000001" }),
          },
        ],
      },
      {
        toolName: "slack.listPins",
        capability: "read",
        positiveInput: {
          channel: "#support",
        },
        negativeInput: {
          channel: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.pins.list",
            assertArgs: (args) => hasArgs(args, { channel: "#support" }),
          },
        ],
      },
      {
        toolName: "slack.listFiles",
        capability: "read",
        positiveInput: {
          limit: 10,
        },
        negativeInput: {
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "slack.files.list",
            assertArgs: (args) => hasArgs(args, { limit: 10 }),
          },
        ],
      },
      {
        toolName: "slack.getFileInfo",
        capability: "read",
        positiveInput: {
          fileId: "F201",
        },
        negativeInput: {
          fileId: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.files.info",
            assertArgs: (args) => hasArgs(args, { fileId: "F201" }),
          },
        ],
      },
      {
        toolName: "slack.deleteFile",
        capability: "write",
        positiveInput: {
          fileId: "F202",
        },
        negativeInput: {
          fileId: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.files.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { fileId: "F202" }),
          },
        ],
      },
      {
        toolName: "slack.getUserProfile",
        capability: "read",
        positiveInput: {
          userId: "U001",
        },
        negativeInput: {
          userId: "",
        },
        expectedSdkCalls: [
          {
            method: "slack.users.profile.get",
            assertArgs: (args) => hasArgs(args, { userId: "U001" }),
          },
        ],
      },
      {
        toolName: "slack.searchFiles",
        capability: "read",
        positiveInput: {
          query: "handoff",
          limit: 10,
        },
        negativeInput: {
          query: "",
          limit: 10,
        },
        expectedSdkCalls: [
          {
            method: "slack.search.files",
            assertArgs: (args) => hasArgs(args, { query: "handoff", limit: 10 }),
          },
        ],
      },
    ],
  },
  {
    providerId: "notion",
    gatewayProviderId: "notion",
    scenarios: [
      {
        toolName: "notion.searchPages",
        capability: "read",
        positiveInput: { query: "Support" },
        negativeInput: { query: 123 as unknown as string },
        expectedSdkCalls: [
          {
            method: "notion.search",
            assertArgs: (args) => hasArgs(args, { query: "Support" }),
          },
        ],
      },
      {
        toolName: "notion.createPage",
        capability: "write",
        positiveInput: {
          title: "Matrix Page",
          content: "matrix notion",
        },
        negativeInput: {
          title: "",
          content: "matrix notion",
        },
        expectedSdkCalls: [
          {
            method: "notion.pages.create",
            requireIdempotencyKey: true,
          },
        ],
      },
      {
        toolName: "notion.getPage",
        capability: "read",
        positiveInput: { pageId: "page_100" },
        negativeInput: { pageId: "" },
        expectedSdkCalls: [
          {
            method: "notion.pages.retrieve",
            assertArgs: (args) => hasArgs(args, { pageId: "page_100" }),
          },
        ],
      },
      {
        toolName: "notion.getPageAsMarkdown",
        capability: "read",
        positiveInput: { pageId: "page_100" },
        negativeInput: { pageId: "" },
        expectedSdkCalls: [
          {
            method: "notion.pages.retrieve",
            assertArgs: (args) => hasArgs(args, { pageId: "page_100" }),
          },
          {
            method: "notion.blocks.children.list",
            assertArgs: (args) => hasArgs(args, { blockId: "page_100" }),
          },
        ],
      },
      {
        toolName: "notion.getPageProperty",
        capability: "read",
        positiveInput: { pageId: "page_100", propertyId: "title" },
        negativeInput: { pageId: "page_100", propertyId: "" },
        expectedSdkCalls: [
          {
            method: "notion.pages.properties.retrieve",
            assertArgs: (args) => hasArgs(args, { pageId: "page_100", propertyId: "title" }),
          },
        ],
      },
      {
        toolName: "notion.updatePage",
        capability: "write",
        positiveInput: {
          pageId: "page_100",
          title: "Matrix Updated Page",
        },
        negativeInput: {
          pageId: "",
          title: "Matrix Updated Page",
        },
        expectedSdkCalls: [
          {
            method: "notion.pages.update",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { pageId: "page_100" }),
          },
        ],
      },
      {
        toolName: "notion.movePage",
        capability: "write",
        positiveInput: {
          pageId: "page_101",
          parentPageId: "page_100",
        },
        negativeInput: {
          pageId: "",
          parentPageId: "page_100",
        },
        expectedSdkCalls: [
          {
            method: "notion.pages.move",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { pageId: "page_101", parentPageId: "page_100" }),
          },
        ],
      },
      {
        toolName: "notion.updatePageMarkdown",
        capability: "write",
        positiveInput: {
          pageId: "page_100",
          markdown: "## Matrix Markdown",
        },
        negativeInput: {
          pageId: "page_100",
          markdown: "",
        },
        expectedSdkCalls: [
          {
            method: "notion.blocks.children.list",
            assertArgs: (args) => hasArgs(args, { blockId: "page_100" }),
          },
          {
            method: "notion.blocks.update",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { blockId: "blk_100_1", content: "## Matrix Markdown" }),
          },
        ],
      },
      {
        toolName: "notion.createDatabase",
        capability: "write",
        positiveInput: {
          title: "Matrix Database",
          propertyNames: ["Name", "Status"],
          parentPageId: "page_100",
        },
        negativeInput: {
          title: "",
          propertyNames: ["Name", "Status"],
        },
        expectedSdkCalls: [
          {
            method: "notion.databases.create",
            requireIdempotencyKey: true,
          },
        ],
      },
      {
        toolName: "notion.queryDatabase",
        capability: "read",
        positiveInput: { databaseId: "db_100", query: "Support", pageSize: 5 },
        negativeInput: { databaseId: "", query: "Support", pageSize: 5 },
        expectedSdkCalls: [
          {
            method: "notion.databases.query",
            assertArgs: (args) =>
              hasArgs(args, { databaseId: "db_100", query: "Support", pageSize: 5 }),
          },
        ],
      },
      {
        toolName: "notion.getDatabase",
        capability: "read",
        positiveInput: { databaseId: "db_100" },
        negativeInput: { databaseId: "" },
        expectedSdkCalls: [
          {
            method: "notion.databases.retrieve",
            assertArgs: (args) => hasArgs(args, { databaseId: "db_100" }),
          },
        ],
      },
      {
        toolName: "notion.updateDatabase",
        capability: "write",
        positiveInput: {
          databaseId: "db_100",
          title: "Matrix Updated Database",
          propertyNames: ["Name", "Status", "Priority"],
        },
        negativeInput: {
          databaseId: "",
          title: "Matrix Updated Database",
        },
        expectedSdkCalls: [
          {
            method: "notion.databases.update",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { databaseId: "db_100" }),
          },
        ],
      },
      {
        toolName: "notion.getBlockChildren",
        capability: "read",
        positiveInput: { blockId: "page_100", pageSize: 5 },
        negativeInput: { blockId: "", pageSize: 5 },
        expectedSdkCalls: [
          {
            method: "notion.blocks.children.list",
            assertArgs: (args) => hasArgs(args, { blockId: "page_100", pageSize: 5 }),
          },
        ],
      },
      {
        toolName: "notion.getBlock",
        capability: "read",
        positiveInput: { blockId: "blk_100_1" },
        negativeInput: { blockId: "" },
        expectedSdkCalls: [
          {
            method: "notion.blocks.retrieve",
            assertArgs: (args) => hasArgs(args, { blockId: "blk_100_1" }),
          },
        ],
      },
      {
        toolName: "notion.appendBlockChildren",
        capability: "write",
        positiveInput: { blockId: "page_100", content: "Matrix appended block content" },
        negativeInput: { blockId: "", content: "Matrix appended block content" },
        expectedSdkCalls: [
          {
            method: "notion.blocks.children.append",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { blockId: "page_100" }),
          },
        ],
      },
      {
        toolName: "notion.updateBlock",
        capability: "write",
        positiveInput: { blockId: "blk_100_1", content: "Matrix updated block content" },
        negativeInput: { blockId: "", content: "Matrix updated block content" },
        expectedSdkCalls: [
          {
            method: "notion.blocks.update",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { blockId: "blk_100_1" }),
          },
        ],
      },
      {
        toolName: "notion.deleteBlock",
        capability: "write",
        positiveInput: { blockId: "blk_101_1" },
        negativeInput: { blockId: "" },
        expectedSdkCalls: [
          {
            method: "notion.blocks.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { blockId: "blk_101_1" }),
          },
        ],
      },
      {
        toolName: "notion.createComment",
        capability: "write",
        positiveInput: { pageId: "page_100", content: "Matrix comment content" },
        negativeInput: { pageId: "", content: "Matrix comment content" },
        expectedSdkCalls: [
          {
            method: "notion.comments.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { pageId: "page_100" }),
          },
        ],
      },
      {
        toolName: "notion.listComments",
        capability: "read",
        positiveInput: { pageId: "page_100", pageSize: 5 },
        negativeInput: { pageId: "", pageSize: 5 },
        expectedSdkCalls: [
          {
            method: "notion.comments.list",
            assertArgs: (args) => hasArgs(args, { pageId: "page_100", pageSize: 5 }),
          },
        ],
      },
      {
        toolName: "notion.getComment",
        capability: "read",
        positiveInput: { commentId: "cmt_100" },
        negativeInput: { commentId: "" },
        expectedSdkCalls: [
          {
            method: "notion.comments.retrieve",
            assertArgs: (args) => hasArgs(args, { commentId: "cmt_100" }),
          },
        ],
      },
      {
        toolName: "notion.listUsers",
        capability: "read",
        positiveInput: { pageSize: 5 },
        negativeInput: { pageSize: 0 },
        expectedSdkCalls: [
          {
            method: "notion.users.list",
            assertArgs: (args) => hasArgs(args, { pageSize: 5 }),
          },
        ],
      },
      {
        toolName: "notion.getUser",
        capability: "read",
        positiveInput: { userId: "usr_100" },
        negativeInput: { userId: "" },
        expectedSdkCalls: [
          {
            method: "notion.users.retrieve",
            assertArgs: (args) => hasArgs(args, { userId: "usr_100" }),
          },
        ],
      },
      {
        toolName: "notion.getBotUser",
        capability: "read",
        positiveInput: {},
        negativeInput: {},
        negativeMode: "not_connected",
        expectedSdkCalls: [
          {
            method: "notion.users.me",
          },
        ],
      },
    ],
  },
  {
    providerId: "reddit",
    gatewayProviderId: "reddit",
    scenarios: [
      {
        toolName: "reddit.searchPosts",
        capability: "read",
        positiveInput: { subreddit: "support", query: "keppo" },
        negativeInput: { subreddit: 123 as unknown as string, query: "keppo" },
        expectedSdkCalls: [
          {
            method: "reddit.search.posts",
            assertArgs: (args) => hasArgs(args, { subreddit: "support", query: "keppo" }),
          },
        ],
      },
      {
        toolName: "reddit.createPost",
        capability: "write",
        positiveInput: {
          subreddit: "support",
          title: "Matrix Reddit",
          body: "matrix reddit",
        },
        negativeInput: {
          subreddit: "support",
          title: "",
          body: "matrix reddit",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.submit",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { subreddit: "support", title: "Matrix Reddit" }),
          },
        ],
      },
      {
        toolName: "reddit.createComment",
        capability: "write",
        positiveInput: {
          parentId: "t3_100",
          body: "Matrix reddit comment",
        },
        negativeInput: {
          parentId: "",
          body: "Matrix reddit comment",
        },
        expectedSdkCalls: [
          {
            method: "reddit.comments.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { parentId: "t3_100" }),
          },
        ],
      },
      {
        toolName: "reddit.getPostComments",
        capability: "read",
        positiveInput: {
          subreddit: "support",
          postId: "t3_100",
          limit: 5,
        },
        negativeInput: {
          subreddit: "support",
          postId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.getComments",
            assertArgs: (args) =>
              hasArgs(args, { subreddit: "support", postId: "t3_100", limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.getInfo",
        capability: "read",
        positiveInput: {
          thingIds: ["t3_100", "t1_500"],
        },
        negativeInput: {
          thingIds: [],
        },
        expectedSdkCalls: [
          {
            method: "reddit.info.get",
            assertArgs: (args) => asStringArray(args.thingIds).length === 2,
          },
        ],
      },
      {
        toolName: "reddit.listHot",
        capability: "read",
        positiveInput: {
          subreddit: "support",
          limit: 5,
        },
        negativeInput: {
          subreddit: "support",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.listHot",
            assertArgs: (args) => hasArgs(args, { subreddit: "support", limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.listNew",
        capability: "read",
        positiveInput: {
          subreddit: "support",
          limit: 5,
        },
        negativeInput: {
          subreddit: "support",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.listNew",
            assertArgs: (args) => hasArgs(args, { subreddit: "support", limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.listTop",
        capability: "read",
        positiveInput: {
          subreddit: "support",
          limit: 5,
        },
        negativeInput: {
          subreddit: "support",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.listTop",
            assertArgs: (args) => hasArgs(args, { subreddit: "support", limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.listRising",
        capability: "read",
        positiveInput: {
          subreddit: "support",
          limit: 5,
        },
        negativeInput: {
          subreddit: "support",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.listRising",
            assertArgs: (args) => hasArgs(args, { subreddit: "support", limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.listControversial",
        capability: "read",
        positiveInput: {
          subreddit: "support",
          limit: 5,
        },
        negativeInput: {
          subreddit: "support",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.listControversial",
            assertArgs: (args) => hasArgs(args, { subreddit: "support", limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.searchSubreddits",
        capability: "read",
        positiveInput: {
          query: "support",
          limit: 5,
        },
        negativeInput: {
          query: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "reddit.subreddits.search",
            assertArgs: (args) => hasArgs(args, { query: "support", limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.getUserOverview",
        capability: "read",
        positiveInput: {
          username: "support_mod",
          limit: 5,
        },
        negativeInput: {
          username: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "reddit.users.getOverview",
            assertArgs: (args) => hasArgs(args, { username: "support_mod", limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.getUserAbout",
        capability: "read",
        positiveInput: {
          username: "support_mod",
        },
        negativeInput: {
          username: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.users.getAbout",
            assertArgs: (args) => hasArgs(args, { username: "support_mod" }),
          },
        ],
      },
      {
        toolName: "reddit.vote",
        capability: "write",
        positiveInput: {
          thingId: "t3_100",
          direction: 1,
        },
        negativeInput: {
          thingId: "",
          direction: 1,
        },
        expectedSdkCalls: [
          {
            method: "reddit.vote",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_100", direction: 1 }),
          },
        ],
      },
      {
        toolName: "reddit.composeMessage",
        capability: "write",
        positiveInput: {
          to: "support_mod",
          subject: "Matrix message",
          body: "Conformance body",
        },
        negativeInput: {
          to: "",
          subject: "Matrix message",
          body: "Conformance body",
        },
        expectedSdkCalls: [
          {
            method: "reddit.messages.compose",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { to: "support_mod", subject: "Matrix message" }),
          },
        ],
      },
      {
        toolName: "reddit.editPost",
        capability: "write",
        positiveInput: {
          thingId: "t3_101",
          body: "Updated body from action matrix",
        },
        negativeInput: {
          thingId: "",
          body: "Updated body from action matrix",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.edit",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { thingId: "t3_101", body: "Updated body from action matrix" }),
          },
        ],
      },
      {
        toolName: "reddit.approve",
        capability: "write",
        positiveInput: {
          thingId: "t3_100",
        },
        negativeInput: {
          thingId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.moderation.approve",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_100" }),
          },
        ],
      },
      {
        toolName: "reddit.removeContent",
        capability: "write",
        positiveInput: {
          thingId: "t3_100",
        },
        negativeInput: {
          thingId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.moderation.remove",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_100" }),
          },
        ],
      },
      {
        toolName: "reddit.distinguish",
        capability: "write",
        positiveInput: {
          thingId: "t3_100",
          sticky: true,
        },
        negativeInput: {
          thingId: "",
          sticky: true,
        },
        expectedSdkCalls: [
          {
            method: "reddit.moderation.distinguish",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_100", sticky: true }),
          },
        ],
      },
      {
        toolName: "reddit.lockPost",
        capability: "write",
        positiveInput: {
          thingId: "t3_100",
        },
        negativeInput: {
          thingId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.lock",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_100" }),
          },
        ],
      },
      {
        toolName: "reddit.unlockPost",
        capability: "write",
        positiveInput: {
          thingId: "t3_100",
        },
        negativeInput: {
          thingId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.unlock",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_100" }),
          },
        ],
      },
      {
        toolName: "reddit.stickyPost",
        capability: "write",
        positiveInput: {
          thingId: "t3_100",
          state: true,
          slot: 1,
        },
        negativeInput: {
          thingId: "",
          state: true,
          slot: 1,
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.sticky",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_100", state: true, slot: 1 }),
          },
        ],
      },
      {
        toolName: "reddit.getModQueue",
        capability: "read",
        positiveInput: {
          subreddit: "support",
          limit: 5,
        },
        negativeInput: {
          subreddit: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "reddit.moderation.getQueue",
            assertArgs: (args) => hasArgs(args, { subreddit: "support", limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.getReports",
        capability: "read",
        positiveInput: {
          subreddit: "support",
          limit: 5,
        },
        negativeInput: {
          subreddit: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "reddit.moderation.getReports",
            assertArgs: (args) => hasArgs(args, { subreddit: "support", limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.getModLog",
        capability: "read",
        positiveInput: {
          subreddit: "support",
          limit: 5,
        },
        negativeInput: {
          subreddit: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "reddit.moderation.getLog",
            assertArgs: (args) => hasArgs(args, { subreddit: "support", limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.getSubredditRules",
        capability: "read",
        positiveInput: {
          subreddit: "support",
        },
        negativeInput: {
          subreddit: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.subreddits.getRules",
            assertArgs: (args) => hasArgs(args, { subreddit: "support" }),
          },
        ],
      },
      {
        toolName: "reddit.markNsfw",
        capability: "write",
        positiveInput: {
          thingId: "t3_101",
        },
        negativeInput: {
          thingId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.markNsfw",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_101" }),
          },
        ],
      },
      {
        toolName: "reddit.unmarkNsfw",
        capability: "write",
        positiveInput: {
          thingId: "t3_101",
        },
        negativeInput: {
          thingId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.unmarkNsfw",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_101" }),
          },
        ],
      },
      {
        toolName: "reddit.spoiler",
        capability: "write",
        positiveInput: {
          thingId: "t3_101",
        },
        negativeInput: {
          thingId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.spoiler",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_101" }),
          },
        ],
      },
      {
        toolName: "reddit.unspoiler",
        capability: "write",
        positiveInput: {
          thingId: "t3_101",
        },
        negativeInput: {
          thingId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.unspoiler",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_101" }),
          },
        ],
      },
      {
        toolName: "reddit.selectFlair",
        capability: "write",
        positiveInput: {
          subreddit: "support",
          thingId: "t3_101",
          text: "Announcement",
          cssClass: "announcement",
        },
        negativeInput: {
          subreddit: "support",
          thingId: "",
          text: "Announcement",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.selectFlair",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                subreddit: "support",
                thingId: "t3_101",
                text: "Announcement",
              }),
          },
        ],
      },
      {
        toolName: "reddit.subscribe",
        capability: "write",
        positiveInput: {
          subreddit: "support",
          action: "sub",
        },
        negativeInput: {
          subreddit: "",
          action: "sub",
        },
        expectedSdkCalls: [
          {
            method: "reddit.subreddits.subscribe",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { subreddit: "support", action: "sub" }),
          },
        ],
      },
      {
        toolName: "reddit.savePost",
        capability: "write",
        positiveInput: {
          thingId: "t3_101",
        },
        negativeInput: {
          thingId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.save",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_101" }),
          },
        ],
      },
      {
        toolName: "reddit.unsavePost",
        capability: "write",
        positiveInput: {
          thingId: "t3_101",
        },
        negativeInput: {
          thingId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.unsave",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_101" }),
          },
        ],
      },
      {
        toolName: "reddit.hidePost",
        capability: "write",
        positiveInput: {
          thingId: "t3_101",
        },
        negativeInput: {
          thingId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.hide",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_101" }),
          },
        ],
      },
      {
        toolName: "reddit.unhidePost",
        capability: "write",
        positiveInput: {
          thingId: "t3_101",
        },
        negativeInput: {
          thingId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.unhide",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_101" }),
          },
        ],
      },
      {
        toolName: "reddit.reportContent",
        capability: "write",
        positiveInput: {
          thingId: "t3_101",
          reason: "spam",
        },
        negativeInput: {
          thingId: "",
          reason: "spam",
        },
        expectedSdkCalls: [
          {
            method: "reddit.content.report",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_101", reason: "spam" }),
          },
        ],
      },
      {
        toolName: "reddit.listInbox",
        capability: "read",
        positiveInput: {
          limit: 5,
        },
        negativeInput: {
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "reddit.messages.listInbox",
            assertArgs: (args) => hasArgs(args, { limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.listUnreadMessages",
        capability: "read",
        positiveInput: {
          limit: 5,
        },
        negativeInput: {
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "reddit.messages.listUnread",
            assertArgs: (args) => hasArgs(args, { limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.listSentMessages",
        capability: "read",
        positiveInput: {
          limit: 5,
        },
        negativeInput: {
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "reddit.messages.listSent",
            assertArgs: (args) => hasArgs(args, { limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.listMentions",
        capability: "read",
        positiveInput: {
          limit: 5,
        },
        negativeInput: {
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "reddit.messages.listMentions",
            assertArgs: (args) => hasArgs(args, { limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.readMessage",
        capability: "write",
        positiveInput: {
          messageId: "t4_700",
        },
        negativeInput: {
          messageId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.messages.read",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { messageId: "t4_700" }),
          },
        ],
      },
      {
        toolName: "reddit.readAllMessages",
        capability: "write",
        positiveInput: {},
        negativeInput: {},
        negativeMode: "not_connected",
        expectedSdkCalls: [
          {
            method: "reddit.messages.readAll",
            requireIdempotencyKey: true,
          },
        ],
      },
      {
        toolName: "reddit.getSubredditInfo",
        capability: "read",
        positiveInput: {
          subreddit: "support",
        },
        negativeInput: {
          subreddit: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.subreddits.get",
            assertArgs: (args) => hasArgs(args, { subreddit: "support" }),
          },
        ],
      },
      {
        toolName: "reddit.listModmail",
        capability: "read",
        positiveInput: {
          subreddit: "support",
          limit: 5,
        },
        negativeInput: {
          subreddit: 123 as unknown as string,
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "reddit.modmail.list",
            assertArgs: (args) => hasArgs(args, { subreddit: "support", limit: 5 }),
          },
        ],
      },
      {
        toolName: "reddit.getModmail",
        capability: "read",
        positiveInput: {
          conversationId: "modmail_900",
        },
        negativeInput: {
          conversationId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.modmail.get",
            assertArgs: (args) => hasArgs(args, { conversationId: "modmail_900" }),
          },
        ],
      },
      {
        toolName: "reddit.getMe",
        capability: "read",
        positiveInput: {},
        negativeInput: {},
        negativeMode: "not_connected",
        expectedSdkCalls: [
          {
            method: "reddit.users.getMe",
            assertArgs: (_args) => true,
          },
        ],
      },
      {
        toolName: "reddit.deletePost",
        capability: "write",
        positiveInput: {
          thingId: "t3_101",
        },
        negativeInput: {
          thingId: "",
        },
        expectedSdkCalls: [
          {
            method: "reddit.posts.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { thingId: "t3_101" }),
          },
        ],
      },
      {
        toolName: "reddit.replyModmail",
        capability: "write",
        positiveInput: {
          conversationId: "modmail_900",
          body: "Thanks for the report. We are following up.",
          isInternal: false,
        },
        negativeInput: {
          conversationId: "",
          body: "missing conversation id",
          isInternal: false,
        },
        expectedSdkCalls: [
          {
            method: "reddit.modmail.reply",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                conversationId: "modmail_900",
                isInternal: false,
              }),
          },
        ],
      },
    ],
  },
  {
    providerId: "x",
    gatewayProviderId: "x",
    scenarios: [
      {
        toolName: "x.searchPosts",
        capability: "read",
        positiveInput: { query: "keppo" },
        negativeInput: { query: 123 as unknown as string },
        expectedSdkCalls: [
          {
            method: "x.tweets.searchRecent",
            assertArgs: (args) => hasArgs(args, { query: "keppo" }),
          },
        ],
      },
      {
        toolName: "x.createPost",
        capability: "write",
        positiveInput: {
          body: "matrix x",
        },
        negativeInput: {
          body: "",
        },
        expectedSdkCalls: [
          {
            method: "x.tweets.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { text: "matrix x" }),
          },
        ],
      },
      {
        toolName: "x.deletePost",
        capability: "write",
        positiveInput: {
          postId: "x_201",
        },
        negativeInput: {
          postId: "",
        },
        expectedSdkCalls: [
          {
            method: "x.tweets.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { postId: "x_201" }),
          },
        ],
      },
      {
        toolName: "x.getPost",
        capability: "read",
        positiveInput: {
          postId: "x_100",
        },
        negativeInput: {
          postId: "",
        },
        expectedSdkCalls: [
          {
            method: "x.tweets.get",
            assertArgs: (args) => hasArgs(args, { postId: "x_100" }),
          },
        ],
      },
      {
        toolName: "x.getPosts",
        capability: "read",
        positiveInput: {
          postIds: ["x_100", "x_101"],
        },
        negativeInput: {
          postIds: [],
        },
        expectedSdkCalls: [
          {
            method: "x.tweets.lookup",
            assertArgs: (args) => asStringArray(args.postIds).length === 2,
          },
        ],
      },
      {
        toolName: "x.getUserTimeline",
        capability: "read",
        positiveInput: {
          userId: "u_100",
          limit: 5,
        },
        negativeInput: {
          userId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.users.tweets",
            assertArgs: (args) => hasArgs(args, { userId: "u_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.getUserMentions",
        capability: "read",
        positiveInput: {
          userId: "u_100",
          limit: 5,
        },
        negativeInput: {
          userId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.users.mentions",
            assertArgs: (args) => hasArgs(args, { userId: "u_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.getUserByUsername",
        capability: "read",
        positiveInput: {
          username: "keppo",
        },
        negativeInput: {
          username: "",
        },
        expectedSdkCalls: [
          {
            method: "x.users.byUsername",
            assertArgs: (args) => hasArgs(args, { username: "keppo" }),
          },
        ],
      },
      {
        toolName: "x.getUserById",
        capability: "read",
        positiveInput: {
          userId: "u_100",
        },
        negativeInput: {
          userId: "",
        },
        expectedSdkCalls: [
          {
            method: "x.users.get",
            assertArgs: (args) => hasArgs(args, { userId: "u_100" }),
          },
        ],
      },
      {
        toolName: "x.getMe",
        capability: "read",
        positiveInput: {},
        negativeInput: {},
        negativeMode: "not_connected",
        expectedSdkCalls: [
          {
            method: "x.users.me",
            assertArgs: (_args) => true,
          },
        ],
      },
      {
        toolName: "x.likePost",
        capability: "write",
        positiveInput: {
          userId: "u_100",
          postId: "x_100",
        },
        negativeInput: {
          userId: "",
          postId: "x_100",
        },
        expectedSdkCalls: [
          {
            method: "x.likes.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { userId: "u_100", postId: "x_100" }),
          },
        ],
      },
      {
        toolName: "x.unlikePost",
        capability: "write",
        positiveInput: {
          userId: "u_100",
          postId: "x_100",
        },
        negativeInput: {
          userId: "",
          postId: "x_100",
        },
        expectedSdkCalls: [
          {
            method: "x.likes.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { userId: "u_100", postId: "x_100" }),
          },
        ],
      },
      {
        toolName: "x.repost",
        capability: "write",
        positiveInput: {
          userId: "u_100",
          postId: "x_100",
        },
        negativeInput: {
          userId: "",
          postId: "x_100",
        },
        expectedSdkCalls: [
          {
            method: "x.reposts.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { userId: "u_100", postId: "x_100" }),
          },
        ],
      },
      {
        toolName: "x.undoRepost",
        capability: "write",
        positiveInput: {
          userId: "u_100",
          postId: "x_100",
        },
        negativeInput: {
          userId: "",
          postId: "x_100",
        },
        expectedSdkCalls: [
          {
            method: "x.reposts.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { userId: "u_100", postId: "x_100" }),
          },
        ],
      },
      {
        toolName: "x.sendDM",
        capability: "write",
        positiveInput: {
          conversationId: "dmconv_100",
          text: "matrix dm",
        },
        negativeInput: {
          conversationId: "",
          text: "matrix dm",
        },
        expectedSdkCalls: [
          {
            method: "x.dm.send",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { conversationId: "dmconv_100", text: "matrix dm" }),
          },
        ],
      },
      {
        toolName: "x.getDMEvents",
        capability: "read",
        positiveInput: {
          conversationId: "dmconv_100",
          limit: 5,
        },
        negativeInput: {
          conversationId: "dmconv_100",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "x.dm.listEvents",
            assertArgs: (args) => hasArgs(args, { conversationId: "dmconv_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.getQuoteTweets",
        capability: "read",
        positiveInput: {
          postId: "x_100",
          limit: 5,
        },
        negativeInput: {
          postId: "x_100",
          limit: 0,
        },
        expectedSdkCalls: [
          {
            method: "x.tweets.quoteTweets",
            assertArgs: (args) => hasArgs(args, { postId: "x_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.getFollowers",
        capability: "read",
        positiveInput: {
          userId: "u_100",
          limit: 5,
        },
        negativeInput: {
          userId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.users.followers",
            assertArgs: (args) => hasArgs(args, { userId: "u_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.getFollowing",
        capability: "read",
        positiveInput: {
          userId: "u_100",
          limit: 5,
        },
        negativeInput: {
          userId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.users.following",
            assertArgs: (args) => hasArgs(args, { userId: "u_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.followUser",
        capability: "write",
        positiveInput: {
          userId: "u_100",
          targetUserId: "u_101",
        },
        negativeInput: {
          userId: "",
          targetUserId: "u_101",
        },
        expectedSdkCalls: [
          {
            method: "x.follows.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { userId: "u_100", targetUserId: "u_101" }),
          },
        ],
      },
      {
        toolName: "x.unfollowUser",
        capability: "write",
        positiveInput: {
          userId: "u_100",
          targetUserId: "u_101",
        },
        negativeInput: {
          userId: "",
          targetUserId: "u_101",
        },
        expectedSdkCalls: [
          {
            method: "x.follows.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { userId: "u_100", targetUserId: "u_101" }),
          },
        ],
      },
      {
        toolName: "x.getLikingUsers",
        capability: "read",
        positiveInput: {
          postId: "x_100",
          limit: 5,
        },
        negativeInput: {
          postId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.likes.listUsers",
            assertArgs: (args) => hasArgs(args, { postId: "x_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.getLikedPosts",
        capability: "read",
        positiveInput: {
          userId: "u_100",
          limit: 5,
        },
        negativeInput: {
          userId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.likes.listPosts",
            assertArgs: (args) => hasArgs(args, { userId: "u_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.getRepostedBy",
        capability: "read",
        positiveInput: {
          postId: "x_100",
          limit: 5,
        },
        negativeInput: {
          postId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.reposts.listUsers",
            assertArgs: (args) => hasArgs(args, { postId: "x_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.blockUser",
        capability: "write",
        positiveInput: {
          userId: "u_100",
          targetUserId: "u_101",
        },
        negativeInput: {
          userId: "",
          targetUserId: "u_101",
        },
        expectedSdkCalls: [
          {
            method: "x.blocks.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { userId: "u_100", targetUserId: "u_101" }),
          },
        ],
      },
      {
        toolName: "x.unblockUser",
        capability: "write",
        positiveInput: {
          userId: "u_100",
          targetUserId: "u_101",
        },
        negativeInput: {
          userId: "",
          targetUserId: "u_101",
        },
        expectedSdkCalls: [
          {
            method: "x.blocks.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { userId: "u_100", targetUserId: "u_101" }),
          },
        ],
      },
      {
        toolName: "x.getBlockedUsers",
        capability: "read",
        positiveInput: {
          userId: "u_100",
          limit: 5,
        },
        negativeInput: {
          userId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.blocks.list",
            assertArgs: (args) => hasArgs(args, { userId: "u_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.muteUser",
        capability: "write",
        positiveInput: {
          userId: "u_100",
          targetUserId: "u_101",
        },
        negativeInput: {
          userId: "",
          targetUserId: "u_101",
        },
        expectedSdkCalls: [
          {
            method: "x.mutes.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { userId: "u_100", targetUserId: "u_101" }),
          },
        ],
      },
      {
        toolName: "x.unmuteUser",
        capability: "write",
        positiveInput: {
          userId: "u_100",
          targetUserId: "u_101",
        },
        negativeInput: {
          userId: "",
          targetUserId: "u_101",
        },
        expectedSdkCalls: [
          {
            method: "x.mutes.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { userId: "u_100", targetUserId: "u_101" }),
          },
        ],
      },
      {
        toolName: "x.getMutedUsers",
        capability: "read",
        positiveInput: {
          userId: "u_100",
          limit: 5,
        },
        negativeInput: {
          userId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.mutes.list",
            assertArgs: (args) => hasArgs(args, { userId: "u_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.createBookmark",
        capability: "write",
        positiveInput: {
          userId: "u_100",
          postId: "x_100",
        },
        negativeInput: {
          userId: "",
          postId: "x_100",
        },
        expectedSdkCalls: [
          {
            method: "x.bookmarks.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { userId: "u_100", postId: "x_100" }),
          },
        ],
      },
      {
        toolName: "x.deleteBookmark",
        capability: "write",
        positiveInput: {
          userId: "u_100",
          postId: "x_100",
        },
        negativeInput: {
          userId: "",
          postId: "x_100",
        },
        expectedSdkCalls: [
          {
            method: "x.bookmarks.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { userId: "u_100", postId: "x_100" }),
          },
        ],
      },
      {
        toolName: "x.getBookmarks",
        capability: "read",
        positiveInput: {
          userId: "u_100",
          limit: 5,
        },
        negativeInput: {
          userId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.bookmarks.list",
            assertArgs: (args) => hasArgs(args, { userId: "u_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.createDMConversation",
        capability: "write",
        positiveInput: {
          participantIds: ["u_100", "u_101"],
          text: "matrix conversation",
        },
        negativeInput: {
          participantIds: [],
          text: "matrix conversation",
        },
        expectedSdkCalls: [
          {
            method: "x.dm.createConversation",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              asStringArray(args.participantIds).includes("u_100") &&
              asStringArray(args.participantIds).includes("u_101") &&
              args.text === "matrix conversation",
          },
        ],
      },
      {
        toolName: "x.searchUsers",
        capability: "read",
        positiveInput: {
          query: "keppo",
          limit: 5,
        },
        negativeInput: {
          query: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.users.search",
            assertArgs: (args) => hasArgs(args, { query: "keppo", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.getUsersByUsernames",
        capability: "read",
        positiveInput: {
          usernames: ["keppo", "alice"],
        },
        negativeInput: {
          usernames: [],
        },
        expectedSdkCalls: [
          {
            method: "x.users.byUsernames",
            assertArgs: (args) =>
              asStringArray(args.usernames).includes("keppo") &&
              asStringArray(args.usernames).includes("alice"),
          },
        ],
      },
      {
        toolName: "x.createList",
        capability: "write",
        positiveInput: {
          name: "Matrix List",
          description: "x list scenario",
          isPrivate: false,
        },
        negativeInput: {
          name: "",
        },
        expectedSdkCalls: [
          {
            method: "x.lists.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { name: "Matrix List" }),
          },
        ],
      },
      {
        toolName: "x.getList",
        capability: "read",
        positiveInput: {
          listId: "list_100",
        },
        negativeInput: {
          listId: "",
        },
        expectedSdkCalls: [
          {
            method: "x.lists.get",
            assertArgs: (args) => hasArgs(args, { listId: "list_100" }),
          },
        ],
      },
      {
        toolName: "x.updateList",
        capability: "write",
        positiveInput: {
          listId: "list_100",
          name: "Keppo Updated List",
        },
        negativeInput: {
          listId: "list_100",
        },
        expectedSdkCalls: [
          {
            method: "x.lists.update",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { listId: "list_100", name: "Keppo Updated List" }),
          },
        ],
      },
      {
        toolName: "x.getOwnedLists",
        capability: "read",
        positiveInput: {
          userId: "u_100",
          limit: 5,
        },
        negativeInput: {
          userId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.lists.owned",
            assertArgs: (args) => hasArgs(args, { userId: "u_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.addListMember",
        capability: "write",
        positiveInput: {
          listId: "list_100",
          userId: "u_101",
        },
        negativeInput: {
          listId: "",
          userId: "u_101",
        },
        expectedSdkCalls: [
          {
            method: "x.lists.members.add",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { listId: "list_100", userId: "u_101" }),
          },
        ],
      },
      {
        toolName: "x.getListMembers",
        capability: "read",
        positiveInput: {
          listId: "list_100",
          limit: 5,
        },
        negativeInput: {
          listId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.lists.members.list",
            assertArgs: (args) => hasArgs(args, { listId: "list_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.getListTweets",
        capability: "read",
        positiveInput: {
          listId: "list_100",
          limit: 5,
        },
        negativeInput: {
          listId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.lists.tweets",
            assertArgs: (args) => hasArgs(args, { listId: "list_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.getHomeTimeline",
        capability: "read",
        positiveInput: {
          userId: "u_100",
          limit: 5,
        },
        negativeInput: {
          userId: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.timelines.home",
            assertArgs: (args) => hasArgs(args, { userId: "u_100", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.searchAllPosts",
        capability: "read",
        positiveInput: {
          query: "keppo",
          limit: 5,
        },
        negativeInput: {
          query: "",
          limit: 5,
        },
        expectedSdkCalls: [
          {
            method: "x.tweets.searchAll",
            assertArgs: (args) => hasArgs(args, { query: "keppo", maxResults: 5 }),
          },
        ],
      },
      {
        toolName: "x.getPostCounts",
        capability: "read",
        positiveInput: {
          query: "keppo",
        },
        negativeInput: {
          query: "",
        },
        expectedSdkCalls: [
          {
            method: "x.tweets.counts",
            assertArgs: (args) => hasArgs(args, { query: "keppo" }),
          },
        ],
      },
      {
        toolName: "x.removeListMember",
        capability: "write",
        positiveInput: {
          listId: "list_100",
          userId: "u_101",
        },
        negativeInput: {
          listId: "",
          userId: "u_101",
        },
        expectedSdkCalls: [
          {
            method: "x.lists.members.remove",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { listId: "list_100", userId: "u_101" }),
          },
        ],
      },
      {
        toolName: "x.deleteList",
        capability: "write",
        positiveInput: {
          listId: "list_201",
        },
        negativeInput: {
          listId: "",
        },
        expectedSdkCalls: [
          {
            method: "x.lists.delete",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { listId: "list_201" }),
          },
        ],
      },
    ],
  },
  {
    providerId: "custom",
    scenarios: [
      {
        toolName: "custom.callRead",
        capability: "read",
        positiveInput: {
          tool: "account.lookup",
          input: { customer_id: "cus_100" },
        },
        negativeInput: {
          tool: "",
          input: { customer_id: "cus_100" },
        },
      },
      {
        toolName: "custom.callWrite",
        capability: "write",
        positiveInput: {
          tool: "credits.adjust",
          payload: { customer_id: "cus_100", amount: 1 },
        },
        negativeInput: {
          tool: "",
          payload: { customer_id: "cus_100", amount: 1 },
        },
      },
    ],
  },
];

export const providerActionPacks: ProviderActionPack[] = providerActionPackDefinitions.map(
  (pack) => {
    return {
      ...pack,
      scenarios: pack.scenarios.map((scenario) => withGoldenExpectations(scenario)),
    };
  },
);

export const providerActionScenarioCount = providerActionPacks.reduce((total, pack) => {
  return total + pack.scenarios.length;
}, 0);
