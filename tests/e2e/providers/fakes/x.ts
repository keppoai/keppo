import {
  createFakeXClientStore,
  createFakeXSdk,
  type FakeXClientStore,
} from "../../../../packages/shared/src/provider-sdk/x/fake.js";
import { BaseProviderFake } from "../base-fake";
import type { ProviderReadRequest, ProviderWriteRequest } from "../contract/provider-contract";

const defaultFakeToken = (): string =>
  process.env.KEPPO_FAKE_X_ACCESS_TOKEN ?? "fake_x_access_token";

const parseBody = (input: unknown): Record<string, unknown> => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string" && input.trim().length > 0) {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return Object.fromEntries(new URLSearchParams(input).entries());
    }
  }
  return {};
};

const toLimit = (value: string | undefined, fallback = 20): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
};

const parsePostIds = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const parseUsernames = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim().replace(/^@+/, ""))
    .filter((entry) => entry.length > 0);
};

export class XFake extends BaseProviderFake {
  private readonly clientStore: FakeXClientStore = createFakeXClientStore();
  private readonly sdk = createFakeXSdk({ clientStore: this.clientStore });

  override async listResources(request: ProviderReadRequest): Promise<Record<string, unknown>> {
    if (request.resource === "posts") {
      const limit = toLimit(request.query.limit);
      const cursor = request.query.after ?? request.query.next_token ?? request.query.cursor ?? "";
      const posts = await this.sdk.searchRecentPosts({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        query: request.query.q ?? request.query.query ?? "",
        maxResults: limit,
        ...(cursor ? { cursor } : {}),
      });
      const nextCursor = posts.length >= Math.max(1, limit) ? posts[posts.length - 1]?.id : null;
      return {
        data: posts,
        meta: nextCursor ? { next_token: nextCursor } : {},
        next_cursor: nextCursor,
      };
    }

    if (request.resource === "posts/get") {
      return {
        post: await this.sdk.getPost({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          postId: request.query.postId ?? "",
        }),
      };
    }

    if (request.resource === "posts/lookup") {
      return {
        posts: await this.sdk.getPosts({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          postIds: parsePostIds(request.query.postIds),
        }),
      };
    }

    if (request.resource === "lists/get") {
      return {
        list: await this.sdk.getList({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          listId: request.query.listId ?? "",
        }),
      };
    }

    if (request.resource === "lists/owned") {
      return {
        lists: await this.sdk.getOwnedLists({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          userId: request.query.userId ?? "",
          maxResults: toLimit(request.query.limit),
          ...(request.query.after ? { cursor: request.query.after } : {}),
        }),
      };
    }

    if (request.resource === "lists/members") {
      return {
        users: await this.sdk.getListMembers({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          listId: request.query.listId ?? "",
          maxResults: toLimit(request.query.limit),
          ...(request.query.after ? { cursor: request.query.after } : {}),
        }),
      };
    }

    if (request.resource === "lists/tweets") {
      const limit = toLimit(request.query.limit);
      const posts = await this.sdk.getListTweets({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        listId: request.query.listId ?? "",
        maxResults: limit,
        ...(request.query.after ? { cursor: request.query.after } : {}),
      });
      const nextCursor = posts.length >= Math.max(1, limit) ? posts[posts.length - 1]?.id : null;
      return {
        data: posts,
        meta: nextCursor ? { next_token: nextCursor } : {},
        next_cursor: nextCursor,
      };
    }

    if (request.resource === "posts/all") {
      const limit = toLimit(request.query.limit);
      const cursor = request.query.after ?? request.query.next_token ?? "";
      const posts = await this.sdk.searchAllPosts({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        query: request.query.q ?? request.query.query ?? "",
        maxResults: limit,
        ...(cursor ? { cursor } : {}),
      });
      const nextCursor = posts.length >= Math.max(1, limit) ? posts[posts.length - 1]?.id : null;
      return {
        data: posts,
        meta: nextCursor ? { next_token: nextCursor } : {},
        next_cursor: nextCursor,
      };
    }

    if (request.resource === "posts/home-timeline") {
      const limit = toLimit(request.query.limit);
      const posts = await this.sdk.getHomeTimeline({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: request.query.userId ?? "",
        maxResults: limit,
        ...(request.query.after ? { cursor: request.query.after } : {}),
      });
      const nextCursor = posts.length >= Math.max(1, limit) ? posts[posts.length - 1]?.id : null;
      return {
        data: posts,
        meta: nextCursor ? { next_token: nextCursor } : {},
        next_cursor: nextCursor,
      };
    }

    if (request.resource === "posts/counts") {
      return {
        counts: await this.sdk.getPostCounts({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          query: request.query.query ?? "",
        }),
      };
    }

    if (request.resource === "users/timeline") {
      const limit = toLimit(request.query.limit);
      const cursor = request.query.after ?? request.query.cursor ?? "";
      const posts = await this.sdk.getUserTimeline({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: request.query.userId ?? "",
        maxResults: limit,
        ...(cursor ? { cursor } : {}),
      });
      const nextCursor = posts.length >= Math.max(1, limit) ? posts[posts.length - 1]?.id : null;
      return {
        data: posts,
        meta: nextCursor ? { next_token: nextCursor } : {},
        next_cursor: nextCursor,
      };
    }

    if (request.resource === "users/mentions") {
      const limit = toLimit(request.query.limit);
      const cursor = request.query.after ?? request.query.cursor ?? "";
      const posts = await this.sdk.getUserMentions({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: request.query.userId ?? "",
        maxResults: limit,
        ...(cursor ? { cursor } : {}),
      });
      const nextCursor = posts.length >= Math.max(1, limit) ? posts[posts.length - 1]?.id : null;
      return {
        data: posts,
        meta: nextCursor ? { next_token: nextCursor } : {},
        next_cursor: nextCursor,
      };
    }

    if (request.resource === "posts/quote-tweets") {
      const limit = toLimit(request.query.limit);
      const posts = await this.sdk.getQuoteTweets({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        postId: request.query.postId ?? "",
        maxResults: limit,
      });
      const nextCursor = posts.length >= Math.max(1, limit) ? posts[posts.length - 1]?.id : null;
      return {
        data: posts,
        meta: nextCursor ? { next_token: nextCursor } : {},
        next_cursor: nextCursor,
      };
    }

    if (request.resource === "users/followers") {
      return {
        users: await this.sdk.getFollowers({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          userId: request.query.userId ?? "",
          maxResults: toLimit(request.query.limit),
          ...(request.query.after ? { cursor: request.query.after } : {}),
        }),
      };
    }

    if (request.resource === "users/following") {
      return {
        users: await this.sdk.getFollowing({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          userId: request.query.userId ?? "",
          maxResults: toLimit(request.query.limit),
          ...(request.query.after ? { cursor: request.query.after } : {}),
        }),
      };
    }

    if (request.resource === "users/liking") {
      return {
        users: await this.sdk.getLikingUsers({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          postId: request.query.postId ?? "",
          maxResults: toLimit(request.query.limit),
          ...(request.query.after ? { cursor: request.query.after } : {}),
        }),
      };
    }

    if (request.resource === "posts/liked") {
      const limit = toLimit(request.query.limit);
      const posts = await this.sdk.getLikedPosts({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: request.query.userId ?? "",
        maxResults: limit,
        ...(request.query.after ? { cursor: request.query.after } : {}),
      });
      const nextCursor = posts.length >= Math.max(1, limit) ? posts[posts.length - 1]?.id : null;
      return {
        data: posts,
        meta: nextCursor ? { next_token: nextCursor } : {},
        next_cursor: nextCursor,
      };
    }

    if (request.resource === "users/reposted-by") {
      return {
        users: await this.sdk.getRepostedBy({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          postId: request.query.postId ?? "",
          maxResults: toLimit(request.query.limit),
          ...(request.query.after ? { cursor: request.query.after } : {}),
        }),
      };
    }

    if (request.resource === "users/blocked") {
      return {
        users: await this.sdk.getBlockedUsers({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          userId: request.query.userId ?? "",
          maxResults: toLimit(request.query.limit),
          ...(request.query.after ? { cursor: request.query.after } : {}),
        }),
      };
    }

    if (request.resource === "users/muted") {
      return {
        users: await this.sdk.getMutedUsers({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          userId: request.query.userId ?? "",
          maxResults: toLimit(request.query.limit),
          ...(request.query.after ? { cursor: request.query.after } : {}),
        }),
      };
    }

    if (request.resource === "posts/bookmarks") {
      const limit = toLimit(request.query.limit);
      const posts = await this.sdk.getBookmarks({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: request.query.userId ?? "",
        maxResults: limit,
        ...(request.query.after ? { cursor: request.query.after } : {}),
      });
      const nextCursor = posts.length >= Math.max(1, limit) ? posts[posts.length - 1]?.id : null;
      return {
        data: posts,
        meta: nextCursor ? { next_token: nextCursor } : {},
        next_cursor: nextCursor,
      };
    }

    if (request.resource === "users/by-username") {
      return {
        user: await this.sdk.getUserByUsername({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          username: request.query.username ?? "",
        }),
      };
    }

    if (request.resource === "users/by-id") {
      return {
        user: await this.sdk.getUserById({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          userId: request.query.userId ?? "",
        }),
      };
    }

    if (request.resource === "users/search") {
      return {
        users: await this.sdk.searchUsers({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          query: request.query.query ?? "",
          maxResults: toLimit(request.query.limit),
          ...(request.query.after ? { cursor: request.query.after } : {}),
        }),
      };
    }

    if (request.resource === "users/by-usernames") {
      return {
        users: await this.sdk.getUsersByUsernames({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          usernames: parseUsernames(request.query.usernames),
        }),
      };
    }

    if (request.resource === "users/me") {
      return {
        me: await this.sdk.getMe({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
        }),
      };
    }

    if (request.resource === "dm/events") {
      return {
        events: await this.sdk.getDmEvents({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          ...(request.query.conversationId ? { conversationId: request.query.conversationId } : {}),
          maxResults: toLimit(request.query.limit),
        }),
      };
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override async writeResource(request: ProviderWriteRequest): Promise<Record<string, unknown>> {
    const payload = parseBody(request.body);
    const idempotencyKey =
      request.headers.get("x-idempotency-key") ??
      request.headers.get("Idempotency-Key") ??
      undefined;

    if (request.resource === "posts") {
      return {
        data: await this.sdk.createPost({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          text: String(payload.body ?? payload.text ?? ""),
          idempotencyKey,
        }),
      };
    }

    if (request.resource === "posts/delete") {
      return await this.sdk.deletePost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        postId: String(payload.postId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "lists/create") {
      return {
        list: await this.sdk.createList({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          name: String(payload.name ?? ""),
          ...(typeof payload.description === "string" ? { description: payload.description } : {}),
          ...(typeof payload.isPrivate === "boolean"
            ? { isPrivate: payload.isPrivate }
            : typeof payload.private === "boolean"
              ? { isPrivate: payload.private }
              : {}),
          idempotencyKey,
        }),
      };
    }

    if (request.resource === "lists/delete") {
      return await this.sdk.deleteList({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        listId: String(payload.listId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "lists/update") {
      return {
        list: await this.sdk.updateList({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          listId: String(payload.listId ?? payload.id ?? ""),
          ...(typeof payload.name === "string" ? { name: payload.name } : {}),
          ...(typeof payload.description === "string" ? { description: payload.description } : {}),
          ...(typeof payload.isPrivate === "boolean"
            ? { isPrivate: payload.isPrivate }
            : typeof payload.private === "boolean"
              ? { isPrivate: payload.private }
              : {}),
          idempotencyKey,
        }),
      };
    }

    if (request.resource === "lists/members/add") {
      return await this.sdk.addListMember({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        listId: String(payload.listId ?? payload.id ?? ""),
        userId: String(payload.userId ?? payload.user_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "lists/members/remove") {
      return await this.sdk.removeListMember({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        listId: String(payload.listId ?? payload.id ?? ""),
        userId: String(payload.userId ?? payload.user_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "likes/create") {
      return await this.sdk.likePost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: String(payload.userId ?? payload.user_id ?? ""),
        postId: String(payload.postId ?? payload.tweet_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "likes/delete") {
      return await this.sdk.unlikePost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: String(payload.userId ?? payload.user_id ?? ""),
        postId: String(payload.postId ?? payload.tweet_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "reposts/create") {
      return await this.sdk.repost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: String(payload.userId ?? payload.user_id ?? ""),
        postId: String(payload.postId ?? payload.tweet_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "reposts/delete") {
      return await this.sdk.undoRepost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: String(payload.userId ?? payload.user_id ?? ""),
        postId: String(payload.postId ?? payload.tweet_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "follows/create") {
      return await this.sdk.followUser({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: String(payload.userId ?? payload.user_id ?? ""),
        targetUserId: String(payload.targetUserId ?? payload.target_user_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "follows/delete") {
      return await this.sdk.unfollowUser({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: String(payload.userId ?? payload.user_id ?? ""),
        targetUserId: String(payload.targetUserId ?? payload.target_user_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "blocks/create") {
      return await this.sdk.blockUser({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: String(payload.userId ?? payload.user_id ?? ""),
        targetUserId: String(payload.targetUserId ?? payload.target_user_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "blocks/delete") {
      return await this.sdk.unblockUser({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: String(payload.userId ?? payload.user_id ?? ""),
        targetUserId: String(payload.targetUserId ?? payload.target_user_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "mutes/create") {
      return await this.sdk.muteUser({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: String(payload.userId ?? payload.user_id ?? ""),
        targetUserId: String(payload.targetUserId ?? payload.target_user_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "mutes/delete") {
      return await this.sdk.unmuteUser({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: String(payload.userId ?? payload.user_id ?? ""),
        targetUserId: String(payload.targetUserId ?? payload.target_user_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "bookmarks/create") {
      return await this.sdk.createBookmark({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: String(payload.userId ?? payload.user_id ?? ""),
        postId: String(payload.postId ?? payload.tweet_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "bookmarks/delete") {
      return await this.sdk.deleteBookmark({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userId: String(payload.userId ?? payload.user_id ?? ""),
        postId: String(payload.postId ?? payload.tweet_id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "dm/send") {
      return {
        event: await this.sdk.sendDm({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          conversationId: String(payload.conversationId ?? payload.dm_conversation_id ?? ""),
          text: String(payload.text ?? payload.message ?? ""),
          idempotencyKey,
        }),
      };
    }

    if (request.resource === "dm/conversations/create") {
      return await this.sdk.createDmConversation({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        participantIds: Array.isArray(payload.participantIds)
          ? payload.participantIds.map((entry) => String(entry))
          : Array.isArray(payload.participant_ids)
            ? payload.participant_ids.map((entry) => String(entry))
            : [],
        ...(typeof payload.text === "string" ? { text: payload.text } : {}),
        idempotencyKey,
      });
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override reset(namespace?: string): void {
    super.reset(namespace);
    this.clientStore.reset(namespace);
  }

  override seed(namespace: string, seedData: Record<string, unknown>): void {
    super.seed(namespace, seedData);
    this.clientStore.seed(namespace, seedData);
  }

  getSdkCalls(namespace?: string): Array<Record<string, unknown>> {
    return this.sdk.callLog.list(namespace);
  }
}
