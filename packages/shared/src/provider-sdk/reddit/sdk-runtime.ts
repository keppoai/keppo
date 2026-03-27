import type { ProviderSdkCallLog, ProviderSdkRuntime } from "../port.js";
import { BaseSdkPort } from "../base-sdk.js";
import type { CreateRedditClient } from "./client-interface.js";
import { toProviderSdkError } from "./errors.js";
import type {
  RedditComposeMessageArgs,
  RedditCreateCommentArgs,
  RedditCreateCommentResponse,
  RedditCreatePostArgs,
  RedditCreatePostResponse,
  RedditDistinguishArgs,
  RedditDistinguishResponse,
  RedditEditPostArgs,
  RedditEditPostResponse,
  RedditGetInfoArgs,
  RedditGetModmailArgs,
  RedditGetPostCommentsArgs,
  RedditGetPostCommentsResponse,
  RedditGetSubredditRulesArgs,
  RedditGetUserArgs,
  RedditInfoItem,
  RedditListModmailArgs,
  RedditListMessagesArgs,
  RedditModerationItem,
  RedditModerationListArgs,
  RedditModLogEntry,
  RedditModmailConversation,
  RedditModmailConversationSummary,
  RedditReplyModmailArgs,
  RedditReplyModmailResponse,
  RedditListPostsArgs,
  RedditMessage,
  RedditPost,
  RedditReadAllMessagesArgs,
  RedditReadAllMessagesResponse,
  RedditReadMessageArgs,
  RedditReadMessageResponse,
  RedditReportContentArgs,
  RedditReportContentResponse,
  RedditSdkContext,
  RedditSdkPort,
  RedditSearchSubredditsArgs,
  RedditSearchPostsArgs,
  RedditSelectFlairArgs,
  RedditSelectFlairResponse,
  RedditStickyPostArgs,
  RedditStickyPostResponse,
  RedditSubredditInfo,
  RedditSubredditRule,
  RedditSubscribeArgs,
  RedditSubscribeResponse,
  RedditThingActionArgs,
  RedditThingActionResponse,
  RedditUser,
  RedditUserOverview,
  RedditVoteArgs,
  RedditVoteResponse,
} from "./types.js";

export class RedditSdk extends BaseSdkPort<CreateRedditClient> implements RedditSdkPort {
  constructor(options: {
    createClient: CreateRedditClient;
    runtime?: ProviderSdkRuntime;
    callLog?: ProviderSdkCallLog;
  }) {
    super({
      providerId: "reddit",
      createClient: options.createClient,
      ...(options.runtime ? { runtime: options.runtime } : {}),
      ...(options.callLog ? { callLog: options.callLog } : {}),
    });
  }

  async searchPosts(args: RedditSearchPostsArgs): Promise<RedditPost[]> {
    const method = "reddit.search.posts";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      query: args.query,
      limit: args.limit,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      const response = await this.client(args).searchPosts(args);
      this.captureOk(args.namespace, method, normalizedArgs, response.posts);
      return response.posts;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listRising(args: RedditListPostsArgs): Promise<RedditPost[]> {
    return this.listPostsMode("reddit.posts.listRising", args, "rising");
  }

  async listControversial(args: RedditListPostsArgs): Promise<RedditPost[]> {
    return this.listPostsMode("reddit.posts.listControversial", args, "controversial");
  }

  async searchSubreddits(args: RedditSearchSubredditsArgs): Promise<RedditSubredditInfo[]> {
    const method = "reddit.subreddits.search";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      limit: args.limit,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      const response = await this.client(args).searchSubreddits({
        query: args.query,
        limit: args.limit,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.subreddits);
      return response.subreddits;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getUserOverview(args: RedditGetUserArgs): Promise<RedditUserOverview> {
    const method = "reddit.users.getOverview";
    const normalizedArgs = {
      namespace: args.namespace,
      username: args.username,
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
    };

    try {
      const response = await this.client(args).getUserOverview({
        username: args.username,
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      });
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getUserAbout(args: RedditGetUserArgs): Promise<RedditUser> {
    const method = "reddit.users.getAbout";
    const normalizedArgs = {
      namespace: args.namespace,
      username: args.username,
    };

    try {
      const response = await this.client(args).getUserAbout({
        username: args.username,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.user);
      return response.user;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createPost(args: RedditCreatePostArgs): Promise<RedditCreatePostResponse> {
    const method = "reddit.posts.submit";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      title: args.title,
      body: args.body,
    };

    try {
      const normalizedResponse = await this.client(args).createPost({
        subreddit: args.subreddit,
        title: args.title,
        body: args.body,
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

  async createComment(args: RedditCreateCommentArgs): Promise<RedditCreateCommentResponse> {
    const method = "reddit.comments.create";
    const normalizedArgs = {
      namespace: args.namespace,
      parentId: args.parentId,
      body: args.body,
    };

    try {
      const response = await this.client(args).createComment({
        parentId: args.parentId,
        body: args.body,
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

  async getPostComments(args: RedditGetPostCommentsArgs): Promise<RedditGetPostCommentsResponse> {
    const method = "reddit.posts.getComments";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      postId: args.postId,
      limit: args.limit,
    };

    try {
      const response = await this.client(args).getPostComments({
        subreddit: args.subreddit,
        postId: args.postId,
        limit: args.limit,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getInfo(args: RedditGetInfoArgs): Promise<RedditInfoItem[]> {
    const method = "reddit.info.get";
    const normalizedArgs = {
      namespace: args.namespace,
      thingIds: [...args.thingIds],
    };

    try {
      const response = await this.client(args).getInfo({ thingIds: args.thingIds });
      this.captureOk(args.namespace, method, normalizedArgs, response.items);
      return response.items;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listHot(args: RedditListPostsArgs): Promise<RedditPost[]> {
    return this.listPostsMode("reddit.posts.listHot", args, "hot");
  }

  async listNew(args: RedditListPostsArgs): Promise<RedditPost[]> {
    return this.listPostsMode("reddit.posts.listNew", args, "new");
  }

  async listTop(args: RedditListPostsArgs): Promise<RedditPost[]> {
    return this.listPostsMode("reddit.posts.listTop", args, "top");
  }

  async editPost(args: RedditEditPostArgs): Promise<RedditEditPostResponse> {
    const method = "reddit.posts.edit";
    const normalizedArgs = {
      namespace: args.namespace,
      thingId: args.thingId,
      body: args.body,
    };

    try {
      const response = await this.client(args).editPost({
        thingId: args.thingId,
        body: args.body,
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

  async deletePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.executeThingAction("reddit.posts.delete", args, "deletePost");
  }

  async approve(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.executeThingAction("reddit.moderation.approve", args, "approve");
  }

  async removeContent(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.executeThingAction("reddit.moderation.remove", args, "removeContent");
  }

  async lockPost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.executeThingAction("reddit.posts.lock", args, "lockPost");
  }

  async unlockPost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.executeThingAction("reddit.posts.unlock", args, "unlockPost");
  }

  async savePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.executeThingAction("reddit.posts.save", args, "savePost");
  }

  async unsavePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.executeThingAction("reddit.posts.unsave", args, "unsavePost");
  }

  async hidePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.executeThingAction("reddit.posts.hide", args, "hidePost");
  }

  async unhidePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.executeThingAction("reddit.posts.unhide", args, "unhidePost");
  }

  async reportContent(args: RedditReportContentArgs): Promise<RedditReportContentResponse> {
    const method = "reddit.content.report";
    const normalizedArgs = {
      namespace: args.namespace,
      thingId: args.thingId,
      reason: args.reason,
    };

    try {
      const response = await this.client(args).reportContent({
        thingId: args.thingId,
        reason: args.reason,
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

  async readMessage(args: RedditReadMessageArgs): Promise<RedditReadMessageResponse> {
    const method = "reddit.messages.read";
    const normalizedArgs = {
      namespace: args.namespace,
      messageId: args.messageId,
    };

    try {
      const response = await this.client(args).readMessage({
        messageId: args.messageId,
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

  async readAllMessages(args: RedditReadAllMessagesArgs): Promise<RedditReadAllMessagesResponse> {
    const method = "reddit.messages.readAll";
    const normalizedArgs = {
      namespace: args.namespace,
    };

    try {
      const response = await this.client(args).readAllMessages({
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

  async vote(args: RedditVoteArgs): Promise<RedditVoteResponse> {
    const method = "reddit.vote";
    const normalizedArgs = {
      namespace: args.namespace,
      thingId: args.thingId,
      direction: args.direction,
    };

    try {
      const response = await this.client(args).vote({
        thingId: args.thingId,
        direction: args.direction,
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

  async composeMessage(args: RedditComposeMessageArgs): Promise<RedditMessage> {
    const method = "reddit.messages.compose";
    const normalizedArgs = {
      namespace: args.namespace,
      to: args.to,
      subject: args.subject,
      body: args.body,
    };

    try {
      const response = await this.client(args).composeMessage({
        to: args.to,
        subject: args.subject,
        body: args.body,
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

  async listInbox(args: RedditListMessagesArgs): Promise<RedditMessage[]> {
    const method = "reddit.messages.listInbox";
    const normalizedArgs = {
      namespace: args.namespace,
      limit: args.limit,
    };

    try {
      const response = await this.client(args).listInbox({ limit: args.limit });
      this.captureOk(args.namespace, method, normalizedArgs, response.messages);
      return response.messages;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listUnreadMessages(args: RedditListMessagesArgs): Promise<RedditMessage[]> {
    const method = "reddit.messages.listUnread";
    const normalizedArgs = {
      namespace: args.namespace,
      limit: args.limit,
    };

    try {
      const response = await this.client(args).listUnreadMessages({ limit: args.limit });
      this.captureOk(args.namespace, method, normalizedArgs, response.messages);
      return response.messages;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listSentMessages(args: RedditListMessagesArgs): Promise<RedditMessage[]> {
    const method = "reddit.messages.listSent";
    const normalizedArgs = {
      namespace: args.namespace,
      limit: args.limit,
    };

    try {
      const response = await this.client(args).listSentMessages({ limit: args.limit });
      this.captureOk(args.namespace, method, normalizedArgs, response.messages);
      return response.messages;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listMentions(args: RedditListMessagesArgs): Promise<RedditMessage[]> {
    const method = "reddit.messages.listMentions";
    const normalizedArgs = {
      namespace: args.namespace,
      limit: args.limit,
    };

    try {
      const response = await this.client(args).listMentions({ limit: args.limit });
      this.captureOk(args.namespace, method, normalizedArgs, response.messages);
      return response.messages;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getSubredditInfo(args: {
    accessToken: string;
    namespace?: string | undefined;
    subreddit: string;
  }): Promise<RedditSubredditInfo> {
    const method = "reddit.subreddits.get";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
    };

    try {
      const response = await this.client(args).getSubredditInfo({ subreddit: args.subreddit });
      this.captureOk(args.namespace, method, normalizedArgs, response.subreddit);
      return response.subreddit;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getModQueue(args: RedditModerationListArgs): Promise<RedditModerationItem[]> {
    const method = "reddit.moderation.getQueue";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      limit: args.limit,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      const response = await this.client(args).getModQueue({
        subreddit: args.subreddit,
        limit: args.limit,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.items);
      return response.items;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getReports(args: RedditModerationListArgs): Promise<RedditModerationItem[]> {
    const method = "reddit.moderation.getReports";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      limit: args.limit,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      const response = await this.client(args).getReports({
        subreddit: args.subreddit,
        limit: args.limit,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.items);
      return response.items;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getModLog(args: RedditModerationListArgs): Promise<RedditModLogEntry[]> {
    const method = "reddit.moderation.getLog";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      limit: args.limit,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      const response = await this.client(args).getModLog({
        subreddit: args.subreddit,
        limit: args.limit,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.entries);
      return response.entries;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getSubredditRules(args: RedditGetSubredditRulesArgs): Promise<RedditSubredditRule[]> {
    const method = "reddit.subreddits.getRules";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
    };

    try {
      const response = await this.client(args).getSubredditRules({
        subreddit: args.subreddit,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.rules);
      return response.rules;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listModmail(args: RedditListModmailArgs): Promise<RedditModmailConversationSummary[]> {
    const method = "reddit.modmail.list";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      limit: args.limit,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      const response = await this.client(args).listModmail({
        subreddit: args.subreddit,
        limit: args.limit,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.conversations);
      return response.conversations;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getModmail(args: RedditGetModmailArgs): Promise<RedditModmailConversation> {
    const method = "reddit.modmail.get";
    const normalizedArgs = {
      namespace: args.namespace,
      conversationId: args.conversationId,
    };

    try {
      const response = await this.client(args).getModmail({
        conversationId: args.conversationId,
      });
      this.captureOk(args.namespace, method, normalizedArgs, response.conversation);
      return response.conversation;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async distinguish(args: RedditDistinguishArgs): Promise<RedditDistinguishResponse> {
    const method = "reddit.moderation.distinguish";
    const normalizedArgs = {
      namespace: args.namespace,
      thingId: args.thingId,
      sticky: args.sticky === true,
    };

    try {
      const response = await this.client(args).distinguish({
        thingId: args.thingId,
        sticky: args.sticky === true,
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

  async stickyPost(args: RedditStickyPostArgs): Promise<RedditStickyPostResponse> {
    const method = "reddit.posts.sticky";
    const normalizedArgs = {
      namespace: args.namespace,
      thingId: args.thingId,
      state: args.state,
      slot: args.slot ?? 1,
    };

    try {
      const response = await this.client(args).stickyPost({
        thingId: args.thingId,
        state: args.state,
        slot: args.slot ?? 1,
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

  async markNsfw(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.executeThingAction("reddit.posts.markNsfw", args, "markNsfw");
  }

  async unmarkNsfw(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.executeThingAction("reddit.posts.unmarkNsfw", args, "unmarkNsfw");
  }

  async spoiler(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.executeThingAction("reddit.posts.spoiler", args, "spoiler");
  }

  async unspoiler(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.executeThingAction("reddit.posts.unspoiler", args, "unspoiler");
  }

  async selectFlair(args: RedditSelectFlairArgs): Promise<RedditSelectFlairResponse> {
    const method = "reddit.posts.selectFlair";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      thingId: args.thingId,
      text: args.text,
      ...(args.cssClass ? { cssClass: args.cssClass } : {}),
    };

    try {
      const response = await this.client(args).selectFlair({
        subreddit: args.subreddit,
        thingId: args.thingId,
        text: args.text,
        ...(args.cssClass ? { cssClass: args.cssClass } : {}),
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

  async subscribe(args: RedditSubscribeArgs): Promise<RedditSubscribeResponse> {
    const method = "reddit.subreddits.subscribe";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      action: args.action,
    };

    try {
      const response = await this.client(args).subscribe({
        subreddit: args.subreddit,
        action: args.action,
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

  async replyModmail(args: RedditReplyModmailArgs): Promise<RedditReplyModmailResponse> {
    const method = "reddit.modmail.reply";
    const normalizedArgs = {
      namespace: args.namespace,
      conversationId: args.conversationId,
      body: args.body,
      isInternal: args.isInternal === true,
    };

    try {
      const response = await this.client(args).replyModmail({
        conversationId: args.conversationId,
        body: args.body,
        isInternal: args.isInternal === true,
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

  async getMe(args: RedditSdkContext): Promise<RedditUser> {
    const method = "reddit.users.getMe";
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

  private async listPostsMode(
    method: string,
    args: RedditListPostsArgs,
    mode: "hot" | "new" | "top" | "rising" | "controversial",
  ): Promise<RedditPost[]> {
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      limit: args.limit,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    try {
      const response = await this.client(args).listPosts({
        mode,
        subreddit: args.subreddit,
        limit: args.limit,
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

  private async executeThingAction(
    method: string,
    args: RedditThingActionArgs,
    action:
      | "deletePost"
      | "approve"
      | "removeContent"
      | "lockPost"
      | "unlockPost"
      | "markNsfw"
      | "unmarkNsfw"
      | "spoiler"
      | "unspoiler"
      | "savePost"
      | "unsavePost"
      | "hidePost"
      | "unhidePost",
  ): Promise<RedditThingActionResponse> {
    const normalizedArgs = {
      namespace: args.namespace,
      thingId: args.thingId,
    };

    try {
      const client = this.client(args);
      const response =
        action === "deletePost"
          ? await client.deletePost({
              thingId: args.thingId,
              idempotencyKey: args.idempotencyKey,
            })
          : action === "approve"
            ? await client.approve({
                thingId: args.thingId,
                idempotencyKey: args.idempotencyKey,
              })
            : action === "removeContent"
              ? await client.removeContent({
                  thingId: args.thingId,
                  idempotencyKey: args.idempotencyKey,
                })
              : action === "lockPost"
                ? await client.lockPost({
                    thingId: args.thingId,
                    idempotencyKey: args.idempotencyKey,
                  })
                : action === "unlockPost"
                  ? await client.unlockPost({
                      thingId: args.thingId,
                      idempotencyKey: args.idempotencyKey,
                    })
                  : action === "markNsfw"
                    ? await client.markNsfw({
                        thingId: args.thingId,
                        idempotencyKey: args.idempotencyKey,
                      })
                    : action === "unmarkNsfw"
                      ? await client.unmarkNsfw({
                          thingId: args.thingId,
                          idempotencyKey: args.idempotencyKey,
                        })
                      : action === "spoiler"
                        ? await client.spoiler({
                            thingId: args.thingId,
                            idempotencyKey: args.idempotencyKey,
                          })
                        : action === "unspoiler"
                          ? await client.unspoiler({
                              thingId: args.thingId,
                              idempotencyKey: args.idempotencyKey,
                            })
                          : action === "savePost"
                            ? await client.savePost({
                                thingId: args.thingId,
                                idempotencyKey: args.idempotencyKey,
                              })
                            : action === "unsavePost"
                              ? await client.unsavePost({
                                  thingId: args.thingId,
                                  idempotencyKey: args.idempotencyKey,
                                })
                              : action === "hidePost"
                                ? await client.hidePost({
                                    thingId: args.thingId,
                                    idempotencyKey: args.idempotencyKey,
                                  })
                                : await client.unhidePost({
                                    thingId: args.thingId,
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

  private client(args: RedditSdkContext) {
    return this.createClient(args.accessToken, args.namespace);
  }
}
