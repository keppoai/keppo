import { safeFetchWithRetry } from "../../provider-write-utils.js";
import { createErrorTextSignals, hasAllWords, hasAnyWord, hasErrorCode } from "../error-signals.js";
import type {
  RedditApiCreatePostResponse,
  RedditApiSearchListingResponse,
  RedditComment,
  RedditCreateCommentResponse,
  RedditCreatePostResponse,
  RedditDistinguishResponse,
  RedditEditPostResponse,
  RedditGatewaySearchResponse,
  RedditGetPostCommentsResponse,
  RedditInfoItem,
  RedditListPostsArgs,
  RedditMessage,
  RedditPost,
  RedditReadAllMessagesResponse,
  RedditReadMessageResponse,
  RedditReplyModmailResponse,
  RedditReportContentResponse,
  RedditSelectFlairResponse,
  RedditSearchPostsArgs,
  RedditStickyPostResponse,
  RedditSubredditInfo,
  RedditSubredditRule,
  RedditSubscribeResponse,
  RedditThingActionResponse,
  RedditTypedHttpErrorCode,
  RedditUser,
  RedditUserOverview,
  RedditVoteResponse,
  RedditModLogEntry,
  RedditModmailConversation,
  RedditModmailConversationSummary,
  RedditModerationItem,
} from "./types.js";

type RequestVariant = {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  jsonBody?: Record<string, unknown>;
  formBody?: URLSearchParams;
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
  fallback: RedditTypedHttpErrorCode = "provider_error",
): RedditTypedHttpErrorCode => {
  const lowerMessage = (input: unknown): string => {
    if (typeof input === "string") {
      return input.toLowerCase();
    }
    return "";
  };

  if (status === 401 || status === 403) {
    return "invalid_token";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 504) {
    return "timeout";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 400 || status === 422) {
    return "invalid_request";
  }

  if (isRecord(payload)) {
    const code = lowerMessage(payload.code);
    const error = lowerMessage(payload.error);
    const reason = lowerMessage(payload.reason);
    const message = lowerMessage(payload.message);
    const json = isRecord(payload.json) ? payload.json : null;
    const jsonErrors = Array.isArray(json?.errors) ? json?.errors : [];
    const signals = createErrorTextSignals(
      code,
      error,
      reason,
      message,
      ...jsonErrors.map((entry) => String(entry)),
    );

    if (
      hasErrorCode(signals, "subreddit_not_found") ||
      hasAllWords(signals, "subreddit", "does", "not", "exist")
    ) {
      return "subreddit_not_found";
    }
    if (hasErrorCode(signals, "invalid_token") || hasAllWords(signals, "not", "logged", "in")) {
      return "invalid_token";
    }
    if (hasErrorCode(signals, "rate_limited") || hasAllWords(signals, "too", "many", "requests")) {
      return "rate_limited";
    }
    if (hasErrorCode(signals, "timeout", "gateway_timeout")) {
      return "timeout";
    }
    if (hasAnyWord(signals, "invalid", "missing")) {
      return "invalid_request";
    }
  }

  return fallback;
};

const toRedditPost = (value: unknown): RedditPost | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = String(value.id ?? value.name ?? "").trim();
  const title = String(value.title ?? "").trim();
  const subreddit = String(value.subreddit ?? "all").trim();
  if (!id || !title) {
    return null;
  }

  return {
    id,
    subreddit,
    title,
    ...(typeof value.body === "string"
      ? { body: value.body }
      : typeof value.selftext === "string"
        ? { body: value.selftext }
        : {}),
    ...(typeof value.score === "number" ? { score: value.score } : {}),
    ...(typeof value.author === "string" ? { author: value.author } : {}),
    ...(typeof value.createdUtc === "number"
      ? { createdUtc: value.createdUtc }
      : typeof value.created_utc === "number"
        ? { createdUtc: value.created_utc }
        : {}),
  };
};

const toRedditComment = (value: unknown): RedditComment | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = String(value.id ?? value.name ?? "").trim();
  const parentId = String(value.parentId ?? value.parent_id ?? "").trim();
  const postId = String(value.postId ?? value.link_id ?? "").trim();
  const body = String(value.body ?? "").trim();
  if (!id || !parentId || !postId || !body) {
    return null;
  }

  return {
    id,
    parentId,
    postId,
    body,
    ...(typeof value.author === "string" ? { author: value.author } : {}),
    ...(typeof value.score === "number" ? { score: value.score } : {}),
  };
};

const toRedditMessage = (value: unknown): RedditMessage | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = String(value.id ?? value.name ?? "").trim();
  const to = String(value.to ?? "").trim();
  const from = String(value.from ?? value.author ?? "").trim();
  const subject = String(value.subject ?? "").trim();
  const body = String(value.body ?? "").trim();
  const unread = value.unread !== false;

  if (!id || !to || !from || !subject || !body) {
    return null;
  }

  return {
    id,
    to,
    from,
    subject,
    body,
    unread,
  };
};

const toRedditSubreddit = (value: unknown): RedditSubredditInfo | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = String(value.id ?? value.name ?? "").trim();
  const name = String(value.name ?? value.display_name ?? "").trim();
  const title = String(value.title ?? name).trim();
  if (!id || !name || !title) {
    return null;
  }

  return {
    id,
    name,
    title,
    ...(typeof value.description === "string"
      ? { description: value.description }
      : typeof value.public_description === "string"
        ? { description: value.public_description }
        : {}),
    ...(typeof value.subscribers === "number" ? { subscribers: value.subscribers } : {}),
  };
};

const toRedditUser = (value: unknown): RedditUser | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = String(value.id ?? value.name ?? "").trim();
  const name = String(value.name ?? "").trim();
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    ...(typeof value.commentKarma === "number"
      ? { commentKarma: value.commentKarma }
      : typeof value.comment_karma === "number"
        ? { commentKarma: value.comment_karma }
        : {}),
    ...(typeof value.linkKarma === "number"
      ? { linkKarma: value.linkKarma }
      : typeof value.link_karma === "number"
        ? { linkKarma: value.link_karma }
        : {}),
  };
};

const parseSearchResponse = (
  payload: unknown,
): {
  posts: RedditPost[];
  nextCursor?: string | null | undefined;
} | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const data = isRecord(payload.data) ? payload.data : null;
  if (data && Array.isArray(data.children)) {
    const posts = data.children
      .map((entry) => (isRecord(entry) ? toRedditPost(entry.data) : null))
      .filter((entry): entry is RedditPost => entry !== null);
    const nextCursor = typeof data.after === "string" ? data.after : null;
    return {
      posts,
      ...(nextCursor ? { nextCursor } : {}),
    } satisfies {
      posts: RedditPost[];
      nextCursor?: string | null | undefined;
    };
  }

  if (Array.isArray(payload.posts)) {
    const gatewayPayload = payload as RedditGatewaySearchResponse;
    const posts = gatewayPayload.posts
      .map((entry) => toRedditPost(entry))
      .filter((entry): entry is RedditPost => entry !== null);
    return {
      posts,
      ...(gatewayPayload.next_cursor !== undefined
        ? { nextCursor: gatewayPayload.next_cursor }
        : {}),
    };
  }

  return null;
};

const parseSubredditSearchResponse = (
  payload: unknown,
): {
  subreddits: RedditSubredditInfo[];
  nextCursor?: string | null | undefined;
} | null => {
  if (!isRecord(payload)) {
    return null;
  }

  if (Array.isArray(payload.subreddits)) {
    const subreddits = payload.subreddits
      .map((entry) => toRedditSubreddit(entry))
      .filter((entry): entry is RedditSubredditInfo => entry !== null);
    const nextCursor = typeof payload.next_cursor === "string" ? payload.next_cursor : null;
    return {
      subreddits,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  const data = isRecord(payload.data) ? payload.data : null;
  if (data && Array.isArray(data.children)) {
    const subreddits = data.children
      .map((entry) => (isRecord(entry) ? toRedditSubreddit(entry.data) : null))
      .filter((entry): entry is RedditSubredditInfo => entry !== null);
    const nextCursor = typeof data.after === "string" ? data.after : null;
    return {
      subreddits,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  return null;
};

const parseUserOverviewResponse = (
  payload: unknown,
  username: string,
): RedditUserOverview | null => {
  if (isRecord(payload) && Array.isArray(payload.posts) && Array.isArray(payload.comments)) {
    const posts = payload.posts
      .map((entry) => toRedditPost(entry))
      .filter((entry): entry is RedditPost => entry !== null);
    const comments = payload.comments
      .map((entry) => toRedditComment(entry))
      .filter((entry): entry is RedditComment => entry !== null);
    return {
      username,
      posts,
      comments,
    };
  }

  if (isRecord(payload)) {
    const data = isRecord(payload.data) ? payload.data : null;
    const children = Array.isArray(data?.children) ? data.children : [];
    const posts: RedditPost[] = [];
    const comments: RedditComment[] = [];
    for (const entry of children) {
      if (!isRecord(entry)) {
        continue;
      }
      const kind = String(entry.kind ?? "");
      if (kind === "t3") {
        const post = toRedditPost(entry.data);
        if (post) {
          posts.push(post);
        }
      } else if (kind === "t1") {
        const comment = toRedditComment(entry.data);
        if (comment) {
          comments.push(comment);
        }
      }
    }
    return { username, posts, comments };
  }

  return null;
};

const parseCreatePostResponse = (
  payload: unknown,
  fallbackSubreddit: string,
  fallbackTitle: string,
): RedditCreatePostResponse | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const apiPayload = payload as RedditApiCreatePostResponse;
  const jsonData = isRecord(apiPayload.json?.data) ? apiPayload.json?.data : null;

  const id = String(jsonData?.id ?? apiPayload.id ?? apiPayload.name ?? "").trim();
  const name = String(jsonData?.name ?? apiPayload.name ?? apiPayload.id ?? "").trim();
  if (!id && !name) {
    return null;
  }

  const normalizedId = id || name;
  const normalizedName = name || id;
  const subreddit = String(jsonData?.subreddit ?? apiPayload.subreddit ?? fallbackSubreddit).trim();
  const title = String(jsonData?.title ?? apiPayload.title ?? fallbackTitle).trim();

  return {
    id: normalizedId,
    name: normalizedName,
    subreddit: subreddit || fallbackSubreddit,
    title: title || fallbackTitle,
    ...(typeof (jsonData?.url ?? apiPayload.url) === "string"
      ? { url: String(jsonData?.url ?? apiPayload.url) }
      : {}),
  };
};

const parseCreateCommentResponse = (payload: unknown): RedditCreateCommentResponse | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const direct = toRedditComment(payload);
  if (direct) {
    return {
      id: direct.id,
      parentId: direct.parentId,
      postId: direct.postId,
      body: direct.body,
    };
  }

  const json = isRecord(payload.json) ? payload.json : null;
  const data = isRecord(json?.data) ? json.data : null;
  const things = Array.isArray(data?.things) ? data?.things : [];
  for (const thing of things) {
    const comment = isRecord(thing) ? toRedditComment(thing.data ?? thing) : null;
    if (comment) {
      return {
        id: comment.id,
        parentId: comment.parentId,
        postId: comment.postId,
        body: comment.body,
      };
    }
  }

  return null;
};

const parsePostCommentsResponse = (payload: unknown): RedditGetPostCommentsResponse | null => {
  if (isRecord(payload)) {
    if (isRecord(payload.post) && Array.isArray(payload.comments)) {
      const post = toRedditPost(payload.post);
      if (!post) {
        return null;
      }
      const comments = payload.comments
        .map((entry) => toRedditComment(entry))
        .filter((entry): entry is RedditComment => entry !== null);
      return { post, comments };
    }

    const data = isRecord(payload.data) ? payload.data : null;
    if (data && Array.isArray(data.children) && data.children.length > 0) {
      const post = toRedditPost((data.children[0] as Record<string, unknown>).data);
      if (!post) {
        return null;
      }
      return { post, comments: [] };
    }
  }

  if (Array.isArray(payload) && payload.length >= 2) {
    const postListing = isRecord(payload[0]) ? payload[0] : null;
    const commentListing = isRecord(payload[1]) ? payload[1] : null;
    const postData = isRecord(postListing?.data) ? postListing?.data : null;
    const commentData = isRecord(commentListing?.data) ? commentListing?.data : null;

    const post =
      postData && Array.isArray(postData.children)
        ? toRedditPost((postData.children[0] as Record<string, unknown>)?.data)
        : null;
    if (!post) {
      return null;
    }

    const comments =
      commentData && Array.isArray(commentData.children)
        ? commentData.children
            .map((entry) => (isRecord(entry) ? toRedditComment(entry.data) : null))
            .filter((entry): entry is RedditComment => entry !== null)
        : [];

    return { post, comments };
  }

  return null;
};

const parseInfoResponse = (payload: unknown): { items: RedditInfoItem[] } | null => {
  if (isRecord(payload) && Array.isArray(payload.items)) {
    const items = payload.items
      .map((entry): RedditInfoItem | null => {
        if (!isRecord(entry)) {
          return null;
        }
        const kind = String(entry.kind ?? "");
        if (kind === "post") {
          const post = toRedditPost(entry.post);
          return post ? { kind: "post", post } : null;
        }
        if (kind === "comment") {
          const comment = toRedditComment(entry.comment);
          return comment ? { kind: "comment", comment } : null;
        }
        if (kind === "subreddit") {
          const subreddit = toRedditSubreddit(entry.subreddit);
          return subreddit ? { kind: "subreddit", subreddit } : null;
        }
        return null;
      })
      .filter((entry): entry is RedditInfoItem => entry !== null);
    return { items };
  }

  if (isRecord(payload)) {
    const data = isRecord(payload.data) ? payload.data : null;
    const children = Array.isArray(data?.children) ? data.children : [];
    const items = children
      .map((entry): RedditInfoItem | null => {
        if (!isRecord(entry)) {
          return null;
        }
        const kind = String(entry.kind ?? "");
        if (kind === "t3") {
          const post = toRedditPost(entry.data);
          return post ? { kind: "post", post } : null;
        }
        if (kind === "t1") {
          const comment = toRedditComment(entry.data);
          return comment ? { kind: "comment", comment } : null;
        }
        if (kind === "t5") {
          const subreddit = toRedditSubreddit(entry.data);
          return subreddit ? { kind: "subreddit", subreddit } : null;
        }
        return null;
      })
      .filter((entry): entry is RedditInfoItem => entry !== null);
    return { items };
  }

  return null;
};

const parseVoteResponse = (
  payload: unknown,
  fallbackThingId: string,
  fallbackDirection: number,
): RedditVoteResponse | null => {
  if (isRecord(payload)) {
    const thingId = String(payload.thingId ?? payload.id ?? fallbackThingId).trim();
    const direction = Number(payload.direction ?? fallbackDirection);
    const score = Number(payload.score ?? 0);
    if (thingId) {
      return {
        thingId,
        direction: Number.isFinite(direction) ? Math.trunc(direction) : fallbackDirection,
        score: Number.isFinite(score) ? score : 0,
      };
    }
  }

  if (payload === null || payload === undefined || payload === "") {
    return {
      thingId: fallbackThingId,
      direction: fallbackDirection,
      score: 0,
    };
  }

  return null;
};

const parseEditPostResponse = (
  payload: unknown,
  fallbackThingId: string,
  fallbackBody: string,
): RedditEditPostResponse | null => {
  if (isRecord(payload)) {
    const thingId = String(payload.thingId ?? payload.id ?? fallbackThingId).trim();
    const body = String(payload.body ?? payload.text ?? fallbackBody).trim();
    if (thingId && body) {
      return {
        thingId,
        body,
        edited: payload.edited !== false,
      };
    }
  }

  if (payload === null || payload === undefined || payload === "") {
    return {
      thingId: fallbackThingId,
      body: fallbackBody,
      edited: true,
    };
  }

  return null;
};

const parseThingActionResponse = (
  payload: unknown,
  fallbackThingId: string,
): RedditThingActionResponse | null => {
  if (isRecord(payload)) {
    const thingId = String(payload.thingId ?? payload.id ?? fallbackThingId).trim();
    const success = payload.success !== false;
    if (thingId) {
      return {
        thingId,
        success,
      };
    }
  }

  if (payload === null || payload === undefined || payload === "") {
    return {
      thingId: fallbackThingId,
      success: true,
    };
  }

  return null;
};

const parseReportContentResponse = (
  payload: unknown,
  fallbackThingId: string,
  fallbackReason: string,
): RedditReportContentResponse | null => {
  if (isRecord(payload)) {
    const thingId = String(payload.thingId ?? payload.id ?? fallbackThingId).trim();
    const reason = String(payload.reason ?? fallbackReason).trim();
    if (thingId && reason) {
      return {
        thingId,
        reason,
        reported: payload.reported !== false,
      };
    }
  }

  if (payload === null || payload === undefined || payload === "") {
    return {
      thingId: fallbackThingId,
      reason: fallbackReason,
      reported: true,
    };
  }

  return null;
};

const parseReadMessageResponse = (
  payload: unknown,
  fallbackMessageId: string,
): RedditReadMessageResponse | null => {
  if (isRecord(payload)) {
    const messageId = String(payload.messageId ?? payload.id ?? fallbackMessageId).trim();
    if (messageId) {
      return {
        messageId,
        unread: payload.unread === true,
      };
    }
  }

  if (payload === null || payload === undefined || payload === "") {
    return {
      messageId: fallbackMessageId,
      unread: false,
    };
  }

  return null;
};

const parseReadAllMessagesResponse = (payload: unknown): RedditReadAllMessagesResponse | null => {
  if (isRecord(payload)) {
    const readCount = Number(payload.readCount ?? payload.count ?? 0);
    if (Number.isFinite(readCount)) {
      return {
        readCount: Math.max(0, Math.trunc(readCount)),
      };
    }
  }

  if (payload === null || payload === undefined || payload === "") {
    return {
      readCount: 0,
    };
  }

  return null;
};

const parseComposeMessageResponse = (
  payload: unknown,
  fallback: { to: string; subject: string; body: string },
): RedditMessage | null => {
  if (isRecord(payload)) {
    const parsed = toRedditMessage(payload);
    if (parsed) {
      return parsed;
    }
  }

  return {
    id: "t4_unknown",
    to: fallback.to,
    from: "unknown",
    subject: fallback.subject,
    body: fallback.body,
    unread: true,
  };
};

const parseListMessagesResponse = (payload: unknown): { messages: RedditMessage[] } | null => {
  if (isRecord(payload) && Array.isArray(payload.messages)) {
    return {
      messages: payload.messages
        .map((entry) => toRedditMessage(entry))
        .filter((entry): entry is RedditMessage => entry !== null),
    };
  }

  if (isRecord(payload)) {
    const data = isRecord(payload.data) ? payload.data : null;
    if (data && Array.isArray(data.children)) {
      return {
        messages: data.children
          .map((entry) => (isRecord(entry) ? toRedditMessage(entry.data) : null))
          .filter((entry): entry is RedditMessage => entry !== null),
      };
    }
  }

  return null;
};

const parseSubredditInfoResponse = (
  payload: unknown,
): { subreddit: RedditSubredditInfo } | null => {
  if (isRecord(payload) && isRecord(payload.subreddit)) {
    const subreddit = toRedditSubreddit(payload.subreddit);
    return subreddit ? { subreddit } : null;
  }

  if (isRecord(payload)) {
    const data = isRecord(payload.data) ? payload.data : payload;
    const subreddit = toRedditSubreddit(data);
    return subreddit ? { subreddit } : null;
  }

  return null;
};

const parseMeResponse = (payload: unknown): { me: RedditUser } | null => {
  if (isRecord(payload) && isRecord(payload.me)) {
    const me = toRedditUser(payload.me);
    return me ? { me } : null;
  }

  const me = toRedditUser(payload);
  return me ? { me } : null;
};

const parseUserAboutResponse = (payload: unknown): { user: RedditUser } | null => {
  if (isRecord(payload) && isRecord(payload.user)) {
    const user = toRedditUser(payload.user);
    return user ? { user } : null;
  }

  if (isRecord(payload)) {
    const data = isRecord(payload.data) ? payload.data : payload;
    const user = toRedditUser(data);
    return user ? { user } : null;
  }

  return null;
};

const toModerationItem = (value: unknown): RedditModerationItem | null => {
  if (!isRecord(value)) {
    return null;
  }
  const thingId = String(value.thingId ?? value.id ?? "").trim();
  const subreddit = String(value.subreddit ?? "all").trim();
  if (!thingId || !subreddit) {
    return null;
  }

  const kindValue = String(value.kind ?? "post");
  const kind: "post" | "comment" = kindValue === "comment" ? "comment" : "post";
  const reports = Number(value.reports ?? 0);

  return {
    thingId,
    subreddit,
    kind,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.body === "string" ? { body: value.body } : {}),
    ...(typeof value.author === "string" ? { author: value.author } : {}),
    reports: Number.isFinite(reports) ? reports : 0,
    ...(typeof value.removed === "boolean" ? { removed: value.removed } : {}),
  };
};

const toModLogEntry = (value: unknown): RedditModLogEntry | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = String(value.id ?? "").trim();
  const action = String(value.action ?? "").trim();
  const moderator = String(value.moderator ?? "").trim();
  const createdUtc = Number(value.createdUtc ?? value.created_utc ?? 0);
  if (!id || !action || !moderator || !Number.isFinite(createdUtc)) {
    return null;
  }

  return {
    id,
    action,
    moderator,
    createdUtc,
    ...(typeof value.targetThingId === "string" ? { targetThingId: value.targetThingId } : {}),
    ...(typeof value.details === "string" ? { details: value.details } : {}),
  };
};

const toSubredditRule = (value: unknown): RedditSubredditRule | null => {
  if (!isRecord(value)) {
    return null;
  }
  const shortName = String(value.shortName ?? value.short_name ?? "").trim();
  const description = String(value.description ?? "").trim();
  if (!shortName || !description) {
    return null;
  }
  const priority = Number(value.priority ?? Number.NaN);
  return {
    shortName,
    description,
    ...(typeof value.kind === "string" ? { kind: value.kind } : {}),
    ...(Number.isFinite(priority) ? { priority } : {}),
    ...(typeof value.violationReason === "string"
      ? { violationReason: value.violationReason }
      : {}),
  };
};

const toModmailMessage = (value: unknown): RedditModmailConversation["messages"][number] | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = String(value.id ?? "").trim();
  const author = String(value.author ?? "").trim();
  const body = String(value.body ?? "").trim();
  const createdUtc = Number(value.createdUtc ?? value.created_utc ?? 0);
  if (!id || !author || !body || !Number.isFinite(createdUtc)) {
    return null;
  }
  return {
    id,
    author,
    body,
    isInternal: value.isInternal === true,
    createdUtc,
  };
};

const toModmailConversationSummary = (value: unknown): RedditModmailConversationSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = String(value.id ?? "").trim();
  const subreddit = String(value.subreddit ?? "all").trim();
  const subject = String(value.subject ?? "").trim();
  const participant = String(value.participant ?? "").trim();
  const state = String(value.state ?? "new").trim();
  const lastUpdatedUtc = Number(value.lastUpdatedUtc ?? value.last_updated_utc ?? 0);
  if (!id || !subreddit || !subject || !participant || !state || !Number.isFinite(lastUpdatedUtc)) {
    return null;
  }
  return {
    id,
    subreddit,
    subject,
    participant,
    state,
    lastUpdatedUtc,
  };
};

const parseModerationItemsResponse = (
  payload: unknown,
): { items: RedditModerationItem[] } | null => {
  if (isRecord(payload) && Array.isArray(payload.items)) {
    return {
      items: payload.items
        .map((entry) => toModerationItem(entry))
        .filter((entry): entry is RedditModerationItem => entry !== null),
    };
  }
  return null;
};

const parseModLogResponse = (payload: unknown): { entries: RedditModLogEntry[] } | null => {
  if (isRecord(payload) && Array.isArray(payload.entries)) {
    return {
      entries: payload.entries
        .map((entry) => toModLogEntry(entry))
        .filter((entry): entry is RedditModLogEntry => entry !== null),
    };
  }
  return null;
};

const parseSubredditRulesResponse = (payload: unknown): { rules: RedditSubredditRule[] } | null => {
  if (isRecord(payload) && Array.isArray(payload.rules)) {
    return {
      rules: payload.rules
        .map((entry) => toSubredditRule(entry))
        .filter((entry): entry is RedditSubredditRule => entry !== null),
    };
  }
  return null;
};

const parseModmailListResponse = (
  payload: unknown,
): { conversations: RedditModmailConversationSummary[] } | null => {
  if (isRecord(payload) && Array.isArray(payload.conversations)) {
    return {
      conversations: payload.conversations
        .map((entry) => toModmailConversationSummary(entry))
        .filter((entry): entry is RedditModmailConversationSummary => entry !== null),
    };
  }
  return null;
};

const parseGetModmailResponse = (
  payload: unknown,
): { conversation: RedditModmailConversation } | null => {
  if (!isRecord(payload)) {
    return null;
  }
  const source = isRecord(payload.conversation) ? payload.conversation : payload;
  const summary = toModmailConversationSummary(source);
  const rawMessages = Array.isArray(source.messages) ? source.messages : [];
  const messages = rawMessages
    .map((entry) => toModmailMessage(entry))
    .filter((entry): entry is RedditModmailConversation["messages"][number] => entry !== null);
  if (!summary) {
    return null;
  }
  return {
    conversation: {
      ...summary,
      messages,
    },
  };
};

const parseDistinguishResponse = (
  payload: unknown,
  fallbackThingId: string,
  fallbackSticky: boolean,
): RedditDistinguishResponse | null => {
  const base = parseThingActionResponse(payload, fallbackThingId);
  if (!base) {
    return null;
  }
  return {
    ...base,
    distinguished: true,
    sticky:
      isRecord(payload) && typeof payload.sticky === "boolean" ? payload.sticky : fallbackSticky,
  };
};

const parseStickyPostResponse = (
  payload: unknown,
  fallbackThingId: string,
  fallbackState: boolean,
  fallbackSlot: number,
): RedditStickyPostResponse | null => {
  const base = parseThingActionResponse(payload, fallbackThingId);
  if (!base) {
    return null;
  }
  const slot =
    isRecord(payload) && Number.isFinite(Number(payload.slot))
      ? Number(payload.slot)
      : fallbackSlot;
  const state =
    isRecord(payload) && typeof payload.state === "boolean" ? payload.state : fallbackState;
  return {
    ...base,
    state,
    slot,
  };
};

const parseSelectFlairResponse = (
  payload: unknown,
  fallback: { subreddit: string; thingId: string; text: string; cssClass?: string | undefined },
): RedditSelectFlairResponse | null => {
  const base = parseThingActionResponse(payload, fallback.thingId);
  if (!base) {
    return null;
  }
  const subreddit =
    isRecord(payload) && typeof payload.subreddit === "string"
      ? payload.subreddit
      : fallback.subreddit;
  const text = isRecord(payload) && typeof payload.text === "string" ? payload.text : fallback.text;
  if (!subreddit || !text) {
    return null;
  }
  const cssClass =
    isRecord(payload) && typeof payload.cssClass === "string"
      ? payload.cssClass
      : fallback.cssClass;
  return {
    ...base,
    subreddit,
    text,
    ...(cssClass ? { cssClass } : {}),
  };
};

const parseSubscribeResponse = (
  payload: unknown,
  fallback: { subreddit: string; action: "sub" | "unsub" },
): RedditSubscribeResponse | null => {
  if (isRecord(payload)) {
    const subreddit =
      typeof payload.subreddit === "string" ? payload.subreddit.trim() : fallback.subreddit;
    const subscribed =
      typeof payload.subscribed === "boolean" ? payload.subscribed : fallback.action === "sub";
    if (subreddit.length === 0) {
      return null;
    }
    return { subreddit, subscribed };
  }

  if (payload === null || payload === undefined || payload === "") {
    return {
      subreddit: fallback.subreddit,
      subscribed: fallback.action === "sub",
    };
  }

  return null;
};

const parseReplyModmailResponse = (
  payload: unknown,
  fallback: { conversationId: string; body: string; isInternal: boolean },
): RedditReplyModmailResponse | null => {
  if (isRecord(payload)) {
    const conversationId =
      typeof payload.conversationId === "string"
        ? payload.conversationId.trim()
        : fallback.conversationId;
    const messageId =
      typeof payload.messageId === "string" && payload.messageId.trim().length > 0
        ? payload.messageId.trim()
        : typeof payload.id === "string" && payload.id.trim().length > 0
          ? payload.id.trim()
          : "modmail_unknown";
    const author = typeof payload.author === "string" ? payload.author : "keppo_user";
    const body = typeof payload.body === "string" ? payload.body : fallback.body;
    const isInternal =
      typeof payload.isInternal === "boolean" ? payload.isInternal : fallback.isInternal;
    if (!conversationId || !body) {
      return null;
    }
    return {
      conversationId,
      messageId,
      author,
      body,
      isInternal,
    };
  }
  return null;
};

const requestWithFallback = async <T>(params: RequestParams<T>): Promise<T> => {
  const errors: string[] = [];

  for (const variant of params.variants) {
    const query = new URLSearchParams(variant.query ?? {});
    const url = `${params.baseUrl}${variant.path}${query.toString() ? `?${query.toString()}` : ""}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${params.accessToken}`,
      "User-Automation": "keppo-connector",
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
          ...(variant.formBody ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(variant.jsonBody ? { body: JSON.stringify(variant.jsonBody) } : {}),
        ...(variant.formBody ? { body: variant.formBody.toString() } : {}),
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

export type RedditTypedHttpClient = {
  searchPosts: (args: RedditSearchPostsArgs) => Promise<{
    posts: RedditPost[];
    nextCursor?: string | null | undefined;
  }>;
  listPosts: (args: {
    mode: "hot" | "new" | "top" | "rising" | "controversial";
    subreddit: string;
    limit: number;
    cursor?: string | undefined;
  }) => Promise<{
    posts: RedditPost[];
    nextCursor?: string | null | undefined;
  }>;
  searchSubreddits: (args: {
    query: string;
    limit: number;
    cursor?: string | undefined;
  }) => Promise<{
    subreddits: RedditSubredditInfo[];
    nextCursor?: string | null | undefined;
  }>;
  getUserOverview: (args: {
    username: string;
    limit?: number | undefined;
  }) => Promise<RedditUserOverview>;
  getUserAbout: (args: { username: string }) => Promise<{ user: RedditUser }>;
  createPost: (args: {
    subreddit: string;
    title: string;
    body: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditCreatePostResponse>;
  createComment: (args: {
    parentId: string;
    body: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditCreateCommentResponse>;
  getPostComments: (args: {
    subreddit: string;
    postId: string;
    limit: number;
  }) => Promise<RedditGetPostCommentsResponse>;
  getInfo: (args: { thingIds: string[] }) => Promise<{ items: RedditInfoItem[] }>;
  editPost: (args: {
    thingId: string;
    body: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditEditPostResponse>;
  deletePost: (args: {
    thingId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditThingActionResponse>;
  approve: (args: {
    thingId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditThingActionResponse>;
  removeContent: (args: {
    thingId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditThingActionResponse>;
  lockPost: (args: {
    thingId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditThingActionResponse>;
  unlockPost: (args: {
    thingId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditThingActionResponse>;
  savePost: (args: {
    thingId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditThingActionResponse>;
  unsavePost: (args: {
    thingId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditThingActionResponse>;
  hidePost: (args: {
    thingId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditThingActionResponse>;
  unhidePost: (args: {
    thingId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditThingActionResponse>;
  reportContent: (args: {
    thingId: string;
    reason: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditReportContentResponse>;
  readMessage: (args: {
    messageId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditReadMessageResponse>;
  readAllMessages: (args: {
    idempotencyKey?: string | undefined;
  }) => Promise<RedditReadAllMessagesResponse>;
  vote: (args: {
    thingId: string;
    direction: number;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditVoteResponse>;
  composeMessage: (args: {
    to: string;
    subject: string;
    body: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditMessage>;
  listInbox: (args: { limit: number }) => Promise<{ messages: RedditMessage[] }>;
  listUnreadMessages: (args: { limit: number }) => Promise<{ messages: RedditMessage[] }>;
  listSentMessages: (args: { limit: number }) => Promise<{ messages: RedditMessage[] }>;
  listMentions: (args: { limit: number }) => Promise<{ messages: RedditMessage[] }>;
  getSubredditInfo: (args: { subreddit: string }) => Promise<{ subreddit: RedditSubredditInfo }>;
  getModQueue: (args: {
    subreddit: string;
    limit: number;
    cursor?: string | undefined;
  }) => Promise<{ items: RedditModerationItem[] }>;
  getReports: (args: {
    subreddit: string;
    limit: number;
    cursor?: string | undefined;
  }) => Promise<{ items: RedditModerationItem[] }>;
  getModLog: (args: {
    subreddit: string;
    limit: number;
    cursor?: string | undefined;
  }) => Promise<{ entries: RedditModLogEntry[] }>;
  getSubredditRules: (args: { subreddit: string }) => Promise<{ rules: RedditSubredditRule[] }>;
  listModmail: (args: {
    subreddit: string;
    limit: number;
    cursor?: string | undefined;
  }) => Promise<{ conversations: RedditModmailConversationSummary[] }>;
  getModmail: (args: {
    conversationId: string;
  }) => Promise<{ conversation: RedditModmailConversation }>;
  distinguish: (args: {
    thingId: string;
    sticky?: boolean | undefined;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditDistinguishResponse>;
  stickyPost: (args: {
    thingId: string;
    state: boolean;
    slot?: number | undefined;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditStickyPostResponse>;
  markNsfw: (args: {
    thingId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditThingActionResponse>;
  unmarkNsfw: (args: {
    thingId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditThingActionResponse>;
  spoiler: (args: {
    thingId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditThingActionResponse>;
  unspoiler: (args: {
    thingId: string;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditThingActionResponse>;
  selectFlair: (args: {
    subreddit: string;
    thingId: string;
    text: string;
    cssClass?: string | undefined;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditSelectFlairResponse>;
  subscribe: (args: {
    subreddit: string;
    action: "sub" | "unsub";
    idempotencyKey?: string | undefined;
  }) => Promise<RedditSubscribeResponse>;
  replyModmail: (args: {
    conversationId: string;
    body: string;
    isInternal?: boolean | undefined;
    idempotencyKey?: string | undefined;
  }) => Promise<RedditReplyModmailResponse>;
  getMe: () => Promise<{ me: RedditUser }>;
};

const buildListPostVariants = (
  mode: "hot" | "new" | "top" | "rising" | "controversial",
  subreddit: string,
  args: { limit: number; cursor?: string | undefined },
): RequestVariant[] => {
  return [
    {
      method: "GET",
      path: `/r/${encodeURIComponent(subreddit)}/${mode}`,
      query: {
        limit: String(args.limit),
        ...(args.cursor ? { after: args.cursor } : {}),
      },
    },
    {
      method: "GET",
      path: `/list/posts-${mode}`,
      query: {
        subreddit,
        limit: String(args.limit),
        ...(args.cursor ? { after: args.cursor } : {}),
      },
    },
  ];
};

export const createRedditTypedHttpClient = (options: {
  accessToken: string;
  namespace?: string | undefined;
  baseUrl: string;
}): RedditTypedHttpClient => {
  return {
    searchPosts: async (args) => {
      const normalizedSubreddit = args.subreddit.trim() || "all";
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.search_posts",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/r/${encodeURIComponent(normalizedSubreddit)}/search`,
            query: {
              q: args.query,
              limit: String(args.limit),
              restrict_sr: normalizedSubreddit.toLowerCase() === "all" ? "0" : "1",
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/posts",
            query: {
              subreddit: normalizedSubreddit,
              q: args.query,
              limit: String(args.limit),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseSearchResponse(payload);
        },
      });
    },
    listPosts: async (args) => {
      const normalizedSubreddit = args.subreddit.trim() || "all";
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: `reddit.sdk.list_posts_${args.mode}`,
        baseUrl: options.baseUrl,
        variants: buildListPostVariants(args.mode, normalizedSubreddit, args),
        parsePayload: (payload) => {
          return parseSearchResponse(payload);
        },
      });
    },
    searchSubreddits: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.search_subreddits",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/subreddits/search",
            query: {
              q: args.query,
              limit: String(args.limit),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/subreddits-search",
            query: {
              q: args.query,
              limit: String(args.limit),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseSubredditSearchResponse(payload);
        },
      });
    },
    getUserOverview: async (args) => {
      const username = args.username.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.get_user_overview",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/user/${encodeURIComponent(username)}/overview`,
            query: typeof args.limit === "number" ? { limit: String(args.limit) } : {},
          },
          {
            method: "GET",
            path: "/list/user-overview",
            query: {
              username,
              ...(typeof args.limit === "number" ? { limit: String(args.limit) } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseUserOverviewResponse(payload, username);
        },
      });
    },
    getUserAbout: async (args) => {
      const username = args.username.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.get_user_about",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/user/${encodeURIComponent(username)}/about`,
          },
          {
            method: "GET",
            path: "/read/user-about",
            query: { username },
          },
        ],
        parsePayload: (payload) => {
          return parseUserAboutResponse(payload);
        },
      });
    },
    createPost: async (args) => {
      const normalizedSubreddit = args.subreddit.trim() || "all";
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.create_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/submit",
            formBody: new URLSearchParams({
              sr: normalizedSubreddit,
              title: args.title,
              text: args.body,
              kind: "self",
            }),
          },
          {
            method: "POST",
            path: "/write/posts",
            jsonBody: {
              subreddit: normalizedSubreddit,
              title: args.title,
              body: args.body,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseCreatePostResponse(payload, normalizedSubreddit, args.title);
        },
      });
    },
    createComment: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.create_comment",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/comment",
            formBody: new URLSearchParams({
              thing_id: args.parentId,
              text: args.body,
            }),
          },
          {
            method: "POST",
            path: "/write/comments",
            jsonBody: {
              parentId: args.parentId,
              body: args.body,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseCreateCommentResponse(payload);
        },
      });
    },
    getPostComments: async (args) => {
      const normalizedSubreddit = args.subreddit.trim() || "all";
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.get_post_comments",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/r/${encodeURIComponent(normalizedSubreddit)}/comments/${encodeURIComponent(args.postId)}`,
            query: {
              limit: String(args.limit),
            },
          },
          {
            method: "GET",
            path: "/list/post-comments",
            query: {
              subreddit: normalizedSubreddit,
              postId: args.postId,
              limit: String(args.limit),
            },
          },
        ],
        parsePayload: (payload) => {
          return parsePostCommentsResponse(payload);
        },
      });
    },
    getInfo: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.get_info",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/api/info",
            query: {
              id: args.thingIds.join(","),
            },
          },
          {
            method: "GET",
            path: "/list/info",
            query: {
              thingIds: args.thingIds.join(","),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseInfoResponse(payload);
        },
      });
    },
    editPost: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.edit_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/editusertext",
            formBody: new URLSearchParams({
              thing_id: args.thingId,
              text: args.body,
            }),
          },
          {
            method: "POST",
            path: "/write/posts-edit",
            jsonBody: {
              thingId: args.thingId,
              body: args.body,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseEditPostResponse(payload, args.thingId, args.body);
        },
      });
    },
    deletePost: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.delete_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/del",
            formBody: new URLSearchParams({
              id: args.thingId,
            }),
          },
          {
            method: "POST",
            path: "/write/posts-delete",
            jsonBody: {
              thingId: args.thingId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseThingActionResponse(payload, args.thingId);
        },
      });
    },
    approve: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.approve",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/approve",
            formBody: new URLSearchParams({
              id: args.thingId,
            }),
          },
          {
            method: "POST",
            path: "/write/moderation-approve",
            jsonBody: {
              thingId: args.thingId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseThingActionResponse(payload, args.thingId);
        },
      });
    },
    removeContent: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.remove_content",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/remove",
            formBody: new URLSearchParams({
              id: args.thingId,
            }),
          },
          {
            method: "POST",
            path: "/write/moderation-remove",
            jsonBody: {
              thingId: args.thingId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseThingActionResponse(payload, args.thingId);
        },
      });
    },
    lockPost: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.lock_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/lock",
            formBody: new URLSearchParams({
              id: args.thingId,
            }),
          },
          {
            method: "POST",
            path: "/write/posts-lock",
            jsonBody: {
              thingId: args.thingId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseThingActionResponse(payload, args.thingId);
        },
      });
    },
    unlockPost: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.unlock_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/unlock",
            formBody: new URLSearchParams({
              id: args.thingId,
            }),
          },
          {
            method: "POST",
            path: "/write/posts-unlock",
            jsonBody: {
              thingId: args.thingId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseThingActionResponse(payload, args.thingId);
        },
      });
    },
    savePost: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.save_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/save",
            formBody: new URLSearchParams({
              id: args.thingId,
            }),
          },
          {
            method: "POST",
            path: "/write/posts-save",
            jsonBody: {
              thingId: args.thingId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseThingActionResponse(payload, args.thingId);
        },
      });
    },
    unsavePost: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.unsave_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/unsave",
            formBody: new URLSearchParams({
              id: args.thingId,
            }),
          },
          {
            method: "POST",
            path: "/write/posts-unsave",
            jsonBody: {
              thingId: args.thingId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseThingActionResponse(payload, args.thingId);
        },
      });
    },
    hidePost: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.hide_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/hide",
            formBody: new URLSearchParams({
              id: args.thingId,
            }),
          },
          {
            method: "POST",
            path: "/write/posts-hide",
            jsonBody: {
              thingId: args.thingId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseThingActionResponse(payload, args.thingId);
        },
      });
    },
    unhidePost: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.unhide_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/unhide",
            formBody: new URLSearchParams({
              id: args.thingId,
            }),
          },
          {
            method: "POST",
            path: "/write/posts-unhide",
            jsonBody: {
              thingId: args.thingId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseThingActionResponse(payload, args.thingId);
        },
      });
    },
    reportContent: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.report_content",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/report",
            formBody: new URLSearchParams({
              thing_id: args.thingId,
              reason: args.reason,
            }),
          },
          {
            method: "POST",
            path: "/write/content-report",
            jsonBody: {
              thingId: args.thingId,
              reason: args.reason,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseReportContentResponse(payload, args.thingId, args.reason);
        },
      });
    },
    readMessage: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.read_message",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/read_message",
            formBody: new URLSearchParams({
              id: args.messageId,
            }),
          },
          {
            method: "POST",
            path: "/write/messages-read",
            jsonBody: {
              messageId: args.messageId,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseReadMessageResponse(payload, args.messageId);
        },
      });
    },
    readAllMessages: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.read_all_messages",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/read_all_messages",
            formBody: new URLSearchParams({}),
          },
          {
            method: "POST",
            path: "/write/messages-read-all",
            jsonBody: {},
          },
        ],
        parsePayload: (payload) => {
          return parseReadAllMessagesResponse(payload);
        },
      });
    },
    vote: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.vote",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/vote",
            formBody: new URLSearchParams({
              id: args.thingId,
              dir: String(args.direction),
            }),
          },
          {
            method: "POST",
            path: "/write/vote",
            jsonBody: {
              thingId: args.thingId,
              direction: args.direction,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseVoteResponse(payload, args.thingId, args.direction);
        },
      });
    },
    composeMessage: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.compose_message",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/compose",
            formBody: new URLSearchParams({
              to: args.to,
              subject: args.subject,
              text: args.body,
            }),
          },
          {
            method: "POST",
            path: "/write/messages/compose",
            jsonBody: {
              to: args.to,
              subject: args.subject,
              body: args.body,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseComposeMessageResponse(payload, args);
        },
      });
    },
    listInbox: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.list_inbox",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/message/inbox",
            query: {
              limit: String(args.limit),
            },
          },
          {
            method: "GET",
            path: "/list/messages-inbox",
            query: {
              limit: String(args.limit),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseListMessagesResponse(payload);
        },
      });
    },
    listUnreadMessages: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.list_unread_messages",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/message/unread",
            query: {
              limit: String(args.limit),
            },
          },
          {
            method: "GET",
            path: "/list/messages-unread",
            query: {
              limit: String(args.limit),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseListMessagesResponse(payload);
        },
      });
    },
    listSentMessages: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.list_sent_messages",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/message/sent",
            query: {
              limit: String(args.limit),
            },
          },
          {
            method: "GET",
            path: "/list/messages-sent",
            query: {
              limit: String(args.limit),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseListMessagesResponse(payload);
        },
      });
    },
    listMentions: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.list_mentions",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/message/mentions",
            query: {
              limit: String(args.limit),
            },
          },
          {
            method: "GET",
            path: "/list/messages-mentions",
            query: {
              limit: String(args.limit),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseListMessagesResponse(payload);
        },
      });
    },
    getSubredditInfo: async (args) => {
      const normalizedSubreddit = args.subreddit.trim() || "all";
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.get_subreddit_info",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/r/${encodeURIComponent(normalizedSubreddit)}/about`,
          },
          {
            method: "GET",
            path: "/list/subreddit-info",
            query: {
              subreddit: normalizedSubreddit,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseSubredditInfoResponse(payload);
        },
      });
    },
    getModQueue: async (args) => {
      const normalizedSubreddit = args.subreddit.trim() || "all";
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.get_mod_queue",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/r/${encodeURIComponent(normalizedSubreddit)}/about/modqueue`,
            query: {
              limit: String(args.limit),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/modqueue",
            query: {
              subreddit: normalizedSubreddit,
              limit: String(args.limit),
              ...(args.cursor ? { cursor: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseModerationItemsResponse(payload);
        },
      });
    },
    getReports: async (args) => {
      const normalizedSubreddit = args.subreddit.trim() || "all";
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.get_reports",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/r/${encodeURIComponent(normalizedSubreddit)}/about/reports`,
            query: {
              limit: String(args.limit),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/reports",
            query: {
              subreddit: normalizedSubreddit,
              limit: String(args.limit),
              ...(args.cursor ? { cursor: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseModerationItemsResponse(payload);
        },
      });
    },
    getModLog: async (args) => {
      const normalizedSubreddit = args.subreddit.trim() || "all";
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.get_mod_log",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/r/${encodeURIComponent(normalizedSubreddit)}/about/log`,
            query: {
              limit: String(args.limit),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/modlog",
            query: {
              subreddit: normalizedSubreddit,
              limit: String(args.limit),
              ...(args.cursor ? { cursor: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseModLogResponse(payload);
        },
      });
    },
    getSubredditRules: async (args) => {
      const normalizedSubreddit = args.subreddit.trim() || "all";
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.get_subreddit_rules",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/r/${encodeURIComponent(normalizedSubreddit)}/about/rules`,
          },
          {
            method: "GET",
            path: "/read/subreddit-rules",
            query: {
              subreddit: normalizedSubreddit,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseSubredditRulesResponse(payload);
        },
      });
    },
    listModmail: async (args) => {
      const normalizedSubreddit = args.subreddit.trim() || "all";
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.list_modmail",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/api/mod/conversations",
            query: {
              subreddit: normalizedSubreddit,
              limit: String(args.limit),
              ...(args.cursor ? { after: args.cursor } : {}),
            },
          },
          {
            method: "GET",
            path: "/list/modmail",
            query: {
              subreddit: normalizedSubreddit,
              limit: String(args.limit),
              ...(args.cursor ? { cursor: args.cursor } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseModmailListResponse(payload);
        },
      });
    },
    getModmail: async (args) => {
      const conversationId = args.conversationId.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.get_modmail",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: `/api/mod/conversations/${encodeURIComponent(conversationId)}`,
          },
          {
            method: "GET",
            path: `/read/modmail/${encodeURIComponent(conversationId)}`,
          },
        ],
        parsePayload: (payload) => {
          return parseGetModmailResponse(payload);
        },
      });
    },
    distinguish: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.distinguish",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/distinguish",
            formBody: new URLSearchParams({
              id: args.thingId,
              how: "yes",
              sticky: args.sticky === true ? "true" : "false",
            }),
          },
          {
            method: "POST",
            path: "/write/moderation-distinguish",
            jsonBody: {
              thingId: args.thingId,
              sticky: args.sticky === true,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseDistinguishResponse(payload, args.thingId, args.sticky === true);
        },
      });
    },
    stickyPost: async (args) => {
      const slot = Number.isFinite(Number(args.slot)) ? Number(args.slot) : 1;
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.sticky_post",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/set_subreddit_sticky",
            formBody: new URLSearchParams({
              id: args.thingId,
              state: args.state ? "true" : "false",
              num: String(slot),
            }),
          },
          {
            method: "POST",
            path: "/write/moderation-sticky",
            jsonBody: {
              thingId: args.thingId,
              state: args.state,
              slot,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseStickyPostResponse(payload, args.thingId, args.state, slot);
        },
      });
    },
    markNsfw: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.mark_nsfw",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/marknsfw",
            formBody: new URLSearchParams({ id: args.thingId }),
          },
          {
            method: "POST",
            path: "/write/posts-mark-nsfw",
            jsonBody: { thingId: args.thingId },
          },
        ],
        parsePayload: (payload) => {
          return parseThingActionResponse(payload, args.thingId);
        },
      });
    },
    unmarkNsfw: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.unmark_nsfw",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/unmarknsfw",
            formBody: new URLSearchParams({ id: args.thingId }),
          },
          {
            method: "POST",
            path: "/write/posts-unmark-nsfw",
            jsonBody: { thingId: args.thingId },
          },
        ],
        parsePayload: (payload) => {
          return parseThingActionResponse(payload, args.thingId);
        },
      });
    },
    spoiler: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.spoiler",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/spoiler",
            formBody: new URLSearchParams({ id: args.thingId }),
          },
          {
            method: "POST",
            path: "/write/posts-spoiler",
            jsonBody: { thingId: args.thingId },
          },
        ],
        parsePayload: (payload) => {
          return parseThingActionResponse(payload, args.thingId);
        },
      });
    },
    unspoiler: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.unspoiler",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/unspoiler",
            formBody: new URLSearchParams({ id: args.thingId }),
          },
          {
            method: "POST",
            path: "/write/posts-unspoiler",
            jsonBody: { thingId: args.thingId },
          },
        ],
        parsePayload: (payload) => {
          return parseThingActionResponse(payload, args.thingId);
        },
      });
    },
    selectFlair: async (args) => {
      const normalizedSubreddit = args.subreddit.trim() || "all";
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.select_flair",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: `/r/${encodeURIComponent(normalizedSubreddit)}/api/selectflair`,
            formBody: new URLSearchParams({
              link: args.thingId,
              text: args.text,
              css_class: args.cssClass ?? "",
            }),
          },
          {
            method: "POST",
            path: "/write/moderation-select-flair",
            jsonBody: {
              subreddit: normalizedSubreddit,
              thingId: args.thingId,
              text: args.text,
              ...(args.cssClass ? { cssClass: args.cssClass } : {}),
            },
          },
        ],
        parsePayload: (payload) => {
          return parseSelectFlairResponse(payload, {
            subreddit: normalizedSubreddit,
            thingId: args.thingId,
            text: args.text,
            ...(args.cssClass ? { cssClass: args.cssClass } : {}),
          });
        },
      });
    },
    subscribe: async (args) => {
      const normalizedSubreddit = args.subreddit.trim();
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.subscribe",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: "/api/subscribe",
            formBody: new URLSearchParams({
              action: args.action,
              sr_name: normalizedSubreddit,
            }),
          },
          {
            method: "POST",
            path: "/write/subreddits-subscribe",
            jsonBody: {
              subreddit: normalizedSubreddit,
              action: args.action,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseSubscribeResponse(payload, {
            subreddit: normalizedSubreddit,
            action: args.action,
          });
        },
      });
    },
    replyModmail: async (args) => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        idempotencyKey: args.idempotencyKey,
        requestName: "reddit.sdk.reply_modmail",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "POST",
            path: `/api/mod/conversations/${encodeURIComponent(args.conversationId)}`,
            jsonBody: {
              body: args.body,
              isInternal: args.isInternal === true,
            },
          },
          {
            method: "POST",
            path: "/write/modmail/reply",
            jsonBody: {
              conversationId: args.conversationId,
              body: args.body,
              isInternal: args.isInternal === true,
            },
          },
        ],
        parsePayload: (payload) => {
          return parseReplyModmailResponse(payload, {
            conversationId: args.conversationId,
            body: args.body,
            isInternal: args.isInternal === true,
          });
        },
      });
    },
    getMe: async () => {
      return requestWithFallback({
        accessToken: options.accessToken,
        namespace: options.namespace,
        requestName: "reddit.sdk.get_me",
        baseUrl: options.baseUrl,
        variants: [
          {
            method: "GET",
            path: "/api/v1/me",
          },
          {
            method: "GET",
            path: "/list/me",
          },
        ],
        parsePayload: (payload) => {
          return parseMeResponse(payload);
        },
      });
    },
  };
};

export type {
  RedditApiCreatePostResponse,
  RedditApiSearchListingResponse,
  RedditGatewaySearchResponse,
};
