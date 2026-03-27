import type { ProviderSdkPort } from "../port.js";

// Source: https://www.reddit.com/dev/api/#GET_search
// Source: https://www.reddit.com/dev/api/#POST_api_submit
// Source: https://www.reddit.com/dev/api/#POST_api_comment
// Source: https://www.reddit.com/dev/api/#POST_api_vote
// Source: https://www.reddit.com/dev/api/#POST_api_compose
// Source: https://www.reddit.com/dev/api/#GET_api_v1_me
export type RedditSdkContext = {
  accessToken: string;
  namespace?: string | undefined;
};

export type RedditPost = {
  id: string;
  subreddit: string;
  title: string;
  body?: string;
  score?: number;
  author?: string;
  createdUtc?: number;
};

export type RedditComment = {
  id: string;
  parentId: string;
  postId: string;
  body: string;
  author?: string;
  score?: number;
};

export type RedditMessage = {
  id: string;
  to: string;
  from: string;
  subject: string;
  body: string;
  unread: boolean;
};

export type RedditSubredditInfo = {
  id: string;
  name: string;
  title: string;
  description?: string;
  subscribers?: number;
};

export type RedditUser = {
  id: string;
  name: string;
  commentKarma?: number;
  linkKarma?: number;
};

export type RedditInfoItem =
  | { kind: "post"; post: RedditPost }
  | { kind: "comment"; comment: RedditComment }
  | { kind: "subreddit"; subreddit: RedditSubredditInfo };

export type RedditUserOverview = {
  username: string;
  posts: RedditPost[];
  comments: RedditComment[];
};

export type RedditSearchPostsArgs = RedditSdkContext & {
  subreddit: string;
  query: string;
  limit: number;
  cursor?: string | undefined;
};

export type RedditListPostsArgs = RedditSdkContext & {
  subreddit: string;
  limit: number;
  cursor?: string | undefined;
};

export type RedditSearchSubredditsArgs = RedditSdkContext & {
  query: string;
  limit: number;
  cursor?: string | undefined;
};

export type RedditGetUserArgs = RedditSdkContext & {
  username: string;
  limit?: number | undefined;
};

export type RedditCreatePostArgs = RedditSdkContext & {
  subreddit: string;
  title: string;
  body: string;
  idempotencyKey?: string | undefined;
};

export type RedditCreatePostResponse = {
  id: string;
  name: string;
  subreddit: string;
  title: string;
  url?: string;
};

export type RedditCreateCommentArgs = RedditSdkContext & {
  parentId: string;
  body: string;
  idempotencyKey?: string | undefined;
};

export type RedditCreateCommentResponse = {
  id: string;
  parentId: string;
  postId: string;
  body: string;
};

export type RedditGetPostCommentsArgs = RedditSdkContext & {
  subreddit: string;
  postId: string;
  limit: number;
};

export type RedditGetPostCommentsResponse = {
  post: RedditPost;
  comments: RedditComment[];
};

export type RedditGetInfoArgs = RedditSdkContext & {
  thingIds: string[];
};

export type RedditEditPostArgs = RedditSdkContext & {
  thingId: string;
  body: string;
  idempotencyKey?: string | undefined;
};

export type RedditEditPostResponse = {
  thingId: string;
  body: string;
  edited: boolean;
};

export type RedditThingActionArgs = RedditSdkContext & {
  thingId: string;
  idempotencyKey?: string | undefined;
};

export type RedditThingActionResponse = {
  thingId: string;
  success: boolean;
};

export type RedditReportContentArgs = RedditSdkContext & {
  thingId: string;
  reason: string;
  idempotencyKey?: string | undefined;
};

export type RedditReportContentResponse = {
  thingId: string;
  reason: string;
  reported: boolean;
};

export type RedditReadMessageArgs = RedditSdkContext & {
  messageId: string;
  idempotencyKey?: string | undefined;
};

export type RedditReadMessageResponse = {
  messageId: string;
  unread: boolean;
};

export type RedditReadAllMessagesArgs = RedditSdkContext & {
  idempotencyKey?: string | undefined;
};

export type RedditReadAllMessagesResponse = {
  readCount: number;
};

export type RedditVoteArgs = RedditSdkContext & {
  thingId: string;
  direction: number;
  idempotencyKey?: string | undefined;
};

export type RedditVoteResponse = {
  thingId: string;
  direction: number;
  score: number;
};

export type RedditComposeMessageArgs = RedditSdkContext & {
  to: string;
  subject: string;
  body: string;
  idempotencyKey?: string | undefined;
};

export type RedditListMessagesArgs = RedditSdkContext & {
  limit: number;
};

export type RedditGetSubredditInfoArgs = RedditSdkContext & {
  subreddit: string;
};

export type RedditModerationItem = {
  thingId: string;
  subreddit: string;
  kind: "post" | "comment";
  title?: string;
  body?: string;
  author?: string;
  reports: number;
  removed?: boolean;
};

export type RedditModerationListArgs = RedditSdkContext & {
  subreddit: string;
  limit: number;
  cursor?: string | undefined;
};

export type RedditModLogEntry = {
  id: string;
  action: string;
  moderator: string;
  targetThingId?: string;
  details?: string;
  createdUtc: number;
};

export type RedditGetSubredditRulesArgs = RedditSdkContext & {
  subreddit: string;
};

export type RedditSubredditRule = {
  shortName: string;
  description: string;
  kind?: string;
  priority?: number;
  violationReason?: string;
};

export type RedditDistinguishArgs = RedditThingActionArgs & {
  sticky?: boolean | undefined;
};

export type RedditDistinguishResponse = RedditThingActionResponse & {
  distinguished: boolean;
  sticky: boolean;
};

export type RedditStickyPostArgs = RedditThingActionArgs & {
  state: boolean;
  slot?: number | undefined;
};

export type RedditStickyPostResponse = RedditThingActionResponse & {
  state: boolean;
  slot: number;
};

export type RedditSelectFlairArgs = RedditSdkContext & {
  subreddit: string;
  thingId: string;
  text: string;
  cssClass?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type RedditSelectFlairResponse = RedditThingActionResponse & {
  subreddit: string;
  text: string;
  cssClass?: string | undefined;
};

export type RedditSubscribeArgs = RedditSdkContext & {
  subreddit: string;
  action: "sub" | "unsub";
  idempotencyKey?: string | undefined;
};

export type RedditSubscribeResponse = {
  subreddit: string;
  subscribed: boolean;
};

export type RedditModmailMessage = {
  id: string;
  author: string;
  body: string;
  isInternal: boolean;
  createdUtc: number;
};

export type RedditModmailConversation = {
  id: string;
  subreddit: string;
  subject: string;
  participant: string;
  state: string;
  lastUpdatedUtc: number;
  messages: RedditModmailMessage[];
};

export type RedditModmailConversationSummary = {
  id: string;
  subreddit: string;
  subject: string;
  participant: string;
  state: string;
  lastUpdatedUtc: number;
};

export type RedditListModmailArgs = RedditSdkContext & {
  subreddit: string;
  limit: number;
  cursor?: string | undefined;
};

export type RedditGetModmailArgs = RedditSdkContext & {
  conversationId: string;
};

export type RedditReplyModmailArgs = RedditSdkContext & {
  conversationId: string;
  body: string;
  isInternal?: boolean | undefined;
  idempotencyKey?: string | undefined;
};

export type RedditReplyModmailResponse = {
  conversationId: string;
  messageId: string;
  author: string;
  body: string;
  isInternal: boolean;
};

export type RedditApiSearchListingResponse = {
  data: {
    children: Array<{
      kind?: string;
      data: {
        id?: string;
        name?: string;
        subreddit?: string;
        title?: string;
        selftext?: string;
        score?: number;
        author?: string;
        created_utc?: number;
      };
    }>;
    after?: string | null;
    before?: string | null;
    dist?: number;
  };
};

export type RedditGatewaySearchResponse = {
  posts: RedditPost[];
  next_cursor?: string | null | undefined;
};

export type RedditApiCreatePostResponse = {
  json?: {
    errors?: unknown[];
    data?: {
      id?: string;
      name?: string;
      url?: string;
      subreddit?: string;
      title?: string;
    };
  };
  id?: string;
  name?: string;
  subreddit?: string;
  title?: string;
  url?: string;
};

export type RedditTypedHttpErrorCode =
  | "invalid_token"
  | "missing_access_token"
  | "subreddit_not_found"
  | "message_not_found"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "invalid_request"
  | "invalid_provider_response"
  | "provider_error";

export interface RedditSdkPort extends ProviderSdkPort {
  searchPosts(args: RedditSearchPostsArgs): Promise<RedditPost[]>;
  listRising(args: RedditListPostsArgs): Promise<RedditPost[]>;
  listControversial(args: RedditListPostsArgs): Promise<RedditPost[]>;
  searchSubreddits(args: RedditSearchSubredditsArgs): Promise<RedditSubredditInfo[]>;
  getUserOverview(args: RedditGetUserArgs): Promise<RedditUserOverview>;
  getUserAbout(args: RedditGetUserArgs): Promise<RedditUser>;
  createPost(args: RedditCreatePostArgs): Promise<RedditCreatePostResponse>;
  createComment(args: RedditCreateCommentArgs): Promise<RedditCreateCommentResponse>;
  getPostComments(args: RedditGetPostCommentsArgs): Promise<RedditGetPostCommentsResponse>;
  getInfo(args: RedditGetInfoArgs): Promise<RedditInfoItem[]>;
  listHot(args: RedditListPostsArgs): Promise<RedditPost[]>;
  listNew(args: RedditListPostsArgs): Promise<RedditPost[]>;
  listTop(args: RedditListPostsArgs): Promise<RedditPost[]>;
  editPost(args: RedditEditPostArgs): Promise<RedditEditPostResponse>;
  deletePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse>;
  approve(args: RedditThingActionArgs): Promise<RedditThingActionResponse>;
  removeContent(args: RedditThingActionArgs): Promise<RedditThingActionResponse>;
  lockPost(args: RedditThingActionArgs): Promise<RedditThingActionResponse>;
  unlockPost(args: RedditThingActionArgs): Promise<RedditThingActionResponse>;
  savePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse>;
  unsavePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse>;
  hidePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse>;
  unhidePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse>;
  reportContent(args: RedditReportContentArgs): Promise<RedditReportContentResponse>;
  readMessage(args: RedditReadMessageArgs): Promise<RedditReadMessageResponse>;
  readAllMessages(args: RedditReadAllMessagesArgs): Promise<RedditReadAllMessagesResponse>;
  vote(args: RedditVoteArgs): Promise<RedditVoteResponse>;
  composeMessage(args: RedditComposeMessageArgs): Promise<RedditMessage>;
  listInbox(args: RedditListMessagesArgs): Promise<RedditMessage[]>;
  listUnreadMessages(args: RedditListMessagesArgs): Promise<RedditMessage[]>;
  listSentMessages(args: RedditListMessagesArgs): Promise<RedditMessage[]>;
  listMentions(args: RedditListMessagesArgs): Promise<RedditMessage[]>;
  getSubredditInfo(args: RedditGetSubredditInfoArgs): Promise<RedditSubredditInfo>;
  getModQueue(args: RedditModerationListArgs): Promise<RedditModerationItem[]>;
  getReports(args: RedditModerationListArgs): Promise<RedditModerationItem[]>;
  getModLog(args: RedditModerationListArgs): Promise<RedditModLogEntry[]>;
  getSubredditRules(args: RedditGetSubredditRulesArgs): Promise<RedditSubredditRule[]>;
  listModmail(args: RedditListModmailArgs): Promise<RedditModmailConversationSummary[]>;
  getModmail(args: RedditGetModmailArgs): Promise<RedditModmailConversation>;
  distinguish(args: RedditDistinguishArgs): Promise<RedditDistinguishResponse>;
  stickyPost(args: RedditStickyPostArgs): Promise<RedditStickyPostResponse>;
  markNsfw(args: RedditThingActionArgs): Promise<RedditThingActionResponse>;
  unmarkNsfw(args: RedditThingActionArgs): Promise<RedditThingActionResponse>;
  spoiler(args: RedditThingActionArgs): Promise<RedditThingActionResponse>;
  unspoiler(args: RedditThingActionArgs): Promise<RedditThingActionResponse>;
  selectFlair(args: RedditSelectFlairArgs): Promise<RedditSelectFlairResponse>;
  subscribe(args: RedditSubscribeArgs): Promise<RedditSubscribeResponse>;
  replyModmail(args: RedditReplyModmailArgs): Promise<RedditReplyModmailResponse>;
  getMe(args: RedditSdkContext): Promise<RedditUser>;
}
