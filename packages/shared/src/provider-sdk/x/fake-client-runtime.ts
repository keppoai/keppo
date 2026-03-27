import { BaseFakeClient } from "../base-fake-client.js";
import { createFakeProviderSdkErrorFactory, matchErrorCodes } from "../fake-error.js";
import { ProviderSdkError, type ProviderSdkCallLog } from "../port.js";
import type { CreateXClient, XClient } from "./client-interface.js";
import { createFakeXClient } from "./client-adapter.js";
import { seedXDmEvents, seedXLists, seedXPosts, seedXUsers } from "./fixtures.js";
import type {
  XBookmarkArgs,
  XCreateListArgs,
  XCreateDmConversationArgs,
  XCreateDmConversationResponse,
  XCreatePostArgs,
  XCreatePostResponse,
  XDeleteListArgs,
  XDeleteListResponse,
  XDmEvent,
  XDeletePostArgs,
  XDeletePostResponse,
  XEngagementArgs,
  XEngagementResponse,
  XGetDmEventsArgs,
  XGetListArgs,
  XGetListMembersArgs,
  XGetListTweetsArgs,
  XGetOwnedListsArgs,
  XGetPostCountsArgs,
  XGetPostArgs,
  XGetPostUsersArgs,
  XGetPostsArgs,
  XGetUsersByUsernamesArgs,
  XGetUserByIdArgs,
  XGetUserByUsernameArgs,
  XList,
  XListMemberArgs,
  XListMemberResponse,
  XListPostsArgs,
  XListUsersArgs,
  XPostCounts,
  XPost,
  XRelationshipArgs,
  XRelationshipResponse,
  XSdkPort,
  XSearchPostsArgs,
  XSearchUsersArgs,
  XSendDmArgs,
  XUpdateListArgs,
  XUser,
} from "./types.js";

type XNamespaceState = {
  posts: XPost[];
  users: XUser[];
  lists: XList[];
  listMemberIdsByList: Map<string, Set<string>>;
  dmEvents: XDmEvent[];
  conversationParticipants: Map<string, string[]>;
  followingUserIdsByUser: Map<string, Set<string>>;
  blockedUserIdsByUser: Map<string, Set<string>>;
  mutedUserIdsByUser: Map<string, Set<string>>;
  bookmarkedPostIdsByUser: Map<string, Set<string>>;
  likedPostIdsByUser: Map<string, Set<string>>;
  repostedPostIdsByUser: Map<string, Set<string>>;
  postCount: number;
  listCount: number;
  dmCount: number;
  idempotentResponses: Map<string, unknown>;
  forceRateLimit: boolean;
  forceTimeout: boolean;
  maxRequestsPerMinute: number;
  rateLimitWindowStartedAtMs: number;
  rateLimitCount: number;
};

const MAX_POST_LENGTH = 280;

const toProviderSdkError = createFakeProviderSdkErrorFactory("x", [
  {
    match: matchErrorCodes("missing_access_token", "invalid_access_token"),
    category: "auth",
    code: "invalid_token",
    status: 401,
    retryable: false,
  },
  {
    match: matchErrorCodes("post_not_found", "user_not_found", "not_found"),
    category: "not_found",
    code: "not_found",
    status: 404,
    retryable: false,
  },
  {
    match: matchErrorCodes("text_too_long"),
    category: "validation",
    code: "text_too_long",
    status: 400,
    retryable: false,
  },
  {
    match: matchErrorCodes("rate_limited"),
    category: "rate_limit",
    code: "rate_limited",
    status: 429,
    retryable: true,
  },
  {
    match: matchErrorCodes("timeout", "gateway_timeout"),
    category: "timeout",
    code: "timeout",
    status: 504,
    retryable: true,
  },
]);

const sortedPosts = (posts: XPost[]): XPost[] => {
  return [...posts].sort((left, right) => right.id.localeCompare(left.id));
};

export class InMemoryXEngine extends BaseFakeClient<XNamespaceState> implements XSdkPort {
  constructor(options?: { callLog?: ProviderSdkCallLog }) {
    super({
      providerId: "x",
      ...(options?.callLog ? { callLog: options.callLog } : {}),
    });
  }

  async searchRecentPosts(args: XSearchPostsArgs): Promise<XPost[]> {
    const method = "x.tweets.searchRecent";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      maxResults: args.maxResults,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const query = args.query.trim().toLowerCase();
      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));

      const filtered = sortedPosts(state.posts).filter((post) => {
        if (!query) {
          return true;
        }
        return post.text.toLowerCase().includes(query);
      });

      const response = this.paginatePosts(filtered, maxResults, args.cursor);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createPost(args: XCreatePostArgs): Promise<XCreatePostResponse> {
    const method = "x.tweets.create";
    const normalizedArgs = {
      namespace: args.namespace,
      text: args.text,
    };

    return this.runIdempotentOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      mapError: toProviderSdkError,
      getResponses: (state) => state.idempotentResponses,
      before: (state) => {
        this.applyFailureFlags(state);
        this.enforceRateLimit(state);
      },
      execute: (state) => {
        const normalizedText = args.text.trim();
        if (!normalizedText) {
          throw new Error("missing_text");
        }
        if (normalizedText.length > MAX_POST_LENGTH) {
          throw new Error("text_too_long");
        }

        state.postCount += 1;
        const response: XCreatePostResponse = {
          id: `x_${200 + state.postCount}`,
          text: normalizedText,
        };
        state.posts.unshift(response);
        return response;
      },
    });
  }

  async deletePost(args: XDeletePostArgs): Promise<XDeletePostResponse> {
    const method = "x.tweets.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      postId: args.postId,
    };

    return this.runIdempotentOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      mapError: toProviderSdkError,
      getResponses: (state) => state.idempotentResponses,
      before: (state) => {
        this.applyFailureFlags(state);
        this.enforceRateLimit(state);
      },
      execute: (state) => {
        const index = state.posts.findIndex((entry) => entry.id === args.postId.trim());
        if (index < 0) {
          throw new Error("post_not_found");
        }
        const removed = state.posts[index];
        if (!removed) {
          throw new Error("post_not_found");
        }
        state.posts.splice(index, 1);
        return {
          id: removed.id,
          deleted: true,
        };
      },
    });
  }

  async getPost(args: XGetPostArgs): Promise<XPost> {
    const method = "x.tweets.get";
    const normalizedArgs = {
      namespace: args.namespace,
      postId: args.postId,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const post = state.posts.find((entry) => entry.id === args.postId.trim());
      if (!post) {
        throw new Error("post_not_found");
      }

      this.captureOk(args.namespace, method, normalizedArgs, post);
      return post;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getPosts(args: XGetPostsArgs): Promise<XPost[]> {
    const method = "x.tweets.lookup";
    const normalizedArgs = {
      namespace: args.namespace,
      postIds: [...args.postIds],
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const postIds = new Set(args.postIds.map((entry) => entry.trim()).filter((entry) => entry));
      const posts = state.posts.filter((entry) => postIds.has(entry.id));
      this.captureOk(args.namespace, method, normalizedArgs, posts);
      return posts;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getUserTimeline(args: XListPostsArgs): Promise<XPost[]> {
    return this.listUserPosts("x.users.tweets", args, "timeline");
  }

  async getUserMentions(args: XListPostsArgs): Promise<XPost[]> {
    return this.listUserPosts("x.users.mentions", args, "mentions");
  }

  async getQuoteTweets(args: XGetPostArgs & { maxResults: number }): Promise<XPost[]> {
    const method = "x.tweets.quoteTweets";
    const normalizedArgs = {
      namespace: args.namespace,
      postId: args.postId,
      maxResults: args.maxResults,
      cursor: undefined,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const postId = args.postId.trim();
      this.assertPostExists(state, postId);
      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));
      const filtered = sortedPosts(state.posts).filter((post) =>
        post.text.includes(`QT:${postId}`),
      );
      const response = this.paginatePosts(filtered, maxResults);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getUserByUsername(args: XGetUserByUsernameArgs): Promise<XUser> {
    const method = "x.users.byUsername";
    const normalizedArgs = {
      namespace: args.namespace,
      username: args.username,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const username = args.username.trim().replace(/^@+/, "").toLowerCase();
      const user = state.users.find((entry) => entry.username.toLowerCase() === username);
      if (!user) {
        throw new Error("user_not_found");
      }

      this.captureOk(args.namespace, method, normalizedArgs, user);
      return user;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getUserById(args: XGetUserByIdArgs): Promise<XUser> {
    const method = "x.users.get";
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const user = state.users.find((entry) => entry.id === args.userId.trim());
      if (!user) {
        throw new Error("user_not_found");
      }

      this.captureOk(args.namespace, method, normalizedArgs, user);
      return user;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getMe(args: { accessToken: string; namespace?: string | undefined }): Promise<XUser> {
    const method = "x.users.me";
    const normalizedArgs = {
      namespace: args.namespace,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const me = state.users[0];
      if (!me) {
        throw new Error("user_not_found");
      }

      this.captureOk(args.namespace, method, normalizedArgs, me);
      return me;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getFollowers(args: XListUsersArgs): Promise<XUser[]> {
    return this.listUsersByRelation("x.users.followers", args, "followers");
  }

  async getFollowing(args: XListUsersArgs): Promise<XUser[]> {
    return this.listUsersByRelation("x.users.following", args, "following");
  }

  async followUser(args: XRelationshipArgs): Promise<XRelationshipResponse> {
    return this.mutateRelationship("x.follows.create", args, "follow");
  }

  async unfollowUser(args: XRelationshipArgs): Promise<XRelationshipResponse> {
    return this.mutateRelationship("x.follows.delete", args, "unfollow");
  }

  async likePost(args: XEngagementArgs): Promise<XEngagementResponse> {
    return this.mutateEngagement("x.likes.create", args, "like");
  }

  async unlikePost(args: XEngagementArgs): Promise<XEngagementResponse> {
    return this.mutateEngagement("x.likes.delete", args, "unlike");
  }

  async getLikingUsers(args: XGetPostUsersArgs): Promise<XUser[]> {
    return this.listUsersByPost("x.likes.listUsers", args, "liked");
  }

  async getLikedPosts(args: XListPostsArgs): Promise<XPost[]> {
    return this.listUserPosts("x.likes.listPosts", args, "liked");
  }

  async repost(args: XEngagementArgs): Promise<XEngagementResponse> {
    return this.mutateEngagement("x.reposts.create", args, "repost");
  }

  async undoRepost(args: XEngagementArgs): Promise<XEngagementResponse> {
    return this.mutateEngagement("x.reposts.delete", args, "undo_repost");
  }

  async getRepostedBy(args: XGetPostUsersArgs): Promise<XUser[]> {
    return this.listUsersByPost("x.reposts.listUsers", args, "reposted");
  }

  async blockUser(args: XRelationshipArgs): Promise<XRelationshipResponse> {
    return this.mutateRelationship("x.blocks.create", args, "block");
  }

  async unblockUser(args: XRelationshipArgs): Promise<XRelationshipResponse> {
    return this.mutateRelationship("x.blocks.delete", args, "unblock");
  }

  async getBlockedUsers(args: XListUsersArgs): Promise<XUser[]> {
    return this.listUsersByRelation("x.blocks.list", args, "blocked");
  }

  async muteUser(args: XRelationshipArgs): Promise<XRelationshipResponse> {
    return this.mutateRelationship("x.mutes.create", args, "mute");
  }

  async unmuteUser(args: XRelationshipArgs): Promise<XRelationshipResponse> {
    return this.mutateRelationship("x.mutes.delete", args, "unmute");
  }

  async getMutedUsers(args: XListUsersArgs): Promise<XUser[]> {
    return this.listUsersByRelation("x.mutes.list", args, "muted");
  }

  async createBookmark(args: XBookmarkArgs): Promise<XEngagementResponse> {
    const engagementArgs: XEngagementArgs = {
      accessToken: args.accessToken,
      namespace: args.namespace,
      userId: args.userId,
      postId: args.postId,
      idempotencyKey: args.idempotencyKey,
    };
    return this.mutateEngagement("x.bookmarks.create", engagementArgs, "bookmark_create");
  }

  async deleteBookmark(args: XBookmarkArgs): Promise<XEngagementResponse> {
    const engagementArgs: XEngagementArgs = {
      accessToken: args.accessToken,
      namespace: args.namespace,
      userId: args.userId,
      postId: args.postId,
      idempotencyKey: args.idempotencyKey,
    };
    return this.mutateEngagement("x.bookmarks.delete", engagementArgs, "bookmark_delete");
  }

  async getBookmarks(args: XListPostsArgs): Promise<XPost[]> {
    return this.listUserPosts("x.bookmarks.list", args, "bookmarks");
  }

  async sendDm(args: XSendDmArgs): Promise<XDmEvent> {
    const method = "x.dm.send";
    const normalizedArgs = {
      namespace: args.namespace,
      conversationId: args.conversationId,
      text: args.text,
    };

    return this.runIdempotentOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      mapError: toProviderSdkError,
      getResponses: (state) => state.idempotentResponses,
      before: (state) => {
        this.applyFailureFlags(state);
        this.enforceRateLimit(state);
      },
      execute: (state) => {
        const conversationId = args.conversationId.trim();
        const text = args.text.trim();
        if (!conversationId) {
          throw new Error("missing_conversation_id");
        }
        if (!text) {
          throw new Error("missing_text");
        }

        state.dmCount += 1;
        const response: XDmEvent = {
          id: `dm_${200 + state.dmCount}`,
          conversationId,
          senderId: state.users[0]?.id ?? "u_unknown",
          text,
          createdAt: new Date(Date.UTC(2026, 1, 28, 1, 0, state.dmCount)).toISOString(),
        };
        state.dmEvents.unshift(response);
        return response;
      },
    });
  }

  async createDmConversation(
    args: XCreateDmConversationArgs,
  ): Promise<XCreateDmConversationResponse> {
    const method = "x.dm.createConversation";
    const normalizedArgs = {
      namespace: args.namespace,
      participantIds: [...args.participantIds],
      ...(typeof args.text === "string" ? { text: args.text } : {}),
    };

    return this.runIdempotentOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      mapError: toProviderSdkError,
      getResponses: (state) => state.idempotentResponses,
      before: (state) => {
        this.applyFailureFlags(state);
        this.enforceRateLimit(state);
      },
      execute: (state) => {
        const participantIds = args.participantIds
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        if (participantIds.length === 0) {
          throw new Error("missing_participant_ids");
        }
        for (const participantId of participantIds) {
          this.assertUserExists(state, participantId);
        }

        state.dmCount += 1;
        const conversationId = `dmconv_${200 + state.dmCount}`;
        state.conversationParticipants.set(conversationId, participantIds);

        const text = typeof args.text === "string" ? args.text.trim() : "";
        const response: XCreateDmConversationResponse = {
          conversationId,
          participantIds,
        };

        if (text) {
          const event: XDmEvent = {
            id: `dm_${300 + state.dmCount}`,
            conversationId,
            senderId: participantIds[0] ?? state.users[0]?.id ?? "u_unknown",
            text,
            createdAt: new Date(Date.UTC(2026, 1, 28, 2, 0, state.dmCount)).toISOString(),
          };
          state.dmEvents.unshift(event);
          response.event = event;
        }

        return response;
      },
    });
  }

  async getDmEvents(args: XGetDmEventsArgs): Promise<XDmEvent[]> {
    const method = "x.dm.listEvents";
    const normalizedArgs = {
      namespace: args.namespace,
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      maxResults: args.maxResults,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));
      const conversationId = args.conversationId?.trim();
      const events = state.dmEvents
        .filter((entry) => !conversationId || entry.conversationId === conversationId)
        .slice(0, maxResults);

      this.captureOk(args.namespace, method, normalizedArgs, events);
      return events;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async searchUsers(args: XSearchUsersArgs): Promise<XUser[]> {
    const method = "x.users.search";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      maxResults: args.maxResults,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const query = args.query.trim().toLowerCase();
      if (!query) {
        throw new Error("missing_query");
      }
      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));
      const users = state.users
        .filter(
          (user) =>
            user.username.toLowerCase().includes(query) || user.name.toLowerCase().includes(query),
        )
        .slice(0, maxResults);
      this.captureOk(args.namespace, method, normalizedArgs, users);
      return users;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getUsersByUsernames(args: XGetUsersByUsernamesArgs): Promise<XUser[]> {
    const method = "x.users.byUsernames";
    const normalizedArgs = {
      namespace: args.namespace,
      usernames: [...args.usernames],
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const wanted = new Set(
        args.usernames.map((entry) => entry.trim().replace(/^@+/, "").toLowerCase()),
      );
      const users = state.users.filter((user) => wanted.has(user.username.toLowerCase()));
      this.captureOk(args.namespace, method, normalizedArgs, users);
      return users;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createList(args: XCreateListArgs): Promise<XList> {
    const method = "x.lists.create";
    const normalizedArgs = {
      namespace: args.namespace,
      name: args.name,
      ...(typeof args.description === "string" ? { description: args.description } : {}),
      ...(typeof args.isPrivate === "boolean" ? { isPrivate: args.isPrivate } : {}),
    };

    return this.runIdempotentOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      mapError: toProviderSdkError,
      getResponses: (state) => state.idempotentResponses,
      before: (state) => {
        this.applyFailureFlags(state);
        this.enforceRateLimit(state);
      },
      execute: (state) => {
        const name = args.name.trim();
        if (!name) {
          throw new Error("missing_name");
        }

        const ownerId = state.users[0]?.id;
        if (!ownerId) {
          throw new Error("user_not_found");
        }

        state.listCount += 1;
        const created: XList = {
          id: `list_${200 + state.listCount}`,
          name,
          ownerId,
          ...(typeof args.description === "string" && args.description.trim().length > 0
            ? { description: args.description.trim() }
            : {}),
          ...(typeof args.isPrivate === "boolean" ? { isPrivate: args.isPrivate } : {}),
        };
        state.lists.unshift(created);
        state.listMemberIdsByList.set(created.id, new Set([ownerId]));
        return created;
      },
    });
  }

  async deleteList(args: XDeleteListArgs): Promise<XDeleteListResponse> {
    const method = "x.lists.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      listId: args.listId,
    };

    return this.runIdempotentOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      mapError: toProviderSdkError,
      getResponses: (state) => state.idempotentResponses,
      before: (state) => {
        this.applyFailureFlags(state);
        this.enforceRateLimit(state);
      },
      execute: (state) => {
        const listId = args.listId.trim();
        if (!listId) {
          throw new Error("missing_list_id");
        }
        const index = state.lists.findIndex((entry) => entry.id === listId);
        if (index < 0) {
          throw new Error("list_not_found");
        }
        state.lists.splice(index, 1);
        state.listMemberIdsByList.delete(listId);
        return {
          id: listId,
          deleted: true,
        };
      },
    });
  }

  async updateList(args: XUpdateListArgs): Promise<XList> {
    const method = "x.lists.update";
    const normalizedArgs = {
      namespace: args.namespace,
      listId: args.listId,
      ...(typeof args.name === "string" ? { name: args.name } : {}),
      ...(typeof args.description === "string" ? { description: args.description } : {}),
      ...(typeof args.isPrivate === "boolean" ? { isPrivate: args.isPrivate } : {}),
    };

    return this.runIdempotentOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      mapError: toProviderSdkError,
      getResponses: (state) => state.idempotentResponses,
      before: (state) => {
        this.applyFailureFlags(state);
        this.enforceRateLimit(state);
      },
      execute: (state) => {
        const listId = args.listId.trim();
        if (!listId) {
          throw new Error("missing_list_id");
        }
        const list = this.assertListExists(state, listId);
        const hasUpdate =
          typeof args.name === "string" ||
          typeof args.description === "string" ||
          typeof args.isPrivate === "boolean";
        if (!hasUpdate) {
          throw new Error("missing_update");
        }

        if (typeof args.name === "string") {
          const name = args.name.trim();
          if (!name) {
            throw new Error("missing_name");
          }
          list.name = name;
        }
        if (typeof args.description === "string") {
          const description = args.description.trim();
          if (!description) {
            delete list.description;
          } else {
            list.description = description;
          }
        }
        if (typeof args.isPrivate === "boolean") {
          list.isPrivate = args.isPrivate;
        }

        return { ...list };
      },
    });
  }

  async getList(args: XGetListArgs): Promise<XList> {
    const method = "x.lists.get";
    const normalizedArgs = {
      namespace: args.namespace,
      listId: args.listId,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const listId = args.listId.trim();
      if (!listId) {
        throw new Error("missing_list_id");
      }
      const list = this.assertListExists(state, listId);
      this.captureOk(args.namespace, method, normalizedArgs, list);
      return { ...list };
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getOwnedLists(args: XGetOwnedListsArgs): Promise<XList[]> {
    const method = "x.lists.owned";
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
      maxResults: args.maxResults,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const userId = args.userId.trim();
      if (!userId) {
        throw new Error("missing_user_id");
      }
      this.assertUserExists(state, userId);
      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));
      const owned = [...state.lists]
        .filter((entry) => entry.ownerId === userId)
        .sort((left, right) => right.id.localeCompare(left.id));
      const response = this.paginateLists(owned, maxResults, args.cursor);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async addListMember(args: XListMemberArgs): Promise<XListMemberResponse> {
    return this.mutateListMember("x.lists.members.add", args, "add");
  }

  async removeListMember(args: XListMemberArgs): Promise<XListMemberResponse> {
    return this.mutateListMember("x.lists.members.remove", args, "remove");
  }

  async getListMembers(args: XGetListMembersArgs): Promise<XUser[]> {
    const method = "x.lists.members.list";
    const normalizedArgs = {
      namespace: args.namespace,
      listId: args.listId,
      maxResults: args.maxResults,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const listId = args.listId.trim();
      if (!listId) {
        throw new Error("missing_list_id");
      }
      const list = this.assertListExists(state, listId);
      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));
      const memberIds = state.listMemberIdsByList.get(list.id) ?? new Set([list.ownerId]);
      const members = state.users.filter((entry) => memberIds.has(entry.id));
      let startIndex = 0;
      if (args.cursor) {
        const cursorIndex = members.findIndex((user) => user.id === args.cursor);
        if (cursorIndex < 0) {
          throw new Error("invalid_cursor");
        }
        startIndex = cursorIndex + 1;
      }
      const response = members.slice(startIndex, startIndex + maxResults);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getListTweets(args: XGetListTweetsArgs): Promise<XPost[]> {
    const method = "x.lists.tweets";
    const normalizedArgs = {
      namespace: args.namespace,
      listId: args.listId,
      maxResults: args.maxResults,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const listId = args.listId.trim();
      if (!listId) {
        throw new Error("missing_list_id");
      }
      const list = this.assertListExists(state, listId);
      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));
      const memberIds = state.listMemberIdsByList.get(list.id) ?? new Set([list.ownerId]);
      const filtered = sortedPosts(state.posts).filter((post) => {
        return post.authorId ? memberIds.has(post.authorId) : false;
      });
      const response = this.paginatePosts(filtered, maxResults, args.cursor);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getHomeTimeline(args: XListPostsArgs): Promise<XPost[]> {
    const method = "x.timelines.home";
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
      maxResults: args.maxResults,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const userId = args.userId.trim();
      if (!userId) {
        throw new Error("missing_user_id");
      }
      this.assertUserExists(state, userId);
      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));
      const followingIds = new Set(state.followingUserIdsByUser.get(userId) ?? []);
      followingIds.add(userId);
      const filtered = sortedPosts(state.posts).filter((post) => {
        return post.authorId ? followingIds.has(post.authorId) : false;
      });
      const response = this.paginatePosts(filtered, maxResults, args.cursor);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async searchAllPosts(args: XSearchPostsArgs): Promise<XPost[]> {
    const method = "x.tweets.searchAll";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      maxResults: args.maxResults,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const query = args.query.trim().toLowerCase();
      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));
      const filtered = sortedPosts(state.posts).filter((post) => {
        if (!query) {
          return true;
        }
        return post.text.toLowerCase().includes(query);
      });

      const response = this.paginatePosts(filtered, maxResults, args.cursor);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getPostCounts(args: XGetPostCountsArgs): Promise<XPostCounts> {
    const method = "x.tweets.counts";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const query = args.query.trim().toLowerCase();
      if (!query) {
        throw new Error("missing_query");
      }
      const total = state.posts.filter((entry) => entry.text.toLowerCase().includes(query)).length;
      const response: XPostCounts = {
        query,
        total,
      };
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  seed(namespace: string, seed: Record<string, unknown>): void {
    const state = this.getState(namespace);

    if (Array.isArray(seed.posts)) {
      state.posts = seed.posts
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `x_${100 + index}`),
          text: String(entry.text ?? ""),
          ...(typeof entry.authorId === "string" ? { authorId: entry.authorId } : {}),
          ...(typeof entry.createdAt === "string" ? { createdAt: entry.createdAt } : {}),
        }));
    }

    if (Array.isArray(seed.users)) {
      state.users = seed.users
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `u_${100 + index}`),
          username: String(entry.username ?? `user_${index}`),
          name: String(entry.name ?? `User ${index}`),
        }));
    }

    if (Array.isArray(seed.lists)) {
      state.lists = seed.lists
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `list_${100 + index}`),
          name: String(entry.name ?? `List ${index}`),
          ownerId: String(entry.ownerId ?? state.users[0]?.id ?? "u_100"),
          ...(typeof entry.description === "string" ? { description: entry.description } : {}),
          ...(typeof entry.isPrivate === "boolean"
            ? { isPrivate: entry.isPrivate }
            : typeof entry.private === "boolean"
              ? { isPrivate: entry.private }
              : {}),
        }));
    }

    if (Array.isArray(seed.dmEvents)) {
      state.dmEvents = seed.dmEvents
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `dm_${100 + index}`),
          conversationId: String(entry.conversationId ?? "dmconv_100"),
          senderId: String(entry.senderId ?? state.users[0]?.id ?? "u_100"),
          text: String(entry.text ?? ""),
          createdAt: String(entry.createdAt ?? new Date().toISOString()),
        }));
    }

    if (seed.listMembersByList && typeof seed.listMembersByList === "object") {
      state.listMemberIdsByList = new Map();
      for (const [listId, rawMembers] of Object.entries(seed.listMembersByList)) {
        if (!Array.isArray(rawMembers)) {
          continue;
        }
        state.listMemberIdsByList.set(
          listId,
          new Set(rawMembers.map((entry) => String(entry)).filter((entry) => entry.length > 0)),
        );
      }
    }

    if (seed.followingByUser && typeof seed.followingByUser === "object") {
      state.followingUserIdsByUser = new Map();
      for (const [userId, rawTargets] of Object.entries(seed.followingByUser)) {
        if (!Array.isArray(rawTargets)) {
          continue;
        }
        state.followingUserIdsByUser.set(
          userId,
          new Set(rawTargets.map((entry) => String(entry)).filter((entry) => entry.length > 0)),
        );
      }
    }

    if (seed.blockedByUser && typeof seed.blockedByUser === "object") {
      state.blockedUserIdsByUser = new Map();
      for (const [userId, rawTargets] of Object.entries(seed.blockedByUser)) {
        if (!Array.isArray(rawTargets)) {
          continue;
        }
        state.blockedUserIdsByUser.set(
          userId,
          new Set(rawTargets.map((entry) => String(entry)).filter((entry) => entry.length > 0)),
        );
      }
    }

    if (seed.mutedByUser && typeof seed.mutedByUser === "object") {
      state.mutedUserIdsByUser = new Map();
      for (const [userId, rawTargets] of Object.entries(seed.mutedByUser)) {
        if (!Array.isArray(rawTargets)) {
          continue;
        }
        state.mutedUserIdsByUser.set(
          userId,
          new Set(rawTargets.map((entry) => String(entry)).filter((entry) => entry.length > 0)),
        );
      }
    }

    if (seed.bookmarkedByUser && typeof seed.bookmarkedByUser === "object") {
      state.bookmarkedPostIdsByUser = new Map();
      for (const [userId, rawPostIds] of Object.entries(seed.bookmarkedByUser)) {
        if (!Array.isArray(rawPostIds)) {
          continue;
        }
        state.bookmarkedPostIdsByUser.set(
          userId,
          new Set(rawPostIds.map((entry) => String(entry)).filter((entry) => entry.length > 0)),
        );
      }
    }

    for (const list of state.lists) {
      if (!state.listMemberIdsByList.has(list.id)) {
        state.listMemberIdsByList.set(list.id, new Set([list.ownerId]));
      }
    }

    if (typeof seed.forceRateLimit === "boolean") {
      state.forceRateLimit = seed.forceRateLimit;
    }
    if (typeof seed.forceTimeout === "boolean") {
      state.forceTimeout = seed.forceTimeout;
    }
    if (
      typeof seed.maxRequestsPerMinute === "number" &&
      Number.isFinite(seed.maxRequestsPerMinute)
    ) {
      state.maxRequestsPerMinute = Math.max(1, Math.floor(seed.maxRequestsPerMinute));
    }
  }

  protected createDefaultState(): XNamespaceState {
    const created: XNamespaceState = {
      posts: seedXPosts(),
      users: seedXUsers(),
      lists: seedXLists(),
      listMemberIdsByList: new Map([["list_100", new Set(["u_100", "u_101"])]]),
      dmEvents: seedXDmEvents(),
      conversationParticipants: new Map([["dmconv_100", ["u_100", "u_101"]]]),
      followingUserIdsByUser: new Map([
        ["u_100", new Set(["u_101"])],
        ["u_101", new Set(["u_100"])],
      ]),
      blockedUserIdsByUser: new Map(),
      mutedUserIdsByUser: new Map(),
      bookmarkedPostIdsByUser: new Map(),
      likedPostIdsByUser: new Map(),
      repostedPostIdsByUser: new Map(),
      postCount: 0,
      listCount: 0,
      dmCount: 0,
      idempotentResponses: new Map(),
      forceRateLimit: false,
      forceTimeout: false,
      maxRequestsPerMinute: 60,
      rateLimitWindowStartedAtMs: Date.now(),
      rateLimitCount: 0,
    };

    return created;
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

  private assertPostExists(state: XNamespaceState, postId: string): void {
    if (!state.posts.some((entry) => entry.id === postId)) {
      throw new Error("post_not_found");
    }
  }

  private assertUserExists(state: XNamespaceState, userId: string): void {
    if (!state.users.some((entry) => entry.id === userId)) {
      throw new Error("user_not_found");
    }
  }

  private assertListExists(state: XNamespaceState, listId: string): XList {
    const list = state.lists.find((entry) => entry.id === listId);
    if (!list) {
      throw new Error("list_not_found");
    }
    return list;
  }

  private paginatePosts(posts: XPost[], limit: number, cursor?: string): XPost[] {
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = posts.findIndex((post) => post.id === cursor);
      if (cursorIndex < 0) {
        throw new Error("invalid_cursor");
      }
      startIndex = cursorIndex + 1;
    }
    return posts.slice(startIndex, startIndex + limit);
  }

  private paginateLists(lists: XList[], limit: number, cursor?: string): XList[] {
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = lists.findIndex((list) => list.id === cursor);
      if (cursorIndex < 0) {
        throw new Error("invalid_cursor");
      }
      startIndex = cursorIndex + 1;
    }
    return lists.slice(startIndex, startIndex + limit);
  }

  private listUserPosts(
    method: string,
    args: XListPostsArgs,
    mode: "timeline" | "mentions" | "liked" | "bookmarks",
  ): XPost[] {
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
      maxResults: args.maxResults,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const userId = args.userId.trim();
      this.assertUserExists(state, userId);

      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));
      const username =
        state.users.find((entry) => entry.id === userId)?.username.toLowerCase() ?? "";
      const likedPostIds = state.likedPostIdsByUser.get(userId) ?? new Set<string>();
      const bookmarkedPostIds = state.bookmarkedPostIdsByUser.get(userId) ?? new Set<string>();
      const filtered = sortedPosts(state.posts).filter((post) => {
        if (mode === "timeline") {
          return post.authorId === userId;
        }
        if (mode === "mentions") {
          return post.text.toLowerCase().includes(`@${username}`);
        }
        if (mode === "liked") {
          return likedPostIds.has(post.id);
        }
        return bookmarkedPostIds.has(post.id);
      });
      const response = this.paginatePosts(filtered, maxResults, args.cursor);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  private mutateEngagement(
    method: string,
    args: XEngagementArgs,
    mode: "like" | "unlike" | "repost" | "undo_repost" | "bookmark_create" | "bookmark_delete",
  ): Promise<XEngagementResponse> {
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
      postId: args.postId,
    };

    return this.runIdempotentOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      mapError: toProviderSdkError,
      getResponses: (state) => state.idempotentResponses,
      before: (state) => {
        this.applyFailureFlags(state);
        this.enforceRateLimit(state);
      },
      execute: (state) => {
        const userId = args.userId.trim();
        const postId = args.postId.trim();
        if (!userId) {
          throw new Error("missing_user_id");
        }
        if (!postId) {
          throw new Error("missing_post_id");
        }

        this.assertUserExists(state, userId);
        this.assertPostExists(state, postId);

        const store =
          mode === "like" || mode === "unlike"
            ? state.likedPostIdsByUser
            : mode === "bookmark_create" || mode === "bookmark_delete"
              ? state.bookmarkedPostIdsByUser
              : state.repostedPostIdsByUser;
        const set = store.get(userId) ?? new Set<string>();
        if (mode === "like" || mode === "repost" || mode === "bookmark_create") {
          set.add(postId);
        } else {
          set.delete(postId);
        }
        store.set(userId, set);

        return {
          userId,
          postId,
        };
      },
    });
  }

  private listUsersByRelation(
    method: string,
    args: XListUsersArgs,
    mode: "followers" | "following" | "blocked" | "muted",
  ): XUser[] {
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
      maxResults: args.maxResults,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const userId = args.userId.trim();
      this.assertUserExists(state, userId);
      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));

      const targetIds =
        mode === "following"
          ? [...(state.followingUserIdsByUser.get(userId) ?? new Set<string>())]
          : mode === "blocked"
            ? [...(state.blockedUserIdsByUser.get(userId) ?? new Set<string>())]
            : mode === "muted"
              ? [...(state.mutedUserIdsByUser.get(userId) ?? new Set<string>())]
              : state.users
                  .filter((entry) =>
                    (state.followingUserIdsByUser.get(entry.id) ?? new Set()).has(userId),
                  )
                  .map((entry) => entry.id);

      const users = targetIds
        .map((targetId) => state.users.find((entry) => entry.id === targetId))
        .filter((entry): entry is XUser => !!entry)
        .slice(0, maxResults);
      this.captureOk(args.namespace, method, normalizedArgs, users);
      return users;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  private listUsersByPost(
    method: string,
    args: XGetPostUsersArgs,
    mode: "liked" | "reposted",
  ): XUser[] {
    const normalizedArgs = {
      namespace: args.namespace,
      postId: args.postId,
      maxResults: args.maxResults,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);
      this.enforceRateLimit(state);

      const postId = args.postId.trim();
      this.assertPostExists(state, postId);
      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));

      const store = mode === "liked" ? state.likedPostIdsByUser : state.repostedPostIdsByUser;
      const users = state.users
        .filter((user) => (store.get(user.id) ?? new Set()).has(postId))
        .slice(0, maxResults);
      this.captureOk(args.namespace, method, normalizedArgs, users);
      return users;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  private mutateRelationship(
    method: string,
    args: XRelationshipArgs,
    mode: "follow" | "unfollow" | "block" | "unblock" | "mute" | "unmute",
  ): Promise<XRelationshipResponse> {
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
      targetUserId: args.targetUserId,
    };

    return this.runIdempotentOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      mapError: toProviderSdkError,
      getResponses: (state) => state.idempotentResponses,
      before: (state) => {
        this.applyFailureFlags(state);
        this.enforceRateLimit(state);
      },
      execute: (state) => {
        const userId = args.userId.trim();
        const targetUserId = args.targetUserId.trim();
        if (!userId) {
          throw new Error("missing_user_id");
        }
        if (!targetUserId) {
          throw new Error("missing_target_user_id");
        }
        this.assertUserExists(state, userId);
        this.assertUserExists(state, targetUserId);

        const store =
          mode === "follow" || mode === "unfollow"
            ? state.followingUserIdsByUser
            : mode === "block" || mode === "unblock"
              ? state.blockedUserIdsByUser
              : state.mutedUserIdsByUser;
        const set = store.get(userId) ?? new Set<string>();
        if (mode === "follow" || mode === "block" || mode === "mute") {
          set.add(targetUserId);
        } else {
          set.delete(targetUserId);
        }
        store.set(userId, set);

        return {
          userId,
          targetUserId,
        };
      },
    });
  }

  private mutateListMember(
    method: string,
    args: XListMemberArgs,
    mode: "add" | "remove",
  ): Promise<XListMemberResponse> {
    const normalizedArgs = {
      namespace: args.namespace,
      listId: args.listId,
      userId: args.userId,
    };

    return this.runIdempotentOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      mapError: toProviderSdkError,
      getResponses: (state) => state.idempotentResponses,
      before: (state) => {
        this.applyFailureFlags(state);
        this.enforceRateLimit(state);
      },
      execute: (state) => {
        const listId = args.listId.trim();
        const userId = args.userId.trim();
        if (!listId) {
          throw new Error("missing_list_id");
        }
        if (!userId) {
          throw new Error("missing_user_id");
        }

        const list = this.assertListExists(state, listId);
        this.assertUserExists(state, userId);

        const members = state.listMemberIdsByList.get(list.id) ?? new Set([list.ownerId]);
        if (mode === "add") {
          members.add(userId);
        } else if (userId !== list.ownerId) {
          members.delete(userId);
        }
        state.listMemberIdsByList.set(list.id, members);

        return {
          listId: list.id,
          userId,
        };
      },
    });
  }

  private enforceRateLimit(state: XNamespaceState): void {
    const nowMs = Date.now();
    if (nowMs - state.rateLimitWindowStartedAtMs >= 60_000) {
      state.rateLimitWindowStartedAtMs = nowMs;
      state.rateLimitCount = 0;
    }

    state.rateLimitCount += 1;
    if (state.rateLimitCount > state.maxRequestsPerMinute) {
      throw new Error("rate_limited");
    }
  }

  private applyFailureFlags(state: XNamespaceState): void {
    if (state.forceRateLimit) {
      throw new Error("rate_limited");
    }
    if (state.forceTimeout) {
      throw new Error("gateway_timeout");
    }
  }
}

export class FakeXClientStore {
  private readonly engine: InMemoryXEngine;

  readonly createClient: CreateXClient;

  constructor(options?: { callLog?: ProviderSdkCallLog }) {
    this.engine = new InMemoryXEngine(options);
    this.createClient = (accessToken: string, namespace?: string): XClient => {
      return createFakeXClient(this.engine, accessToken, namespace);
    };
  }

  reset(namespace?: string): void {
    this.engine.reset(namespace);
  }

  seed(namespace: string, seedData: Record<string, unknown>): void {
    this.engine.seed(namespace, seedData);
  }
}

export const createFakeXClientStore = (options?: {
  callLog?: ProviderSdkCallLog;
}): FakeXClientStore => {
  return new FakeXClientStore(options);
};
