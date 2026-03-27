import { buildProviderIdempotencyKey } from "../../../provider-write-utils.js";
import { redditTools } from "../../../tool-definitions.js";
import { BaseConnector } from "../../../connectors/base-connector.js";
import type { Connector, ConnectorContext, PreparedWrite } from "../../../connectors/base.js";
import { createRealRedditSdk } from "../../../provider-sdk/reddit/real.js";
import type { RedditSdkPort } from "../../../provider-sdk/reddit/types.js";
import {
  createProviderCircuitBreaker,
  wrapObjectWithCircuitBreaker,
} from "../../../circuit-breaker.js";

const requiredScopesByTool: Record<string, string[]> = {
  "reddit.searchPosts": ["reddit.read"],
  "reddit.getPostComments": ["reddit.read"],
  "reddit.getInfo": ["reddit.read"],
  "reddit.listHot": ["reddit.read"],
  "reddit.listNew": ["reddit.read"],
  "reddit.listTop": ["reddit.read"],
  "reddit.listRising": ["reddit.read"],
  "reddit.listControversial": ["reddit.read"],
  "reddit.searchSubreddits": ["reddit.read"],
  "reddit.getUserOverview": ["reddit.read"],
  "reddit.getUserAbout": ["reddit.read"],
  "reddit.listInbox": ["reddit.read"],
  "reddit.listUnreadMessages": ["reddit.read"],
  "reddit.listSentMessages": ["reddit.read"],
  "reddit.listMentions": ["reddit.read"],
  "reddit.getSubredditInfo": ["reddit.read"],
  "reddit.getModQueue": ["reddit.read"],
  "reddit.getReports": ["reddit.read"],
  "reddit.getModLog": ["reddit.read"],
  "reddit.getSubredditRules": ["reddit.read"],
  "reddit.listModmail": ["reddit.read"],
  "reddit.getModmail": ["reddit.read"],
  "reddit.getMe": ["reddit.read"],
  "reddit.createPost": ["reddit.write"],
  "reddit.createComment": ["reddit.write"],
  "reddit.vote": ["reddit.write"],
  "reddit.composeMessage": ["reddit.write"],
  "reddit.editPost": ["reddit.write"],
  "reddit.deletePost": ["reddit.write"],
  "reddit.approve": ["reddit.write"],
  "reddit.removeContent": ["reddit.write"],
  "reddit.distinguish": ["reddit.write"],
  "reddit.lockPost": ["reddit.write"],
  "reddit.unlockPost": ["reddit.write"],
  "reddit.stickyPost": ["reddit.write"],
  "reddit.markNsfw": ["reddit.write"],
  "reddit.unmarkNsfw": ["reddit.write"],
  "reddit.spoiler": ["reddit.write"],
  "reddit.unspoiler": ["reddit.write"],
  "reddit.selectFlair": ["reddit.write"],
  "reddit.subscribe": ["reddit.write"],
  "reddit.savePost": ["reddit.write"],
  "reddit.unsavePost": ["reddit.write"],
  "reddit.hidePost": ["reddit.write"],
  "reddit.unhidePost": ["reddit.write"],
  "reddit.reportContent": ["reddit.write"],
  "reddit.readMessage": ["reddit.write"],
  "reddit.readAllMessages": ["reddit.write"],
  "reddit.replyModmail": ["reddit.write"],
};

const FAKE_REDDIT_ACCESS_TOKEN = process.env.KEPPO_FAKE_REDDIT_ACCESS_TOKEN?.trim();

const assertIntegrationConnected = (context: ConnectorContext): void => {
  const hasAccountId =
    typeof context.integration_account_id === "string" && context.integration_account_id.length > 0;
  const hasToken =
    (typeof context.access_token === "string" && context.access_token.length > 0) ||
    (typeof context.refresh_token === "string" && context.refresh_token.length > 0);

  if (!hasAccountId && !hasToken) {
    throw new Error(`Integration reddit is not connected for workspace ${context.workspaceId}`);
  }
};

const getToken = (context: ConnectorContext): string => {
  if (context.access_token) {
    return context.access_token;
  }
  if (FAKE_REDDIT_ACCESS_TOKEN) {
    return FAKE_REDDIT_ACCESS_TOKEN;
  }
  throw new Error("Reddit access token missing. Reconnect Reddit integration.");
};

const toLimit = (value: unknown, fallback = 20): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
};

const providerCircuitBreaker = createProviderCircuitBreaker("reddit");

type RedditReadToolName =
  | "reddit.searchPosts"
  | "reddit.getPostComments"
  | "reddit.getInfo"
  | "reddit.listHot"
  | "reddit.listNew"
  | "reddit.listTop"
  | "reddit.listRising"
  | "reddit.listControversial"
  | "reddit.searchSubreddits"
  | "reddit.getUserOverview"
  | "reddit.getUserAbout"
  | "reddit.listInbox"
  | "reddit.listUnreadMessages"
  | "reddit.listSentMessages"
  | "reddit.listMentions"
  | "reddit.getSubredditInfo"
  | "reddit.getModQueue"
  | "reddit.getReports"
  | "reddit.getModLog"
  | "reddit.getSubredditRules"
  | "reddit.listModmail"
  | "reddit.getModmail"
  | "reddit.getMe";

type RedditWriteToolName =
  | "reddit.createPost"
  | "reddit.createComment"
  | "reddit.vote"
  | "reddit.composeMessage"
  | "reddit.editPost"
  | "reddit.deletePost"
  | "reddit.approve"
  | "reddit.removeContent"
  | "reddit.distinguish"
  | "reddit.lockPost"
  | "reddit.unlockPost"
  | "reddit.stickyPost"
  | "reddit.markNsfw"
  | "reddit.unmarkNsfw"
  | "reddit.spoiler"
  | "reddit.unspoiler"
  | "reddit.selectFlair"
  | "reddit.subscribe"
  | "reddit.savePost"
  | "reddit.unsavePost"
  | "reddit.hidePost"
  | "reddit.unhidePost"
  | "reddit.reportContent"
  | "reddit.readMessage"
  | "reddit.readAllMessages"
  | "reddit.replyModmail";

type RedditReadDispatchInput = {
  validated: Record<string, unknown>;
  accessToken: string;
  namespace: string | undefined;
};

type RedditPrepareDispatchInput = {
  validated: Record<string, unknown>;
};

type RedditWriteDispatchInput = {
  normalizedPayload: Record<string, unknown>;
  accessToken: string;
  namespace: string | undefined;
};

export const createRedditConnector = (options?: { sdk?: RedditSdkPort }): Connector => {
  const sdk = wrapObjectWithCircuitBreaker(
    options?.sdk ?? createRealRedditSdk(),
    providerCircuitBreaker,
  );

  const readMap: Record<
    RedditReadToolName,
    (payload: RedditReadDispatchInput) => Promise<Record<string, unknown>>
  > = {
    "reddit.searchPosts": async ({ validated, accessToken, namespace }) => {
      const subreddit = String(validated.subreddit ?? "all");
      const query = String(validated.query ?? "");
      const limit = toLimit(validated.limit, 20);
      const posts = await sdk.searchPosts({
        accessToken,
        namespace,
        subreddit,
        query,
        limit,
      });

      return {
        subreddit,
        query,
        posts,
      };
    },
    "reddit.getPostComments": async ({ validated, accessToken, namespace }) => {
      const subreddit = String(validated.subreddit ?? "");
      const postId = String(validated.postId ?? "");
      const limit = toLimit(validated.limit, 20);
      const result = await sdk.getPostComments({
        accessToken,
        namespace,
        subreddit,
        postId,
        limit,
      });

      return {
        subreddit,
        postId,
        post: result.post,
        comments: result.comments,
      };
    },
    "reddit.getInfo": async ({ validated, accessToken, namespace }) => {
      const thingIds = Array.isArray(validated.thingIds)
        ? validated.thingIds.map((entry) => String(entry))
        : [];
      const items = await sdk.getInfo({
        accessToken,
        namespace,
        thingIds,
      });
      return {
        thingIds,
        items,
      };
    },
    "reddit.listHot": async ({ validated, accessToken, namespace }) => {
      const subreddit = String(validated.subreddit ?? "");
      const limit = toLimit(validated.limit, 20);
      const posts = await sdk.listHot({ accessToken, namespace, subreddit, limit });
      return { subreddit, posts };
    },
    "reddit.listNew": async ({ validated, accessToken, namespace }) => {
      const subreddit = String(validated.subreddit ?? "");
      const limit = toLimit(validated.limit, 20);
      const posts = await sdk.listNew({ accessToken, namespace, subreddit, limit });
      return { subreddit, posts };
    },
    "reddit.listTop": async ({ validated, accessToken, namespace }) => {
      const subreddit = String(validated.subreddit ?? "");
      const limit = toLimit(validated.limit, 20);
      const posts = await sdk.listTop({ accessToken, namespace, subreddit, limit });
      return { subreddit, posts };
    },
    "reddit.listRising": async ({ validated, accessToken, namespace }) => {
      const subreddit = String(validated.subreddit ?? "");
      const limit = toLimit(validated.limit, 20);
      const posts = await sdk.listRising({ accessToken, namespace, subreddit, limit });
      return { subreddit, posts };
    },
    "reddit.listControversial": async ({ validated, accessToken, namespace }) => {
      const subreddit = String(validated.subreddit ?? "");
      const limit = toLimit(validated.limit, 20);
      const posts = await sdk.listControversial({
        accessToken,
        namespace,
        subreddit,
        limit,
      });
      return { subreddit, posts };
    },
    "reddit.searchSubreddits": async ({ validated, accessToken, namespace }) => {
      const query = String(validated.query ?? "");
      const limit = toLimit(validated.limit, 20);
      const subreddits = await sdk.searchSubreddits({
        accessToken,
        namespace,
        query,
        limit,
      });
      return { query, subreddits };
    },
    "reddit.getUserOverview": async ({ validated, accessToken, namespace }) => {
      const username = String(validated.username ?? "");
      const limit = toLimit(validated.limit, 20);
      const overview = await sdk.getUserOverview({
        accessToken,
        namespace,
        username,
        limit,
      });
      return overview;
    },
    "reddit.getUserAbout": async ({ validated, accessToken, namespace }) => {
      const username = String(validated.username ?? "");
      const user = await sdk.getUserAbout({
        accessToken,
        namespace,
        username,
      });
      return { user };
    },
    "reddit.listInbox": async ({ validated, accessToken, namespace }) => {
      const limit = toLimit(validated.limit, 20);
      const messages = await sdk.listInbox({ accessToken, namespace, limit });
      return { messages };
    },
    "reddit.listUnreadMessages": async ({ validated, accessToken, namespace }) => {
      const limit = toLimit(validated.limit, 20);
      const messages = await sdk.listUnreadMessages({ accessToken, namespace, limit });
      return { messages };
    },
    "reddit.listSentMessages": async ({ validated, accessToken, namespace }) => {
      const limit = toLimit(validated.limit, 20);
      const messages = await sdk.listSentMessages({ accessToken, namespace, limit });
      return { messages };
    },
    "reddit.listMentions": async ({ validated, accessToken, namespace }) => {
      const limit = toLimit(validated.limit, 20);
      const messages = await sdk.listMentions({ accessToken, namespace, limit });
      return { messages };
    },
    "reddit.getSubredditInfo": async ({ validated, accessToken, namespace }) => {
      const subreddit = await sdk.getSubredditInfo({
        accessToken,
        namespace,
        subreddit: String(validated.subreddit ?? ""),
      });
      return { subreddit };
    },
    "reddit.getModQueue": async ({ validated, accessToken, namespace }) => {
      const subreddit = String(validated.subreddit ?? "");
      const limit = toLimit(validated.limit, 20);
      const items = await sdk.getModQueue({
        accessToken,
        namespace,
        subreddit,
        limit,
      });
      return { subreddit, items };
    },
    "reddit.getReports": async ({ validated, accessToken, namespace }) => {
      const subreddit = String(validated.subreddit ?? "");
      const limit = toLimit(validated.limit, 20);
      const items = await sdk.getReports({
        accessToken,
        namespace,
        subreddit,
        limit,
      });
      return { subreddit, items };
    },
    "reddit.getModLog": async ({ validated, accessToken, namespace }) => {
      const subreddit = String(validated.subreddit ?? "");
      const limit = toLimit(validated.limit, 20);
      const entries = await sdk.getModLog({
        accessToken,
        namespace,
        subreddit,
        limit,
      });
      return { subreddit, entries };
    },
    "reddit.getSubredditRules": async ({ validated, accessToken, namespace }) => {
      const subreddit = String(validated.subreddit ?? "");
      const rules = await sdk.getSubredditRules({
        accessToken,
        namespace,
        subreddit,
      });
      return { subreddit, rules };
    },
    "reddit.listModmail": async ({ validated, accessToken, namespace }) => {
      const subreddit = String(validated.subreddit ?? "all");
      const limit = toLimit(validated.limit, 20);
      const conversations = await sdk.listModmail({
        accessToken,
        namespace,
        subreddit,
        limit,
      });
      return { subreddit, conversations };
    },
    "reddit.getModmail": async ({ validated, accessToken, namespace }) => {
      const conversationId = String(validated.conversationId ?? "");
      const conversation = await sdk.getModmail({
        accessToken,
        namespace,
        conversationId,
      });
      return { conversationId, conversation };
    },
    "reddit.getMe": async ({ accessToken, namespace }) => {
      const me = await sdk.getMe({ accessToken, namespace });
      return { me };
    },
  };

  const prepareMap: Record<
    RedditWriteToolName,
    (payload: RedditPrepareDispatchInput) => Promise<PreparedWrite>
  > = {
    "reddit.createPost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "create_post",
          subreddit: String(validated.subreddit ?? ""),
          title: String(validated.title ?? ""),
          body: String(validated.body ?? ""),
        },
        payload_preview: {
          subreddit: String(validated.subreddit ?? ""),
          title: String(validated.title ?? ""),
          body_preview: String(validated.body ?? "").slice(0, 120),
        },
      };
    },
    "reddit.createComment": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "create_comment",
          parentId: String(validated.parentId ?? ""),
          body: String(validated.body ?? ""),
        },
        payload_preview: {
          parentId: String(validated.parentId ?? ""),
          body_preview: String(validated.body ?? "").slice(0, 120),
        },
      };
    },
    "reddit.vote": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "vote",
          thingId: String(validated.thingId ?? ""),
          direction: Number(validated.direction ?? 0),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
          direction: Number(validated.direction ?? 0),
        },
      };
    },
    "reddit.composeMessage": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "compose_message",
          to: String(validated.to ?? ""),
          subject: String(validated.subject ?? ""),
          body: String(validated.body ?? ""),
        },
        payload_preview: {
          to: String(validated.to ?? ""),
          subject: String(validated.subject ?? ""),
          body_preview: String(validated.body ?? "").slice(0, 120),
        },
      };
    },
    "reddit.editPost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "edit_post",
          thingId: String(validated.thingId ?? ""),
          body: String(validated.body ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
          body_preview: String(validated.body ?? "").slice(0, 120),
        },
      };
    },
    "reddit.deletePost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "delete_post",
          thingId: String(validated.thingId ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
        },
      };
    },
    "reddit.approve": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "approve",
          thingId: String(validated.thingId ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
        },
      };
    },
    "reddit.removeContent": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "remove_content",
          thingId: String(validated.thingId ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
        },
      };
    },
    "reddit.distinguish": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "distinguish",
          thingId: String(validated.thingId ?? ""),
          sticky: validated.sticky === true,
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
          sticky: validated.sticky === true,
        },
      };
    },
    "reddit.lockPost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "lock_post",
          thingId: String(validated.thingId ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
        },
      };
    },
    "reddit.unlockPost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "unlock_post",
          thingId: String(validated.thingId ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
        },
      };
    },
    "reddit.stickyPost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "sticky_post",
          thingId: String(validated.thingId ?? ""),
          state: validated.state !== false,
          slot: Number(validated.slot ?? 1),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
          state: validated.state !== false,
          slot: Number(validated.slot ?? 1),
        },
      };
    },
    "reddit.markNsfw": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "mark_nsfw",
          thingId: String(validated.thingId ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
        },
      };
    },
    "reddit.unmarkNsfw": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "unmark_nsfw",
          thingId: String(validated.thingId ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
        },
      };
    },
    "reddit.spoiler": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "spoiler",
          thingId: String(validated.thingId ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
        },
      };
    },
    "reddit.unspoiler": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "unspoiler",
          thingId: String(validated.thingId ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
        },
      };
    },
    "reddit.selectFlair": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "select_flair",
          subreddit: String(validated.subreddit ?? ""),
          thingId: String(validated.thingId ?? ""),
          text: String(validated.text ?? ""),
          cssClass: String(validated.cssClass ?? ""),
        },
        payload_preview: {
          subreddit: String(validated.subreddit ?? ""),
          thingId: String(validated.thingId ?? ""),
          text: String(validated.text ?? ""),
          cssClass: String(validated.cssClass ?? ""),
        },
      };
    },
    "reddit.subscribe": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "subscribe",
          subreddit: String(validated.subreddit ?? ""),
          action: String(validated.action ?? "sub"),
        },
        payload_preview: {
          subreddit: String(validated.subreddit ?? ""),
          action: String(validated.action ?? "sub"),
        },
      };
    },
    "reddit.savePost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "save_post",
          thingId: String(validated.thingId ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
        },
      };
    },
    "reddit.unsavePost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "unsave_post",
          thingId: String(validated.thingId ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
        },
      };
    },
    "reddit.hidePost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "hide_post",
          thingId: String(validated.thingId ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
        },
      };
    },
    "reddit.unhidePost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "unhide_post",
          thingId: String(validated.thingId ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
        },
      };
    },
    "reddit.reportContent": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "report_content",
          thingId: String(validated.thingId ?? ""),
          reason: String(validated.reason ?? ""),
        },
        payload_preview: {
          thingId: String(validated.thingId ?? ""),
          reason_preview: String(validated.reason ?? "").slice(0, 120),
        },
      };
    },
    "reddit.readMessage": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "read_message",
          messageId: String(validated.messageId ?? ""),
        },
        payload_preview: {
          messageId: String(validated.messageId ?? ""),
        },
      };
    },
    "reddit.readAllMessages": async () => {
      return {
        normalized_payload: {
          type: "read_all_messages",
        },
        payload_preview: {
          action: "read_all_messages",
        },
      };
    },
    "reddit.replyModmail": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "reply_modmail",
          conversationId: String(validated.conversationId ?? ""),
          body: String(validated.body ?? ""),
          isInternal: validated.isInternal === true,
        },
        payload_preview: {
          conversationId: String(validated.conversationId ?? ""),
          body_preview: String(validated.body ?? "").slice(0, 120),
          isInternal: validated.isInternal === true,
        },
      };
    },
  };

  const writeMap: Record<
    RedditWriteToolName,
    (payload: RedditWriteDispatchInput) => Promise<Record<string, unknown>>
  > = {
    "reddit.createPost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.createPost", normalizedPayload);
      const response = await sdk.createPost({
        accessToken,
        namespace,
        subreddit: String(normalizedPayload.subreddit ?? ""),
        title: String(normalizedPayload.title ?? ""),
        body: String(normalizedPayload.body ?? ""),
        idempotencyKey,
      });

      return {
        status: "posted",
        provider_action_id: response.id,
        subreddit: response.subreddit,
        title: response.title,
        ...(response.url ? { url: response.url } : {}),
      };
    },
    "reddit.createComment": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.createComment", normalizedPayload);
      const response = await sdk.createComment({
        accessToken,
        namespace,
        parentId: String(normalizedPayload.parentId ?? ""),
        body: String(normalizedPayload.body ?? ""),
        idempotencyKey,
      });

      return {
        status: "commented",
        provider_action_id: response.id,
        parentId: response.parentId,
      };
    },
    "reddit.vote": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.vote", normalizedPayload);
      const response = await sdk.vote({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        direction: Number(normalizedPayload.direction ?? 0),
        idempotencyKey,
      });

      return {
        status: "voted",
        provider_action_id: response.thingId,
        direction: response.direction,
        score: response.score,
      };
    },
    "reddit.composeMessage": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "reddit.composeMessage",
        normalizedPayload,
      );
      const response = await sdk.composeMessage({
        accessToken,
        namespace,
        to: String(normalizedPayload.to ?? ""),
        subject: String(normalizedPayload.subject ?? ""),
        body: String(normalizedPayload.body ?? ""),
        idempotencyKey,
      });

      return {
        status: "sent",
        provider_action_id: response.id,
        to: response.to,
        subject: response.subject,
      };
    },
    "reddit.editPost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.editPost", normalizedPayload);
      const response = await sdk.editPost({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        body: String(normalizedPayload.body ?? ""),
        idempotencyKey,
      });
      return {
        status: "edited",
        provider_action_id: response.thingId,
        thingId: response.thingId,
        body: response.body,
      };
    },
    "reddit.deletePost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.deletePost", normalizedPayload);
      const response = await sdk.deletePost({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        idempotencyKey,
      });
      return {
        status: "deleted",
        provider_action_id: response.thingId,
        thingId: response.thingId,
      };
    },
    "reddit.approve": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.approve", normalizedPayload);
      const response = await sdk.approve({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        idempotencyKey,
      });
      return {
        status: "approved",
        provider_action_id: response.thingId,
        thingId: response.thingId,
      };
    },
    "reddit.removeContent": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.removeContent", normalizedPayload);
      const response = await sdk.removeContent({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        idempotencyKey,
      });
      return {
        status: "removed",
        provider_action_id: response.thingId,
        thingId: response.thingId,
      };
    },
    "reddit.distinguish": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.distinguish", normalizedPayload);
      const response = await sdk.distinguish({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        sticky: normalizedPayload.sticky === true,
        idempotencyKey,
      });
      return {
        status: "distinguished",
        provider_action_id: response.thingId,
        thingId: response.thingId,
        sticky: response.sticky,
      };
    },
    "reddit.lockPost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.lockPost", normalizedPayload);
      const response = await sdk.lockPost({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        idempotencyKey,
      });
      return {
        status: "locked",
        provider_action_id: response.thingId,
        thingId: response.thingId,
      };
    },
    "reddit.unlockPost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.unlockPost", normalizedPayload);
      const response = await sdk.unlockPost({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        idempotencyKey,
      });
      return {
        status: "unlocked",
        provider_action_id: response.thingId,
        thingId: response.thingId,
      };
    },
    "reddit.stickyPost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.stickyPost", normalizedPayload);
      const response = await sdk.stickyPost({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        state: normalizedPayload.state !== false,
        slot: Number(normalizedPayload.slot ?? 1),
        idempotencyKey,
      });
      return {
        status: response.state ? "stickied" : "unstickied",
        provider_action_id: response.thingId,
        thingId: response.thingId,
        state: response.state,
        slot: response.slot,
      };
    },
    "reddit.markNsfw": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.markNsfw", normalizedPayload);
      const response = await sdk.markNsfw({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        idempotencyKey,
      });
      return {
        status: "nsfw_marked",
        provider_action_id: response.thingId,
        thingId: response.thingId,
      };
    },
    "reddit.unmarkNsfw": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.unmarkNsfw", normalizedPayload);
      const response = await sdk.unmarkNsfw({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        idempotencyKey,
      });
      return {
        status: "nsfw_unmarked",
        provider_action_id: response.thingId,
        thingId: response.thingId,
      };
    },
    "reddit.spoiler": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.spoiler", normalizedPayload);
      const response = await sdk.spoiler({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        idempotencyKey,
      });
      return {
        status: "spoiler_marked",
        provider_action_id: response.thingId,
        thingId: response.thingId,
      };
    },
    "reddit.unspoiler": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.unspoiler", normalizedPayload);
      const response = await sdk.unspoiler({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        idempotencyKey,
      });
      return {
        status: "spoiler_unmarked",
        provider_action_id: response.thingId,
        thingId: response.thingId,
      };
    },
    "reddit.selectFlair": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.selectFlair", normalizedPayload);
      const response = await sdk.selectFlair({
        accessToken,
        namespace,
        subreddit: String(normalizedPayload.subreddit ?? ""),
        thingId: String(normalizedPayload.thingId ?? ""),
        text: String(normalizedPayload.text ?? ""),
        cssClass: String(normalizedPayload.cssClass ?? ""),
        idempotencyKey,
      });
      return {
        status: "flair_selected",
        provider_action_id: response.thingId,
        thingId: response.thingId,
        subreddit: response.subreddit,
        text: response.text,
        ...(response.cssClass ? { cssClass: response.cssClass } : {}),
      };
    },
    "reddit.subscribe": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.subscribe", normalizedPayload);
      const response = await sdk.subscribe({
        accessToken,
        namespace,
        subreddit: String(normalizedPayload.subreddit ?? ""),
        action: String(normalizedPayload.action ?? "sub") === "unsub" ? "unsub" : "sub",
        idempotencyKey,
      });
      return {
        status: response.subscribed ? "subscribed" : "unsubscribed",
        provider_action_id: response.subreddit,
        subreddit: response.subreddit,
        subscribed: response.subscribed,
      };
    },
    "reddit.savePost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.savePost", normalizedPayload);
      const response = await sdk.savePost({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        idempotencyKey,
      });
      return {
        status: "saved",
        provider_action_id: response.thingId,
        thingId: response.thingId,
      };
    },
    "reddit.unsavePost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.unsavePost", normalizedPayload);
      const response = await sdk.unsavePost({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        idempotencyKey,
      });
      return {
        status: "unsaved",
        provider_action_id: response.thingId,
        thingId: response.thingId,
      };
    },
    "reddit.hidePost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.hidePost", normalizedPayload);
      const response = await sdk.hidePost({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        idempotencyKey,
      });
      return {
        status: "hidden",
        provider_action_id: response.thingId,
        thingId: response.thingId,
      };
    },
    "reddit.unhidePost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.unhidePost", normalizedPayload);
      const response = await sdk.unhidePost({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        idempotencyKey,
      });
      return {
        status: "unhidden",
        provider_action_id: response.thingId,
        thingId: response.thingId,
      };
    },
    "reddit.reportContent": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.reportContent", normalizedPayload);
      const response = await sdk.reportContent({
        accessToken,
        namespace,
        thingId: String(normalizedPayload.thingId ?? ""),
        reason: String(normalizedPayload.reason ?? ""),
        idempotencyKey,
      });
      return {
        status: "reported",
        provider_action_id: response.thingId,
        thingId: response.thingId,
        reason: response.reason,
      };
    },
    "reddit.readMessage": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.readMessage", normalizedPayload);
      const response = await sdk.readMessage({
        accessToken,
        namespace,
        messageId: String(normalizedPayload.messageId ?? ""),
        idempotencyKey,
      });
      return {
        status: "read",
        provider_action_id: response.messageId,
        messageId: response.messageId,
        unread: response.unread,
      };
    },
    "reddit.readAllMessages": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "reddit.readAllMessages",
        normalizedPayload,
      );
      const response = await sdk.readAllMessages({
        accessToken,
        namespace,
        idempotencyKey,
      });
      return {
        status: "read_all",
        provider_action_id: "all_messages",
        readCount: response.readCount,
      };
    },
    "reddit.replyModmail": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("reddit.replyModmail", normalizedPayload);
      const response = await sdk.replyModmail({
        accessToken,
        namespace,
        conversationId: String(normalizedPayload.conversationId ?? ""),
        body: String(normalizedPayload.body ?? ""),
        isInternal: normalizedPayload.isInternal === true,
        idempotencyKey,
      });
      return {
        status: "replied",
        provider_action_id: response.messageId,
        conversationId: response.conversationId,
        messageId: response.messageId,
        isInternal: response.isInternal,
      };
    },
  };

  class RedditConnector extends BaseConnector<
    RedditReadDispatchInput,
    RedditPrepareDispatchInput,
    RedditWriteDispatchInput,
    typeof redditTools
  > {
    constructor() {
      super({
        provider: "reddit",
        tools: redditTools,
        requiredScopesByTool,
        readMap,
        prepareMap,
        writeMap,
      });
    }

    protected getToken(context: ConnectorContext): string {
      return getToken(context);
    }

    protected override async beforeRead(
      _toolName: string,
      _validated: Record<string, unknown>,
      context: ConnectorContext,
    ): Promise<void> {
      assertIntegrationConnected(context);
    }

    protected override async beforePrepareWrite(
      _toolName: string,
      _validated: Record<string, unknown>,
      context: ConnectorContext,
    ): Promise<void> {
      assertIntegrationConnected(context);
    }

    protected override async beforeWrite(
      _toolName: string,
      _normalizedPayload: Record<string, unknown>,
      context: ConnectorContext,
    ): Promise<void> {
      assertIntegrationConnected(context);
    }

    protected buildReadDispatchInput(
      _toolName: string,
      validated: Record<string, unknown>,
      _context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): RedditReadDispatchInput {
      return {
        validated,
        accessToken: runtime.accessToken,
        namespace: runtime.namespace,
      };
    }

    protected buildPrepareDispatchInput(
      _toolName: string,
      validated: Record<string, unknown>,
      _context: ConnectorContext,
    ): RedditPrepareDispatchInput {
      return { validated };
    }

    protected buildWriteDispatchInput(
      _toolName: string,
      normalizedPayload: Record<string, unknown>,
      _context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): RedditWriteDispatchInput {
      return {
        normalizedPayload,
        accessToken: runtime.accessToken,
        namespace: runtime.namespace,
      };
    }

    protected override unsupportedToolMessage(
      phase: "read" | "prepare" | "write",
      toolName: string,
    ): string {
      if (phase === "read") {
        return `Unsupported Reddit read tool ${toolName}`;
      }
      return `Unsupported Reddit write tool ${toolName}`;
    }
  }

  return new RedditConnector();
};

const connector = createRedditConnector();

export default connector;
