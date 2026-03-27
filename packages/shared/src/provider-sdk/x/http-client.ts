import { safeFetchWithRetry } from "../../provider-write-utils.js";
import { createErrorTextSignals, hasAllWords, hasAnyWord, hasErrorCode } from "../error-signals.js";
import type {
  XApiCreatePostResponse,
  XApiSearchResponse,
  XCreateDmConversationResponse,
  XCreatePostResponse,
  XDmEvent,
  XDeleteListResponse,
  XDeletePostResponse,
  XEngagementResponse,
  XGatewaySearchResponse,
  XList,
  XPostCounts,
  XPost,
  XRelationshipResponse,
  XSearchPostsArgs,
  XTypedHttpErrorCode,
  XUser,
} from "./types.js";

type RequestVariant = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string>;
  jsonBody?: Record<string, unknown>;
};

type RequestParams<T> = {
  accessToken: string;
  namespace?: string | undefined;
  idempotencyKey?: string | undefined;
  requestName: string;
  baseUrl: string;
  variants: RequestVariant[];
  parsePayload: (value: unknown) => T | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const raw = await response.text();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};

const toErrorCode = (
  status: number,
  payload: unknown,
  fallback: XTypedHttpErrorCode = "provider_error",
): XTypedHttpErrorCode => {
  if (status === 401 || status === 403) {
    return "invalid_token";
  }

  if (isRecord(payload)) {
    const message = String(payload.message ?? "").toLowerCase();
    const title = String(payload.title ?? "").toLowerCase();
    const detail = String(payload.detail ?? "").toLowerCase();
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const signals = createErrorTextSignals(
      message,
      title,
      detail,
      ...errors.map((entry) => String(entry)),
    );

    if (
      hasErrorCode(signals, "text_too_long") ||
      hasAllWords(signals, "too", "long") ||
      hasAnyWord(signals, "280")
    ) {
      return "text_too_long";
    }
    if (hasErrorCode(signals, "rate_limited") || hasAllWords(signals, "too", "many", "requests")) {
      return "rate_limited";
    }
    if (hasErrorCode(signals, "invalid_token")) {
      return "invalid_token";
    }
    if (hasErrorCode(signals, "timeout", "gateway_timeout")) {
      return "timeout";
    }
    if (hasAnyWord(signals, "invalid", "missing")) {
      return "invalid_request";
    }
  }

  if (status === 404) {
    return "not_found";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 504) {
    return "timeout";
  }
  if (status === 400 || status === 422) {
    return "invalid_request";
  }

  return fallback;
};

const toXPost = (value: unknown): XPost | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = String(value.id ?? "").trim();
  const text = String(value.text ?? value.body ?? "").trim();
  if (!id || !text) {
    return null;
  }
  return {
    id,
    text,
    ...(typeof value.authorId === "string"
      ? { authorId: value.authorId }
      : typeof value.author_id === "string"
        ? { authorId: value.author_id }
        : {}),
    ...(typeof value.createdAt === "string"
      ? { createdAt: value.createdAt }
      : typeof value.created_at === "string"
        ? { createdAt: value.created_at }
        : {}),
  };
};

const toXUser = (value: unknown): XUser | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = String(value.id ?? "").trim();
  const username = String(value.username ?? "").trim();
  const name = String(value.name ?? "").trim();
  if (!id || !username || !name) {
    return null;
  }
  return { id, username, name };
};

const toXList = (value: unknown): XList | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = String(value.id ?? value.listId ?? "").trim();
  const name = String(value.name ?? value.title ?? "").trim();
  const ownerId = String(value.ownerId ?? value.owner_id ?? value.userId ?? "").trim();
  if (!id || !name || !ownerId) {
    return null;
  }
  return {
    id,
    name,
    ownerId,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(typeof value.isPrivate === "boolean"
      ? { isPrivate: value.isPrivate }
      : typeof value.private === "boolean"
        ? { isPrivate: value.private }
        : {}),
  };
};

const toXDmEvent = (value: unknown): XDmEvent | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = String(value.id ?? "").trim();
  const conversationId = String(value.conversationId ?? value.dm_conversation_id ?? "").trim();
  const senderId = String(value.senderId ?? value.sender_id ?? "").trim();
  const text = String(value.text ?? value.message ?? "").trim();
  const createdAt = String(value.createdAt ?? value.created_at ?? "").trim();
  if (!id || !conversationId || !senderId || !text || !createdAt) {
    return null;
  }
  return {
    id,
    conversationId,
    senderId,
    text,
    createdAt,
  };
};

const parseSearchResponse = (
  payload: unknown,
): {
  posts: XPost[];
  nextCursor?: string | null | undefined;
} | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const apiPayload = payload as XApiSearchResponse & XGatewaySearchResponse;
  const sourcePosts = Array.isArray(apiPayload.data)
    ? apiPayload.data
    : Array.isArray(apiPayload.posts)
      ? apiPayload.posts
      : null;

  if (!sourcePosts) {
    return null;
  }

  const posts = sourcePosts
    .map((entry) => toXPost(entry))
    .filter((entry): entry is XPost => !!entry);
  const nextCursor =
    typeof apiPayload.meta?.next_token === "string"
      ? apiPayload.meta.next_token
      : apiPayload.next_cursor;

  return {
    posts,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
};

const parseCreateResponse = (
  payload: unknown,
  fallbackText: string,
): XCreatePostResponse | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const apiPayload = payload as XApiCreatePostResponse & Record<string, unknown>;
  const data = (isRecord(apiPayload.data) ? apiPayload.data : apiPayload) as Record<
    string,
    unknown
  >;
  const id = String(data.id ?? "").trim();
  const text = String(data.text ?? data.body ?? fallbackText).trim();

  if (!id || !text) {
    return null;
  }

  return { id, text };
};

const parseDeleteResponse = (
  payload: unknown,
  fallbackPostId: string,
): XDeletePostResponse | null => {
  if (isRecord(payload)) {
    const id = String(payload.id ?? payload.postId ?? fallbackPostId).trim();
    const deleted = payload.deleted !== false;
    if (id) {
      return {
        id,
        deleted,
      };
    }
  }

  if (payload === null || payload === undefined || payload === "") {
    return {
      id: fallbackPostId,
      deleted: true,
    };
  }

  return null;
};

const parsePostResponse = (payload: unknown): { post: XPost } | null => {
  if (!isRecord(payload)) {
    return null;
  }

  if (isRecord(payload.post)) {
    const post = toXPost(payload.post);
    return post ? { post } : null;
  }

  const data = isRecord(payload.data) ? payload.data : payload;
  const post = toXPost(data);
  return post ? { post } : null;
};

const parsePostsResponse = (payload: unknown): { posts: XPost[] } | null => {
  if (!isRecord(payload)) {
    return null;
  }

  if (Array.isArray(payload.posts)) {
    return {
      posts: payload.posts
        .map((entry) => toXPost(entry))
        .filter((entry): entry is XPost => !!entry),
    };
  }

  const data = Array.isArray(payload.data) ? payload.data : null;
  if (data) {
    return {
      posts: data.map((entry) => toXPost(entry)).filter((entry): entry is XPost => !!entry),
    };
  }

  return null;
};

const parseUserResponse = (payload: unknown): { user: XUser } | null => {
  if (!isRecord(payload)) {
    return null;
  }

  if (isRecord(payload.user)) {
    const user = toXUser(payload.user);
    return user ? { user } : null;
  }

  const data = isRecord(payload.data) ? payload.data : payload;
  const user = toXUser(data);
  return user ? { user } : null;
};

const parseMeResponse = (payload: unknown): { me: XUser } | null => {
  if (!isRecord(payload)) {
    return null;
  }

  if (isRecord(payload.me)) {
    const me = toXUser(payload.me);
    return me ? { me } : null;
  }

  const data = isRecord(payload.data) ? payload.data : payload;
  const me = toXUser(data);
  return me ? { me } : null;
};

const parseUsersResponse = (payload: unknown): { users: XUser[] } | null => {
  if (!isRecord(payload)) {
    return null;
  }

  if (Array.isArray(payload.users)) {
    return {
      users: payload.users
        .map((entry) => toXUser(entry))
        .filter((entry): entry is XUser => !!entry),
    };
  }

  const data = Array.isArray(payload.data) ? payload.data : null;
  if (data) {
    return {
      users: data.map((entry) => toXUser(entry)).filter((entry): entry is XUser => !!entry),
    };
  }

  return null;
};

const parseListResponse = (payload: unknown): { list: XList } | null => {
  if (!isRecord(payload)) {
    return null;
  }
  if (isRecord(payload.list)) {
    const list = toXList(payload.list);
    return list ? { list } : null;
  }
  const data = isRecord(payload.data) ? payload.data : payload;
  const list = toXList(data);
  return list ? { list } : null;
};

const parseListsResponse = (payload: unknown): { lists: XList[] } | null => {
  if (!isRecord(payload)) {
    return null;
  }
  if (Array.isArray(payload.lists)) {
    return {
      lists: payload.lists
        .map((entry) => toXList(entry))
        .filter((entry): entry is XList => !!entry),
    };
  }
  const data = Array.isArray(payload.data) ? payload.data : null;
  if (data) {
    return {
      lists: data.map((entry) => toXList(entry)).filter((entry): entry is XList => !!entry),
    };
  }
  return null;
};

const parseListMemberResponse = (
  payload: unknown,
  fallbackListId: string,
  fallbackUserId: string,
): { listId: string; userId: string } | null => {
  if (isRecord(payload)) {
    const listId = String(payload.listId ?? payload.id ?? fallbackListId).trim();
    const userId = String(
      payload.userId ?? payload.memberId ?? payload.targetUserId ?? fallbackUserId,
    ).trim();
    if (listId && userId) {
      return { listId, userId };
    }
    const data = isRecord(payload.data) ? payload.data : null;
    if (data) {
      const dataListId = String(data.listId ?? data.id ?? fallbackListId).trim();
      const dataUserId = String(
        data.userId ?? data.memberId ?? data.targetUserId ?? fallbackUserId,
      ).trim();
      if (dataListId && dataUserId) {
        return { listId: dataListId, userId: dataUserId };
      }
    }
  }
  return null;
};

const parsePostCountsResponse = (
  payload: unknown,
  fallbackQuery: string,
): { counts: XPostCounts } | null => {
  if (!isRecord(payload)) {
    return null;
  }
  if (isRecord(payload.counts)) {
    const query = String(payload.counts.query ?? fallbackQuery).trim();
    const total = Number(payload.counts.total ?? payload.counts.count ?? 0);
    if (query && Number.isFinite(total)) {
      return { counts: { query, total } };
    }
  }
  const data = isRecord(payload.data) ? payload.data : payload;
  const query = String(data.query ?? fallbackQuery).trim();
  const total = Number(data.total ?? data.count ?? 0);
  if (query && Number.isFinite(total)) {
    return { counts: { query, total } };
  }
  return null;
};

const parseEngagementResponse = (
  payload: unknown,
  fallbackUserId: string,
  fallbackPostId: string,
): XEngagementResponse | null => {
  if (isRecord(payload)) {
    const userId = String(payload.userId ?? fallbackUserId).trim();
    const postId = String(payload.postId ?? payload.tweetId ?? fallbackPostId).trim();
    if (userId && postId) {
      return {
        userId,
        postId,
      };
    }

    const data = isRecord(payload.data) ? payload.data : null;
    if (data) {
      const dataUserId = String(data.userId ?? fallbackUserId).trim();
      const dataPostId = String(data.postId ?? data.tweetId ?? fallbackPostId).trim();
      if (dataUserId && dataPostId) {
        return {
          userId: dataUserId,
          postId: dataPostId,
        };
      }
    }
  }

  if (payload === null || payload === undefined || payload === "") {
    return {
      userId: fallbackUserId,
      postId: fallbackPostId,
    };
  }

  return null;
};

const parseRelationshipResponse = (
  payload: unknown,
  fallbackUserId: string,
  fallbackTargetUserId: string,
): XRelationshipResponse | null => {
  if (isRecord(payload)) {
    const userId = String(payload.userId ?? fallbackUserId).trim();
    const targetUserId = String(
      payload.targetUserId ?? payload.target_id ?? fallbackTargetUserId,
    ).trim();
    if (userId && targetUserId) {
      return {
        userId,
        targetUserId,
      };
    }

    const data = isRecord(payload.data) ? payload.data : null;
    if (data) {
      const dataUserId = String(data.userId ?? fallbackUserId).trim();
      const dataTargetUserId = String(
        data.targetUserId ?? data.target_id ?? fallbackTargetUserId,
      ).trim();
      if (dataUserId && dataTargetUserId) {
        return {
          userId: dataUserId,
          targetUserId: dataTargetUserId,
        };
      }
    }
  }

  if (payload === null || payload === undefined || payload === "") {
    return {
      userId: fallbackUserId,
      targetUserId: fallbackTargetUserId,
    };
  }

  return null;
};

const parseSendDmResponse = (payload: unknown): { event: XDmEvent } | null => {
  if (!isRecord(payload)) {
    return null;
  }

  if (isRecord(payload.event)) {
    const event = toXDmEvent(payload.event);
    return event ? { event } : null;
  }

  const data = isRecord(payload.data) ? payload.data : payload;
  const event = toXDmEvent(data);
  return event ? { event } : null;
};

const parseDmEventsResponse = (payload: unknown): { events: XDmEvent[] } | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const source = Array.isArray(payload.events)
    ? payload.events
    : Array.isArray(payload.data)
      ? payload.data
      : null;

  if (!source) {
    return null;
  }

  return {
    events: source.map((entry) => toXDmEvent(entry)).filter((entry): entry is XDmEvent => !!entry),
  };
};

const parseCreateDmConversationResponse = (
  payload: unknown,
  fallbackParticipants: string[],
): XCreateDmConversationResponse | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const candidate = isRecord(payload.data) ? payload.data : payload;
  const conversationId = String(
    candidate.conversationId ?? candidate.dm_conversation_id ?? "",
  ).trim();
  const participantIds = Array.isArray(candidate.participantIds)
    ? candidate.participantIds
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0)
    : Array.isArray(candidate.participant_ids)
      ? candidate.participant_ids
          .map((entry) => String(entry).trim())
          .filter((entry) => entry.length > 0)
      : fallbackParticipants;

  if (!conversationId) {
    return null;
  }

  const eventSource = isRecord(candidate.event) ? candidate.event : null;
  const event = eventSource ? toXDmEvent(eventSource) : null;
  return {
    conversationId,
    participantIds,
    ...(event ? { event } : {}),
  };
};

const requestWithFallback = async <T>(params: RequestParams<T>): Promise<T> => {
  const errors: string[] = [];

  for (const variant of params.variants) {
    const query = new URLSearchParams(variant.query ?? {});
    const url = `${params.baseUrl}${variant.path}${query.toString() ? `?${query.toString()}` : ""}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${params.accessToken}`,
    };
    if (params.idempotencyKey) {
      headers["x-idempotency-key"] = params.idempotencyKey;
    }

    const response = await safeFetchWithRetry(
      url,
      {
        method: variant.method,
        headers: {
          ...headers,
          ...(variant.jsonBody ? { "Content-Type": "application/json" } : {}),
        },
        ...(variant.jsonBody ? { body: JSON.stringify(variant.jsonBody) } : {}),
      },
      params.requestName,
      params.namespace ? { namespace: params.namespace } : undefined,
    );

    const parsedBody = await parseResponseBody(response);
    if (response.ok) {
      const parsed = params.parsePayload(parsedBody);
      if (!parsed) {
        throw new Error("invalid_provider_response");
      }
      return parsed;
    }

    if (response.status === 404 || response.status === 405) {
      errors.push(`${String(response.status)}:${variant.method}:${variant.path}`);
      continue;
    }

    throw new Error(toErrorCode(response.status, parsedBody));
  }

  if (errors.length > 0) {
    throw new Error("not_found");
  }
  throw new Error("provider_error");
};

export type XTypedHttpClient = {
  searchRecentPosts: (args: XSearchPostsArgs) => Promise<{
    posts: XPost[];
    nextCursor?: string | null | undefined;
  }>;
  createPost: (args: {
    text: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XCreatePostResponse>;
  deletePost: (args: {
    postId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XDeletePostResponse>;
  getPost: (args: { postId: string }) => Promise<{ post: XPost }>;
  getPosts: (args: { postIds: string[] }) => Promise<{ posts: XPost[] }>;
  getUserTimeline: (args: {
    userId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ posts: XPost[]; nextCursor?: string | null | undefined }>;
  getUserMentions: (args: {
    userId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ posts: XPost[]; nextCursor?: string | null | undefined }>;
  getQuoteTweets: (args: {
    postId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ posts: XPost[]; nextCursor?: string | null | undefined }>;
  getUserByUsername: (args: { username: string }) => Promise<{ user: XUser }>;
  getUserById: (args: { userId: string }) => Promise<{ user: XUser }>;
  getMe: () => Promise<{ me: XUser }>;
  getFollowers: (args: {
    userId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ users: XUser[] }>;
  getFollowing: (args: {
    userId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ users: XUser[] }>;
  followUser: (args: {
    userId: string;
    targetUserId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XRelationshipResponse>;
  unfollowUser: (args: {
    userId: string;
    targetUserId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XRelationshipResponse>;
  likePost: (args: {
    userId: string;
    postId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XEngagementResponse>;
  unlikePost: (args: {
    userId: string;
    postId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XEngagementResponse>;
  getLikingUsers: (args: {
    postId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ users: XUser[] }>;
  getLikedPosts: (args: {
    userId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ posts: XPost[]; nextCursor?: string | null | undefined }>;
  repost: (args: {
    userId: string;
    postId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XEngagementResponse>;
  undoRepost: (args: {
    userId: string;
    postId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XEngagementResponse>;
  getRepostedBy: (args: {
    postId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ users: XUser[] }>;
  blockUser: (args: {
    userId: string;
    targetUserId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XRelationshipResponse>;
  unblockUser: (args: {
    userId: string;
    targetUserId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XRelationshipResponse>;
  getBlockedUsers: (args: {
    userId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ users: XUser[] }>;
  muteUser: (args: {
    userId: string;
    targetUserId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XRelationshipResponse>;
  unmuteUser: (args: {
    userId: string;
    targetUserId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XRelationshipResponse>;
  getMutedUsers: (args: {
    userId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ users: XUser[] }>;
  createBookmark: (args: {
    userId: string;
    postId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XEngagementResponse>;
  deleteBookmark: (args: {
    userId: string;
    postId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XEngagementResponse>;
  getBookmarks: (args: {
    userId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ posts: XPost[]; nextCursor?: string | null | undefined }>;
  sendDm: (args: {
    conversationId: string;
    text: string;
    idempotencyKey?: string | undefined;
  }) => Promise<{ event: XDmEvent }>;
  createDmConversation: (args: {
    participantIds: string[];
    text?: string | undefined;
    idempotencyKey?: string | undefined;
  }) => Promise<XCreateDmConversationResponse>;
  getDmEvents: (args: {
    conversationId?: string | undefined;
    maxResults: number;
  }) => Promise<{ events: XDmEvent[] }>;
  searchUsers: (args: {
    query: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ users: XUser[] }>;
  getUsersByUsernames: (args: { usernames: string[] }) => Promise<{ users: XUser[] }>;
  createList: (args: {
    name: string;
    description?: string | undefined;
    isPrivate?: boolean | undefined;
    idempotencyKey?: string | undefined;
  }) => Promise<{ list: XList }>;
  deleteList: (args: {
    listId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<XDeleteListResponse>;
  updateList: (args: {
    listId: string;
    name?: string | undefined;
    description?: string | undefined;
    isPrivate?: boolean | undefined;
    idempotencyKey?: string | undefined;
  }) => Promise<{ list: XList }>;
  getList: (args: { listId: string }) => Promise<{ list: XList }>;
  getOwnedLists: (args: {
    userId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ lists: XList[] }>;
  addListMember: (args: {
    listId: string;
    userId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<{ listId: string; userId: string }>;
  removeListMember: (args: {
    listId: string;
    userId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<{ listId: string; userId: string }>;
  getListMembers: (args: {
    listId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ users: XUser[] }>;
  getListTweets: (args: {
    listId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ posts: XPost[] }>;
  getHomeTimeline: (args: {
    userId: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{ posts: XPost[] }>;
  searchAllPosts: (args: {
    query: string;
    maxResults: number;
    cursor?: string | undefined;
  }) => Promise<{
    posts: XPost[];
    nextCursor?: string | null | undefined;
  }>;
  getPostCounts: (args: { query: string }) => Promise<{ counts: XPostCounts }>;
};

export const createXTypedHttpClient = (options: {
  accessToken: string;
  namespace?: string | undefined;
  baseUrl: string;
}): XTypedHttpClient => {
  return {
    searchRecentPosts: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.search_recent_posts",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/2/tweets/search/recent",
            query: {
              query: args.query,
              max_results: String(args.maxResults),
              ...(args.cursor ? { next_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/posts",
            query: {
              q: args.query,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseSearchResponse(payload);
        },
      });
    },
    createPost: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.create_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/2/tweets",
            jsonBody: {
              text: args.text,
            },
          },
          {
            method: "POST",
            path: "/write/posts",
            jsonBody: {
              body: args.text,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseCreateResponse(payload, args.text);
        },
      });
    },
    deletePost: async (args) => {
      const postId = args.postId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.delete_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "DELETE",
            path: `/2/tweets/${encodeURIComponent(postId)}`,
          },
          {
            method: "POST",
            path: "/write/posts/delete",
            jsonBody: {
              postId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseDeleteResponse(payload, postId);
        },
      });
    },
    getPost: async (args) => {
      const postId = args.postId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/tweets/${encodeURIComponent(postId)}`,
          },
          {
            method: "GET",
            path: "/list/posts/get",
            query: {
              postId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parsePostResponse(payload);
        },
      });
    },
    getPosts: async (args) => {
      const postIds = args.postIds.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_posts",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/2/tweets",
            query: {
              ids: postIds.join(","),
            },
          },
          {
            method: "GET",
            path: "/list/posts/lookup",
            query: {
              postIds: postIds.join(","),
            },
          },
        ],
        parsePayload: (payload) => {
          return parsePostsResponse(payload);
        },
      });
    },
    getUserTimeline: async (args) => {
      const userId = args.userId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_user_timeline",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/users/${encodeURIComponent(userId)}/tweets`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/users/timeline",
            query: {
              userId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          const parsed = parseSearchResponse(payload);
          return parsed ? { posts: parsed.posts, nextCursor: parsed.nextCursor } : null;
        },
      });
    },
    getUserMentions: async (args) => {
      const userId = args.userId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_user_mentions",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/users/${encodeURIComponent(userId)}/mentions`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/users/mentions",
            query: {
              userId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          const parsed = parseSearchResponse(payload);
          return parsed ? { posts: parsed.posts, nextCursor: parsed.nextCursor } : null;
        },
      });
    },
    getQuoteTweets: async (args) => {
      const postId = args.postId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_quote_tweets",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/tweets/${encodeURIComponent(postId)}/quote_tweets`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/posts/quote-tweets",
            query: {
              postId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          const parsed = parseSearchResponse(payload);
          return parsed ? { posts: parsed.posts, nextCursor: parsed.nextCursor } : null;
        },
      });
    },
    getUserByUsername: async (args) => {
      const username = args.username.trim().replace(/^@+/, "");
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_user_by_username",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/users/by/username/${encodeURIComponent(username)}`,
          },
          {
            method: "GET",
            path: "/list/users/by-username",
            query: {
              username,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseUserResponse(payload);
        },
      });
    },
    getUserById: async (args) => {
      const userId = args.userId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_user_by_id",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/users/${encodeURIComponent(userId)}`,
          },
          {
            method: "GET",
            path: "/list/users/by-id",
            query: {
              userId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseUserResponse(payload);
        },
      });
    },
    getMe: async () => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_me",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/2/users/me",
          },
          {
            method: "GET",
            path: "/list/users/me",
          },
        ],
        parsePayload: (payload) => {
          return parseMeResponse(payload);
        },
      });
    },
    getFollowers: async (args) => {
      const userId = args.userId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_followers",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/users/${encodeURIComponent(userId)}/followers`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/users/followers",
            query: {
              userId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseUsersResponse(payload);
        },
      });
    },
    getFollowing: async (args) => {
      const userId = args.userId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_following",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/users/${encodeURIComponent(userId)}/following`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/users/following",
            query: {
              userId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseUsersResponse(payload);
        },
      });
    },
    followUser: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.follow_user",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: `/2/users/${encodeURIComponent(args.userId)}/following`,
            jsonBody: {
              target_user_id: args.targetUserId,
            },
          },
          {
            method: "POST",
            path: "/write/follows/create",
            jsonBody: {
              userId: args.userId,
              targetUserId: args.targetUserId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseRelationshipResponse(payload, args.userId, args.targetUserId);
        },
      });
    },
    unfollowUser: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.unfollow_user",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "DELETE",
            path: `/2/users/${encodeURIComponent(args.userId)}/following/${encodeURIComponent(args.targetUserId)}`,
          },
          {
            method: "POST",
            path: "/write/follows/delete",
            jsonBody: {
              userId: args.userId,
              targetUserId: args.targetUserId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseRelationshipResponse(payload, args.userId, args.targetUserId);
        },
      });
    },
    likePost: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.like_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: `/2/users/${encodeURIComponent(args.userId)}/likes`,
            jsonBody: {
              tweet_id: args.postId,
            },
          },
          {
            method: "POST",
            path: "/write/likes/create",
            jsonBody: {
              userId: args.userId,
              postId: args.postId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseEngagementResponse(payload, args.userId, args.postId);
        },
      });
    },
    unlikePost: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.unlike_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "DELETE",
            path: `/2/users/${encodeURIComponent(args.userId)}/likes/${encodeURIComponent(args.postId)}`,
          },
          {
            method: "POST",
            path: "/write/likes/delete",
            jsonBody: {
              userId: args.userId,
              postId: args.postId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseEngagementResponse(payload, args.userId, args.postId);
        },
      });
    },
    getLikingUsers: async (args) => {
      const postId = args.postId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_liking_users",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/tweets/${encodeURIComponent(postId)}/liked_by`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/users/liking",
            query: {
              postId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseUsersResponse(payload);
        },
      });
    },
    getLikedPosts: async (args) => {
      const userId = args.userId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_liked_posts",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/users/${encodeURIComponent(userId)}/liked_tweets`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/posts/liked",
            query: {
              userId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          const parsed = parseSearchResponse(payload);
          return parsed ? { posts: parsed.posts, nextCursor: parsed.nextCursor } : null;
        },
      });
    },
    repost: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.repost",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: `/2/users/${encodeURIComponent(args.userId)}/retweets`,
            jsonBody: {
              tweet_id: args.postId,
            },
          },
          {
            method: "POST",
            path: "/write/reposts/create",
            jsonBody: {
              userId: args.userId,
              postId: args.postId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseEngagementResponse(payload, args.userId, args.postId);
        },
      });
    },
    undoRepost: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.undo_repost",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "DELETE",
            path: `/2/users/${encodeURIComponent(args.userId)}/retweets/${encodeURIComponent(args.postId)}`,
          },
          {
            method: "POST",
            path: "/write/reposts/delete",
            jsonBody: {
              userId: args.userId,
              postId: args.postId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseEngagementResponse(payload, args.userId, args.postId);
        },
      });
    },
    getRepostedBy: async (args) => {
      const postId = args.postId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_reposted_by",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/tweets/${encodeURIComponent(postId)}/retweeted_by`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/users/reposted-by",
            query: {
              postId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseUsersResponse(payload);
        },
      });
    },
    blockUser: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.block_user",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: `/2/users/${encodeURIComponent(args.userId)}/blocking`,
            jsonBody: {
              target_user_id: args.targetUserId,
            },
          },
          {
            method: "POST",
            path: "/write/blocks/create",
            jsonBody: {
              userId: args.userId,
              targetUserId: args.targetUserId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseRelationshipResponse(payload, args.userId, args.targetUserId);
        },
      });
    },
    unblockUser: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.unblock_user",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "DELETE",
            path: `/2/users/${encodeURIComponent(args.userId)}/blocking/${encodeURIComponent(args.targetUserId)}`,
          },
          {
            method: "POST",
            path: "/write/blocks/delete",
            jsonBody: {
              userId: args.userId,
              targetUserId: args.targetUserId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseRelationshipResponse(payload, args.userId, args.targetUserId);
        },
      });
    },
    getBlockedUsers: async (args) => {
      const userId = args.userId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_blocked_users",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/users/${encodeURIComponent(userId)}/blocking`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/users/blocked",
            query: {
              userId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseUsersResponse(payload);
        },
      });
    },
    muteUser: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.mute_user",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: `/2/users/${encodeURIComponent(args.userId)}/muting`,
            jsonBody: {
              target_user_id: args.targetUserId,
            },
          },
          {
            method: "POST",
            path: "/write/mutes/create",
            jsonBody: {
              userId: args.userId,
              targetUserId: args.targetUserId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseRelationshipResponse(payload, args.userId, args.targetUserId);
        },
      });
    },
    unmuteUser: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.unmute_user",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "DELETE",
            path: `/2/users/${encodeURIComponent(args.userId)}/muting/${encodeURIComponent(args.targetUserId)}`,
          },
          {
            method: "POST",
            path: "/write/mutes/delete",
            jsonBody: {
              userId: args.userId,
              targetUserId: args.targetUserId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseRelationshipResponse(payload, args.userId, args.targetUserId);
        },
      });
    },
    getMutedUsers: async (args) => {
      const userId = args.userId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_muted_users",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/users/${encodeURIComponent(userId)}/muting`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/users/muted",
            query: {
              userId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseUsersResponse(payload);
        },
      });
    },
    createBookmark: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.create_bookmark",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: `/2/users/${encodeURIComponent(args.userId)}/bookmarks`,
            jsonBody: {
              tweet_id: args.postId,
            },
          },
          {
            method: "POST",
            path: "/write/bookmarks/create",
            jsonBody: {
              userId: args.userId,
              postId: args.postId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseEngagementResponse(payload, args.userId, args.postId);
        },
      });
    },
    deleteBookmark: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.delete_bookmark",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "DELETE",
            path: `/2/users/${encodeURIComponent(args.userId)}/bookmarks/${encodeURIComponent(args.postId)}`,
          },
          {
            method: "POST",
            path: "/write/bookmarks/delete",
            jsonBody: {
              userId: args.userId,
              postId: args.postId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseEngagementResponse(payload, args.userId, args.postId);
        },
      });
    },
    getBookmarks: async (args) => {
      const userId = args.userId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_bookmarks",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/users/${encodeURIComponent(userId)}/bookmarks`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/posts/bookmarks",
            query: {
              userId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          const parsed = parseSearchResponse(payload);
          return parsed ? { posts: parsed.posts, nextCursor: parsed.nextCursor } : null;
        },
      });
    },
    sendDm: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.send_dm",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: `/2/dm_conversations/${encodeURIComponent(args.conversationId)}/messages`,
            jsonBody: {
              text: args.text,
            },
          },
          {
            method: "POST",
            path: "/write/dm/send",
            jsonBody: {
              conversationId: args.conversationId,
              text: args.text,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseSendDmResponse(payload);
        },
      });
    },
    createDmConversation: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.create_dm_conversation",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/2/dm_conversations",
            jsonBody: {
              conversation_type: "Group",
              participant_ids: args.participantIds,
              ...(typeof args.text === "string" ? { text: args.text } : {}),
            },
          },
          {
            method: "POST",
            path: "/write/dm/conversations/create",
            jsonBody: {
              participantIds: args.participantIds,
              ...(typeof args.text === "string" ? { text: args.text } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseCreateDmConversationResponse(payload, args.participantIds);
        },
      });
    },
    getDmEvents: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_dm_events",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/2/dm_events",
            query: {
              max_results: String(args.maxResults),
              ...(args.conversationId ? { dm_conversation_id: args.conversationId } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/dm/events",
            query: {
              limit: String(args.maxResults),
              ...(args.conversationId ? { conversationId: args.conversationId } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseDmEventsResponse(payload);
        },
      });
    },
    searchUsers: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.search_users",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/2/users/search",
            query: {
              query: args.query,
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/users/search",
            query: {
              query: args.query,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseUsersResponse(payload);
        },
      });
    },
    getUsersByUsernames: async (args) => {
      const usernames = args.usernames
        .map((entry) => entry.trim().replace(/^@+/, ""))
        .filter((entry) => entry.length > 0);
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_users_by_usernames",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/2/users/by",
            query: {
              usernames: usernames.join(","),
            },
          },
          {
            method: "GET",
            path: "/list/users/by-usernames",
            query: {
              usernames: usernames.join(","),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseUsersResponse(payload);
        },
      });
    },
    createList: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.create_list",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/2/lists",
            jsonBody: {
              name: args.name,
              ...(typeof args.description === "string" ? { description: args.description } : {}),
              ...(typeof args.isPrivate === "boolean" ? { private: args.isPrivate } : {}),
            },
          },
          {
            method: "POST",
            path: "/write/lists/create",
            jsonBody: {
              name: args.name,
              ...(typeof args.description === "string" ? { description: args.description } : {}),
              ...(typeof args.isPrivate === "boolean" ? { isPrivate: args.isPrivate } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseListResponse(payload);
        },
      });
    },
    deleteList: async (args) => {
      const listId = args.listId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.delete_list",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "DELETE",
            path: `/2/lists/${encodeURIComponent(listId)}`,
          },
          {
            method: "POST",
            path: "/write/lists/delete",
            jsonBody: {
              listId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseDeleteResponse(payload, listId);
        },
      });
    },
    updateList: async (args) => {
      const listId = args.listId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.update_list",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "PUT",
            path: `/2/lists/${encodeURIComponent(listId)}`,
            jsonBody: {
              ...(typeof args.name === "string" ? { name: args.name } : {}),
              ...(typeof args.description === "string" ? { description: args.description } : {}),
              ...(typeof args.isPrivate === "boolean" ? { private: args.isPrivate } : {}),
            },
          },
          {
            method: "POST",
            path: "/write/lists/update",
            jsonBody: {
              listId,
              ...(typeof args.name === "string" ? { name: args.name } : {}),
              ...(typeof args.description === "string" ? { description: args.description } : {}),
              ...(typeof args.isPrivate === "boolean" ? { isPrivate: args.isPrivate } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseListResponse(payload);
        },
      });
    },
    getList: async (args) => {
      const listId = args.listId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_list",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/lists/${encodeURIComponent(listId)}`,
          },
          {
            method: "GET",
            path: "/list/lists/get",
            query: {
              listId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseListResponse(payload);
        },
      });
    },
    getOwnedLists: async (args) => {
      const userId = args.userId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_owned_lists",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/users/${encodeURIComponent(userId)}/owned_lists`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/lists/owned",
            query: {
              userId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseListsResponse(payload);
        },
      });
    },
    addListMember: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.add_list_member",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: `/2/lists/${encodeURIComponent(args.listId)}/members`,
            jsonBody: {
              user_id: args.userId,
            },
          },
          {
            method: "POST",
            path: "/write/lists/members/add",
            jsonBody: {
              listId: args.listId,
              userId: args.userId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseListMemberResponse(payload, args.listId, args.userId);
        },
      });
    },
    removeListMember: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "x.sdk.remove_list_member",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "DELETE",
            path: `/2/lists/${encodeURIComponent(args.listId)}/members/${encodeURIComponent(args.userId)}`,
          },
          {
            method: "POST",
            path: "/write/lists/members/remove",
            jsonBody: {
              listId: args.listId,
              userId: args.userId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseListMemberResponse(payload, args.listId, args.userId);
        },
      });
    },
    getListMembers: async (args) => {
      const listId = args.listId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_list_members",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/lists/${encodeURIComponent(listId)}/members`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/lists/members",
            query: {
              listId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseUsersResponse(payload);
        },
      });
    },
    getListTweets: async (args) => {
      const listId = args.listId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_list_tweets",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/lists/${encodeURIComponent(listId)}/tweets`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/lists/tweets",
            query: {
              listId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          const parsed = parseSearchResponse(payload);
          return parsed ? { posts: parsed.posts, nextCursor: parsed.nextCursor } : null;
        },
      });
    },
    getHomeTimeline: async (args) => {
      const userId = args.userId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_home_timeline",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/2/users/${encodeURIComponent(userId)}/timelines/reverse_chronological`,
            query: {
              max_results: String(args.maxResults),
              ...(args.cursor ? { pagination_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/posts/home-timeline",
            query: {
              userId,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          const parsed = parseSearchResponse(payload);
          return parsed ? { posts: parsed.posts, nextCursor: parsed.nextCursor } : null;
        },
      });
    },
    searchAllPosts: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.search_all_posts",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/2/tweets/search/all",
            query: {
              query: args.query,
              max_results: String(args.maxResults),
              ...(args.cursor ? { next_token: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/posts/all",
            query: {
              q: args.query,
              limit: String(args.maxResults),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseSearchResponse(payload);
        },
      });
    },
    getPostCounts: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "x.sdk.get_post_counts",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/2/tweets/counts/recent",
            query: {
              query: args.query,
            },
          },
          {
            method: "GET",
            path: "/list/posts/counts",
            query: {
              query: args.query,
            },
          },
        ],
        parsePayload: (payload) => {
          return parsePostCountsResponse(payload, args.query);
        },
      });
    },
  };
};

export type { XApiCreatePostResponse, XApiSearchResponse, XGatewaySearchResponse };
