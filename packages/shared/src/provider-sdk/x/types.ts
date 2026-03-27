import type { ProviderSdkPort } from "../port.js";

// Source: https://developer.x.com/en/docs/x-api/tweets/search/api-reference/get-tweets-search-recent
// Source: https://developer.x.com/en/docs/x-api/tweets/manage-tweets/api-reference/post-tweets
export type XSdkContext = {
  accessToken: string;
  namespace?: string | undefined;
};

export type XPost = {
  id: string;
  text: string;
  authorId?: string;
  createdAt?: string;
};

export type XUser = {
  id: string;
  username: string;
  name: string;
};

export type XList = {
  id: string;
  name: string;
  ownerId: string;
  description?: string;
  isPrivate?: boolean;
};

export type XDmEvent = {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
};

export type XSearchPostsArgs = XSdkContext & {
  query: string;
  maxResults: number;
  cursor?: string | undefined;
};

export type XListPostsArgs = XSdkContext & {
  userId: string;
  maxResults: number;
  cursor?: string | undefined;
};

export type XGetPostArgs = XSdkContext & {
  postId: string;
};

export type XGetPostsArgs = XSdkContext & {
  postIds: string[];
};

export type XGetUserByUsernameArgs = XSdkContext & {
  username: string;
};

export type XGetUserByIdArgs = XSdkContext & {
  userId: string;
};

export type XCreatePostArgs = XSdkContext & {
  text: string;
  idempotencyKey?: string | undefined;
};

export type XCreatePostResponse = {
  id: string;
  text: string;
};

export type XDeletePostArgs = XSdkContext & {
  postId: string;
  idempotencyKey?: string | undefined;
};

export type XDeletePostResponse = {
  id: string;
  deleted: boolean;
};

export type XEngagementArgs = XSdkContext & {
  userId: string;
  postId: string;
  idempotencyKey?: string | undefined;
};

export type XEngagementResponse = {
  userId: string;
  postId: string;
};

export type XSendDmArgs = XSdkContext & {
  conversationId: string;
  text: string;
  idempotencyKey?: string | undefined;
};

export type XGetDmEventsArgs = XSdkContext & {
  conversationId?: string | undefined;
  maxResults: number;
};

export type XGetPostUsersArgs = XSdkContext & {
  postId: string;
  maxResults: number;
  cursor?: string | undefined;
};

export type XListUsersArgs = XSdkContext & {
  userId: string;
  maxResults: number;
  cursor?: string | undefined;
};

export type XRelationshipArgs = XSdkContext & {
  userId: string;
  targetUserId: string;
  idempotencyKey?: string | undefined;
};

export type XBookmarkArgs = XSdkContext & {
  userId: string;
  postId: string;
  idempotencyKey?: string | undefined;
};

export type XSearchUsersArgs = XSdkContext & {
  query: string;
  maxResults: number;
  cursor?: string | undefined;
};

export type XGetUsersByUsernamesArgs = XSdkContext & {
  usernames: string[];
};

export type XCreateListArgs = XSdkContext & {
  name: string;
  description?: string | undefined;
  isPrivate?: boolean | undefined;
  idempotencyKey?: string | undefined;
};

export type XUpdateListArgs = XSdkContext & {
  listId: string;
  name?: string | undefined;
  description?: string | undefined;
  isPrivate?: boolean | undefined;
  idempotencyKey?: string | undefined;
};

export type XDeleteListArgs = XSdkContext & {
  listId: string;
  idempotencyKey?: string | undefined;
};

export type XDeleteListResponse = {
  id: string;
  deleted: boolean;
};

export type XGetListArgs = XSdkContext & {
  listId: string;
};

export type XGetOwnedListsArgs = XSdkContext & {
  userId: string;
  maxResults: number;
  cursor?: string | undefined;
};

export type XListMemberArgs = XSdkContext & {
  listId: string;
  userId: string;
  idempotencyKey?: string | undefined;
};

export type XListMemberResponse = {
  listId: string;
  userId: string;
};

export type XGetListMembersArgs = XSdkContext & {
  listId: string;
  maxResults: number;
  cursor?: string | undefined;
};

export type XGetListTweetsArgs = XSdkContext & {
  listId: string;
  maxResults: number;
  cursor?: string | undefined;
};

export type XGetPostCountsArgs = XSdkContext & {
  query: string;
};

export type XPostCounts = {
  query: string;
  total: number;
};

export type XCreateDmConversationArgs = XSdkContext & {
  participantIds: string[];
  text?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type XApiSearchResponse = {
  data: XPost[];
  meta?: {
    result_count?: number;
    next_token?: string;
  };
};

export type XGatewaySearchResponse = {
  posts?: XPost[];
  data?: XPost[];
  next_cursor?: string | null | undefined;
  meta?: {
    next_token?: string;
  };
};

export type XApiCreatePostResponse = {
  data: {
    id: string;
    text: string;
  };
};

export type XRelationshipResponse = {
  userId: string;
  targetUserId: string;
};

export type XCreateDmConversationResponse = {
  conversationId: string;
  participantIds: string[];
  event?: XDmEvent | undefined;
};

export type XTypedHttpErrorCode =
  | "invalid_token"
  | "missing_access_token"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "invalid_request"
  | "text_too_long"
  | "invalid_provider_response"
  | "provider_error";

export interface XSdkPort extends ProviderSdkPort {
  searchRecentPosts(args: XSearchPostsArgs): Promise<XPost[]>;
  createPost(args: XCreatePostArgs): Promise<XCreatePostResponse>;
  deletePost(args: XDeletePostArgs): Promise<XDeletePostResponse>;
  getPost(args: XGetPostArgs): Promise<XPost>;
  getPosts(args: XGetPostsArgs): Promise<XPost[]>;
  getUserTimeline(args: XListPostsArgs): Promise<XPost[]>;
  getUserMentions(args: XListPostsArgs): Promise<XPost[]>;
  getQuoteTweets(args: XGetPostArgs & { maxResults: number }): Promise<XPost[]>;
  getUserByUsername(args: XGetUserByUsernameArgs): Promise<XUser>;
  getUserById(args: XGetUserByIdArgs): Promise<XUser>;
  getMe(args: XSdkContext): Promise<XUser>;
  getFollowers(args: XListUsersArgs): Promise<XUser[]>;
  getFollowing(args: XListUsersArgs): Promise<XUser[]>;
  followUser(args: XRelationshipArgs): Promise<XRelationshipResponse>;
  unfollowUser(args: XRelationshipArgs): Promise<XRelationshipResponse>;
  likePost(args: XEngagementArgs): Promise<XEngagementResponse>;
  unlikePost(args: XEngagementArgs): Promise<XEngagementResponse>;
  getLikingUsers(args: XGetPostUsersArgs): Promise<XUser[]>;
  getLikedPosts(args: XListPostsArgs): Promise<XPost[]>;
  repost(args: XEngagementArgs): Promise<XEngagementResponse>;
  undoRepost(args: XEngagementArgs): Promise<XEngagementResponse>;
  getRepostedBy(args: XGetPostUsersArgs): Promise<XUser[]>;
  blockUser(args: XRelationshipArgs): Promise<XRelationshipResponse>;
  unblockUser(args: XRelationshipArgs): Promise<XRelationshipResponse>;
  getBlockedUsers(args: XListUsersArgs): Promise<XUser[]>;
  muteUser(args: XRelationshipArgs): Promise<XRelationshipResponse>;
  unmuteUser(args: XRelationshipArgs): Promise<XRelationshipResponse>;
  getMutedUsers(args: XListUsersArgs): Promise<XUser[]>;
  createBookmark(args: XBookmarkArgs): Promise<XEngagementResponse>;
  deleteBookmark(args: XBookmarkArgs): Promise<XEngagementResponse>;
  getBookmarks(args: XListPostsArgs): Promise<XPost[]>;
  sendDm(args: XSendDmArgs): Promise<XDmEvent>;
  createDmConversation(args: XCreateDmConversationArgs): Promise<XCreateDmConversationResponse>;
  getDmEvents(args: XGetDmEventsArgs): Promise<XDmEvent[]>;
  searchUsers(args: XSearchUsersArgs): Promise<XUser[]>;
  getUsersByUsernames(args: XGetUsersByUsernamesArgs): Promise<XUser[]>;
  createList(args: XCreateListArgs): Promise<XList>;
  deleteList(args: XDeleteListArgs): Promise<XDeleteListResponse>;
  updateList(args: XUpdateListArgs): Promise<XList>;
  getList(args: XGetListArgs): Promise<XList>;
  getOwnedLists(args: XGetOwnedListsArgs): Promise<XList[]>;
  addListMember(args: XListMemberArgs): Promise<XListMemberResponse>;
  removeListMember(args: XListMemberArgs): Promise<XListMemberResponse>;
  getListMembers(args: XGetListMembersArgs): Promise<XUser[]>;
  getListTweets(args: XGetListTweetsArgs): Promise<XPost[]>;
  getHomeTimeline(args: XListPostsArgs): Promise<XPost[]>;
  searchAllPosts(args: XSearchPostsArgs): Promise<XPost[]>;
  getPostCounts(args: XGetPostCountsArgs): Promise<XPostCounts>;
}
