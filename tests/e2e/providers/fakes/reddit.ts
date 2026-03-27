import {
  createFakeRedditClientStore,
  createFakeRedditSdk,
  type FakeRedditClientStore,
} from "../../../../packages/shared/src/provider-sdk/reddit/fake.js";
import { BaseProviderFake } from "../base-fake";
import type { ProviderReadRequest, ProviderWriteRequest } from "../contract/provider-contract";

const defaultFakeToken = (): string =>
  process.env.KEPPO_FAKE_REDDIT_ACCESS_TOKEN ?? "fake_reddit_access_token";

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

const parseThingIds = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

export class RedditFake extends BaseProviderFake {
  private readonly clientStore: FakeRedditClientStore = createFakeRedditClientStore();
  private readonly sdk = createFakeRedditSdk({ clientStore: this.clientStore });

  override async getProfile(namespace: string): Promise<Record<string, unknown>> {
    return await this.sdk.getMe({
      accessToken: defaultFakeToken(),
      namespace,
    });
  }

  override async listResources(request: ProviderReadRequest): Promise<Record<string, unknown>> {
    const limit = toLimit(request.query.limit);

    if (request.resource === "posts") {
      const cursor = request.query.after ?? request.query.cursor ?? "";
      const posts = await this.sdk.searchPosts({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        subreddit: request.query.subreddit ?? "all",
        query: request.query.q ?? "",
        limit,
        ...(cursor ? { cursor } : {}),
      });
      return {
        posts,
        next_cursor:
          posts.length >= Math.max(1, limit) ? (posts[posts.length - 1]?.id ?? null) : null,
      };
    }

    if (request.resource === "posts-hot") {
      const cursor = request.query.after ?? request.query.cursor ?? "";
      const posts = await this.sdk.listHot({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        subreddit: request.query.subreddit ?? "all",
        limit,
        ...(cursor ? { cursor } : {}),
      });
      return {
        posts,
        next_cursor:
          posts.length >= Math.max(1, limit) ? (posts[posts.length - 1]?.id ?? null) : null,
      };
    }

    if (request.resource === "posts-new") {
      const cursor = request.query.after ?? request.query.cursor ?? "";
      const posts = await this.sdk.listNew({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        subreddit: request.query.subreddit ?? "all",
        limit,
        ...(cursor ? { cursor } : {}),
      });
      return {
        posts,
        next_cursor:
          posts.length >= Math.max(1, limit) ? (posts[posts.length - 1]?.id ?? null) : null,
      };
    }

    if (request.resource === "posts-top") {
      const cursor = request.query.after ?? request.query.cursor ?? "";
      const posts = await this.sdk.listTop({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        subreddit: request.query.subreddit ?? "all",
        limit,
        ...(cursor ? { cursor } : {}),
      });
      return {
        posts,
        next_cursor:
          posts.length >= Math.max(1, limit) ? (posts[posts.length - 1]?.id ?? null) : null,
      };
    }

    if (request.resource === "posts-rising") {
      const cursor = request.query.after ?? request.query.cursor ?? "";
      const posts = await this.sdk.listRising({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        subreddit: request.query.subreddit ?? "all",
        limit,
        ...(cursor ? { cursor } : {}),
      });
      return {
        posts,
        next_cursor:
          posts.length >= Math.max(1, limit) ? (posts[posts.length - 1]?.id ?? null) : null,
      };
    }

    if (request.resource === "posts-controversial") {
      const cursor = request.query.after ?? request.query.cursor ?? "";
      const posts = await this.sdk.listControversial({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        subreddit: request.query.subreddit ?? "all",
        limit,
        ...(cursor ? { cursor } : {}),
      });
      return {
        posts,
        next_cursor:
          posts.length >= Math.max(1, limit) ? (posts[posts.length - 1]?.id ?? null) : null,
      };
    }

    if (request.resource === "subreddits-search") {
      const cursor = request.query.after ?? request.query.cursor ?? "";
      const subreddits = await this.sdk.searchSubreddits({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        query: request.query.q ?? "",
        limit,
        ...(cursor ? { cursor } : {}),
      });
      return {
        subreddits,
        next_cursor:
          subreddits.length >= Math.max(1, limit)
            ? (subreddits[subreddits.length - 1]?.name ?? null)
            : null,
      };
    }

    if (request.resource === "user-overview") {
      return await this.sdk.getUserOverview({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        username: request.query.username ?? "",
        limit,
      });
    }

    if (request.resource === "post-comments") {
      const subreddit = request.query.subreddit ?? "all";
      const postId = request.query.postId ?? request.query.id ?? "";
      return await this.sdk.getPostComments({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        subreddit,
        postId,
        limit,
      });
    }

    if (request.resource === "info") {
      const thingIds = parseThingIds(request.query.thingIds ?? request.query.id);
      return {
        items: await this.sdk.getInfo({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          thingIds,
        }),
      };
    }

    if (request.resource === "messages-inbox") {
      return {
        messages: await this.sdk.listInbox({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          limit,
        }),
      };
    }

    if (request.resource === "messages-unread") {
      return {
        messages: await this.sdk.listUnreadMessages({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          limit,
        }),
      };
    }

    if (request.resource === "messages-sent") {
      return {
        messages: await this.sdk.listSentMessages({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          limit,
        }),
      };
    }

    if (request.resource === "messages-mentions") {
      return {
        messages: await this.sdk.listMentions({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          limit,
        }),
      };
    }

    if (request.resource === "subreddit-info") {
      const subreddit = request.query.subreddit ?? "all";
      return {
        subreddit: await this.sdk.getSubredditInfo({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          subreddit,
        }),
      };
    }

    if (request.resource === "modqueue") {
      return {
        items: await this.sdk.getModQueue({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          subreddit: request.query.subreddit ?? "all",
          limit,
          ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
        }),
      };
    }

    if (request.resource === "reports") {
      return {
        items: await this.sdk.getReports({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          subreddit: request.query.subreddit ?? "all",
          limit,
          ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
        }),
      };
    }

    if (request.resource === "modlog") {
      return {
        entries: await this.sdk.getModLog({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          subreddit: request.query.subreddit ?? "all",
          limit,
          ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
        }),
      };
    }

    if (request.resource === "modmail") {
      return {
        conversations: await this.sdk.listModmail({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          subreddit: request.query.subreddit ?? "all",
          limit,
          ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
        }),
      };
    }

    if (request.resource === "me") {
      return {
        me: await this.sdk.getMe({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
        }),
      };
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override async readResource(request: ProviderReadRequest): Promise<Record<string, unknown>> {
    if (request.resource === "user-about") {
      const username = request.query.username ?? "";
      return {
        user: await this.sdk.getUserAbout({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          username,
        }),
      };
    }

    if (request.resource === "subreddit-rules") {
      const subreddit = request.query.subreddit ?? "all";
      return {
        rules: await this.sdk.getSubredditRules({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          subreddit,
        }),
      };
    }

    if (request.resource.startsWith("modmail/")) {
      const conversationId = request.resource.replace("modmail/", "");
      return {
        conversation: await this.sdk.getModmail({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          conversationId,
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
      return await this.sdk.createPost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        subreddit: String(payload.subreddit ?? "all"),
        title: String(payload.title ?? ""),
        body: String(payload.body ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "comments") {
      return await this.sdk.createComment({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        parentId: String(payload.parentId ?? payload.parent_id ?? payload.thing_id ?? ""),
        body: String(payload.body ?? payload.text ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "vote") {
      return await this.sdk.vote({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        direction: Number(payload.direction ?? payload.dir ?? 0),
        idempotencyKey,
      });
    }

    if (request.resource === "messages/compose") {
      return await this.sdk.composeMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        to: String(payload.to ?? ""),
        subject: String(payload.subject ?? ""),
        body: String(payload.body ?? payload.text ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "posts-edit") {
      return await this.sdk.editPost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? payload.thing_id ?? ""),
        body: String(payload.body ?? payload.text ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "posts-delete") {
      return await this.sdk.deletePost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "moderation-approve") {
      return await this.sdk.approve({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "moderation-remove") {
      return await this.sdk.removeContent({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "moderation-distinguish") {
      return await this.sdk.distinguish({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        sticky: payload.sticky === true || payload.sticky === "true",
        idempotencyKey,
      });
    }

    if (request.resource === "posts-lock") {
      return await this.sdk.lockPost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "posts-unlock") {
      return await this.sdk.unlockPost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "moderation-sticky") {
      return await this.sdk.stickyPost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        state:
          payload.state === true || payload.state === "true" || payload.state === "1"
            ? true
            : payload.state === false || payload.state === "false" || payload.state === "0"
              ? false
              : true,
        slot: Number(payload.slot ?? payload.num ?? 1),
        idempotencyKey,
      });
    }

    if (request.resource === "posts-mark-nsfw") {
      return await this.sdk.markNsfw({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "posts-unmark-nsfw") {
      return await this.sdk.unmarkNsfw({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "posts-spoiler") {
      return await this.sdk.spoiler({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "posts-unspoiler") {
      return await this.sdk.unspoiler({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "moderation-select-flair") {
      return await this.sdk.selectFlair({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        subreddit: String(payload.subreddit ?? payload.sr ?? "all"),
        thingId: String(payload.thingId ?? payload.id ?? payload.link ?? ""),
        text: String(payload.text ?? ""),
        cssClass: String(payload.cssClass ?? payload.css_class ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "subreddits-subscribe") {
      return await this.sdk.subscribe({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        subreddit: String(payload.subreddit ?? payload.sr_name ?? ""),
        action: String(payload.action ?? "sub") === "unsub" ? "unsub" : "sub",
        idempotencyKey,
      });
    }

    if (request.resource === "posts-save") {
      return await this.sdk.savePost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "posts-unsave") {
      return await this.sdk.unsavePost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "posts-hide") {
      return await this.sdk.hidePost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "posts-unhide") {
      return await this.sdk.unhidePost({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "content-report") {
      return await this.sdk.reportContent({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        thingId: String(payload.thingId ?? payload.id ?? payload.thing_id ?? ""),
        reason: String(payload.reason ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "messages-read") {
      return await this.sdk.readMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        messageId: String(payload.messageId ?? payload.id ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "messages-read-all") {
      return await this.sdk.readAllMessages({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        idempotencyKey,
      });
    }

    if (request.resource === "modmail/reply") {
      return await this.sdk.replyModmail({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        conversationId: String(payload.conversationId ?? ""),
        body: String(payload.body ?? payload.text ?? ""),
        isInternal: payload.isInternal === true || payload.isInternal === "true",
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
