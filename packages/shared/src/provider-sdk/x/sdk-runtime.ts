import type { ProviderSdkCallLog, ProviderSdkRuntime } from "../port.js";
import { BaseSdkPort } from "../base-sdk.js";
import type { CreateXClient } from "./client-interface.js";
import { toProviderSdkError } from "./errors.js";
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
  XSdkContext,
  XSdkPort,
  XSearchPostsArgs,
  XSearchUsersArgs,
  XSendDmArgs,
  XUpdateListArgs,
  XUser,
} from "./types.js";

export class XSdk extends BaseSdkPort<CreateXClient> implements XSdkPort {
  constructor(options: {
    createClient: CreateXClient;
    runtime?: ProviderSdkRuntime;
    callLog?: ProviderSdkCallLog;
  }) {
    super({
      providerId: "x",
      createClient: options.createClient,
      ...(options.runtime ? { runtime: options.runtime } : {}),
      ...(options.callLog ? { callLog: options.callLog } : {}),
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
      const response = await this.client(args).searchRecentPosts(args);
      this.captureOk(args.namespace, method, normalizedArgs, response.posts);
      return response.posts;
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

    try {
      const normalizedResponse = await this.client(args).createPost({
        text: args.text,
        idempotencyKey: args.idempotencyKey,
      });

      this.captureOk(
        args.namespace,
        method,
        normalizedArgs,
        normalizedResponse,
        args.idempotencyKey,
      );
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async deletePost(args: XDeletePostArgs): Promise<XDeletePostResponse> {
    const method = "x.tweets.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      postId: args.postId,
    };

    try {
      const response = await this.client(args).deletePost({
        postId: args.postId,
        idempotencyKey: args.idempotencyKey,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getPost(args: XGetPostArgs): Promise<XPost> {
    const method = "x.tweets.get";
    const normalizedArgs = {
      namespace: args.namespace,
      postId: args.postId,
    };

    try {
      const response = await this.client(args).getPost({ postId: args.postId });
      this.captureOk(args.namespace, method, normalizedArgs, response.post);
      return response.post;
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
      const response = await this.client(args).getPosts({ postIds: args.postIds });
      this.captureOk(args.namespace, method, normalizedArgs, response.posts);
      return response.posts;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getUserTimeline(args: XListPostsArgs): Promise<XPost[]> {
    return this.listPostsMode("x.users.tweets", args, "timeline");
  }

  async getUserMentions(args: XListPostsArgs): Promise<XPost[]> {
    return this.listPostsMode("x.users.mentions", args, "mentions");
  }

  async getQuoteTweets(args: XGetPostArgs & { maxResults: number }): Promise<XPost[]> {
    const method = "x.tweets.quoteTweets";
    const normalizedArgs = {
      namespace: args.namespace,
      postId: args.postId,
      maxResults: args.maxResults,
    };

    try {
      const response = await this.client(args).getQuoteTweets({
        postId: args.postId,
        maxResults: args.maxResults,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.posts);
      return response.posts;
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
      const response = await this.client(args).getUserByUsername({ username: args.username });
      this.captureOk(args.namespace, method, normalizedArgs, response.user);
      return response.user;
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
      const response = await this.client(args).getUserById({ userId: args.userId });
      this.captureOk(args.namespace, method, normalizedArgs, response.user);
      return response.user;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getMe(args: XSdkContext): Promise<XUser> {
    const method = "x.users.me";
    const normalizedArgs = {
      namespace: args.namespace,
    };

    try {
      const response = await this.client(args).getMe();
      this.captureOk(args.namespace, method, normalizedArgs, response.me);
      return response.me;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getFollowers(args: XListUsersArgs): Promise<XUser[]> {
    return this.listUsersMode("x.users.followers", args, "followers");
  }

  async getFollowing(args: XListUsersArgs): Promise<XUser[]> {
    return this.listUsersMode("x.users.following", args, "following");
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
    return this.listPostUsersMode("x.likes.listUsers", args, "liking_users");
  }

  async getLikedPosts(args: XListPostsArgs): Promise<XPost[]> {
    return this.listPostsMode("x.likes.listPosts", args, "liked_posts");
  }

  async repost(args: XEngagementArgs): Promise<XEngagementResponse> {
    return this.mutateEngagement("x.reposts.create", args, "repost");
  }

  async undoRepost(args: XEngagementArgs): Promise<XEngagementResponse> {
    return this.mutateEngagement("x.reposts.delete", args, "undo_repost");
  }

  async getRepostedBy(args: XGetPostUsersArgs): Promise<XUser[]> {
    return this.listPostUsersMode("x.reposts.listUsers", args, "reposted_by");
  }

  async blockUser(args: XRelationshipArgs): Promise<XRelationshipResponse> {
    return this.mutateRelationship("x.blocks.create", args, "block");
  }

  async unblockUser(args: XRelationshipArgs): Promise<XRelationshipResponse> {
    return this.mutateRelationship("x.blocks.delete", args, "unblock");
  }

  async getBlockedUsers(args: XListUsersArgs): Promise<XUser[]> {
    return this.listUsersMode("x.blocks.list", args, "blocked");
  }

  async muteUser(args: XRelationshipArgs): Promise<XRelationshipResponse> {
    return this.mutateRelationship("x.mutes.create", args, "mute");
  }

  async unmuteUser(args: XRelationshipArgs): Promise<XRelationshipResponse> {
    return this.mutateRelationship("x.mutes.delete", args, "unmute");
  }

  async getMutedUsers(args: XListUsersArgs): Promise<XUser[]> {
    return this.listUsersMode("x.mutes.list", args, "muted");
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
    return this.listPostsMode("x.bookmarks.list", args, "bookmarks");
  }

  async sendDm(args: XSendDmArgs): Promise<XDmEvent> {
    const method = "x.dm.send";
    const normalizedArgs = {
      namespace: args.namespace,
      conversationId: args.conversationId,
      text: args.text,
    };

    try {
      const response = await this.client(args).sendDm({
        conversationId: args.conversationId,
        text: args.text,
        idempotencyKey: args.idempotencyKey,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.event, args.idempotencyKey);
      return response.event;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
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

    try {
      const response = await this.client(args).createDmConversation({
        participantIds: args.participantIds,
        ...(typeof args.text === "string" ? { text: args.text } : {}),
        idempotencyKey: args.idempotencyKey,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getDmEvents(args: XGetDmEventsArgs): Promise<XDmEvent[]> {
    const method = "x.dm.listEvents";
    const normalizedArgs = {
      namespace: args.namespace,
      maxResults: args.maxResults,
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
    };

    try {
      const response = await this.client(args).getDmEvents({
        ...(args.conversationId ? { conversationId: args.conversationId } : {}),
        maxResults: args.maxResults,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.events);
      return response.events;
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
      const response = await this.client(args).searchUsers({
        query: args.query,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.users);
      return response.users;
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
      const response = await this.client(args).getUsersByUsernames({
        usernames: args.usernames,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.users);
      return response.users;
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

    try {
      const response = await this.client(args).createList({
        name: args.name,
        ...(typeof args.description === "string" ? { description: args.description } : {}),
        ...(typeof args.isPrivate === "boolean" ? { isPrivate: args.isPrivate } : {}),
        idempotencyKey: args.idempotencyKey,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.list, args.idempotencyKey);
      return response.list;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async deleteList(args: XDeleteListArgs): Promise<XDeleteListResponse> {
    const method = "x.lists.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      listId: args.listId,
    };

    try {
      const response = await this.client(args).deleteList({
        listId: args.listId,
        idempotencyKey: args.idempotencyKey,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
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

    try {
      const response = await this.client(args).updateList({
        listId: args.listId,
        ...(typeof args.name === "string" ? { name: args.name } : {}),
        ...(typeof args.description === "string" ? { description: args.description } : {}),
        ...(typeof args.isPrivate === "boolean" ? { isPrivate: args.isPrivate } : {}),
        idempotencyKey: args.idempotencyKey,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.list, args.idempotencyKey);
      return response.list;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getList(args: XGetListArgs): Promise<XList> {
    const method = "x.lists.get";
    const normalizedArgs = {
      namespace: args.namespace,
      listId: args.listId,
    };

    try {
      const response = await this.client(args).getList({ listId: args.listId });
      this.captureOk(args.namespace, method, normalizedArgs, response.list);
      return response.list;
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
      const response = await this.client(args).getOwnedLists({
        userId: args.userId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.lists);
      return response.lists;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async addListMember(args: XListMemberArgs): Promise<XListMemberResponse> {
    const method = "x.lists.members.add";
    const normalizedArgs = {
      namespace: args.namespace,
      listId: args.listId,
      userId: args.userId,
    };

    try {
      const response = await this.client(args).addListMember({
        listId: args.listId,
        userId: args.userId,
        idempotencyKey: args.idempotencyKey,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async removeListMember(args: XListMemberArgs): Promise<XListMemberResponse> {
    const method = "x.lists.members.remove";
    const normalizedArgs = {
      namespace: args.namespace,
      listId: args.listId,
      userId: args.userId,
    };

    try {
      const response = await this.client(args).removeListMember({
        listId: args.listId,
        userId: args.userId,
        idempotencyKey: args.idempotencyKey,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
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
      const response = await this.client(args).getListMembers({
        listId: args.listId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.users);
      return response.users;
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
      const response = await this.client(args).getListTweets({
        listId: args.listId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.posts);
      return response.posts;
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
      const response = await this.client(args).getHomeTimeline({
        userId: args.userId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.posts);
      return response.posts;
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
      const response = await this.client(args).searchAllPosts({
        query: args.query,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.posts);
      return response.posts;
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
      const response = await this.client(args).getPostCounts({
        query: args.query,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.counts);
      return response.counts;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  private async listPostsMode(
    method: string,
    args: XListPostsArgs,
    mode: "timeline" | "mentions" | "liked_posts" | "bookmarks",
  ): Promise<XPost[]> {
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
      maxResults: args.maxResults,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      const response =
        mode === "timeline"
          ? await this.client(args).getUserTimeline({
              userId: args.userId,
              maxResults: args.maxResults,
              cursor: args.cursor,
            })
          : mode === "mentions"
            ? await this.client(args).getUserMentions({
                userId: args.userId,
                maxResults: args.maxResults,
                cursor: args.cursor,
              })
            : mode === "liked_posts"
              ? await this.client(args).getLikedPosts({
                  userId: args.userId,
                  maxResults: args.maxResults,
                  cursor: args.cursor,
                })
              : await this.client(args).getBookmarks({
                  userId: args.userId,
                  maxResults: args.maxResults,
                  cursor: args.cursor,
                });
      this.captureOk(args.namespace, method, normalizedArgs, response.posts);
      return response.posts;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  private async mutateEngagement(
    method: string,
    args: XEngagementArgs,
    mode: "like" | "unlike" | "repost" | "undo_repost" | "bookmark_create" | "bookmark_delete",
  ): Promise<XEngagementResponse> {
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
      postId: args.postId,
    };

    try {
      const response =
        mode === "like"
          ? await this.client(args).likePost({
              userId: args.userId,
              postId: args.postId,
              idempotencyKey: args.idempotencyKey,
            })
          : mode === "unlike"
            ? await this.client(args).unlikePost({
                userId: args.userId,
                postId: args.postId,
                idempotencyKey: args.idempotencyKey,
              })
            : mode === "repost"
              ? await this.client(args).repost({
                  userId: args.userId,
                  postId: args.postId,
                  idempotencyKey: args.idempotencyKey,
                })
              : mode === "undo_repost"
                ? await this.client(args).undoRepost({
                    userId: args.userId,
                    postId: args.postId,
                    idempotencyKey: args.idempotencyKey,
                  })
                : mode === "bookmark_create"
                  ? await this.client(args).createBookmark({
                      userId: args.userId,
                      postId: args.postId,
                      idempotencyKey: args.idempotencyKey,
                    })
                  : await this.client(args).deleteBookmark({
                      userId: args.userId,
                      postId: args.postId,
                      idempotencyKey: args.idempotencyKey,
                    });
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  private async listUsersMode(
    method: string,
    args: XListUsersArgs,
    mode: "followers" | "following" | "blocked" | "muted",
  ): Promise<XUser[]> {
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
      maxResults: args.maxResults,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      const response =
        mode === "followers"
          ? await this.client(args).getFollowers({
              userId: args.userId,
              maxResults: args.maxResults,
              cursor: args.cursor,
            })
          : mode === "following"
            ? await this.client(args).getFollowing({
                userId: args.userId,
                maxResults: args.maxResults,
                cursor: args.cursor,
              })
            : mode === "blocked"
              ? await this.client(args).getBlockedUsers({
                  userId: args.userId,
                  maxResults: args.maxResults,
                  cursor: args.cursor,
                })
              : await this.client(args).getMutedUsers({
                  userId: args.userId,
                  maxResults: args.maxResults,
                  cursor: args.cursor,
                });
      this.captureOk(args.namespace, method, normalizedArgs, response.users);
      return response.users;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  private async listPostUsersMode(
    method: string,
    args: XGetPostUsersArgs,
    mode: "liking_users" | "reposted_by",
  ): Promise<XUser[]> {
    const normalizedArgs = {
      namespace: args.namespace,
      postId: args.postId,
      maxResults: args.maxResults,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      const response =
        mode === "liking_users"
          ? await this.client(args).getLikingUsers({
              postId: args.postId,
              maxResults: args.maxResults,
              cursor: args.cursor,
            })
          : await this.client(args).getRepostedBy({
              postId: args.postId,
              maxResults: args.maxResults,
              cursor: args.cursor,
            });
      this.captureOk(args.namespace, method, normalizedArgs, response.users);
      return response.users;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  private async mutateRelationship(
    method: string,
    args: XRelationshipArgs,
    mode: "follow" | "unfollow" | "block" | "unblock" | "mute" | "unmute",
  ): Promise<XRelationshipResponse> {
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
      targetUserId: args.targetUserId,
    };

    try {
      const response =
        mode === "follow"
          ? await this.client(args).followUser({
              userId: args.userId,
              targetUserId: args.targetUserId,
              idempotencyKey: args.idempotencyKey,
            })
          : mode === "unfollow"
            ? await this.client(args).unfollowUser({
                userId: args.userId,
                targetUserId: args.targetUserId,
                idempotencyKey: args.idempotencyKey,
              })
            : mode === "block"
              ? await this.client(args).blockUser({
                  userId: args.userId,
                  targetUserId: args.targetUserId,
                  idempotencyKey: args.idempotencyKey,
                })
              : mode === "unblock"
                ? await this.client(args).unblockUser({
                    userId: args.userId,
                    targetUserId: args.targetUserId,
                    idempotencyKey: args.idempotencyKey,
                  })
                : mode === "mute"
                  ? await this.client(args).muteUser({
                      userId: args.userId,
                      targetUserId: args.targetUserId,
                      idempotencyKey: args.idempotencyKey,
                    })
                  : await this.client(args).unmuteUser({
                      userId: args.userId,
                      targetUserId: args.targetUserId,
                      idempotencyKey: args.idempotencyKey,
                    });
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  private client(args: XSdkContext) {
    return this.createClient(args.accessToken, args.namespace);
  }
}
