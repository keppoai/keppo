import { BaseFakeClient } from "../base-fake-client.js";
import { createFakeProviderSdkErrorFactory, matchErrorCodes } from "../fake-error.js";
import { ProviderSdkError, type ProviderSdkCallLog } from "../port.js";
import type { CreateRedditClient, RedditClient } from "./client-interface.js";
import { createFakeRedditClient } from "./client-adapter.js";
import {
  seedRedditComments,
  seedRedditMe,
  seedRedditMessages,
  seedRedditModmailConversations,
  seedRedditPosts,
  seedRedditSubredditRules,
  seedRedditSubreddits,
} from "./fixtures.js";
import type {
  RedditComment,
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
  RedditListPostsArgs,
  RedditMessage,
  RedditModerationItem,
  RedditModerationListArgs,
  RedditModLogEntry,
  RedditModmailConversation,
  RedditModmailConversationSummary,
  RedditPost,
  RedditReadAllMessagesArgs,
  RedditReadAllMessagesResponse,
  RedditReadMessageArgs,
  RedditReadMessageResponse,
  RedditReplyModmailArgs,
  RedditReplyModmailResponse,
  RedditReportContentArgs,
  RedditReportContentResponse,
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

type RedditNamespaceState = {
  posts: RedditPost[];
  comments: RedditComment[];
  messages: RedditMessage[];
  subreddits: RedditSubredditInfo[];
  me: RedditUser;
  users: RedditUser[];
  savedThingIds: Set<string>;
  hiddenThingIds: Set<string>;
  removedThingIds: Set<string>;
  lockedThingIds: Set<string>;
  nsfwThingIds: Set<string>;
  spoilerThingIds: Set<string>;
  distinguishedThingIds: Set<string>;
  stickyByThingId: Map<string, number>;
  flairByThingId: Map<string, { subreddit: string; text: string; cssClass?: string | undefined }>;
  subscribedSubreddits: Set<string>;
  reportedReasonsByThing: Map<string, string>;
  voteDirectionsByThing: Map<string, number>;
  modLogEntries: RedditModLogEntry[];
  subredditRulesByName: Map<string, RedditSubredditRule[]>;
  modmailConversations: RedditModmailConversation[];
  postCount: number;
  commentCount: number;
  messageCount: number;
  modmailMessageCount: number;
  idempotentResponses: Map<string, unknown>;
  forceRateLimit: boolean;
  forceTimeout: boolean;
  maxRequestsPerMinute: number;
  rateLimitWindowStartedAtMs: number;
  rateLimitCount: number;
};

const VALID_SUBREDDIT = /^[a-z0-9_]{3,21}$/;

const toProviderSdkError = createFakeProviderSdkErrorFactory("reddit", [
  {
    match: matchErrorCodes("missing_access_token", "invalid_access_token"),
    category: "auth",
    code: "invalid_token",
    status: 401,
    retryable: false,
  },
  {
    match: matchErrorCodes(
      "subreddit_not_found",
      "post_not_found",
      "comment_not_found",
      "message_not_found",
      "not_found",
    ),
    category: "not_found",
    code: "not_found",
    status: 404,
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

const normalizeSubreddit = (value: string): string => {
  return value.trim().toLowerCase() || "all";
};

const sortedByScoreDesc = (posts: RedditPost[]): RedditPost[] => {
  return [...posts].sort((left, right) => {
    const scoreLeft = typeof left.score === "number" ? left.score : 0;
    const scoreRight = typeof right.score === "number" ? right.score : 0;
    if (scoreRight !== scoreLeft) {
      return scoreRight - scoreLeft;
    }
    return right.id.localeCompare(left.id);
  });
};

const sortedByCreatedDesc = (posts: RedditPost[]): RedditPost[] => {
  return [...posts].sort((left, right) => {
    const createdLeft = typeof left.createdUtc === "number" ? left.createdUtc : 0;
    const createdRight = typeof right.createdUtc === "number" ? right.createdUtc : 0;
    if (createdRight !== createdLeft) {
      return createdRight - createdLeft;
    }
    return right.id.localeCompare(left.id);
  });
};

const resolvePostIdFromParent = (
  parentId: string,
  posts: RedditPost[],
  comments: RedditComment[],
): string | null => {
  const post = posts.find((entry) => entry.id === parentId);
  if (post) {
    return post.id;
  }
  const comment = comments.find((entry) => entry.id === parentId);
  return comment ? comment.postId : null;
};

const findUserByName = (state: RedditNamespaceState, username: string): RedditUser | null => {
  const normalized = username.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const found = state.users.find((entry) => entry.name.toLowerCase() === normalized);
  return found ?? null;
};

export class InMemoryRedditEngine
  extends BaseFakeClient<RedditNamespaceState>
  implements RedditSdkPort
{
  constructor(options?: { callLog?: ProviderSdkCallLog }) {
    super({
      providerId: "reddit",
      ...(options?.callLog ? { callLog: options.callLog } : {}),
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

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const subreddit = this.assertSubreddit(state, args.subreddit);
        const query = args.query.trim().toLowerCase();
        const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));

        const filtered = sortedByScoreDesc(state.posts).filter((post) => {
          if (state.hiddenThingIds.has(post.id)) {
            return false;
          }
          const postSubreddit = normalizeSubreddit(post.subreddit);
          const matchesSubreddit =
            subreddit === "all" || postSubreddit === subreddit || postSubreddit === "all";
          if (!matchesSubreddit) {
            return false;
          }
          if (!query) {
            return true;
          }
          return (
            post.title.toLowerCase().includes(query) ||
            String(post.body ?? "")
              .toLowerCase()
              .includes(query)
          );
        });

        return this.pagePosts(filtered, limit, args.cursor);
      },
    });
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

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const query = args.query.trim().toLowerCase();
        if (!query) {
          throw new Error("missing_query");
        }
        const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
        const sorted = [...state.subreddits].sort((left, right) =>
          left.name.localeCompare(right.name),
        );
        const filtered = sorted.filter((entry) => {
          return (
            entry.name.toLowerCase().includes(query) ||
            entry.title.toLowerCase().includes(query) ||
            String(entry.description ?? "")
              .toLowerCase()
              .includes(query)
          );
        });
        return filtered.slice(0, limit);
      },
    });
  }

  async getUserOverview(args: RedditGetUserArgs): Promise<RedditUserOverview> {
    const method = "reddit.users.getOverview";
    const normalizedArgs = {
      namespace: args.namespace,
      username: args.username,
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
    };

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const username = args.username.trim();
        const user = findUserByName(state, username);
        if (!user) {
          throw new Error("not_found");
        }
        const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
        const posts = sortedByCreatedDesc(state.posts)
          .filter((entry) => String(entry.author ?? "").toLowerCase() === user.name.toLowerCase())
          .slice(0, limit);
        const comments = [...state.comments]
          .filter((entry) => String(entry.author ?? "").toLowerCase() === user.name.toLowerCase())
          .sort((left, right) => right.id.localeCompare(left.id))
          .slice(0, limit);
        const response: RedditUserOverview = {
          username: user.name,
          posts,
          comments,
        };
        return response;
      },
    });
  }

  async getUserAbout(args: RedditGetUserArgs): Promise<RedditUser> {
    const method = "reddit.users.getAbout";
    const normalizedArgs = {
      namespace: args.namespace,
      username: args.username,
    };

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const username = args.username.trim();
        const user = findUserByName(state, username);
        if (!user) {
          throw new Error("not_found");
        }
        return { ...user };
      },
    });
  }

  async createPost(args: RedditCreatePostArgs): Promise<RedditCreatePostResponse> {
    const method = "reddit.posts.submit";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      title: args.title,
      body: args.body,
    };

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        const normalizedSubreddit = this.assertSubreddit(state, args.subreddit);
        if (!args.title.trim()) {
          throw new Error("missing_title");
        }
        if (!args.body.trim()) {
          throw new Error("missing_body");
        }

        state.postCount += 1;
        const id = `t3_${200 + state.postCount}`;
        const response: RedditCreatePostResponse = {
          id,
          name: id,
          subreddit: normalizedSubreddit,
          title: args.title.trim(),
          url: `https://reddit.test/r/${normalizedSubreddit}/comments/${id.replace("t3_", "")}`,
        };

        state.posts.unshift({
          id,
          subreddit: normalizedSubreddit,
          title: args.title.trim(),
          body: args.body,
          score: 1,
          author: state.me.name,
          createdUtc: Math.trunc(Date.now() / 1000),
        });

        return response;
      },
    });
  }

  async createComment(args: RedditCreateCommentArgs): Promise<RedditCreateCommentResponse> {
    const method = "reddit.comments.create";
    const normalizedArgs = {
      namespace: args.namespace,
      parentId: args.parentId,
      body: args.body,
    };

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        const parentId = args.parentId.trim();
        if (!parentId) {
          throw new Error("missing_parent_id");
        }
        if (!args.body.trim()) {
          throw new Error("missing_body");
        }

        const postId = resolvePostIdFromParent(parentId, state.posts, state.comments);
        if (!postId) {
          throw new Error("comment_not_found");
        }

        state.commentCount += 1;
        const response: RedditCreateCommentResponse = {
          id: `t1_${800 + state.commentCount}`,
          parentId,
          postId,
          body: args.body.trim(),
        };
        state.comments.unshift({
          ...response,
          author: state.me.name,
          score: 1,
        });
        return response;
      },
    });
  }

  async getPostComments(args: RedditGetPostCommentsArgs): Promise<RedditGetPostCommentsResponse> {
    const method = "reddit.posts.getComments";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      postId: args.postId,
      limit: args.limit,
    };

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const subreddit = this.assertSubreddit(state, args.subreddit);
        const postId = args.postId.trim();
        const post = state.posts.find(
          (entry) => entry.id === postId && normalizeSubreddit(entry.subreddit) === subreddit,
        );
        if (!post) {
          throw new Error("post_not_found");
        }

        const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
        const comments = state.comments
          .filter((entry) => entry.postId === post.id)
          .sort((left, right) => {
            const leftScore = typeof left.score === "number" ? left.score : 0;
            const rightScore = typeof right.score === "number" ? right.score : 0;
            if (rightScore !== leftScore) {
              return rightScore - leftScore;
            }
            return right.id.localeCompare(left.id);
          })
          .slice(0, limit);

        const response: RedditGetPostCommentsResponse = {
          post,
          comments,
        };
        return response;
      },
    });
  }

  async getInfo(args: RedditGetInfoArgs): Promise<RedditInfoItem[]> {
    const method = "reddit.info.get";
    const normalizedArgs = {
      namespace: args.namespace,
      thingIds: [...args.thingIds],
    };

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const items: RedditInfoItem[] = [];
        for (const thingIdRaw of args.thingIds) {
          const thingId = String(thingIdRaw).trim();
          if (!thingId) {
            continue;
          }

          if (thingId.startsWith("t3_")) {
            const post = state.posts.find((entry) => entry.id === thingId);
            if (post) {
              items.push({ kind: "post", post });
            }
            continue;
          }

          if (thingId.startsWith("t1_")) {
            const comment = state.comments.find((entry) => entry.id === thingId);
            if (comment) {
              items.push({ kind: "comment", comment });
            }
            continue;
          }

          if (thingId.startsWith("t5_")) {
            const name = thingId.replace(/^t5_/, "").trim().toLowerCase();
            const subreddit = state.subreddits.find((entry) => entry.name === name);
            if (subreddit) {
              items.push({ kind: "subreddit", subreddit });
            }
          }
        }
        return items;
      },
    });
  }

  async editPost(args: RedditEditPostArgs): Promise<RedditEditPostResponse> {
    const method = "reddit.posts.edit";
    const normalizedArgs = {
      namespace: args.namespace,
      thingId: args.thingId,
      body: args.body,
    };

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        const thingId = args.thingId.trim();
        const body = args.body.trim();
        if (!thingId) {
          throw new Error("missing_thing_id");
        }
        if (!body) {
          throw new Error("missing_body");
        }

        const post = state.posts.find((entry) => entry.id === thingId);
        const comment = post ? null : state.comments.find((entry) => entry.id === thingId);
        if (!post && !comment) {
          throw new Error("not_found");
        }

        if (post) {
          post.body = body;
        }
        if (comment) {
          comment.body = body;
        }

        const response: RedditEditPostResponse = {
          thingId,
          body,
          edited: true,
        };
        return response;
      },
    });
  }

  async deletePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.performThingAction("reddit.posts.delete", args, "delete");
  }

  async approve(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.performThingAction("reddit.moderation.approve", args, "approve");
  }

  async removeContent(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.performThingAction("reddit.moderation.remove", args, "remove");
  }

  async lockPost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.performThingAction("reddit.posts.lock", args, "lock");
  }

  async unlockPost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.performThingAction("reddit.posts.unlock", args, "unlock");
  }

  async distinguish(args: RedditDistinguishArgs): Promise<RedditDistinguishResponse> {
    const method = "reddit.moderation.distinguish";
    const normalizedArgs = {
      namespace: args.namespace,
      thingId: args.thingId,
      sticky: args.sticky === true,
    };

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        const thingId = args.thingId.trim();
        if (!thingId) {
          throw new Error("missing_thing_id");
        }
        this.assertThingExists(state, thingId);

        state.distinguishedThingIds.add(thingId);
        if (args.sticky === true) {
          state.stickyByThingId.set(thingId, 1);
        }
        this.appendModLog(
          state,
          "distinguish",
          thingId,
          args.sticky === true ? "sticky" : undefined,
        );

        const response: RedditDistinguishResponse = {
          thingId,
          success: true,
          distinguished: true,
          sticky: args.sticky === true,
        };
        return response;
      },
    });
  }

  async stickyPost(args: RedditStickyPostArgs): Promise<RedditStickyPostResponse> {
    const method = "reddit.posts.sticky";
    const slot = Number.isFinite(Number(args.slot))
      ? Math.max(1, Math.min(2, Number(args.slot)))
      : 1;
    const normalizedArgs = {
      namespace: args.namespace,
      thingId: args.thingId,
      state: args.state,
      slot,
    };

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        const thingId = args.thingId.trim();
        if (!thingId) {
          throw new Error("missing_thing_id");
        }
        this.assertThingExists(state, thingId);

        if (args.state) {
          state.stickyByThingId.set(thingId, slot);
        } else {
          state.stickyByThingId.delete(thingId);
        }
        this.appendModLog(
          state,
          args.state ? "sticky" : "unsticky",
          thingId,
          `slot:${String(slot)}`,
        );

        const response: RedditStickyPostResponse = {
          thingId,
          success: true,
          state: args.state,
          slot,
        };
        return response;
      },
    });
  }

  async markNsfw(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.performThingAction("reddit.posts.markNsfw", args, "markNsfw");
  }

  async unmarkNsfw(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.performThingAction("reddit.posts.unmarkNsfw", args, "unmarkNsfw");
  }

  async spoiler(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.performThingAction("reddit.posts.spoiler", args, "spoiler");
  }

  async unspoiler(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.performThingAction("reddit.posts.unspoiler", args, "unspoiler");
  }

  async savePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.performThingAction("reddit.posts.save", args, "save");
  }

  async unsavePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.performThingAction("reddit.posts.unsave", args, "unsave");
  }

  async hidePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.performThingAction("reddit.posts.hide", args, "hide");
  }

  async unhidePost(args: RedditThingActionArgs): Promise<RedditThingActionResponse> {
    return this.performThingAction("reddit.posts.unhide", args, "unhide");
  }

  async reportContent(args: RedditReportContentArgs): Promise<RedditReportContentResponse> {
    const method = "reddit.content.report";
    const normalizedArgs = {
      namespace: args.namespace,
      thingId: args.thingId,
      reason: args.reason,
    };

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        const thingId = args.thingId.trim();
        const reason = args.reason.trim();
        if (!thingId) {
          throw new Error("missing_thing_id");
        }
        if (!reason) {
          throw new Error("missing_reason");
        }

        this.assertThingExists(state, thingId);
        state.reportedReasonsByThing.set(thingId, reason);
        this.appendModLog(state, "report", thingId, reason);
        const response: RedditReportContentResponse = {
          thingId,
          reason,
          reported: true,
        };
        return response;
      },
    });
  }

  async readMessage(args: RedditReadMessageArgs): Promise<RedditReadMessageResponse> {
    const method = "reddit.messages.read";
    const normalizedArgs = {
      namespace: args.namespace,
      messageId: args.messageId,
    };

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        const messageId = args.messageId.trim();
        if (!messageId) {
          throw new Error("missing_message_id");
        }
        const message = state.messages.find((entry) => entry.id === messageId);
        if (!message) {
          throw new Error("message_not_found");
        }
        message.unread = false;
        const response: RedditReadMessageResponse = {
          messageId,
          unread: false,
        };
        return response;
      },
    });
  }

  async readAllMessages(args: RedditReadAllMessagesArgs): Promise<RedditReadAllMessagesResponse> {
    const method = "reddit.messages.readAll";
    const normalizedArgs = {
      namespace: args.namespace,
    };

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        let readCount = 0;
        for (const message of state.messages) {
          if (message.unread) {
            message.unread = false;
            readCount += 1;
          }
        }

        const response: RedditReadAllMessagesResponse = { readCount };
        return response;
      },
    });
  }

  async vote(args: RedditVoteArgs): Promise<RedditVoteResponse> {
    const method = "reddit.vote";
    const normalizedArgs = {
      namespace: args.namespace,
      thingId: args.thingId,
      direction: args.direction,
    };

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        const thingId = args.thingId.trim();
        if (!thingId) {
          throw new Error("missing_thing_id");
        }
        const direction = Math.trunc(Number(args.direction));
        if (![1, 0, -1].includes(direction)) {
          throw new Error("invalid_direction");
        }

        const post = state.posts.find((entry) => entry.id === thingId);
        const comment = post ? null : state.comments.find((entry) => entry.id === thingId);
        if (!post && !comment) {
          throw new Error("not_found");
        }

        const previous = state.voteDirectionsByThing.get(thingId) ?? 0;
        const delta = direction - previous;
        state.voteDirectionsByThing.set(thingId, direction);

        if (post) {
          post.score = (post.score ?? 0) + delta;
        }
        if (comment) {
          comment.score = (comment.score ?? 0) + delta;
        }

        const response: RedditVoteResponse = {
          thingId,
          direction,
          score: post ? (post.score ?? 0) : (comment?.score ?? 0),
        };
        return response;
      },
    });
  }

  async composeMessage(args: RedditComposeMessageArgs): Promise<RedditMessage> {
    const method = "reddit.messages.compose";
    const normalizedArgs = {
      namespace: args.namespace,
      to: args.to,
      subject: args.subject,
      body: args.body,
    };

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        const to = args.to.trim();
        const subject = args.subject.trim();
        const body = args.body.trim();
        if (!to) {
          throw new Error("missing_to");
        }
        if (!subject) {
          throw new Error("missing_subject");
        }
        if (!body) {
          throw new Error("missing_body");
        }

        state.messageCount += 1;
        const response: RedditMessage = {
          id: `t4_${900 + state.messageCount}`,
          to,
          from: state.me.name,
          subject,
          body,
          unread: false,
        };

        state.messages.unshift(response);
        return response;
      },
    });
  }

  async listInbox(args: RedditListMessagesArgs): Promise<RedditMessage[]> {
    return this.listMessagesMode("reddit.messages.listInbox", args, "inbox");
  }

  async listUnreadMessages(args: RedditListMessagesArgs): Promise<RedditMessage[]> {
    return this.listMessagesMode("reddit.messages.listUnread", args, "unread");
  }

  async listSentMessages(args: RedditListMessagesArgs): Promise<RedditMessage[]> {
    return this.listMessagesMode("reddit.messages.listSent", args, "sent");
  }

  async listMentions(args: RedditListMessagesArgs): Promise<RedditMessage[]> {
    return this.listMessagesMode("reddit.messages.listMentions", args, "mentions");
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

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const subreddit = this.assertSubreddit(state, args.subreddit);
        const found = state.subreddits.find((entry) => entry.name === subreddit);
        if (!found) {
          throw new Error("subreddit_not_found");
        }
        return found;
      },
    });
  }

  async getModQueue(args: RedditModerationListArgs): Promise<RedditModerationItem[]> {
    const method = "reddit.moderation.getQueue";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      limit: args.limit,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const subreddit = this.assertSubreddit(state, args.subreddit);
        const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
        const reportMap = this.getReportCountMap(state);
        const postItems = state.posts
          .filter((post) => normalizeSubreddit(post.subreddit) === subreddit || subreddit === "all")
          .map(
            (post): RedditModerationItem => ({
              thingId: post.id,
              subreddit: normalizeSubreddit(post.subreddit),
              kind: "post",
              title: post.title,
              ...(typeof post.body === "string" ? { body: post.body } : {}),
              ...(typeof post.author === "string" ? { author: post.author } : {}),
              reports: reportMap.get(post.id) ?? 0,
              removed: state.removedThingIds.has(post.id),
            }),
          );
        const commentItems = state.comments
          .map(
            (comment): RedditModerationItem => ({
              thingId: comment.id,
              subreddit,
              kind: "comment",
              body: comment.body,
              ...(typeof comment.author === "string" ? { author: comment.author } : {}),
              reports: reportMap.get(comment.id) ?? 0,
              removed: state.removedThingIds.has(comment.id),
            }),
          )
          .filter((entry) => entry.subreddit === subreddit || subreddit === "all");
        return [...postItems, ...commentItems].slice(0, limit);
      },
    });
  }

  async getReports(args: RedditModerationListArgs): Promise<RedditModerationItem[]> {
    const method = "reddit.moderation.getReports";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      limit: args.limit,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const subreddit = this.assertSubreddit(state, args.subreddit);
        const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
        const reportMap = this.getReportCountMap(state);
        return [...reportMap.keys()]
          .reduce<RedditModerationItem[]>((items, thingId) => {
            const post = state.posts.find((entry) => entry.id === thingId);
            if (post) {
              items.push({
                thingId: post.id,
                subreddit: normalizeSubreddit(post.subreddit),
                kind: "post",
                title: post.title,
                ...(typeof post.body === "string" ? { body: post.body } : {}),
                ...(typeof post.author === "string" ? { author: post.author } : {}),
                reports: reportMap.get(thingId) ?? 0,
                removed: state.removedThingIds.has(thingId),
              });
              return items;
            }
            const comment = state.comments.find((entry) => entry.id === thingId);
            if (comment) {
              items.push({
                thingId: comment.id,
                subreddit,
                kind: "comment",
                body: comment.body,
                ...(typeof comment.author === "string" ? { author: comment.author } : {}),
                reports: reportMap.get(thingId) ?? 0,
                removed: state.removedThingIds.has(thingId),
              });
            }
            return items;
          }, [])
          .filter((entry) => entry.subreddit === subreddit || subreddit === "all")
          .slice(0, limit);
      },
    });
  }

  async getModLog(args: RedditModerationListArgs): Promise<RedditModLogEntry[]> {
    const method = "reddit.moderation.getLog";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      limit: args.limit,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        this.assertSubreddit(state, args.subreddit);
        const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
        return [...state.modLogEntries]
          .sort((left, right) => right.createdUtc - left.createdUtc)
          .slice(0, limit);
      },
    });
  }

  async getSubredditRules(args: RedditGetSubredditRulesArgs): Promise<RedditSubredditRule[]> {
    const method = "reddit.subreddits.getRules";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
    };

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const subreddit = this.assertSubreddit(state, args.subreddit);
        const rules = state.subredditRulesByName.get(subreddit);
        return Array.isArray(rules) ? rules : [];
      },
    });
  }

  async listModmail(args: RedditListModmailArgs): Promise<RedditModmailConversationSummary[]> {
    const method = "reddit.modmail.list";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      limit: args.limit,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const subreddit = normalizeSubreddit(args.subreddit);
        const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
        return state.modmailConversations
          .filter(
            (entry) => subreddit === "all" || normalizeSubreddit(entry.subreddit) === subreddit,
          )
          .map((entry) => ({
            id: entry.id,
            subreddit: entry.subreddit,
            subject: entry.subject,
            participant: entry.participant,
            state: entry.state,
            lastUpdatedUtc: entry.lastUpdatedUtc,
          }))
          .sort((left, right) => right.lastUpdatedUtc - left.lastUpdatedUtc)
          .slice(0, limit);
      },
    });
  }

  async getModmail(args: RedditGetModmailArgs): Promise<RedditModmailConversation> {
    const method = "reddit.modmail.get";
    const normalizedArgs = {
      namespace: args.namespace,
      conversationId: args.conversationId,
    };

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const conversationId = args.conversationId.trim();
        if (!conversationId) {
          throw new Error("missing_conversation_id");
        }
        const conversation = state.modmailConversations.find(
          (entry) => entry.id === conversationId,
        );
        if (!conversation) {
          throw new Error("not_found");
        }
        return {
          ...conversation,
          messages: conversation.messages.map((entry) => ({ ...entry })),
        };
      },
    });
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

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        const subreddit = this.assertSubreddit(state, args.subreddit);
        const thingId = args.thingId.trim();
        const text = args.text.trim();
        if (!thingId) {
          throw new Error("missing_thing_id");
        }
        if (!text) {
          throw new Error("missing_text");
        }
        this.assertThingExists(state, thingId);
        state.flairByThingId.set(thingId, {
          subreddit,
          text,
          ...(args.cssClass ? { cssClass: args.cssClass } : {}),
        });
        this.appendModLog(state, "select_flair", thingId, text);

        return {
          thingId,
          success: true,
          subreddit,
          text,
          ...(args.cssClass ? { cssClass: args.cssClass } : {}),
        };
      },
    });
  }

  async subscribe(args: RedditSubscribeArgs): Promise<RedditSubscribeResponse> {
    const method = "reddit.subreddits.subscribe";
    const normalizedArgs = {
      namespace: args.namespace,
      subreddit: args.subreddit,
      action: args.action,
    };

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        const subreddit = this.assertSubreddit(state, args.subreddit);
        const action = args.action === "unsub" ? "unsub" : "sub";
        const subscribed = action === "sub";
        if (subscribed) {
          state.subscribedSubreddits.add(subreddit);
        } else {
          state.subscribedSubreddits.delete(subreddit);
        }
        this.appendModLog(state, subscribed ? "subscribe" : "unsubscribe", undefined, subreddit);
        return { subreddit, subscribed };
      },
    });
  }

  async replyModmail(args: RedditReplyModmailArgs): Promise<RedditReplyModmailResponse> {
    const method = "reddit.modmail.reply";
    const normalizedArgs = {
      namespace: args.namespace,
      conversationId: args.conversationId,
      body: args.body,
      isInternal: args.isInternal === true,
    };

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        const conversationId = args.conversationId.trim();
        const body = args.body.trim();
        if (!conversationId) {
          throw new Error("missing_conversation_id");
        }
        if (!body) {
          throw new Error("missing_body");
        }

        const conversation = state.modmailConversations.find(
          (entry) => entry.id === conversationId,
        );
        if (!conversation) {
          throw new Error("not_found");
        }
        state.modmailMessageCount += 1;
        const messageId = `modmail_msg_${900 + state.modmailMessageCount}`;
        const message = {
          id: messageId,
          author: state.me.name,
          body,
          isInternal: args.isInternal === true,
          createdUtc: Math.trunc(Date.now() / 1000),
        };
        conversation.messages.push(message);
        conversation.lastUpdatedUtc = message.createdUtc;
        conversation.state = "inprogress";
        this.appendModLog(state, "modmail_reply", undefined, conversationId);

        return {
          conversationId,
          messageId,
          author: message.author,
          body: message.body,
          isInternal: message.isInternal,
        };
      },
    });
  }

  async getMe(args: { accessToken: string; namespace?: string | undefined }): Promise<RedditUser> {
    const method = "reddit.users.getMe";
    const normalizedArgs = {
      namespace: args.namespace,
    };

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => ({ ...state.me }),
    });
  }

  seed(namespace: string, seed: Record<string, unknown>): void {
    const state = this.getState(namespace);

    if (Array.isArray(seed.posts)) {
      state.posts = seed.posts
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `t3_${100 + index}`),
          subreddit: String(entry.subreddit ?? "all"),
          title: String(entry.title ?? "Untitled post"),
          ...(typeof entry.body === "string" ? { body: entry.body } : {}),
          ...(typeof entry.score === "number" ? { score: entry.score } : {}),
          ...(typeof entry.author === "string" ? { author: entry.author } : {}),
          ...(typeof entry.createdUtc === "number" ? { createdUtc: entry.createdUtc } : {}),
        }));
    }

    if (Array.isArray(seed.comments)) {
      state.comments = seed.comments
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `t1_${500 + index}`),
          parentId: String(entry.parentId ?? entry.postId ?? ""),
          postId: String(entry.postId ?? ""),
          body: String(entry.body ?? ""),
          ...(typeof entry.author === "string" ? { author: entry.author } : {}),
          ...(typeof entry.score === "number" ? { score: entry.score } : {}),
        }));
    }

    if (Array.isArray(seed.messages)) {
      state.messages = seed.messages
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `t4_${700 + index}`),
          to: String(entry.to ?? state.me.name),
          from: String(entry.from ?? "mod_bot"),
          subject: String(entry.subject ?? "Message"),
          body: String(entry.body ?? ""),
          unread: entry.unread !== false,
        }));
    }

    if (Array.isArray(seed.users)) {
      state.users = seed.users
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `u_${200 + index}`),
          name: String(entry.name ?? `user_${index}`),
          ...(typeof entry.commentKarma === "number" ? { commentKarma: entry.commentKarma } : {}),
          ...(typeof entry.linkKarma === "number" ? { linkKarma: entry.linkKarma } : {}),
        }));
    }

    if (Array.isArray(seed.subreddits)) {
      state.subreddits = seed.subreddits
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `t5_${100 + index}`),
          name: normalizeSubreddit(String(entry.name ?? "all")),
          title: String(entry.title ?? "Subreddit"),
          ...(typeof entry.description === "string" ? { description: entry.description } : {}),
          ...(typeof entry.subscribers === "number" ? { subscribers: entry.subscribers } : {}),
        }));
    }

    if (
      seed.subredditRules &&
      typeof seed.subredditRules === "object" &&
      !Array.isArray(seed.subredditRules)
    ) {
      state.subredditRulesByName = new Map();
      for (const [name, rulesValue] of Object.entries(
        seed.subredditRules as Record<string, unknown>,
      )) {
        const rules = Array.isArray(rulesValue)
          ? rulesValue
              .filter((entry): entry is Record<string, unknown> => {
                return !!entry && typeof entry === "object" && !Array.isArray(entry);
              })
              .map((entry) => ({
                shortName: String(entry.shortName ?? entry.short_name ?? "Rule"),
                description: String(entry.description ?? ""),
                ...(typeof entry.kind === "string" ? { kind: entry.kind } : {}),
                ...(typeof entry.priority === "number" ? { priority: entry.priority } : {}),
                ...(typeof entry.violationReason === "string"
                  ? { violationReason: entry.violationReason }
                  : {}),
              }))
          : [];
        state.subredditRulesByName.set(normalizeSubreddit(name), rules);
      }
    }

    if (Array.isArray(seed.modmailConversations)) {
      state.modmailConversations = seed.modmailConversations
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => {
          const messages = Array.isArray(entry.messages) ? entry.messages : [];
          return {
            id: String(entry.id ?? `modmail_${900 + index}`),
            subreddit: normalizeSubreddit(String(entry.subreddit ?? "support")),
            subject: String(entry.subject ?? "Modmail"),
            participant: String(entry.participant ?? "user"),
            state: String(entry.state ?? "new"),
            lastUpdatedUtc: Number(entry.lastUpdatedUtc ?? 1_710_000_000 + index),
            messages: messages
              .filter((message): message is Record<string, unknown> => {
                return !!message && typeof message === "object" && !Array.isArray(message);
              })
              .map((message, messageIndex) => ({
                id: String(message.id ?? `modmail_msg_${900 + index}_${messageIndex}`),
                author: String(message.author ?? "user"),
                body: String(message.body ?? ""),
                isInternal: message.isInternal === true,
                createdUtc: Number(message.createdUtc ?? 1_710_000_000 + messageIndex),
              })),
          } satisfies RedditModmailConversation;
        });
    }

    if (seed.me && typeof seed.me === "object" && !Array.isArray(seed.me)) {
      const me = seed.me as Record<string, unknown>;
      state.me = {
        id: String(me.id ?? state.me.id),
        name: String(me.name ?? state.me.name),
        ...(typeof me.commentKarma === "number"
          ? { commentKarma: me.commentKarma }
          : state.me.commentKarma !== undefined
            ? { commentKarma: state.me.commentKarma }
            : {}),
        ...(typeof me.linkKarma === "number"
          ? { linkKarma: me.linkKarma }
          : state.me.linkKarma !== undefined
            ? { linkKarma: state.me.linkKarma }
            : {}),
      };
      const existingMeIndex = state.users.findIndex((entry) => entry.id === state.me.id);
      if (existingMeIndex >= 0) {
        state.users[existingMeIndex] = { ...state.me };
      } else {
        state.users.unshift({ ...state.me });
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

  protected createDefaultState(): RedditNamespaceState {
    const created: RedditNamespaceState = {
      posts: seedRedditPosts(),
      comments: seedRedditComments(),
      messages: seedRedditMessages(),
      subreddits: seedRedditSubreddits(),
      me: seedRedditMe(),
      users: [
        seedRedditMe(),
        { id: "u_101", name: "automation_one", commentKarma: 121, linkKarma: 74 },
        { id: "u_102", name: "automation_two", commentKarma: 88, linkKarma: 46 },
        { id: "u_103", name: "support_mod", commentKarma: 302, linkKarma: 190 },
        { id: "u_104", name: "mod_support", commentKarma: 255, linkKarma: 210 },
      ],
      savedThingIds: new Set(),
      hiddenThingIds: new Set(),
      removedThingIds: new Set(),
      lockedThingIds: new Set(),
      nsfwThingIds: new Set(),
      spoilerThingIds: new Set(),
      distinguishedThingIds: new Set(),
      stickyByThingId: new Map(),
      flairByThingId: new Map(),
      subscribedSubreddits: new Set(["support"]),
      reportedReasonsByThing: new Map(),
      voteDirectionsByThing: new Map(),
      modLogEntries: [],
      subredditRulesByName: new Map(
        Object.entries(seedRedditSubredditRules()).map(([name, rules]) => [name, rules]),
      ),
      modmailConversations: seedRedditModmailConversations(),
      postCount: 0,
      commentCount: 0,
      messageCount: 0,
      modmailMessageCount: 0,
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

  private assertSubreddit(state: RedditNamespaceState, value: string): string {
    const subreddit = normalizeSubreddit(value);
    if (subreddit !== "all" && !VALID_SUBREDDIT.test(subreddit)) {
      throw new Error("invalid_subreddit");
    }

    const known = new Set<string>();
    for (const post of state.posts) {
      const name = normalizeSubreddit(post.subreddit);
      if (name !== "all") {
        known.add(name);
      }
    }
    for (const subredditInfo of state.subreddits) {
      known.add(normalizeSubreddit(subredditInfo.name));
    }

    if (subreddit !== "all" && !known.has(subreddit)) {
      throw new Error("subreddit_not_found");
    }

    return subreddit;
  }

  private pagePosts(posts: RedditPost[], limit: number, cursor?: string): RedditPost[] {
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

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const subreddit = this.assertSubreddit(state, args.subreddit);
        const sorted =
          mode === "new"
            ? sortedByCreatedDesc(state.posts)
            : mode === "rising"
              ? sortedByCreatedDesc(state.posts).sort((left, right) => {
                  const leftScore = typeof left.score === "number" ? left.score : 0;
                  const rightScore = typeof right.score === "number" ? right.score : 0;
                  if (rightScore !== leftScore) {
                    return rightScore - leftScore;
                  }
                  return right.id.localeCompare(left.id);
                })
              : mode === "controversial"
                ? [...state.posts].sort((left, right) => {
                    const leftScore = Math.abs(typeof left.score === "number" ? left.score : 0);
                    const rightScore = Math.abs(typeof right.score === "number" ? right.score : 0);
                    if (leftScore !== rightScore) {
                      return leftScore - rightScore;
                    }
                    return right.id.localeCompare(left.id);
                  })
                : sortedByScoreDesc(state.posts);
        const filtered = sorted.filter((post) => {
          if (state.hiddenThingIds.has(post.id)) {
            return false;
          }
          const postSubreddit = normalizeSubreddit(post.subreddit);
          return subreddit === "all" || postSubreddit === subreddit || postSubreddit === "all";
        });

        const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
        return this.pagePosts(filtered, limit, args.cursor);
      },
    });
  }

  private async listMessagesMode(
    method: string,
    args: RedditListMessagesArgs,
    mode: "inbox" | "unread" | "sent" | "mentions",
  ): Promise<RedditMessage[]> {
    const normalizedArgs = {
      namespace: args.namespace,
      limit: args.limit,
    };

    return this.runRedditOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      execute: (state) => {
        const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
        const meName = state.me.name.toLowerCase();
        const source =
          mode === "unread"
            ? state.messages.filter((entry) => entry.unread && entry.to.toLowerCase() === meName)
            : mode === "sent"
              ? state.messages.filter((entry) => entry.from.toLowerCase() === meName)
              : mode === "mentions"
                ? state.messages.filter((entry) => {
                    const combined = `${entry.subject} ${entry.body}`.toLowerCase();
                    return combined.includes(`u/${meName}`) || combined.includes(`@${meName}`);
                  })
                : state.messages.filter((entry) => entry.to.toLowerCase() === meName);
        return source.slice(0, limit);
      },
    });
  }

  private assertThingExists(state: RedditNamespaceState, thingId: string): void {
    const hasPost = state.posts.some((entry) => entry.id === thingId);
    const hasComment = state.comments.some((entry) => entry.id === thingId);
    if (!hasPost && !hasComment) {
      throw new Error("not_found");
    }
  }

  private async performThingAction(
    method: string,
    args: RedditThingActionArgs,
    operation:
      | "delete"
      | "approve"
      | "remove"
      | "lock"
      | "unlock"
      | "markNsfw"
      | "unmarkNsfw"
      | "spoiler"
      | "unspoiler"
      | "save"
      | "unsave"
      | "hide"
      | "unhide",
  ): Promise<RedditThingActionResponse> {
    const normalizedArgs = {
      namespace: args.namespace,
      thingId: args.thingId,
    };

    return this.runRedditMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      args: normalizedArgs,
      idempotencyKey: args.idempotencyKey,
      execute: (state) => {
        const thingId = args.thingId.trim();
        if (!thingId) {
          throw new Error("missing_thing_id");
        }
        this.assertThingExists(state, thingId);

        if (operation === "delete") {
          state.posts = state.posts.filter((entry) => entry.id !== thingId);
          state.comments = state.comments.filter((entry) => entry.id !== thingId);
          state.savedThingIds.delete(thingId);
          state.hiddenThingIds.delete(thingId);
          state.removedThingIds.delete(thingId);
          state.lockedThingIds.delete(thingId);
          state.nsfwThingIds.delete(thingId);
          state.spoilerThingIds.delete(thingId);
          state.stickyByThingId.delete(thingId);
          state.distinguishedThingIds.delete(thingId);
          state.flairByThingId.delete(thingId);
          this.appendModLog(state, "delete", thingId);
        } else if (operation === "approve") {
          state.removedThingIds.delete(thingId);
          this.appendModLog(state, "approve", thingId);
        } else if (operation === "remove") {
          state.removedThingIds.add(thingId);
          this.appendModLog(state, "remove", thingId);
        } else if (operation === "lock") {
          state.lockedThingIds.add(thingId);
          this.appendModLog(state, "lock", thingId);
        } else if (operation === "unlock") {
          state.lockedThingIds.delete(thingId);
          this.appendModLog(state, "unlock", thingId);
        } else if (operation === "markNsfw") {
          state.nsfwThingIds.add(thingId);
          this.appendModLog(state, "mark_nsfw", thingId);
        } else if (operation === "unmarkNsfw") {
          state.nsfwThingIds.delete(thingId);
          this.appendModLog(state, "unmark_nsfw", thingId);
        } else if (operation === "spoiler") {
          state.spoilerThingIds.add(thingId);
          this.appendModLog(state, "spoiler", thingId);
        } else if (operation === "unspoiler") {
          state.spoilerThingIds.delete(thingId);
          this.appendModLog(state, "unspoiler", thingId);
        } else if (operation === "save") {
          state.savedThingIds.add(thingId);
        } else if (operation === "unsave") {
          state.savedThingIds.delete(thingId);
        } else if (operation === "hide") {
          state.hiddenThingIds.add(thingId);
        } else if (operation === "unhide") {
          state.hiddenThingIds.delete(thingId);
        }

        const response: RedditThingActionResponse = {
          thingId,
          success: true,
        };
        return response;
      },
    });
  }

  private runRedditOperation<TResult>(options: {
    namespace?: string | undefined;
    accessToken: string;
    method: string;
    args: unknown;
    idempotencyKey?: string | undefined;
    execute: (state: RedditNamespaceState) => Promise<TResult> | TResult;
  }): Promise<TResult> {
    return this.runProviderOperation({
      namespace: options.namespace,
      method: options.method,
      args: options.args,
      accessToken: options.accessToken,
      assertToken: (accessToken) => this.assertToken(accessToken),
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      mapError: toProviderSdkError,
      before: (state) => {
        this.applyFailureFlags(state);
        this.enforceRateLimit(state);
      },
      execute: options.execute,
    });
  }

  private runRedditMutation<TResult>(options: {
    namespace?: string | undefined;
    accessToken: string;
    method: string;
    args: unknown;
    idempotencyKey?: string | undefined;
    execute: (state: RedditNamespaceState) => Promise<TResult> | TResult;
  }): Promise<TResult> {
    return this.runProviderIdempotentOperation({
      namespace: options.namespace,
      method: options.method,
      args: options.args,
      accessToken: options.accessToken,
      idempotencyKey: options.idempotencyKey,
      assertToken: (accessToken) => this.assertToken(accessToken),
      mapError: toProviderSdkError,
      before: (state) => {
        this.applyFailureFlags(state);
        this.enforceRateLimit(state);
      },
      getResponses: (state) => state.idempotentResponses,
      execute: async (state) => {
        return await options.execute(state);
      },
    });
  }

  private getReportCountMap(state: RedditNamespaceState): Map<string, number> {
    const reportMap = new Map<string, number>();
    for (const thingId of state.reportedReasonsByThing.keys()) {
      reportMap.set(thingId, (reportMap.get(thingId) ?? 0) + 1);
    }
    return reportMap;
  }

  private appendModLog(
    state: RedditNamespaceState,
    action: string,
    targetThingId?: string,
    details?: string,
  ): void {
    const entry: RedditModLogEntry = {
      id: `modlog_${1000 + state.modLogEntries.length + 1}`,
      action,
      moderator: state.me.name,
      createdUtc: Math.trunc(Date.now() / 1000),
      ...(targetThingId ? { targetThingId } : {}),
      ...(details ? { details } : {}),
    };
    state.modLogEntries.unshift(entry);
  }

  private enforceRateLimit(state: RedditNamespaceState): void {
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

  private applyFailureFlags(state: RedditNamespaceState): void {
    if (state.forceRateLimit) {
      throw new Error("rate_limited");
    }
    if (state.forceTimeout) {
      throw new Error("gateway_timeout");
    }
  }
}

export class FakeRedditClientStore {
  private readonly engine: InMemoryRedditEngine;

  readonly createClient: CreateRedditClient;

  constructor(options?: { callLog?: ProviderSdkCallLog }) {
    this.engine = new InMemoryRedditEngine(options);
    this.createClient = (accessToken: string, namespace?: string): RedditClient => {
      return createFakeRedditClient(this.engine, accessToken, namespace);
    };
  }

  reset(namespace?: string): void {
    this.engine.reset(namespace);
  }

  seed(namespace: string, seedData: Record<string, unknown>): void {
    this.engine.seed(namespace, seedData);
  }
}

export const createFakeRedditClientStore = (options?: {
  callLog?: ProviderSdkCallLog;
}): FakeRedditClientStore => {
  return new FakeRedditClientStore(options);
};
