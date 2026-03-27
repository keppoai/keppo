import { buildProviderIdempotencyKey } from "../../../provider-write-utils.js";
import { xTools } from "../../../tool-definitions.js";
import { BaseConnector } from "../../../connectors/base-connector.js";
import type { Connector, ConnectorContext, PreparedWrite } from "../../../connectors/base.js";
import { createRealXSdk } from "../../../provider-sdk/x/real.js";
import type { XSdkPort } from "../../../provider-sdk/x/types.js";
import {
  createProviderCircuitBreaker,
  wrapObjectWithCircuitBreaker,
} from "../../../circuit-breaker.js";

const requiredScopesByTool: Record<string, string[]> = {
  "x.searchPosts": ["x.read"],
  "x.getPost": ["x.read"],
  "x.getPosts": ["x.read"],
  "x.getUserTimeline": ["x.read"],
  "x.getUserMentions": ["x.read"],
  "x.getUserByUsername": ["x.read"],
  "x.getUserById": ["x.read"],
  "x.getMe": ["x.read"],
  "x.getDMEvents": ["x.read"],
  "x.getQuoteTweets": ["x.read"],
  "x.getFollowers": ["x.read"],
  "x.getFollowing": ["x.read"],
  "x.getLikingUsers": ["x.read"],
  "x.getLikedPosts": ["x.read"],
  "x.getRepostedBy": ["x.read"],
  "x.getBlockedUsers": ["x.read"],
  "x.getMutedUsers": ["x.read"],
  "x.getBookmarks": ["x.read"],
  "x.searchUsers": ["x.read"],
  "x.getUsersByUsernames": ["x.read"],
  "x.getList": ["x.read"],
  "x.getOwnedLists": ["x.read"],
  "x.getListMembers": ["x.read"],
  "x.getListTweets": ["x.read"],
  "x.getHomeTimeline": ["x.read"],
  "x.searchAllPosts": ["x.read"],
  "x.getPostCounts": ["x.read"],
  "x.createPost": ["x.write"],
  "x.deletePost": ["x.write"],
  "x.likePost": ["x.write"],
  "x.unlikePost": ["x.write"],
  "x.repost": ["x.write"],
  "x.undoRepost": ["x.write"],
  "x.sendDM": ["x.write"],
  "x.followUser": ["x.write"],
  "x.unfollowUser": ["x.write"],
  "x.blockUser": ["x.write"],
  "x.unblockUser": ["x.write"],
  "x.muteUser": ["x.write"],
  "x.unmuteUser": ["x.write"],
  "x.createBookmark": ["x.write"],
  "x.deleteBookmark": ["x.write"],
  "x.createDMConversation": ["x.write"],
  "x.createList": ["x.write"],
  "x.deleteList": ["x.write"],
  "x.updateList": ["x.write"],
  "x.addListMember": ["x.write"],
  "x.removeListMember": ["x.write"],
};

const FAKE_X_ACCESS_TOKEN = process.env.KEPPO_FAKE_X_ACCESS_TOKEN?.trim();

const getToken = (context: ConnectorContext): string => {
  if (context.access_token) {
    return context.access_token;
  }
  if (FAKE_X_ACCESS_TOKEN) {
    return FAKE_X_ACCESS_TOKEN;
  }
  throw new Error("X access token missing. Reconnect X integration.");
};

const toLimit = (value: unknown, fallback = 20): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
};

const providerCircuitBreaker = createProviderCircuitBreaker("x");

type XReadToolName =
  | "x.searchPosts"
  | "x.getPost"
  | "x.getPosts"
  | "x.getUserTimeline"
  | "x.getUserMentions"
  | "x.getUserByUsername"
  | "x.getUserById"
  | "x.getMe"
  | "x.getDMEvents"
  | "x.getQuoteTweets"
  | "x.getFollowers"
  | "x.getFollowing"
  | "x.getLikingUsers"
  | "x.getLikedPosts"
  | "x.getRepostedBy"
  | "x.getBlockedUsers"
  | "x.getMutedUsers"
  | "x.getBookmarks"
  | "x.searchUsers"
  | "x.getUsersByUsernames"
  | "x.getList"
  | "x.getOwnedLists"
  | "x.getListMembers"
  | "x.getListTweets"
  | "x.getHomeTimeline"
  | "x.searchAllPosts"
  | "x.getPostCounts";

type XWriteToolName =
  | "x.createPost"
  | "x.deletePost"
  | "x.likePost"
  | "x.unlikePost"
  | "x.repost"
  | "x.undoRepost"
  | "x.sendDM"
  | "x.followUser"
  | "x.unfollowUser"
  | "x.blockUser"
  | "x.unblockUser"
  | "x.muteUser"
  | "x.unmuteUser"
  | "x.createBookmark"
  | "x.deleteBookmark"
  | "x.createDMConversation"
  | "x.createList"
  | "x.deleteList"
  | "x.updateList"
  | "x.addListMember"
  | "x.removeListMember";

type XReadDispatchInput = {
  validated: Record<string, unknown>;
  accessToken: string;
  namespace: string | undefined;
};

type XPrepareDispatchInput = {
  validated: Record<string, unknown>;
};

type XWriteDispatchInput = {
  normalizedPayload: Record<string, unknown>;
  accessToken: string;
  namespace: string | undefined;
};

export const createXConnector = (options?: { sdk?: XSdkPort }): Connector => {
  const sdk = wrapObjectWithCircuitBreaker(
    options?.sdk ?? createRealXSdk(),
    providerCircuitBreaker,
  );

  const readMap: Record<
    XReadToolName,
    (payload: XReadDispatchInput) => Promise<Record<string, unknown>>
  > = {
    "x.searchPosts": async ({ validated, accessToken, namespace }) => {
      const query = String(validated.query ?? "");
      const posts = await sdk.searchRecentPosts({
        accessToken,
        namespace,
        query,
        maxResults: 20,
      });

      return {
        query,
        posts,
      };
    },
    "x.getPost": async ({ validated, accessToken, namespace }) => {
      const post = await sdk.getPost({
        accessToken,
        namespace,
        postId: String(validated.postId ?? ""),
      });
      return { post };
    },
    "x.getPosts": async ({ validated, accessToken, namespace }) => {
      const postIds = Array.isArray(validated.postIds)
        ? validated.postIds.map((entry) => String(entry))
        : [];
      const posts = await sdk.getPosts({
        accessToken,
        namespace,
        postIds,
      });
      return { postIds, posts };
    },
    "x.getUserTimeline": async ({ validated, accessToken, namespace }) => {
      const userId = String(validated.userId ?? "");
      const posts = await sdk.getUserTimeline({
        accessToken,
        namespace,
        userId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { userId, posts };
    },
    "x.getUserMentions": async ({ validated, accessToken, namespace }) => {
      const userId = String(validated.userId ?? "");
      const posts = await sdk.getUserMentions({
        accessToken,
        namespace,
        userId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { userId, posts };
    },
    "x.getUserByUsername": async ({ validated, accessToken, namespace }) => {
      const user = await sdk.getUserByUsername({
        accessToken,
        namespace,
        username: String(validated.username ?? ""),
      });
      return { user };
    },
    "x.getUserById": async ({ validated, accessToken, namespace }) => {
      const user = await sdk.getUserById({
        accessToken,
        namespace,
        userId: String(validated.userId ?? ""),
      });
      return { user };
    },
    "x.getMe": async ({ accessToken, namespace }) => {
      const me = await sdk.getMe({
        accessToken,
        namespace,
      });
      return { me };
    },
    "x.getDMEvents": async ({ validated, accessToken, namespace }) => {
      const conversationId =
        typeof validated.conversationId === "string" ? validated.conversationId : undefined;
      const events = await sdk.getDmEvents({
        accessToken,
        namespace,
        ...(conversationId ? { conversationId } : {}),
        maxResults: toLimit(validated.limit, 20),
      });
      return {
        ...(conversationId ? { conversationId } : {}),
        events,
      };
    },
    "x.getQuoteTweets": async ({ validated, accessToken, namespace }) => {
      const postId = String(validated.postId ?? "");
      const posts = await sdk.getQuoteTweets({
        accessToken,
        namespace,
        postId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { postId, posts };
    },
    "x.getFollowers": async ({ validated, accessToken, namespace }) => {
      const userId = String(validated.userId ?? "");
      const users = await sdk.getFollowers({
        accessToken,
        namespace,
        userId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { userId, users };
    },
    "x.getFollowing": async ({ validated, accessToken, namespace }) => {
      const userId = String(validated.userId ?? "");
      const users = await sdk.getFollowing({
        accessToken,
        namespace,
        userId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { userId, users };
    },
    "x.getLikingUsers": async ({ validated, accessToken, namespace }) => {
      const postId = String(validated.postId ?? "");
      const users = await sdk.getLikingUsers({
        accessToken,
        namespace,
        postId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { postId, users };
    },
    "x.getLikedPosts": async ({ validated, accessToken, namespace }) => {
      const userId = String(validated.userId ?? "");
      const posts = await sdk.getLikedPosts({
        accessToken,
        namespace,
        userId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { userId, posts };
    },
    "x.getRepostedBy": async ({ validated, accessToken, namespace }) => {
      const postId = String(validated.postId ?? "");
      const users = await sdk.getRepostedBy({
        accessToken,
        namespace,
        postId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { postId, users };
    },
    "x.getBlockedUsers": async ({ validated, accessToken, namespace }) => {
      const userId = String(validated.userId ?? "");
      const users = await sdk.getBlockedUsers({
        accessToken,
        namespace,
        userId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { userId, users };
    },
    "x.getMutedUsers": async ({ validated, accessToken, namespace }) => {
      const userId = String(validated.userId ?? "");
      const users = await sdk.getMutedUsers({
        accessToken,
        namespace,
        userId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { userId, users };
    },
    "x.getBookmarks": async ({ validated, accessToken, namespace }) => {
      const userId = String(validated.userId ?? "");
      const posts = await sdk.getBookmarks({
        accessToken,
        namespace,
        userId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { userId, posts };
    },
    "x.searchUsers": async ({ validated, accessToken, namespace }) => {
      const query = String(validated.query ?? "");
      const users = await sdk.searchUsers({
        accessToken,
        namespace,
        query,
        maxResults: toLimit(validated.limit, 20),
      });
      return { query, users };
    },
    "x.getUsersByUsernames": async ({ validated, accessToken, namespace }) => {
      const usernames = Array.isArray(validated.usernames)
        ? validated.usernames.map((entry) => String(entry))
        : [];
      const users = await sdk.getUsersByUsernames({
        accessToken,
        namespace,
        usernames,
      });
      return { usernames, users };
    },
    "x.getList": async ({ validated, accessToken, namespace }) => {
      const list = await sdk.getList({
        accessToken,
        namespace,
        listId: String(validated.listId ?? ""),
      });
      return { list };
    },
    "x.getOwnedLists": async ({ validated, accessToken, namespace }) => {
      const userId = String(validated.userId ?? "");
      const lists = await sdk.getOwnedLists({
        accessToken,
        namespace,
        userId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { userId, lists };
    },
    "x.getListMembers": async ({ validated, accessToken, namespace }) => {
      const listId = String(validated.listId ?? "");
      const users = await sdk.getListMembers({
        accessToken,
        namespace,
        listId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { listId, users };
    },
    "x.getListTweets": async ({ validated, accessToken, namespace }) => {
      const listId = String(validated.listId ?? "");
      const posts = await sdk.getListTweets({
        accessToken,
        namespace,
        listId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { listId, posts };
    },
    "x.getHomeTimeline": async ({ validated, accessToken, namespace }) => {
      const userId = String(validated.userId ?? "");
      const posts = await sdk.getHomeTimeline({
        accessToken,
        namespace,
        userId,
        maxResults: toLimit(validated.limit, 20),
      });
      return { userId, posts };
    },
    "x.searchAllPosts": async ({ validated, accessToken, namespace }) => {
      const query = String(validated.query ?? "");
      const posts = await sdk.searchAllPosts({
        accessToken,
        namespace,
        query,
        maxResults: toLimit(validated.limit, 20),
      });
      return { query, posts };
    },
    "x.getPostCounts": async ({ validated, accessToken, namespace }) => {
      const query = String(validated.query ?? "");
      const counts = await sdk.getPostCounts({
        accessToken,
        namespace,
        query,
      });
      return { query, counts };
    },
  };

  const prepareMap: Record<
    XWriteToolName,
    (payload: XPrepareDispatchInput) => Promise<PreparedWrite>
  > = {
    "x.createPost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "create_post",
          body: String(validated.body ?? ""),
        },
        payload_preview: {
          body_preview: String(validated.body ?? "").slice(0, 120),
        },
      };
    },
    "x.deletePost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "delete_post",
          postId: String(validated.postId ?? ""),
        },
        payload_preview: {
          postId: String(validated.postId ?? ""),
        },
      };
    },
    "x.likePost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "like_post",
          userId: String(validated.userId ?? ""),
          postId: String(validated.postId ?? ""),
        },
        payload_preview: {
          userId: String(validated.userId ?? ""),
          postId: String(validated.postId ?? ""),
        },
      };
    },
    "x.unlikePost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "unlike_post",
          userId: String(validated.userId ?? ""),
          postId: String(validated.postId ?? ""),
        },
        payload_preview: {
          userId: String(validated.userId ?? ""),
          postId: String(validated.postId ?? ""),
        },
      };
    },
    "x.repost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "repost",
          userId: String(validated.userId ?? ""),
          postId: String(validated.postId ?? ""),
        },
        payload_preview: {
          userId: String(validated.userId ?? ""),
          postId: String(validated.postId ?? ""),
        },
      };
    },
    "x.undoRepost": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "undo_repost",
          userId: String(validated.userId ?? ""),
          postId: String(validated.postId ?? ""),
        },
        payload_preview: {
          userId: String(validated.userId ?? ""),
          postId: String(validated.postId ?? ""),
        },
      };
    },
    "x.sendDM": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "send_dm",
          conversationId: String(validated.conversationId ?? ""),
          text: String(validated.text ?? ""),
        },
        payload_preview: {
          conversationId: String(validated.conversationId ?? ""),
          text_preview: String(validated.text ?? "").slice(0, 120),
        },
      };
    },
    "x.followUser": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "follow_user",
          userId: String(validated.userId ?? ""),
          targetUserId: String(validated.targetUserId ?? ""),
        },
        payload_preview: {
          userId: String(validated.userId ?? ""),
          targetUserId: String(validated.targetUserId ?? ""),
        },
      };
    },
    "x.unfollowUser": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "unfollow_user",
          userId: String(validated.userId ?? ""),
          targetUserId: String(validated.targetUserId ?? ""),
        },
        payload_preview: {
          userId: String(validated.userId ?? ""),
          targetUserId: String(validated.targetUserId ?? ""),
        },
      };
    },
    "x.blockUser": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "block_user",
          userId: String(validated.userId ?? ""),
          targetUserId: String(validated.targetUserId ?? ""),
        },
        payload_preview: {
          userId: String(validated.userId ?? ""),
          targetUserId: String(validated.targetUserId ?? ""),
        },
      };
    },
    "x.unblockUser": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "unblock_user",
          userId: String(validated.userId ?? ""),
          targetUserId: String(validated.targetUserId ?? ""),
        },
        payload_preview: {
          userId: String(validated.userId ?? ""),
          targetUserId: String(validated.targetUserId ?? ""),
        },
      };
    },
    "x.muteUser": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "mute_user",
          userId: String(validated.userId ?? ""),
          targetUserId: String(validated.targetUserId ?? ""),
        },
        payload_preview: {
          userId: String(validated.userId ?? ""),
          targetUserId: String(validated.targetUserId ?? ""),
        },
      };
    },
    "x.unmuteUser": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "unmute_user",
          userId: String(validated.userId ?? ""),
          targetUserId: String(validated.targetUserId ?? ""),
        },
        payload_preview: {
          userId: String(validated.userId ?? ""),
          targetUserId: String(validated.targetUserId ?? ""),
        },
      };
    },
    "x.createBookmark": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "create_bookmark",
          userId: String(validated.userId ?? ""),
          postId: String(validated.postId ?? ""),
        },
        payload_preview: {
          userId: String(validated.userId ?? ""),
          postId: String(validated.postId ?? ""),
        },
      };
    },
    "x.deleteBookmark": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "delete_bookmark",
          userId: String(validated.userId ?? ""),
          postId: String(validated.postId ?? ""),
        },
        payload_preview: {
          userId: String(validated.userId ?? ""),
          postId: String(validated.postId ?? ""),
        },
      };
    },
    "x.createDMConversation": async ({ validated }) => {
      const participantIds = Array.isArray(validated.participantIds)
        ? validated.participantIds.map((entry) => String(entry))
        : [];
      return {
        normalized_payload: {
          type: "create_dm_conversation",
          participantIds,
          ...(typeof validated.text === "string" ? { text: validated.text } : {}),
        },
        payload_preview: {
          participantIds,
          ...(typeof validated.text === "string"
            ? { text_preview: validated.text.slice(0, 120) }
            : {}),
        },
      };
    },
    "x.createList": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "create_list",
          name: String(validated.name ?? ""),
          ...(typeof validated.description === "string"
            ? { description: validated.description }
            : {}),
          ...(typeof validated.isPrivate === "boolean" ? { isPrivate: validated.isPrivate } : {}),
        },
        payload_preview: {
          name: String(validated.name ?? ""),
          ...(typeof validated.description === "string"
            ? { description_preview: validated.description.slice(0, 120) }
            : {}),
          ...(typeof validated.isPrivate === "boolean" ? { isPrivate: validated.isPrivate } : {}),
        },
      };
    },
    "x.deleteList": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "delete_list",
          listId: String(validated.listId ?? ""),
        },
        payload_preview: {
          listId: String(validated.listId ?? ""),
        },
      };
    },
    "x.updateList": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "update_list",
          listId: String(validated.listId ?? ""),
          ...(typeof validated.name === "string" ? { name: validated.name } : {}),
          ...(typeof validated.description === "string"
            ? { description: validated.description }
            : {}),
          ...(typeof validated.isPrivate === "boolean" ? { isPrivate: validated.isPrivate } : {}),
        },
        payload_preview: {
          listId: String(validated.listId ?? ""),
          ...(typeof validated.name === "string" ? { name: validated.name } : {}),
          ...(typeof validated.description === "string"
            ? { description_preview: validated.description.slice(0, 120) }
            : {}),
          ...(typeof validated.isPrivate === "boolean" ? { isPrivate: validated.isPrivate } : {}),
        },
      };
    },
    "x.addListMember": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "add_list_member",
          listId: String(validated.listId ?? ""),
          userId: String(validated.userId ?? ""),
        },
        payload_preview: {
          listId: String(validated.listId ?? ""),
          userId: String(validated.userId ?? ""),
        },
      };
    },
    "x.removeListMember": async ({ validated }) => {
      return {
        normalized_payload: {
          type: "remove_list_member",
          listId: String(validated.listId ?? ""),
          userId: String(validated.userId ?? ""),
        },
        payload_preview: {
          listId: String(validated.listId ?? ""),
          userId: String(validated.userId ?? ""),
        },
      };
    },
  };

  const writeMap: Record<
    XWriteToolName,
    (payload: XWriteDispatchInput) => Promise<Record<string, unknown>>
  > = {
    "x.createPost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.createPost", normalizedPayload);
      const response = await sdk.createPost({
        accessToken,
        namespace,
        text: String(normalizedPayload.body ?? ""),
        idempotencyKey,
      });

      return {
        status: "posted",
        provider_action_id: response.id,
        preview: response.text.slice(0, 80),
      };
    },
    "x.deletePost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.deletePost", normalizedPayload);
      const response = await sdk.deletePost({
        accessToken,
        namespace,
        postId: String(normalizedPayload.postId ?? ""),
        idempotencyKey,
      });

      return {
        status: response.deleted ? "deleted" : "not_deleted",
        provider_action_id: response.id,
      };
    },
    "x.likePost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.likePost", normalizedPayload);
      const response = await sdk.likePost({
        accessToken,
        namespace,
        userId: String(normalizedPayload.userId ?? ""),
        postId: String(normalizedPayload.postId ?? ""),
        idempotencyKey,
      });
      return {
        status: "liked",
        provider_action_id: response.postId,
        userId: response.userId,
      };
    },
    "x.unlikePost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.unlikePost", normalizedPayload);
      const response = await sdk.unlikePost({
        accessToken,
        namespace,
        userId: String(normalizedPayload.userId ?? ""),
        postId: String(normalizedPayload.postId ?? ""),
        idempotencyKey,
      });
      return {
        status: "unliked",
        provider_action_id: response.postId,
        userId: response.userId,
      };
    },
    "x.repost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.repost", normalizedPayload);
      const response = await sdk.repost({
        accessToken,
        namespace,
        userId: String(normalizedPayload.userId ?? ""),
        postId: String(normalizedPayload.postId ?? ""),
        idempotencyKey,
      });
      return {
        status: "reposted",
        provider_action_id: response.postId,
        userId: response.userId,
      };
    },
    "x.undoRepost": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.undoRepost", normalizedPayload);
      const response = await sdk.undoRepost({
        accessToken,
        namespace,
        userId: String(normalizedPayload.userId ?? ""),
        postId: String(normalizedPayload.postId ?? ""),
        idempotencyKey,
      });
      return {
        status: "repost_removed",
        provider_action_id: response.postId,
        userId: response.userId,
      };
    },
    "x.sendDM": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.sendDM", normalizedPayload);
      const response = await sdk.sendDm({
        accessToken,
        namespace,
        conversationId: String(normalizedPayload.conversationId ?? ""),
        text: String(normalizedPayload.text ?? ""),
        idempotencyKey,
      });
      return {
        status: "sent",
        provider_action_id: response.id,
        conversationId: response.conversationId,
      };
    },
    "x.followUser": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.followUser", normalizedPayload);
      const response = await sdk.followUser({
        accessToken,
        namespace,
        userId: String(normalizedPayload.userId ?? ""),
        targetUserId: String(normalizedPayload.targetUserId ?? ""),
        idempotencyKey,
      });
      return {
        status: "followed",
        provider_action_id: `${response.userId}:${response.targetUserId}`,
        userId: response.userId,
        targetUserId: response.targetUserId,
      };
    },
    "x.unfollowUser": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.unfollowUser", normalizedPayload);
      const response = await sdk.unfollowUser({
        accessToken,
        namespace,
        userId: String(normalizedPayload.userId ?? ""),
        targetUserId: String(normalizedPayload.targetUserId ?? ""),
        idempotencyKey,
      });
      return {
        status: "unfollowed",
        provider_action_id: `${response.userId}:${response.targetUserId}`,
        userId: response.userId,
        targetUserId: response.targetUserId,
      };
    },
    "x.blockUser": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.blockUser", normalizedPayload);
      const response = await sdk.blockUser({
        accessToken,
        namespace,
        userId: String(normalizedPayload.userId ?? ""),
        targetUserId: String(normalizedPayload.targetUserId ?? ""),
        idempotencyKey,
      });
      return {
        status: "blocked",
        provider_action_id: `${response.userId}:${response.targetUserId}`,
        userId: response.userId,
        targetUserId: response.targetUserId,
      };
    },
    "x.unblockUser": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.unblockUser", normalizedPayload);
      const response = await sdk.unblockUser({
        accessToken,
        namespace,
        userId: String(normalizedPayload.userId ?? ""),
        targetUserId: String(normalizedPayload.targetUserId ?? ""),
        idempotencyKey,
      });
      return {
        status: "unblocked",
        provider_action_id: `${response.userId}:${response.targetUserId}`,
        userId: response.userId,
        targetUserId: response.targetUserId,
      };
    },
    "x.muteUser": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.muteUser", normalizedPayload);
      const response = await sdk.muteUser({
        accessToken,
        namespace,
        userId: String(normalizedPayload.userId ?? ""),
        targetUserId: String(normalizedPayload.targetUserId ?? ""),
        idempotencyKey,
      });
      return {
        status: "muted",
        provider_action_id: `${response.userId}:${response.targetUserId}`,
        userId: response.userId,
        targetUserId: response.targetUserId,
      };
    },
    "x.unmuteUser": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.unmuteUser", normalizedPayload);
      const response = await sdk.unmuteUser({
        accessToken,
        namespace,
        userId: String(normalizedPayload.userId ?? ""),
        targetUserId: String(normalizedPayload.targetUserId ?? ""),
        idempotencyKey,
      });
      return {
        status: "unmuted",
        provider_action_id: `${response.userId}:${response.targetUserId}`,
        userId: response.userId,
        targetUserId: response.targetUserId,
      };
    },
    "x.createBookmark": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.createBookmark", normalizedPayload);
      const response = await sdk.createBookmark({
        accessToken,
        namespace,
        userId: String(normalizedPayload.userId ?? ""),
        postId: String(normalizedPayload.postId ?? ""),
        idempotencyKey,
      });
      return {
        status: "bookmarked",
        provider_action_id: response.postId,
        userId: response.userId,
      };
    },
    "x.deleteBookmark": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.deleteBookmark", normalizedPayload);
      const response = await sdk.deleteBookmark({
        accessToken,
        namespace,
        userId: String(normalizedPayload.userId ?? ""),
        postId: String(normalizedPayload.postId ?? ""),
        idempotencyKey,
      });
      return {
        status: "bookmark_removed",
        provider_action_id: response.postId,
        userId: response.userId,
      };
    },
    "x.createDMConversation": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "x.createDMConversation",
        normalizedPayload,
      );
      const participantIds = Array.isArray(normalizedPayload.participantIds)
        ? normalizedPayload.participantIds.map((entry) => String(entry))
        : [];
      const response = await sdk.createDmConversation({
        accessToken,
        namespace,
        participantIds,
        ...(typeof normalizedPayload.text === "string" ? { text: normalizedPayload.text } : {}),
        idempotencyKey,
      });
      return {
        status: "conversation_created",
        provider_action_id: response.conversationId,
        conversationId: response.conversationId,
        participantIds: response.participantIds,
        ...(response.event ? { eventId: response.event.id } : {}),
      };
    },
    "x.createList": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.createList", normalizedPayload);
      const response = await sdk.createList({
        accessToken,
        namespace,
        name: String(normalizedPayload.name ?? ""),
        ...(typeof normalizedPayload.description === "string"
          ? { description: normalizedPayload.description }
          : {}),
        ...(typeof normalizedPayload.isPrivate === "boolean"
          ? { isPrivate: normalizedPayload.isPrivate }
          : {}),
        idempotencyKey,
      });
      return {
        status: "list_created",
        provider_action_id: response.id,
        listId: response.id,
      };
    },
    "x.deleteList": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.deleteList", normalizedPayload);
      const response = await sdk.deleteList({
        accessToken,
        namespace,
        listId: String(normalizedPayload.listId ?? ""),
        idempotencyKey,
      });
      return {
        status: response.deleted ? "deleted" : "not_deleted",
        provider_action_id: response.id,
        listId: response.id,
      };
    },
    "x.updateList": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.updateList", normalizedPayload);
      const response = await sdk.updateList({
        accessToken,
        namespace,
        listId: String(normalizedPayload.listId ?? ""),
        ...(typeof normalizedPayload.name === "string" ? { name: normalizedPayload.name } : {}),
        ...(typeof normalizedPayload.description === "string"
          ? { description: normalizedPayload.description }
          : {}),
        ...(typeof normalizedPayload.isPrivate === "boolean"
          ? { isPrivate: normalizedPayload.isPrivate }
          : {}),
        idempotencyKey,
      });
      return {
        status: "updated",
        provider_action_id: response.id,
        listId: response.id,
      };
    },
    "x.addListMember": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.addListMember", normalizedPayload);
      const response = await sdk.addListMember({
        accessToken,
        namespace,
        listId: String(normalizedPayload.listId ?? ""),
        userId: String(normalizedPayload.userId ?? ""),
        idempotencyKey,
      });
      return {
        status: "member_added",
        provider_action_id: `${response.listId}:${response.userId}`,
        listId: response.listId,
        userId: response.userId,
      };
    },
    "x.removeListMember": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("x.removeListMember", normalizedPayload);
      const response = await sdk.removeListMember({
        accessToken,
        namespace,
        listId: String(normalizedPayload.listId ?? ""),
        userId: String(normalizedPayload.userId ?? ""),
        idempotencyKey,
      });
      return {
        status: "member_removed",
        provider_action_id: `${response.listId}:${response.userId}`,
        listId: response.listId,
        userId: response.userId,
      };
    },
  };

  class XConnector extends BaseConnector<
    XReadDispatchInput,
    XPrepareDispatchInput,
    XWriteDispatchInput,
    typeof xTools
  > {
    constructor() {
      super({
        provider: "x",
        tools: xTools,
        requiredScopesByTool,
        readMap,
        prepareMap,
        writeMap,
      });
    }

    protected getToken(context: ConnectorContext): string {
      return getToken(context);
    }

    protected buildReadDispatchInput(
      _toolName: string,
      validated: Record<string, unknown>,
      _context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): XReadDispatchInput {
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
    ): XPrepareDispatchInput {
      return { validated };
    }

    protected buildWriteDispatchInput(
      _toolName: string,
      normalizedPayload: Record<string, unknown>,
      _context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): XWriteDispatchInput {
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
        return `Unsupported X read tool ${toolName}`;
      }
      return `Unsupported X write tool ${toolName}`;
    }
  }

  return new XConnector();
};

const connector = createXConnector();

export default connector;
