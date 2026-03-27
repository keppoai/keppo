import type { ProviderSdkCallLog, ProviderSdkRuntime } from "../port.js";
import { BaseSdkPort } from "../base-sdk.js";
import { asRecord } from "../client-adapter-utils.js";
import type { CreateSlackClient } from "./client-interface.js";
import { toProviderSdkError } from "./errors.js";
import type {
  SlackAddReactionArgs,
  SlackAddReactionResponse,
  SlackArchiveChannelArgs,
  SlackArchiveChannelResponse,
  SlackBookmark,
  SlackChannel,
  SlackChannelInfo,
  SlackCreateChannelArgs,
  SlackCreateChannelResponse,
  SlackDeleteReminderArgs,
  SlackDeleteReminderResponse,
  SlackDeleteFileArgs,
  SlackDeleteFileResponse,
  SlackDeleteMessageArgs,
  SlackDeleteMessageResponse,
  SlackDeleteScheduledMessageArgs,
  SlackDeleteScheduledMessageResponse,
  SlackFile,
  SlackGetChannelHistoryArgs,
  SlackGetChannelInfoArgs,
  SlackGetFileInfoArgs,
  SlackGetPermalinkArgs,
  SlackGetPermalinkResponse,
  SlackGetReactionsArgs,
  SlackGetThreadRepliesArgs,
  SlackGetUserPresenceArgs,
  SlackGetUserProfileArgs,
  SlackGetUserInfoArgs,
  SlackInviteToChannelArgs,
  SlackInviteToChannelResponse,
  SlackJoinChannelArgs,
  SlackJoinChannelResponse,
  SlackListChannelMembersArgs,
  SlackListChannelsArgs,
  SlackListFilesArgs,
  SlackListBookmarksArgs,
  SlackListReactionsArgs,
  SlackListRemindersArgs,
  SlackListPinsArgs,
  SlackListScheduledMessagesArgs,
  SlackListUserGroupMembersArgs,
  SlackListUserGroupsArgs,
  SlackListUsersArgs,
  SlackListedReaction,
  SlackMeMessageArgs,
  SlackMeMessageResponse,
  SlackMarkChannelReadArgs,
  SlackMarkChannelReadResponse,
  SlackMessage,
  SlackMessageReaction,
  SlackReminder,
  SlackCloseDmArgs,
  SlackCloseDmResponse,
  SlackKickFromChannelArgs,
  SlackKickFromChannelResponse,
  SlackLeaveChannelArgs,
  SlackLeaveChannelResponse,
  SlackOpenDmArgs,
  SlackOpenDmResponse,
  SlackPinItem,
  SlackPinMessageArgs,
  SlackPinMessageResponse,
  SlackPostEphemeralArgs,
  SlackPostEphemeralResponse,
  SlackPostMessageArgs,
  SlackPostMessageResponse,
  SlackRemoveReactionArgs,
  SlackRemoveReactionResponse,
  SlackScheduledMessage,
  SlackScheduleMessageArgs,
  SlackScheduleMessageResponse,
  SlackSdkPort,
  SlackSearchFilesArgs,
  SlackSearchMessagesArgs,
  SlackUserGroup,
  SlackUserPresence,
  SlackRenameChannelArgs,
  SlackRenameChannelResponse,
  SlackSetChannelPurposeArgs,
  SlackSetChannelPurposeResponse,
  SlackSetChannelTopicArgs,
  SlackSetChannelTopicResponse,
  SlackUpdateMessageArgs,
  SlackUpdateMessageResponse,
  SlackAddBookmarkArgs,
  SlackAddBookmarkResponse,
  SlackAddReminderArgs,
  SlackAddReminderResponse,
  SlackEditBookmarkArgs,
  SlackEditBookmarkResponse,
  SlackRemoveBookmarkArgs,
  SlackRemoveBookmarkResponse,
  SlackUploadFileArgs,
  SlackUploadFileResponse,
  SlackUserProfile,
  SlackUser,
} from "./types.js";
const toSlackReaction = (value: unknown): SlackMessageReaction | null => {
  const reaction = asRecord(value);
  const name = String(reaction.name ?? "").trim();
  if (!name) {
    return null;
  }
  const users = Array.isArray(reaction.users) ? reaction.users.map((entry) => String(entry)) : [];
  return {
    name,
    count: Math.max(0, Number(reaction.count ?? users.length) || users.length),
    users,
  };
};

const toSlackMessage = (
  value: unknown,
  fallback: { channel: string; text?: string },
): SlackMessage | null => {
  const message = asRecord(value);
  const ts = String(message.ts ?? "").trim();
  if (!ts) {
    return null;
  }
  const text = String(message.text ?? fallback.text ?? "");
  const userId = typeof message.user === "string" ? message.user : undefined;
  const threadTs = typeof message.thread_ts === "string" ? message.thread_ts : undefined;
  const reactions = Array.isArray(message.reactions)
    ? message.reactions
        .map((reaction) => toSlackReaction(reaction))
        .filter((entry): entry is SlackMessageReaction => !!entry)
    : [];

  return {
    ts,
    channel: fallback.channel,
    text,
    ...(userId ? { userId } : {}),
    ...(threadTs ? { threadTs } : {}),
    ...(reactions.length > 0 ? { reactions } : {}),
  };
};

const toSlackChannel = (value: unknown): SlackChannel | null => {
  const channel = asRecord(value);
  const id = String(channel.id ?? "").trim();
  const name = String(channel.name ?? "").trim();
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    ...(typeof channel.is_private === "boolean" ? { isPrivate: channel.is_private } : {}),
  };
};

const toSlackUser = (value: unknown): SlackUser | null => {
  const user = asRecord(value);
  const id = String(user.id ?? "").trim();
  const name = String(user.name ?? "").trim();
  if (!id || !name) {
    return null;
  }
  const profile = asRecord(user.profile);
  const realName =
    typeof user.real_name === "string"
      ? user.real_name
      : typeof profile.real_name === "string"
        ? profile.real_name
        : undefined;
  return {
    id,
    name,
    ...(realName ? { realName } : {}),
    ...(typeof user.is_bot === "boolean" ? { isBot: user.is_bot } : {}),
    ...(typeof user.deleted === "boolean" ? { isDeleted: user.deleted } : {}),
  };
};

const toSlackChannelInfo = (value: unknown): SlackChannelInfo | null => {
  const channel = asRecord(value);
  const id = String(channel.id ?? "").trim();
  const name = String(channel.name ?? "").trim();
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    ...(typeof channel.is_private === "boolean" ? { isPrivate: channel.is_private } : {}),
    ...(typeof channel.is_archived === "boolean" ? { isArchived: channel.is_archived } : {}),
    ...(typeof channel.is_member === "boolean" ? { isMember: channel.is_member } : {}),
    ...(typeof channel.num_members === "number" ? { memberCount: channel.num_members } : {}),
  };
};

const toSlackFile = (value: unknown, fallbackName: string): SlackFile | null => {
  const file = asRecord(value);
  const id = String(file.id ?? "").trim();
  const name = String(file.name ?? fallbackName).trim();
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    ...(typeof file.title === "string" ? { title: file.title } : {}),
    ...(typeof file.url_private === "string"
      ? { url: file.url_private }
      : typeof file.permalink === "string"
        ? { url: file.permalink }
        : {}),
    ...(Array.isArray(file.channels)
      ? { channels: file.channels.map((entry) => String(entry)) }
      : {}),
    ...(typeof file.user === "string" ? { userId: file.user } : {}),
    ...(typeof file.mimetype === "string" ? { mimetype: file.mimetype } : {}),
    ...(typeof file.size === "number" ? { size: file.size } : {}),
  };
};

const toSlackBookmark = (value: unknown): SlackBookmark | null => {
  const bookmark = asRecord(value);
  const id = String(bookmark.id ?? bookmark.bookmark_id ?? "").trim();
  const channel = String(bookmark.channel_id ?? bookmark.channel ?? "").trim();
  const title = String(bookmark.title ?? "").trim();
  const link = String(bookmark.link ?? bookmark.url ?? "").trim();
  if (!id || !channel || !title || !link) {
    return null;
  }
  return {
    id,
    channel,
    title,
    link,
    ...(typeof bookmark.emoji === "string" ? { emoji: bookmark.emoji } : {}),
    ...(typeof bookmark.entity_id === "string"
      ? { entityId: bookmark.entity_id }
      : typeof bookmark.entityId === "string"
        ? { entityId: bookmark.entityId }
        : {}),
  };
};

const toSlackReminder = (value: unknown): SlackReminder | null => {
  const reminder = asRecord(value);
  const id = String(reminder.id ?? "").trim();
  const text = String(reminder.text ?? reminder.text_short ?? "").trim();
  const time = Number(reminder.time ?? reminder.ts ?? 0);
  if (!id || !text || !Number.isFinite(time) || time <= 0) {
    return null;
  }
  return {
    id,
    text,
    time: Math.floor(time),
    ...(typeof reminder.user === "string"
      ? { userId: reminder.user }
      : typeof reminder.userId === "string"
        ? { userId: reminder.userId }
        : {}),
  };
};

const toSlackUserGroup = (value: unknown): SlackUserGroup | null => {
  const userGroup = asRecord(value);
  const id = String(userGroup.id ?? "").trim();
  const handle = String(userGroup.handle ?? "").trim();
  const name = String(userGroup.name ?? "").trim();
  if (!id || !handle || !name) {
    return null;
  }
  return {
    id,
    handle,
    name,
    ...(typeof userGroup.date_delete === "number"
      ? { isDisabled: userGroup.date_delete > 0 }
      : typeof userGroup.isDisabled === "boolean"
        ? { isDisabled: userGroup.isDisabled }
        : typeof userGroup.is_usergroup === "boolean"
          ? { isDisabled: !userGroup.is_usergroup }
          : {}),
    ...(Array.isArray(userGroup.users)
      ? { userCount: userGroup.users.length }
      : typeof userGroup.userCount === "number"
        ? { userCount: Math.floor(userGroup.userCount) }
        : {}),
  };
};

const toSlackUserPresence = (value: unknown, userId: string): SlackUserPresence => {
  const presence = asRecord(value);
  const rawPresence = String(presence.presence ?? "away")
    .trim()
    .toLowerCase();
  return {
    userId,
    presence: rawPresence === "active" ? "active" : "away",
    ...(typeof presence.online === "boolean" ? { online: presence.online } : {}),
    ...(typeof presence.auto_away === "boolean"
      ? { autoAway: presence.auto_away }
      : typeof presence.autoAway === "boolean"
        ? { autoAway: presence.autoAway }
        : {}),
    ...(typeof presence.manual_away === "boolean"
      ? { manualAway: presence.manual_away }
      : typeof presence.manualAway === "boolean"
        ? { manualAway: presence.manualAway }
        : {}),
    ...(typeof presence.last_activity === "number"
      ? { lastActivity: Math.floor(presence.last_activity) }
      : typeof presence.lastActivity === "number"
        ? { lastActivity: Math.floor(presence.lastActivity) }
        : {}),
    ...(typeof presence.connection_count === "number"
      ? { connectionCount: Math.floor(presence.connection_count) }
      : typeof presence.connectionCount === "number"
        ? { connectionCount: Math.floor(presence.connectionCount) }
        : {}),
  };
};

const toSlackListedReactions = (value: unknown): SlackListedReaction[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const listed: SlackListedReaction[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const message = asRecord(record.message);
    const channel = String(record.channel ?? record.channel_id ?? "").trim();
    const ts = String(message.ts ?? record.ts ?? "").trim();
    if (!channel || !ts) {
      continue;
    }
    const reactions = Array.isArray(message.reactions)
      ? message.reactions
          .map((reaction) => toSlackReaction(reaction))
          .filter((reaction): reaction is SlackMessageReaction => !!reaction)
      : [];
    if (
      reactions.length === 0 &&
      typeof record.name === "string" &&
      record.name.trim().length > 0
    ) {
      const users = Array.isArray(record.users) ? record.users.map((entry) => String(entry)) : [];
      reactions.push({
        name: record.name,
        count: Math.max(0, Number(record.count ?? users.length) || users.length),
        users,
      });
    }
    for (const reaction of reactions) {
      listed.push({
        channel,
        ts,
        name: reaction.name,
        count: reaction.count,
        users: reaction.users,
      });
    }
  }
  return listed;
};

const toSlackMemberIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry)).filter((entry) => entry.length > 0);
};

const toSlackScheduledMessage = (value: unknown): SlackScheduledMessage | null => {
  const message = asRecord(value);
  const id = String(
    message.id ??
      message.scheduled_message_id ??
      message.scheduledMessageId ??
      message.message_id ??
      "",
  ).trim();
  const channel = String(message.channel_id ?? message.channel ?? "").trim();
  const text = String(message.text ?? "");
  const postAt = Number(message.post_at ?? message.postAt ?? 0);
  if (!id || !channel || !Number.isFinite(postAt) || postAt <= 0) {
    return null;
  }
  return {
    id,
    channel,
    text,
    postAt: Math.floor(postAt),
  };
};

const toSlackPinItem = (value: unknown, fallbackChannel: string): SlackPinItem | null => {
  const item = asRecord(value);
  const message = item.message ? asRecord(item.message) : item;
  const channel = String(item.channel_id ?? item.channel ?? fallbackChannel).trim();
  const ts = String(message.ts ?? item.ts ?? "").trim();
  if (!channel || !ts) {
    return null;
  }
  const text = typeof message.text === "string" ? message.text : undefined;
  return {
    channel,
    ts,
    ...(text ? { text } : {}),
  };
};

const toSlackUserProfile = (value: unknown, userId: string): SlackUserProfile => {
  const profile = asRecord(value);
  return {
    userId,
    ...(typeof profile.display_name === "string" ? { displayName: profile.display_name } : {}),
    ...(typeof profile.real_name === "string" ? { realName: profile.real_name } : {}),
    ...(typeof profile.email === "string" ? { email: profile.email } : {}),
    ...(typeof profile.title === "string" ? { title: profile.title } : {}),
    ...(typeof profile.status_text === "string" ? { statusText: profile.status_text } : {}),
    ...(typeof profile.status_emoji === "string" ? { statusEmoji: profile.status_emoji } : {}),
  };
};

export class SlackSdk extends BaseSdkPort<CreateSlackClient> implements SlackSdkPort {
  constructor(options: {
    createClient: CreateSlackClient;
    runtime?: ProviderSdkRuntime;
    callLog?: ProviderSdkCallLog;
  }) {
    super({
      providerId: "slack",
      createClient: options.createClient,
      ...(options.runtime ? { runtime: options.runtime } : {}),
      ...(options.callLog ? { callLog: options.callLog } : {}),
    });
  }

  async listChannels(args: SlackListChannelsArgs): Promise<SlackChannel[]> {
    const method = "slack.conversations.list";
    const normalizedArgs = {
      namespace: args.namespace,
      limit: args.limit,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.list_channels",
      });
      const response = await slack.conversations.list({
        limit: Math.max(1, Math.min(200, Number(args.limit) || 100)),
        types: "public_channel,private_channel",
      });

      const channels = (response.channels ?? [])
        .map((channel) => toSlackChannel(channel))
        .filter((entry): entry is SlackChannel => !!entry);

      this.captureOk(args.namespace, method, normalizedArgs, channels);
      return channels;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getChannelHistory(args: SlackGetChannelHistoryArgs): Promise<SlackMessage[]> {
    const method = "slack.conversations.history";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      limit: args.limit,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.get_channel_history",
      });
      const response = await slack.conversations.history({
        channel: args.channel,
        limit: Math.max(1, Math.min(200, Number(args.limit) || 50)),
      });
      const messages = (response.messages ?? [])
        .map((message) => toSlackMessage(message, { channel: args.channel }))
        .filter((entry): entry is SlackMessage => !!entry);
      this.captureOk(args.namespace, method, normalizedArgs, messages);
      return messages;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getThreadReplies(args: SlackGetThreadRepliesArgs): Promise<SlackMessage[]> {
    const method = "slack.conversations.replies";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      threadTs: args.threadTs,
      limit: args.limit,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.get_thread_replies",
      });
      const response = await slack.conversations.replies({
        channel: args.channel,
        ts: args.threadTs,
        limit: Math.max(1, Math.min(200, Number(args.limit) || 50)),
      });
      const messages = (response.messages ?? [])
        .map((message) => toSlackMessage(message, { channel: args.channel }))
        .filter((entry): entry is SlackMessage => !!entry);
      this.captureOk(args.namespace, method, normalizedArgs, messages);
      return messages;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getReactions(args: SlackGetReactionsArgs): Promise<SlackMessageReaction[]> {
    const method = "slack.reactions.get";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.get_reactions",
      });
      const response = await slack.reactions.get({
        channel: args.channel,
        timestamp: args.ts,
        full: true,
      });
      const message = asRecord(response.message);
      const reactions = Array.isArray(message.reactions)
        ? message.reactions
            .map((reaction) => toSlackReaction(reaction))
            .filter((entry): entry is SlackMessageReaction => !!entry)
        : [];
      this.captureOk(args.namespace, method, normalizedArgs, reactions);
      return reactions;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listReactions(args: SlackListReactionsArgs): Promise<SlackListedReaction[]> {
    const method = "slack.reactions.list";
    const normalizedArgs = {
      namespace: args.namespace,
      ...(typeof args.userId === "string" ? { userId: args.userId } : {}),
      limit: args.limit,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.list_reactions",
      });
      const response = await slack.reactions.list({
        ...(typeof args.userId === "string" ? { user: args.userId } : {}),
        full: true,
        count: Math.max(1, Math.min(200, Number(args.limit) || 20)),
      });
      const reactions = toSlackListedReactions(response.items);
      this.captureOk(args.namespace, method, normalizedArgs, reactions);
      return reactions;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listUsers(args: SlackListUsersArgs): Promise<SlackUser[]> {
    const method = "slack.users.list";
    const normalizedArgs = {
      namespace: args.namespace,
      limit: args.limit,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.list_users",
      });
      const response = await slack.users.list({
        limit: Math.max(1, Math.min(200, Number(args.limit) || 200)),
      });
      const users = (response.members ?? [])
        .map((user) => toSlackUser(user))
        .filter((entry): entry is SlackUser => !!entry);
      this.captureOk(args.namespace, method, normalizedArgs, users);
      return users;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getUserInfo(args: SlackGetUserInfoArgs): Promise<SlackUser> {
    const method = "slack.users.info";
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.get_user_info",
      });
      const response = await slack.users.info({
        user: args.userId,
      });
      const user = toSlackUser(response.user);
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

  async getUserPresence(args: SlackGetUserPresenceArgs): Promise<SlackUserPresence> {
    const method = "slack.users.getPresence";
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.get_user_presence",
      });
      const response = await slack.users.getPresence({
        user: args.userId,
      });
      const presence = toSlackUserPresence(response, args.userId);
      this.captureOk(args.namespace, method, normalizedArgs, presence);
      return presence;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getChannelInfo(args: SlackGetChannelInfoArgs): Promise<SlackChannelInfo> {
    const method = "slack.conversations.info";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.get_channel_info",
      });
      const response = await slack.conversations.info({
        channel: args.channel,
      });
      const channel = toSlackChannelInfo(response.channel);
      if (!channel) {
        throw new Error("channel_not_found");
      }
      this.captureOk(args.namespace, method, normalizedArgs, channel);
      return channel;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async searchMessages(args: SlackSearchMessagesArgs): Promise<SlackMessage[]> {
    const method = "slack.search.messages";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      limit: args.limit,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.search_messages",
      });
      const response = await slack.search.messages({
        query: args.query,
        count: Math.max(1, Math.min(100, Number(args.limit) || 20)),
      });
      const messagesEnvelope = asRecord(response.messages);
      const matches = Array.isArray(messagesEnvelope.matches) ? messagesEnvelope.matches : [];
      const messages = matches
        .map((match) => {
          const record = asRecord(match);
          const channel = asRecord(record.channel);
          const channelId =
            typeof channel.id === "string"
              ? channel.id
              : typeof channel.name === "string"
                ? channel.name
                : "";
          return toSlackMessage(match, { channel: channelId || "unknown" });
        })
        .filter((entry): entry is SlackMessage => !!entry);
      this.captureOk(args.namespace, method, normalizedArgs, messages);
      return messages;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listBookmarks(args: SlackListBookmarksArgs): Promise<SlackBookmark[]> {
    const method = "slack.bookmarks.list";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.list_bookmarks",
      });
      const response = await slack.bookmarks.list({
        channel_id: args.channel,
      });
      const bookmarks = Array.isArray(response.bookmarks)
        ? response.bookmarks
            .map((entry) => toSlackBookmark(entry))
            .filter((entry): entry is SlackBookmark => !!entry)
        : [];
      this.captureOk(args.namespace, method, normalizedArgs, bookmarks);
      return bookmarks;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listReminders(args: SlackListRemindersArgs): Promise<SlackReminder[]> {
    const method = "slack.reminders.list";
    const normalizedArgs = {
      namespace: args.namespace,
      ...(typeof args.userId === "string" ? { userId: args.userId } : {}),
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.list_reminders",
      });
      const response = await slack.reminders.list();
      const reminders = Array.isArray(response.reminders)
        ? response.reminders
            .map((entry) => toSlackReminder(entry))
            .filter((entry): entry is SlackReminder => !!entry)
            .filter((entry) => !args.userId || entry.userId === args.userId)
        : [];
      this.captureOk(args.namespace, method, normalizedArgs, reminders);
      return reminders;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listUserGroups(args: SlackListUserGroupsArgs): Promise<SlackUserGroup[]> {
    const method = "slack.usergroups.list";
    const normalizedArgs = {
      namespace: args.namespace,
      ...(typeof args.includeDisabled === "boolean"
        ? { includeDisabled: args.includeDisabled }
        : {}),
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.list_user_groups",
      });
      const response = await slack.usergroups.list(
        typeof args.includeDisabled === "boolean" ? { include_disabled: args.includeDisabled } : {},
      );
      const groups = Array.isArray(response.usergroups)
        ? response.usergroups
            .map((entry) => toSlackUserGroup(entry))
            .filter((entry): entry is SlackUserGroup => !!entry)
        : [];
      this.captureOk(args.namespace, method, normalizedArgs, groups);
      return groups;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listUserGroupMembers(args: SlackListUserGroupMembersArgs): Promise<string[]> {
    const method = "slack.usergroups.users.list";
    const normalizedArgs = {
      namespace: args.namespace,
      userGroupId: args.userGroupId,
      ...(typeof args.includeDisabled === "boolean"
        ? { includeDisabled: args.includeDisabled }
        : {}),
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.list_user_group_members",
      });
      const response = await slack.usergroups.users.list({
        usergroup: args.userGroupId,
        ...(typeof args.includeDisabled === "boolean"
          ? { include_disabled: args.includeDisabled }
          : {}),
      });
      const users = toSlackMemberIds(response.users);
      this.captureOk(args.namespace, method, normalizedArgs, users);
      return users;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async postMessage(args: SlackPostMessageArgs): Promise<SlackPostMessageResponse> {
    const method = "slack.chat.postMessage";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      text: args.text,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.post_message",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.chat.postMessage({
        channel: args.channel,
        text: args.text,
      });
      const responseMessage =
        response.message && typeof response.message === "object" && !Array.isArray(response.message)
          ? (response.message as Record<string, unknown>)
          : {};

      const normalizedResponse: SlackPostMessageResponse = {
        ok: response.ok === false ? false : true,
        channel: String(response.channel ?? args.channel),
        ts: String(response.ts ?? "0"),
        message: {
          text: String(response.message?.text ?? args.text),
          ...(typeof responseMessage.client_msg_id === "string"
            ? { client_msg_id: responseMessage.client_msg_id }
            : {}),
        },
      };

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

  async updateMessage(args: SlackUpdateMessageArgs): Promise<SlackUpdateMessageResponse> {
    const method = "slack.chat.update";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
      text: args.text,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.update_message",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.chat.update({
        channel: args.channel,
        ts: args.ts,
        text: args.text,
      });
      const responseMessage =
        response.message && typeof response.message === "object" && !Array.isArray(response.message)
          ? (response.message as Record<string, unknown>)
          : {};

      const normalizedResponse: SlackUpdateMessageResponse = {
        ok: response.ok === false ? false : true,
        channel: String(response.channel ?? args.channel),
        ts: String(response.ts ?? args.ts),
        message: {
          text: String(response.message?.text ?? args.text),
          ...(typeof responseMessage.client_msg_id === "string"
            ? { client_msg_id: responseMessage.client_msg_id }
            : {}),
        },
      };

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

  async deleteMessage(args: SlackDeleteMessageArgs): Promise<SlackDeleteMessageResponse> {
    const method = "slack.chat.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.delete_message",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.chat.delete({
        channel: args.channel,
        ts: args.ts,
      });
      const normalizedResponse: SlackDeleteMessageResponse = {
        ok: response.ok === false ? false : true,
        channel: String(response.channel ?? args.channel),
        ts: String(response.ts ?? args.ts),
      };

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

  async addReaction(args: SlackAddReactionArgs): Promise<SlackAddReactionResponse> {
    const method = "slack.reactions.add";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
      name: args.name,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.add_reaction",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.reactions.add({
        channel: args.channel,
        timestamp: args.ts,
        name: args.name,
      });
      const normalizedResponse: SlackAddReactionResponse = {
        ok: response.ok === false ? false : true,
        channel: args.channel,
        ts: args.ts,
        name: args.name,
      };
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

  async postEphemeral(args: SlackPostEphemeralArgs): Promise<SlackPostEphemeralResponse> {
    const method = "slack.chat.postEphemeral";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      userId: args.userId,
      text: args.text,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.post_ephemeral",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.chat.postEphemeral({
        channel: args.channel,
        user: args.userId,
        text: args.text,
      });
      const normalizedResponse: SlackPostEphemeralResponse = {
        ok: response.ok === false ? false : true,
        channel: args.channel,
        messageTs: String(response.message_ts ?? "0"),
      };

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

  async uploadFile(args: SlackUploadFileArgs): Promise<SlackUploadFileResponse> {
    const method = "slack.files.uploadV2";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      filename: args.filename,
      ...(typeof args.title === "string" ? { title: args.title } : {}),
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.upload_file",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.files.upload({
        channels: args.channel,
        filename: args.filename,
        content: args.content,
        ...(typeof args.title === "string" ? { title: args.title } : {}),
      });
      const uploadFiles = Array.isArray((response as { files?: unknown }).files)
        ? ((response as { files?: unknown[] }).files ?? [])
        : [];
      const rawFirstFile = response.file ?? uploadFiles[0] ?? null;
      const firstFile = rawFirstFile ? toSlackFile(rawFirstFile, args.filename) : null;
      if (!firstFile) {
        throw new Error("invalid_upload_response");
      }

      const normalizedResponse: SlackUploadFileResponse = {
        ok: response.ok === false ? false : true,
        file: firstFile,
      };

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

  async addBookmark(args: SlackAddBookmarkArgs): Promise<SlackAddBookmarkResponse> {
    const method = "slack.bookmarks.add";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      title: args.title,
      link: args.link,
      ...(typeof args.emoji === "string" ? { emoji: args.emoji } : {}),
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.add_bookmark",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.bookmarks.add({
        channel_id: args.channel,
        title: args.title,
        type: "link",
        link: args.link,
        ...(typeof args.emoji === "string" ? { emoji: args.emoji } : {}),
      });
      const bookmark = toSlackBookmark(response.bookmark) ?? {
        id: `bm_${args.channel}_${args.title}`,
        channel: args.channel,
        title: args.title,
        link: args.link,
        ...(typeof args.emoji === "string" ? { emoji: args.emoji } : {}),
      };
      const normalizedResponse: SlackAddBookmarkResponse = {
        ok: response.ok !== false,
        bookmark,
      };
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

  async editBookmark(args: SlackEditBookmarkArgs): Promise<SlackEditBookmarkResponse> {
    const method = "slack.bookmarks.edit";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      bookmarkId: args.bookmarkId,
      ...(typeof args.title === "string" ? { title: args.title } : {}),
      ...(typeof args.link === "string" ? { link: args.link } : {}),
      ...(typeof args.emoji === "string" ? { emoji: args.emoji } : {}),
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.edit_bookmark",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.bookmarks.edit({
        channel_id: args.channel,
        bookmark_id: args.bookmarkId,
        ...(typeof args.title === "string" ? { title: args.title } : {}),
        ...(typeof args.link === "string" ? { link: args.link } : {}),
        ...(typeof args.emoji === "string" ? { emoji: args.emoji } : {}),
      });
      const bookmark = toSlackBookmark(response.bookmark) ?? {
        id: args.bookmarkId,
        channel: args.channel,
        title: args.title ?? args.bookmarkId,
        link: args.link ?? "https://example.test",
        ...(typeof args.emoji === "string" ? { emoji: args.emoji } : {}),
      };
      const normalizedResponse: SlackEditBookmarkResponse = {
        ok: response.ok !== false,
        bookmark,
      };
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

  async removeBookmark(args: SlackRemoveBookmarkArgs): Promise<SlackRemoveBookmarkResponse> {
    const method = "slack.bookmarks.remove";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      bookmarkId: args.bookmarkId,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.remove_bookmark",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.bookmarks.remove({
        channel_id: args.channel,
        bookmark_id: args.bookmarkId,
      });
      const normalizedResponse: SlackRemoveBookmarkResponse = {
        ok: response.ok !== false,
        channel: args.channel,
        bookmarkId: args.bookmarkId,
      };
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

  async addReminder(args: SlackAddReminderArgs): Promise<SlackAddReminderResponse> {
    const method = "slack.reminders.add";
    const normalizedArgs = {
      namespace: args.namespace,
      text: args.text,
      time: args.time,
      ...(typeof args.userId === "string" ? { userId: args.userId } : {}),
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.add_reminder",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.reminders.add({
        text: args.text,
        time: Math.floor(args.time),
        ...(typeof args.userId === "string" ? { user: args.userId } : {}),
      });
      const reminder = toSlackReminder(response.reminder) ?? {
        id: `rem_${Math.floor(args.time)}`,
        text: args.text,
        time: Math.floor(args.time),
        ...(typeof args.userId === "string" ? { userId: args.userId } : {}),
      };
      const normalizedResponse: SlackAddReminderResponse = {
        ok: response.ok !== false,
        reminder,
      };
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

  async deleteReminder(args: SlackDeleteReminderArgs): Promise<SlackDeleteReminderResponse> {
    const method = "slack.reminders.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      reminderId: args.reminderId,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.delete_reminder",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.reminders.delete({
        reminder: args.reminderId,
      });
      const normalizedResponse: SlackDeleteReminderResponse = {
        ok: response.ok !== false,
        reminderId: args.reminderId,
      };
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

  async meMessage(args: SlackMeMessageArgs): Promise<SlackMeMessageResponse> {
    const method = "slack.chat.meMessage";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      text: args.text,
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.me_message",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.chat.meMessage({
        channel: args.channel,
        text: args.text,
      });
      const normalizedResponse: SlackMeMessageResponse = {
        ok: response.ok !== false,
        channel: String(response.channel ?? args.channel),
        ts: String(response.ts ?? "0"),
        text: args.text,
      };
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

  async createChannel(args: SlackCreateChannelArgs): Promise<SlackCreateChannelResponse> {
    const method = "slack.conversations.create";
    const normalizedArgs = {
      namespace: args.namespace,
      name: args.name,
      ...(typeof args.isPrivate === "boolean" ? { isPrivate: args.isPrivate } : {}),
    };

    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.create_channel",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.conversations.create({
        name: args.name,
        ...(typeof args.isPrivate === "boolean" ? { is_private: args.isPrivate } : {}),
      });
      const channel = toSlackChannelInfo(response.channel);
      if (!channel) {
        throw new Error("invalid_channel");
      }
      const normalizedResponse: SlackCreateChannelResponse = { ok: response.ok !== false, channel };
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

  async inviteToChannel(args: SlackInviteToChannelArgs): Promise<SlackInviteToChannelResponse> {
    const method = "slack.conversations.invite";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      userIds: args.userIds,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.invite_to_channel",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.conversations.invite({
        channel: args.channel,
        users: args.userIds.join(","),
      });
      const channel = toSlackChannelInfo(response.channel);
      if (!channel) {
        throw new Error("invalid_channel");
      }
      const normalizedResponse: SlackInviteToChannelResponse = {
        ok: response.ok !== false,
        channel,
        invitedUserIds: [...args.userIds],
      };
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

  async joinChannel(args: SlackJoinChannelArgs): Promise<SlackJoinChannelResponse> {
    const method = "slack.conversations.join";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.join_channel",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.conversations.join({
        channel: args.channel,
      });
      const channel = toSlackChannelInfo(response.channel);
      if (!channel) {
        throw new Error("invalid_channel");
      }
      const normalizedResponse: SlackJoinChannelResponse = {
        ok: response.ok !== false,
        channel,
      };
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

  async listChannelMembers(args: SlackListChannelMembersArgs): Promise<string[]> {
    const method = "slack.conversations.members";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      limit: args.limit,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.list_channel_members",
      });
      const response = await slack.conversations.members({
        channel: args.channel,
        limit: Math.max(1, Math.min(1000, Number(args.limit) || 200)),
      });
      const members = toSlackMemberIds(response.members);
      this.captureOk(args.namespace, method, normalizedArgs, members);
      return members;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async markChannelRead(args: SlackMarkChannelReadArgs): Promise<SlackMarkChannelReadResponse> {
    const method = "slack.conversations.mark";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.mark_channel_read",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.conversations.mark({
        channel: args.channel,
        ts: args.ts,
      });
      const normalizedResponse: SlackMarkChannelReadResponse = {
        ok: response.ok !== false,
        channel: args.channel,
        ts: args.ts,
      };
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

  async archiveChannel(args: SlackArchiveChannelArgs): Promise<SlackArchiveChannelResponse> {
    const method = "slack.conversations.archive";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.archive_channel",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.conversations.archive({
        channel: args.channel,
      });
      const normalizedResponse: SlackArchiveChannelResponse = {
        ok: response.ok !== false,
        channel: {
          id: args.channel,
          name: args.channel,
          isArchived: true,
        },
      };
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

  async unarchiveChannel(args: SlackArchiveChannelArgs): Promise<SlackArchiveChannelResponse> {
    const method = "slack.conversations.unarchive";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.unarchive_channel",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.conversations.unarchive({
        channel: args.channel,
      });
      const normalizedResponse: SlackArchiveChannelResponse = {
        ok: response.ok !== false,
        channel: {
          id: args.channel,
          name: args.channel,
          isArchived: false,
        },
      };
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

  async setChannelPurpose(
    args: SlackSetChannelPurposeArgs,
  ): Promise<SlackSetChannelPurposeResponse> {
    const method = "slack.conversations.setPurpose";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      purpose: args.purpose,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.set_channel_purpose",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.conversations.setPurpose({
        channel: args.channel,
        purpose: args.purpose,
      });
      const normalizedResponse: SlackSetChannelPurposeResponse = {
        ok: response.ok !== false,
        channel: args.channel,
        purpose: args.purpose,
      };
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

  async setChannelTopic(args: SlackSetChannelTopicArgs): Promise<SlackSetChannelTopicResponse> {
    const method = "slack.conversations.setTopic";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      topic: args.topic,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.set_channel_topic",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.conversations.setTopic({
        channel: args.channel,
        topic: args.topic,
      });
      const normalizedResponse: SlackSetChannelTopicResponse = {
        ok: response.ok !== false,
        channel: args.channel,
        topic: args.topic,
      };
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

  async openDM(args: SlackOpenDmArgs): Promise<SlackOpenDmResponse> {
    const method = "slack.conversations.open";
    const normalizedArgs = {
      namespace: args.namespace,
      userIds: args.userIds,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.open_dm",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.conversations.open({
        users: args.userIds.join(","),
      });
      const channel = toSlackChannelInfo(response.channel);
      if (!channel) {
        throw new Error("invalid_channel");
      }
      const normalizedResponse: SlackOpenDmResponse = {
        ok: response.ok !== false,
        channel,
        userIds: [...args.userIds],
      };
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

  async renameChannel(args: SlackRenameChannelArgs): Promise<SlackRenameChannelResponse> {
    const method = "slack.conversations.rename";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      name: args.name,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.rename_channel",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.conversations.rename({
        channel: args.channel,
        name: args.name,
      });
      const responseRecord = asRecord(response);
      const channel = toSlackChannelInfo(responseRecord.channel) ?? {
        id: args.channel,
        name: args.name,
      };
      const normalizedResponse: SlackRenameChannelResponse = {
        ok: response.ok !== false,
        channel,
      };
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

  async kickFromChannel(args: SlackKickFromChannelArgs): Promise<SlackKickFromChannelResponse> {
    const method = "slack.conversations.kick";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      userId: args.userId,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.kick_from_channel",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.conversations.kick({
        channel: args.channel,
        user: args.userId,
      });
      const responseRecord = asRecord(response);
      const channel = toSlackChannelInfo(responseRecord.channel) ?? {
        id: args.channel,
        name: args.channel,
      };
      const normalizedResponse: SlackKickFromChannelResponse = {
        ok: response.ok !== false,
        channel,
        userId: args.userId,
      };
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

  async leaveChannel(args: SlackLeaveChannelArgs): Promise<SlackLeaveChannelResponse> {
    const method = "slack.conversations.leave";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.leave_channel",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.conversations.leave({
        channel: args.channel,
      });
      const responseRecord = asRecord(response);
      const channel = toSlackChannelInfo(responseRecord.channel) ?? {
        id: args.channel,
        name: args.channel,
      };
      const normalizedResponse: SlackLeaveChannelResponse = {
        ok: response.ok !== false,
        channel,
      };
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

  async closeDM(args: SlackCloseDmArgs): Promise<SlackCloseDmResponse> {
    const method = "slack.conversations.close";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.close_dm",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.conversations.close({
        channel: args.channel,
      });
      const responseRecord = asRecord(response);
      const channel = toSlackChannelInfo(responseRecord.channel) ?? {
        id: args.channel,
        name: args.channel,
      };
      const normalizedResponse: SlackCloseDmResponse = {
        ok: response.ok !== false,
        channel,
      };
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

  async scheduleMessage(args: SlackScheduleMessageArgs): Promise<SlackScheduleMessageResponse> {
    const method = "slack.chat.scheduleMessage";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      text: args.text,
      postAt: args.postAt,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.schedule_message",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.chat.scheduleMessage({
        channel: args.channel,
        text: args.text,
        post_at: Math.floor(args.postAt),
      });
      const normalizedResponse: SlackScheduleMessageResponse = {
        ok: response.ok !== false,
        channel: String(response.channel ?? args.channel),
        scheduledMessageId: String(response.scheduled_message_id ?? response.message?.bot_id ?? ""),
        postAt: Number(response.post_at ?? args.postAt),
      };
      if (!normalizedResponse.scheduledMessageId) {
        normalizedResponse.scheduledMessageId = `sched_${normalizedResponse.postAt}`;
      }
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

  async deleteScheduledMessage(
    args: SlackDeleteScheduledMessageArgs,
  ): Promise<SlackDeleteScheduledMessageResponse> {
    const method = "slack.chat.deleteScheduledMessage";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      scheduledMessageId: args.scheduledMessageId,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.delete_scheduled_message",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.chat.deleteScheduledMessage({
        channel: args.channel,
        scheduled_message_id: args.scheduledMessageId,
      });
      const normalizedResponse: SlackDeleteScheduledMessageResponse = {
        ok: response.ok !== false,
        channel: args.channel,
        scheduledMessageId: args.scheduledMessageId,
      };
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

  async listScheduledMessages(
    args: SlackListScheduledMessagesArgs,
  ): Promise<SlackScheduledMessage[]> {
    const method = "slack.chat.scheduledMessages.list";
    const normalizedArgs = {
      namespace: args.namespace,
      ...(typeof args.channel === "string" ? { channel: args.channel } : {}),
      limit: args.limit,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.list_scheduled_messages",
      });
      const response = await slack.chat.scheduledMessages.list({
        ...(typeof args.channel === "string" ? { channel: args.channel } : {}),
        limit: Math.max(1, Math.min(100, Number(args.limit) || 20)),
      });
      const scheduled = Array.isArray(response.scheduled_messages)
        ? response.scheduled_messages
            .map((entry) => toSlackScheduledMessage(entry))
            .filter((entry): entry is SlackScheduledMessage => !!entry)
        : [];
      this.captureOk(args.namespace, method, normalizedArgs, scheduled);
      return scheduled;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getPermalink(args: SlackGetPermalinkArgs): Promise<SlackGetPermalinkResponse> {
    const method = "slack.chat.getPermalink";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.get_permalink",
      });
      const response = await slack.chat.getPermalink({
        channel: args.channel,
        message_ts: args.ts,
      });
      const normalizedResponse: SlackGetPermalinkResponse = {
        ok: response.ok !== false,
        channel: args.channel,
        ts: args.ts,
        permalink: String(response.permalink ?? ""),
      };
      if (!normalizedResponse.permalink) {
        throw new Error("invalid_permalink");
      }
      this.captureOk(args.namespace, method, normalizedArgs, normalizedResponse);
      return normalizedResponse;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async removeReaction(args: SlackRemoveReactionArgs): Promise<SlackRemoveReactionResponse> {
    const method = "slack.reactions.remove";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
      name: args.name,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.remove_reaction",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.reactions.remove({
        channel: args.channel,
        timestamp: args.ts,
        name: args.name,
      });
      const normalizedResponse: SlackRemoveReactionResponse = {
        ok: response.ok !== false,
        channel: args.channel,
        ts: args.ts,
        name: args.name,
      };
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

  async pinMessage(args: SlackPinMessageArgs): Promise<SlackPinMessageResponse> {
    const method = "slack.pins.add";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.pin_message",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.pins.add({
        channel: args.channel,
        timestamp: args.ts,
      });
      const normalizedResponse: SlackPinMessageResponse = {
        ok: response.ok !== false,
        channel: args.channel,
        ts: args.ts,
      };
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

  async unpinMessage(args: SlackPinMessageArgs): Promise<SlackPinMessageResponse> {
    const method = "slack.pins.remove";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.unpin_message",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.pins.remove({
        channel: args.channel,
        timestamp: args.ts,
      });
      const normalizedResponse: SlackPinMessageResponse = {
        ok: response.ok !== false,
        channel: args.channel,
        ts: args.ts,
      };
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

  async listPins(args: SlackListPinsArgs): Promise<SlackPinItem[]> {
    const method = "slack.pins.list";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.list_pins",
      });
      const response = await slack.pins.list({ channel: args.channel });
      const items = Array.isArray(response.items)
        ? response.items
            .map((item) => toSlackPinItem(item, args.channel))
            .filter((item): item is SlackPinItem => !!item)
        : [];
      this.captureOk(args.namespace, method, normalizedArgs, items);
      return items;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listFiles(args: SlackListFilesArgs): Promise<SlackFile[]> {
    const method = "slack.files.list";
    const normalizedArgs = {
      namespace: args.namespace,
      ...(typeof args.channel === "string" ? { channel: args.channel } : {}),
      ...(typeof args.userId === "string" ? { userId: args.userId } : {}),
      limit: args.limit,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.list_files",
      });
      const response = await slack.files.list({
        ...(typeof args.channel === "string" ? { channel: args.channel } : {}),
        ...(typeof args.userId === "string" ? { user: args.userId } : {}),
        count: Math.max(1, Math.min(200, Number(args.limit) || 20)),
      });
      const files = Array.isArray(response.files)
        ? response.files
            .map((entry) => toSlackFile(entry, "file"))
            .filter((entry): entry is SlackFile => !!entry)
        : [];
      this.captureOk(args.namespace, method, normalizedArgs, files);
      return files;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getFileInfo(args: SlackGetFileInfoArgs): Promise<SlackFile> {
    const method = "slack.files.info";
    const normalizedArgs = {
      namespace: args.namespace,
      fileId: args.fileId,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.get_file_info",
      });
      const response = await slack.files.info({ file: args.fileId });
      const file = toSlackFile(response.file, args.fileId);
      if (!file) {
        throw new Error("file_not_found");
      }
      this.captureOk(args.namespace, method, normalizedArgs, file);
      return file;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async deleteFile(args: SlackDeleteFileArgs): Promise<SlackDeleteFileResponse> {
    const method = "slack.files.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      fileId: args.fileId,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.delete_file",
        ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
      });
      const response = await slack.files.delete({ file: args.fileId });
      const normalizedResponse: SlackDeleteFileResponse = {
        ok: response.ok !== false,
        fileId: args.fileId,
      };
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

  async getUserProfile(args: SlackGetUserProfileArgs): Promise<SlackUserProfile> {
    const method = "slack.users.profile.get";
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.get_user_profile",
      });
      const response = await slack.users.profile.get({ user: args.userId });
      const profile = toSlackUserProfile(response.profile, args.userId);
      this.captureOk(args.namespace, method, normalizedArgs, profile);
      return profile;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async searchFiles(args: SlackSearchFilesArgs): Promise<SlackFile[]> {
    const method = "slack.search.files";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      limit: args.limit,
    };
    try {
      const slack = this.createClient(args.accessToken, args.namespace, {
        requestContext: "slack.sdk.search_files",
      });
      const response = await slack.search.files({
        query: args.query,
        count: Math.max(1, Math.min(100, Number(args.limit) || 20)),
      });
      const filesEnvelope = asRecord(response.files);
      const matches = Array.isArray(filesEnvelope.matches) ? filesEnvelope.matches : [];
      const files = matches
        .map((entry) => toSlackFile(entry, "file"))
        .filter((entry): entry is SlackFile => !!entry);
      this.captureOk(args.namespace, method, normalizedArgs, files);
      return files;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }
}
