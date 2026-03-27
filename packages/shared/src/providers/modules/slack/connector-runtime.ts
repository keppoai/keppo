import { buildProviderIdempotencyKey } from "../../../provider-write-utils.js";
import { slackTools } from "../../../tool-definitions.js";
import { BaseConnector } from "../../../connectors/base-connector.js";
import type { Connector, ConnectorContext, PreparedWrite } from "../../../connectors/base.js";
import { createRealSlackSdk } from "../../../provider-sdk/slack/real.js";
import type { SlackSdkPort } from "../../../provider-sdk/slack/types.js";
import {
  createProviderCircuitBreaker,
  wrapObjectWithCircuitBreaker,
} from "../../../circuit-breaker.js";

const readSlackTools = [
  "slack.listChannels",
  "slack.getChannelHistory",
  "slack.getThreadReplies",
  "slack.getReactions",
  "slack.listUsers",
  "slack.getUserInfo",
  "slack.getChannelInfo",
  "slack.searchMessages",
  "slack.listChannelMembers",
  "slack.listScheduledMessages",
  "slack.getPermalink",
  "slack.listBookmarks",
  "slack.listReminders",
  "slack.listUserGroups",
  "slack.listUserGroupMembers",
  "slack.getUserPresence",
  "slack.listReactions",
  "slack.listPins",
  "slack.listFiles",
  "slack.getFileInfo",
  "slack.getUserProfile",
  "slack.searchFiles",
] as const;

const writeSlackTools = [
  "slack.postMessage",
  "slack.updateMessage",
  "slack.deleteMessage",
  "slack.addReaction",
  "slack.postEphemeral",
  "slack.uploadFile",
  "slack.createChannel",
  "slack.inviteToChannel",
  "slack.joinChannel",
  "slack.markChannelRead",
  "slack.archiveChannel",
  "slack.unarchiveChannel",
  "slack.setChannelPurpose",
  "slack.setChannelTopic",
  "slack.openDM",
  "slack.renameChannel",
  "slack.kickFromChannel",
  "slack.leaveChannel",
  "slack.closeDM",
  "slack.addBookmark",
  "slack.editBookmark",
  "slack.removeBookmark",
  "slack.addReminder",
  "slack.deleteReminder",
  "slack.meMessage",
  "slack.scheduleMessage",
  "slack.deleteScheduledMessage",
  "slack.removeReaction",
  "slack.pinMessage",
  "slack.unpinMessage",
  "slack.deleteFile",
] as const;

const requiredScopesByTool: Record<string, string[]> = {
  ...Object.fromEntries(readSlackTools.map((toolName) => [toolName, ["slack.read"]] as const)),
  ...Object.fromEntries(writeSlackTools.map((toolName) => [toolName, ["slack.write"]] as const)),
};

const FAKE_SLACK_ACCESS_TOKEN = process.env.KEPPO_FAKE_SLACK_ACCESS_TOKEN?.trim();

const getToken = (context: ConnectorContext): string => {
  if (context.access_token) {
    return context.access_token;
  }
  if (FAKE_SLACK_ACCESS_TOKEN) {
    return FAKE_SLACK_ACCESS_TOKEN;
  }
  throw new Error("Slack access token missing. Reconnect Slack integration.");
};

const formatChannelName = (name: string): string => {
  return name.startsWith("#") ? name : `#${name}`;
};

const providerCircuitBreaker = createProviderCircuitBreaker("slack");

type SlackReadToolName = (typeof readSlackTools)[number];
type SlackWriteToolName = (typeof writeSlackTools)[number];

type SlackReadDispatchInput = {
  validated: Record<string, unknown>;
  accessToken: string;
  namespace: string | undefined;
};

type SlackPrepareDispatchInput = {
  validated: Record<string, unknown>;
};

type SlackWriteDispatchInput = {
  normalizedPayload: Record<string, unknown>;
  accessToken: string;
  namespace: string | undefined;
};

export const createSlackConnector = (options?: { sdk?: SlackSdkPort }): Connector => {
  const sdk = wrapObjectWithCircuitBreaker(
    options?.sdk ?? createRealSlackSdk(),
    providerCircuitBreaker,
  );

  const readMap: Record<
    SlackReadToolName,
    (payload: SlackReadDispatchInput) => Promise<Record<string, unknown>>
  > = {
    "slack.listChannels": async ({ validated, accessToken, namespace }) => {
      const channels = await sdk.listChannels({
        accessToken,
        namespace,
        limit: 200,
      });

      return {
        channels: channels.map((channel) => ({
          id: channel.id,
          name: formatChannelName(channel.name),
          ...(typeof channel.isPrivate === "boolean" ? { is_private: channel.isPrivate } : {}),
        })),
      };
    },
    "slack.getChannelHistory": async ({ validated, accessToken, namespace }) => {
      const channel = String(validated.channel ?? "");
      const limit = Number(validated.limit ?? 50) || 50;
      const messages = await sdk.getChannelHistory({
        accessToken,
        namespace,
        channel,
        limit,
      });
      return {
        channel,
        messages: messages.map((message) => ({
          ts: message.ts,
          channel: message.channel,
          text: message.text,
          ...(message.userId ? { userId: message.userId } : {}),
          ...(message.threadTs ? { threadTs: message.threadTs } : {}),
          ...(message.reactions ? { reactions: message.reactions } : {}),
        })),
      };
    },
    "slack.getThreadReplies": async ({ validated, accessToken, namespace }) => {
      const channel = String(validated.channel ?? "");
      const threadTs = String(validated.threadTs ?? "");
      const limit = Number(validated.limit ?? 50) || 50;
      const replies = await sdk.getThreadReplies({
        accessToken,
        namespace,
        channel,
        threadTs,
        limit,
      });
      return {
        channel,
        threadTs,
        replies: replies.map((message) => ({
          ts: message.ts,
          channel: message.channel,
          text: message.text,
          ...(message.userId ? { userId: message.userId } : {}),
          ...(message.threadTs ? { threadTs: message.threadTs } : {}),
          ...(message.reactions ? { reactions: message.reactions } : {}),
        })),
      };
    },
    "slack.getReactions": async ({ validated, accessToken, namespace }) => {
      const channel = String(validated.channel ?? "");
      const ts = String(validated.ts ?? "");
      const reactions = await sdk.getReactions({
        accessToken,
        namespace,
        channel,
        ts,
      });
      return {
        channel,
        ts,
        reactions,
      };
    },
    "slack.listUsers": async ({ validated, accessToken, namespace }) => {
      const limit = Number(validated.limit ?? 200) || 200;
      const users = await sdk.listUsers({
        accessToken,
        namespace,
        limit,
      });
      return {
        users: users.map((user) => ({
          id: user.id,
          name: user.name,
          ...(user.realName ? { realName: user.realName } : {}),
          ...(typeof user.isBot === "boolean" ? { isBot: user.isBot } : {}),
          ...(typeof user.isDeleted === "boolean" ? { isDeleted: user.isDeleted } : {}),
        })),
      };
    },
    "slack.getUserInfo": async ({ validated, accessToken, namespace }) => {
      const userId = String(validated.userId ?? "");
      const user = await sdk.getUserInfo({
        accessToken,
        namespace,
        userId,
      });
      return {
        user: {
          id: user.id,
          name: user.name,
          ...(user.realName ? { realName: user.realName } : {}),
          ...(typeof user.isBot === "boolean" ? { isBot: user.isBot } : {}),
          ...(typeof user.isDeleted === "boolean" ? { isDeleted: user.isDeleted } : {}),
        },
      };
    },
    "slack.getChannelInfo": async ({ validated, accessToken, namespace }) => {
      const channel = String(validated.channel ?? "");
      const channelInfo = await sdk.getChannelInfo({
        accessToken,
        namespace,
        channel,
      });
      return {
        channel: {
          id: channelInfo.id,
          name: formatChannelName(channelInfo.name),
          ...(typeof channelInfo.isPrivate === "boolean"
            ? { is_private: channelInfo.isPrivate }
            : {}),
          ...(typeof channelInfo.isArchived === "boolean"
            ? { is_archived: channelInfo.isArchived }
            : {}),
          ...(typeof channelInfo.isMember === "boolean" ? { is_member: channelInfo.isMember } : {}),
          ...(typeof channelInfo.memberCount === "number"
            ? { member_count: channelInfo.memberCount }
            : {}),
        },
      };
    },
    "slack.searchMessages": async ({ validated, accessToken, namespace }) => {
      const query = String(validated.query ?? "");
      const limit = Number(validated.limit ?? 20) || 20;
      const messages = await sdk.searchMessages({
        accessToken,
        namespace,
        query,
        limit,
      });
      return {
        query,
        messages: messages.map((message) => ({
          ts: message.ts,
          channel: message.channel,
          text: message.text,
          ...(message.userId ? { userId: message.userId } : {}),
          ...(message.threadTs ? { threadTs: message.threadTs } : {}),
        })),
      };
    },
    "slack.listChannelMembers": async ({ validated, accessToken, namespace }) => {
      const channel = String(validated.channel ?? "");
      const limit = Number(validated.limit ?? 200) || 200;
      const members = await sdk.listChannelMembers({
        accessToken,
        namespace,
        channel,
        limit,
      });
      return {
        channel,
        members,
      };
    },
    "slack.listScheduledMessages": async ({ validated, accessToken, namespace }) => {
      const limit = Number(validated.limit ?? 20) || 20;
      const channel =
        typeof validated.channel === "string" && validated.channel.length > 0
          ? validated.channel
          : undefined;
      const scheduledMessages = await sdk.listScheduledMessages({
        accessToken,
        namespace,
        ...(channel ? { channel } : {}),
        limit,
      });
      return {
        ...(channel ? { channel } : {}),
        scheduled_messages: scheduledMessages.map((message) => ({
          id: message.id,
          channel: message.channel,
          text: message.text,
          post_at: message.postAt,
        })),
      };
    },
    "slack.getPermalink": async ({ validated, accessToken, namespace }) => {
      const channel = String(validated.channel ?? "");
      const ts = String(validated.ts ?? "");
      const permalink = await sdk.getPermalink({
        accessToken,
        namespace,
        channel,
        ts,
      });
      return {
        channel: permalink.channel,
        ts: permalink.ts,
        permalink: permalink.permalink,
      };
    },
    "slack.listBookmarks": async ({ validated, accessToken, namespace }) => {
      const channel = String(validated.channel ?? "");
      const bookmarks = await sdk.listBookmarks({
        accessToken,
        namespace,
        channel,
      });
      return {
        channel,
        bookmarks: bookmarks.map((bookmark) => ({
          id: bookmark.id,
          title: bookmark.title,
          link: bookmark.link,
          ...(typeof bookmark.emoji === "string" ? { emoji: bookmark.emoji } : {}),
          ...(typeof bookmark.entityId === "string" ? { entity_id: bookmark.entityId } : {}),
        })),
      };
    },
    "slack.listReminders": async ({ validated, accessToken, namespace }) => {
      const userId =
        typeof validated.userId === "string" && validated.userId.length > 0
          ? validated.userId
          : undefined;
      const reminders = await sdk.listReminders({
        accessToken,
        namespace,
        ...(userId ? { userId } : {}),
      });
      return {
        ...(userId ? { user_id: userId } : {}),
        reminders: reminders.map((reminder) => ({
          id: reminder.id,
          text: reminder.text,
          time: reminder.time,
          ...(typeof reminder.userId === "string" ? { user_id: reminder.userId } : {}),
        })),
      };
    },
    "slack.listUserGroups": async ({ validated, accessToken, namespace }) => {
      const includeDisabled =
        typeof validated.includeDisabled === "boolean" ? validated.includeDisabled : undefined;
      const userGroups = await sdk.listUserGroups({
        accessToken,
        namespace,
        ...(typeof includeDisabled === "boolean" ? { includeDisabled } : {}),
      });
      return {
        ...(typeof includeDisabled === "boolean" ? { include_disabled: includeDisabled } : {}),
        user_groups: userGroups.map((group) => ({
          id: group.id,
          handle: group.handle,
          name: group.name,
          ...(typeof group.isDisabled === "boolean" ? { is_disabled: group.isDisabled } : {}),
          ...(typeof group.userCount === "number" ? { user_count: group.userCount } : {}),
        })),
      };
    },
    "slack.listUserGroupMembers": async ({ validated, accessToken, namespace }) => {
      const userGroupId = String(validated.userGroupId ?? "");
      const includeDisabled =
        typeof validated.includeDisabled === "boolean" ? validated.includeDisabled : undefined;
      const members = await sdk.listUserGroupMembers({
        accessToken,
        namespace,
        userGroupId,
        ...(typeof includeDisabled === "boolean" ? { includeDisabled } : {}),
      });
      return {
        user_group_id: userGroupId,
        ...(typeof includeDisabled === "boolean" ? { include_disabled: includeDisabled } : {}),
        members,
      };
    },
    "slack.getUserPresence": async ({ validated, accessToken, namespace }) => {
      const userId = String(validated.userId ?? "");
      const presence = await sdk.getUserPresence({
        accessToken,
        namespace,
        userId,
      });
      return {
        presence: {
          user_id: presence.userId,
          presence: presence.presence,
          ...(typeof presence.online === "boolean" ? { online: presence.online } : {}),
          ...(typeof presence.autoAway === "boolean" ? { auto_away: presence.autoAway } : {}),
          ...(typeof presence.manualAway === "boolean" ? { manual_away: presence.manualAway } : {}),
          ...(typeof presence.lastActivity === "number"
            ? { last_activity: presence.lastActivity }
            : {}),
          ...(typeof presence.connectionCount === "number"
            ? { connection_count: presence.connectionCount }
            : {}),
        },
      };
    },
    "slack.listReactions": async ({ validated, accessToken, namespace }) => {
      const limit = Number(validated.limit ?? 20) || 20;
      const userId =
        typeof validated.userId === "string" && validated.userId.length > 0
          ? validated.userId
          : undefined;
      const reactions = await sdk.listReactions({
        accessToken,
        namespace,
        ...(userId ? { userId } : {}),
        limit,
      });
      return {
        ...(userId ? { user_id: userId } : {}),
        reactions: reactions.map((reaction) => ({
          channel: reaction.channel,
          ts: reaction.ts,
          name: reaction.name,
          count: reaction.count,
          users: reaction.users,
        })),
      };
    },
    "slack.listPins": async ({ validated, accessToken, namespace }) => {
      const channel = String(validated.channel ?? "");
      const pins = await sdk.listPins({
        accessToken,
        namespace,
        channel,
      });
      return {
        channel,
        pins: pins.map((pin) => ({
          channel: pin.channel,
          ts: pin.ts,
          ...(typeof pin.text === "string" ? { text: pin.text } : {}),
        })),
      };
    },
    "slack.listFiles": async ({ validated, accessToken, namespace }) => {
      const limit = Number(validated.limit ?? 20) || 20;
      const channel =
        typeof validated.channel === "string" && validated.channel.length > 0
          ? validated.channel
          : undefined;
      const userId =
        typeof validated.userId === "string" && validated.userId.length > 0
          ? validated.userId
          : undefined;
      const files = await sdk.listFiles({
        accessToken,
        namespace,
        ...(channel ? { channel } : {}),
        ...(userId ? { userId } : {}),
        limit,
      });
      return {
        ...(channel ? { channel } : {}),
        ...(userId ? { userId } : {}),
        files: files.map((file) => ({
          id: file.id,
          name: file.name,
          ...(typeof file.title === "string" ? { title: file.title } : {}),
          ...(typeof file.url === "string" ? { url: file.url } : {}),
          ...(Array.isArray(file.channels) ? { channels: file.channels } : {}),
          ...(typeof file.userId === "string" ? { userId: file.userId } : {}),
          ...(typeof file.mimetype === "string" ? { mimetype: file.mimetype } : {}),
          ...(typeof file.size === "number" ? { size: file.size } : {}),
        })),
      };
    },
    "slack.getFileInfo": async ({ validated, accessToken, namespace }) => {
      const fileId = String(validated.fileId ?? "");
      const file = await sdk.getFileInfo({
        accessToken,
        namespace,
        fileId,
      });
      return {
        file: {
          id: file.id,
          name: file.name,
          ...(typeof file.title === "string" ? { title: file.title } : {}),
          ...(typeof file.url === "string" ? { url: file.url } : {}),
          ...(Array.isArray(file.channels) ? { channels: file.channels } : {}),
          ...(typeof file.userId === "string" ? { userId: file.userId } : {}),
          ...(typeof file.mimetype === "string" ? { mimetype: file.mimetype } : {}),
          ...(typeof file.size === "number" ? { size: file.size } : {}),
        },
      };
    },
    "slack.getUserProfile": async ({ validated, accessToken, namespace }) => {
      const userId = String(validated.userId ?? "");
      const profile = await sdk.getUserProfile({
        accessToken,
        namespace,
        userId,
      });
      return {
        profile: {
          userId: profile.userId,
          ...(typeof profile.displayName === "string" ? { displayName: profile.displayName } : {}),
          ...(typeof profile.realName === "string" ? { realName: profile.realName } : {}),
          ...(typeof profile.email === "string" ? { email: profile.email } : {}),
          ...(typeof profile.title === "string" ? { title: profile.title } : {}),
          ...(typeof profile.statusText === "string" ? { statusText: profile.statusText } : {}),
          ...(typeof profile.statusEmoji === "string" ? { statusEmoji: profile.statusEmoji } : {}),
        },
      };
    },
    "slack.searchFiles": async ({ validated, accessToken, namespace }) => {
      const query = String(validated.query ?? "");
      const limit = Number(validated.limit ?? 20) || 20;
      const files = await sdk.searchFiles({
        accessToken,
        namespace,
        query,
        limit,
      });
      return {
        query,
        files: files.map((file) => ({
          id: file.id,
          name: file.name,
          ...(typeof file.title === "string" ? { title: file.title } : {}),
          ...(typeof file.url === "string" ? { url: file.url } : {}),
          ...(Array.isArray(file.channels) ? { channels: file.channels } : {}),
          ...(typeof file.userId === "string" ? { userId: file.userId } : {}),
          ...(typeof file.mimetype === "string" ? { mimetype: file.mimetype } : {}),
          ...(typeof file.size === "number" ? { size: file.size } : {}),
        })),
      };
    },
  };

  const prepareMap: Record<
    SlackWriteToolName,
    (payload: SlackPrepareDispatchInput) => Promise<PreparedWrite>
  > = {
    "slack.postMessage": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const text = String(validated.text ?? "");
      return {
        normalized_payload: {
          type: "post_message",
          channel,
          text,
        },
        payload_preview: {
          channel,
          message_preview: text.slice(0, 120),
        },
      };
    },
    "slack.updateMessage": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const ts = String(validated.ts ?? "");
      const text = String(validated.text ?? "");
      return {
        normalized_payload: {
          type: "update_message",
          channel,
          ts,
          text,
        },
        payload_preview: {
          channel,
          ts,
          message_preview: text.slice(0, 120),
        },
      };
    },
    "slack.deleteMessage": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const ts = String(validated.ts ?? "");
      return {
        normalized_payload: {
          type: "delete_message",
          channel,
          ts,
        },
        payload_preview: {
          channel,
          ts,
        },
      };
    },
    "slack.addReaction": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const ts = String(validated.ts ?? "");
      const name = String(validated.name ?? "");
      return {
        normalized_payload: {
          type: "add_reaction",
          channel,
          ts,
          name,
        },
        payload_preview: {
          channel,
          ts,
          reaction: name,
        },
      };
    },
    "slack.postEphemeral": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const userId = String(validated.userId ?? "");
      const text = String(validated.text ?? "");
      return {
        normalized_payload: {
          type: "post_ephemeral",
          channel,
          userId,
          text,
        },
        payload_preview: {
          channel,
          userId,
          message_preview: text.slice(0, 120),
        },
      };
    },
    "slack.uploadFile": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const filename = String(validated.filename ?? "");
      const content = String(validated.content ?? "");
      return {
        normalized_payload: {
          type: "upload_file",
          channel,
          filename,
          content,
          ...(typeof validated.title === "string" ? { title: validated.title } : {}),
        },
        payload_preview: {
          channel,
          filename,
          ...(typeof validated.title === "string" ? { title: validated.title } : {}),
          content_preview: content.slice(0, 120),
        },
      };
    },
    "slack.createChannel": async ({ validated }) => {
      const name = String(validated.name ?? "");
      return {
        normalized_payload: {
          type: "create_channel",
          name,
          ...(typeof validated.isPrivate === "boolean" ? { isPrivate: validated.isPrivate } : {}),
        },
        payload_preview: {
          channel_name: name,
          ...(typeof validated.isPrivate === "boolean" ? { is_private: validated.isPrivate } : {}),
        },
      };
    },
    "slack.inviteToChannel": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const userIds = Array.isArray(validated.userIds)
        ? validated.userIds.map((entry) => String(entry))
        : [];
      return {
        normalized_payload: {
          type: "invite_to_channel",
          channel,
          userIds,
        },
        payload_preview: {
          channel,
          user_count: userIds.length,
        },
      };
    },
    "slack.joinChannel": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      return {
        normalized_payload: {
          type: "join_channel",
          channel,
        },
        payload_preview: {
          channel,
        },
      };
    },
    "slack.markChannelRead": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const ts = String(validated.ts ?? "");
      return {
        normalized_payload: {
          type: "mark_channel_read",
          channel,
          ts,
        },
        payload_preview: {
          channel,
          ts,
        },
      };
    },
    "slack.archiveChannel": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      return {
        normalized_payload: {
          type: "archive_channel",
          channel,
        },
        payload_preview: {
          channel,
        },
      };
    },
    "slack.unarchiveChannel": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      return {
        normalized_payload: {
          type: "unarchive_channel",
          channel,
        },
        payload_preview: {
          channel,
        },
      };
    },
    "slack.setChannelPurpose": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const purpose = String(validated.purpose ?? "");
      return {
        normalized_payload: {
          type: "set_channel_purpose",
          channel,
          purpose,
        },
        payload_preview: {
          channel,
          purpose_preview: purpose.slice(0, 120),
        },
      };
    },
    "slack.setChannelTopic": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const topic = String(validated.topic ?? "");
      return {
        normalized_payload: {
          type: "set_channel_topic",
          channel,
          topic,
        },
        payload_preview: {
          channel,
          topic_preview: topic.slice(0, 120),
        },
      };
    },
    "slack.openDM": async ({ validated }) => {
      const userIds = Array.isArray(validated.userIds)
        ? validated.userIds.map((entry) => String(entry))
        : [];
      return {
        normalized_payload: {
          type: "open_dm",
          userIds,
        },
        payload_preview: {
          user_count: userIds.length,
        },
      };
    },
    "slack.renameChannel": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const name = String(validated.name ?? "");
      return {
        normalized_payload: {
          type: "rename_channel",
          channel,
          name,
        },
        payload_preview: {
          channel,
          name,
        },
      };
    },
    "slack.kickFromChannel": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const userId = String(validated.userId ?? "");
      return {
        normalized_payload: {
          type: "kick_from_channel",
          channel,
          userId,
        },
        payload_preview: {
          channel,
          user_id: userId,
        },
      };
    },
    "slack.leaveChannel": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      return {
        normalized_payload: {
          type: "leave_channel",
          channel,
        },
        payload_preview: {
          channel,
        },
      };
    },
    "slack.closeDM": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      return {
        normalized_payload: {
          type: "close_dm",
          channel,
        },
        payload_preview: {
          channel,
        },
      };
    },
    "slack.addBookmark": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const title = String(validated.title ?? "");
      const link = String(validated.link ?? "");
      return {
        normalized_payload: {
          type: "add_bookmark",
          channel,
          title,
          link,
          ...(typeof validated.emoji === "string" ? { emoji: validated.emoji } : {}),
        },
        payload_preview: {
          channel,
          title,
          link,
        },
      };
    },
    "slack.editBookmark": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const bookmarkId = String(validated.bookmarkId ?? "");
      return {
        normalized_payload: {
          type: "edit_bookmark",
          channel,
          bookmarkId,
          ...(typeof validated.title === "string" ? { title: validated.title } : {}),
          ...(typeof validated.link === "string" ? { link: validated.link } : {}),
          ...(typeof validated.emoji === "string" ? { emoji: validated.emoji } : {}),
        },
        payload_preview: {
          channel,
          bookmark_id: bookmarkId,
        },
      };
    },
    "slack.removeBookmark": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const bookmarkId = String(validated.bookmarkId ?? "");
      return {
        normalized_payload: {
          type: "remove_bookmark",
          channel,
          bookmarkId,
        },
        payload_preview: {
          channel,
          bookmark_id: bookmarkId,
        },
      };
    },
    "slack.addReminder": async ({ validated }) => {
      const text = String(validated.text ?? "");
      const time = Number(validated.time ?? 0);
      return {
        normalized_payload: {
          type: "add_reminder",
          text,
          time,
          ...(typeof validated.userId === "string" ? { userId: validated.userId } : {}),
        },
        payload_preview: {
          reminder_preview: text.slice(0, 120),
          time,
        },
      };
    },
    "slack.deleteReminder": async ({ validated }) => {
      const reminderId = String(validated.reminderId ?? "");
      return {
        normalized_payload: {
          type: "delete_reminder",
          reminderId,
        },
        payload_preview: {
          reminder_id: reminderId,
        },
      };
    },
    "slack.meMessage": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const text = String(validated.text ?? "");
      return {
        normalized_payload: {
          type: "me_message",
          channel,
          text,
        },
        payload_preview: {
          channel,
          message_preview: text.slice(0, 120),
        },
      };
    },
    "slack.scheduleMessage": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const text = String(validated.text ?? "");
      const postAt = Number(validated.postAt ?? 0);
      return {
        normalized_payload: {
          type: "schedule_message",
          channel,
          text,
          postAt,
        },
        payload_preview: {
          channel,
          message_preview: text.slice(0, 120),
          post_at: postAt,
        },
      };
    },
    "slack.deleteScheduledMessage": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const scheduledMessageId = String(validated.scheduledMessageId ?? "");
      return {
        normalized_payload: {
          type: "delete_scheduled_message",
          channel,
          scheduledMessageId,
        },
        payload_preview: {
          channel,
          scheduled_message_id: scheduledMessageId,
        },
      };
    },
    "slack.removeReaction": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const ts = String(validated.ts ?? "");
      const name = String(validated.name ?? "");
      return {
        normalized_payload: {
          type: "remove_reaction",
          channel,
          ts,
          name,
        },
        payload_preview: {
          channel,
          ts,
          reaction: name,
        },
      };
    },
    "slack.pinMessage": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const ts = String(validated.ts ?? "");
      return {
        normalized_payload: {
          type: "pin_message",
          channel,
          ts,
        },
        payload_preview: {
          channel,
          ts,
        },
      };
    },
    "slack.unpinMessage": async ({ validated }) => {
      const channel = String(validated.channel ?? "");
      const ts = String(validated.ts ?? "");
      return {
        normalized_payload: {
          type: "unpin_message",
          channel,
          ts,
        },
        payload_preview: {
          channel,
          ts,
        },
      };
    },
    "slack.deleteFile": async ({ validated }) => {
      const fileId = String(validated.fileId ?? "");
      return {
        normalized_payload: {
          type: "delete_file",
          fileId,
        },
        payload_preview: {
          file_id: fileId,
        },
      };
    },
  };

  const writeMap: Record<
    SlackWriteToolName,
    (payload: SlackWriteDispatchInput) => Promise<Record<string, unknown>>
  > = {
    "slack.postMessage": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.postMessage", normalizedPayload);
      const response = await sdk.postMessage({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        text: String(normalizedPayload.text ?? ""),
        idempotencyKey,
      });

      return {
        status: response.ok ? "posted" : "failed",
        provider_action_id: response.message.client_msg_id ?? `slack_ts_${response.ts}`,
        channel: response.channel,
        ts: response.ts,
      };
    },
    "slack.updateMessage": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.updateMessage", normalizedPayload);
      const response = await sdk.updateMessage({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        ts: String(normalizedPayload.ts ?? ""),
        text: String(normalizedPayload.text ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "updated" : "failed",
        provider_action_id: response.message.client_msg_id ?? `slack_ts_${response.ts}`,
        channel: response.channel,
        ts: response.ts,
      };
    },
    "slack.deleteMessage": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.deleteMessage", normalizedPayload);
      const response = await sdk.deleteMessage({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        ts: String(normalizedPayload.ts ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "deleted" : "failed",
        provider_action_id: `slack_ts_${response.ts}`,
        channel: response.channel,
        ts: response.ts,
      };
    },
    "slack.addReaction": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.addReaction", normalizedPayload);
      const response = await sdk.addReaction({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        ts: String(normalizedPayload.ts ?? ""),
        name: String(normalizedPayload.name ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "reacted" : "failed",
        provider_action_id: `slack_ts_${response.ts}`,
        channel: response.channel,
        ts: response.ts,
        name: response.name,
      };
    },
    "slack.postEphemeral": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.postEphemeral", normalizedPayload);
      const response = await sdk.postEphemeral({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        userId: String(normalizedPayload.userId ?? ""),
        text: String(normalizedPayload.text ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "posted" : "failed",
        provider_action_id: `slack_ephemeral_${response.messageTs}`,
        channel: response.channel,
        ts: response.messageTs,
      };
    },
    "slack.uploadFile": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.uploadFile", normalizedPayload);
      const response = await sdk.uploadFile({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        filename: String(normalizedPayload.filename ?? ""),
        content: String(normalizedPayload.content ?? ""),
        ...(typeof normalizedPayload.title === "string" ? { title: normalizedPayload.title } : {}),
        idempotencyKey,
      });
      return {
        status: response.ok ? "uploaded" : "failed",
        provider_action_id: response.file.id,
        file: {
          id: response.file.id,
          name: response.file.name,
          ...(response.file.title ? { title: response.file.title } : {}),
          ...(response.file.url ? { url: response.file.url } : {}),
        },
      };
    },
    "slack.createChannel": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.createChannel", normalizedPayload);
      const response = await sdk.createChannel({
        accessToken,
        namespace,
        name: String(normalizedPayload.name ?? ""),
        ...(typeof normalizedPayload.isPrivate === "boolean"
          ? { isPrivate: normalizedPayload.isPrivate }
          : {}),
        idempotencyKey,
      });
      return {
        status: response.ok ? "created" : "failed",
        provider_action_id: response.channel.id,
        channel: {
          id: response.channel.id,
          name: formatChannelName(response.channel.name),
          ...(typeof response.channel.isPrivate === "boolean"
            ? { is_private: response.channel.isPrivate }
            : {}),
        },
      };
    },
    "slack.inviteToChannel": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "slack.inviteToChannel",
        normalizedPayload,
      );
      const userIds = Array.isArray(normalizedPayload.userIds)
        ? normalizedPayload.userIds.map((entry) => String(entry))
        : [];
      const response = await sdk.inviteToChannel({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        userIds,
        idempotencyKey,
      });
      return {
        status: response.ok ? "invited" : "failed",
        provider_action_id: response.channel.id,
        channel: response.channel.id,
        invited_user_ids: response.invitedUserIds,
      };
    },
    "slack.joinChannel": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.joinChannel", normalizedPayload);
      const response = await sdk.joinChannel({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "joined" : "failed",
        provider_action_id: response.channel.id,
        channel: response.channel.id,
      };
    },
    "slack.markChannelRead": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "slack.markChannelRead",
        normalizedPayload,
      );
      const response = await sdk.markChannelRead({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        ts: String(normalizedPayload.ts ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "marked" : "failed",
        provider_action_id: `slack_mark_${response.channel}_${response.ts}`,
        channel: response.channel,
        ts: response.ts,
      };
    },
    "slack.archiveChannel": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.archiveChannel", normalizedPayload);
      const response = await sdk.archiveChannel({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "archived" : "failed",
        provider_action_id: response.channel.id,
        channel: response.channel.id,
      };
    },
    "slack.unarchiveChannel": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "slack.unarchiveChannel",
        normalizedPayload,
      );
      const response = await sdk.unarchiveChannel({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "unarchived" : "failed",
        provider_action_id: response.channel.id,
        channel: response.channel.id,
      };
    },
    "slack.setChannelPurpose": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "slack.setChannelPurpose",
        normalizedPayload,
      );
      const response = await sdk.setChannelPurpose({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        purpose: String(normalizedPayload.purpose ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "updated" : "failed",
        provider_action_id: response.channel,
        channel: response.channel,
        purpose: response.purpose,
      };
    },
    "slack.setChannelTopic": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "slack.setChannelTopic",
        normalizedPayload,
      );
      const response = await sdk.setChannelTopic({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        topic: String(normalizedPayload.topic ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "updated" : "failed",
        provider_action_id: response.channel,
        channel: response.channel,
        topic: response.topic,
      };
    },
    "slack.openDM": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.openDM", normalizedPayload);
      const userIds = Array.isArray(normalizedPayload.userIds)
        ? normalizedPayload.userIds.map((entry) => String(entry))
        : [];
      const response = await sdk.openDM({
        accessToken,
        namespace,
        userIds,
        idempotencyKey,
      });
      return {
        status: response.ok ? "opened" : "failed",
        provider_action_id: response.channel.id,
        channel: response.channel.id,
        user_ids: response.userIds,
      };
    },
    "slack.renameChannel": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.renameChannel", normalizedPayload);
      const response = await sdk.renameChannel({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        name: String(normalizedPayload.name ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "renamed" : "failed",
        provider_action_id: response.channel.id,
        channel: response.channel.id,
        name: response.channel.name,
      };
    },
    "slack.kickFromChannel": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "slack.kickFromChannel",
        normalizedPayload,
      );
      const response = await sdk.kickFromChannel({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        userId: String(normalizedPayload.userId ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "removed" : "failed",
        provider_action_id: `slack_kick_${response.channel.id}_${response.userId}`,
        channel: response.channel.id,
        user_id: response.userId,
      };
    },
    "slack.leaveChannel": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.leaveChannel", normalizedPayload);
      const response = await sdk.leaveChannel({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "left" : "failed",
        provider_action_id: response.channel.id,
        channel: response.channel.id,
      };
    },
    "slack.closeDM": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.closeDM", normalizedPayload);
      const response = await sdk.closeDM({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "closed" : "failed",
        provider_action_id: response.channel.id,
        channel: response.channel.id,
      };
    },
    "slack.addBookmark": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.addBookmark", normalizedPayload);
      const response = await sdk.addBookmark({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        title: String(normalizedPayload.title ?? ""),
        link: String(normalizedPayload.link ?? ""),
        ...(typeof normalizedPayload.emoji === "string" ? { emoji: normalizedPayload.emoji } : {}),
        idempotencyKey,
      });
      return {
        status: response.ok ? "added" : "failed",
        provider_action_id: response.bookmark.id,
        bookmark: {
          id: response.bookmark.id,
          channel: response.bookmark.channel,
          title: response.bookmark.title,
          link: response.bookmark.link,
          ...(typeof response.bookmark.emoji === "string"
            ? { emoji: response.bookmark.emoji }
            : {}),
        },
      };
    },
    "slack.editBookmark": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.editBookmark", normalizedPayload);
      const response = await sdk.editBookmark({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        bookmarkId: String(normalizedPayload.bookmarkId ?? ""),
        ...(typeof normalizedPayload.title === "string" ? { title: normalizedPayload.title } : {}),
        ...(typeof normalizedPayload.link === "string" ? { link: normalizedPayload.link } : {}),
        ...(typeof normalizedPayload.emoji === "string" ? { emoji: normalizedPayload.emoji } : {}),
        idempotencyKey,
      });
      return {
        status: response.ok ? "updated" : "failed",
        provider_action_id: response.bookmark.id,
        bookmark: {
          id: response.bookmark.id,
          channel: response.bookmark.channel,
          title: response.bookmark.title,
          link: response.bookmark.link,
          ...(typeof response.bookmark.emoji === "string"
            ? { emoji: response.bookmark.emoji }
            : {}),
        },
      };
    },
    "slack.removeBookmark": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.removeBookmark", normalizedPayload);
      const response = await sdk.removeBookmark({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        bookmarkId: String(normalizedPayload.bookmarkId ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "removed" : "failed",
        provider_action_id: response.bookmarkId,
        channel: response.channel,
        bookmark_id: response.bookmarkId,
      };
    },
    "slack.addReminder": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.addReminder", normalizedPayload);
      const response = await sdk.addReminder({
        accessToken,
        namespace,
        text: String(normalizedPayload.text ?? ""),
        time: Number(normalizedPayload.time ?? 0),
        ...(typeof normalizedPayload.userId === "string"
          ? { userId: normalizedPayload.userId }
          : {}),
        idempotencyKey,
      });
      return {
        status: response.ok ? "created" : "failed",
        provider_action_id: response.reminder.id,
        reminder: {
          id: response.reminder.id,
          text: response.reminder.text,
          time: response.reminder.time,
          ...(typeof response.reminder.userId === "string"
            ? { user_id: response.reminder.userId }
            : {}),
        },
      };
    },
    "slack.deleteReminder": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.deleteReminder", normalizedPayload);
      const response = await sdk.deleteReminder({
        accessToken,
        namespace,
        reminderId: String(normalizedPayload.reminderId ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "deleted" : "failed",
        provider_action_id: response.reminderId,
        reminder_id: response.reminderId,
      };
    },
    "slack.meMessage": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.meMessage", normalizedPayload);
      const response = await sdk.meMessage({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        text: String(normalizedPayload.text ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "posted" : "failed",
        provider_action_id: `slack_ts_${response.ts}`,
        channel: response.channel,
        ts: response.ts,
      };
    },
    "slack.scheduleMessage": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "slack.scheduleMessage",
        normalizedPayload,
      );
      const response = await sdk.scheduleMessage({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        text: String(normalizedPayload.text ?? ""),
        postAt: Number(normalizedPayload.postAt ?? 0),
        idempotencyKey,
      });
      return {
        status: response.ok ? "scheduled" : "failed",
        provider_action_id: response.scheduledMessageId,
        channel: response.channel,
        scheduled_message_id: response.scheduledMessageId,
        post_at: response.postAt,
      };
    },
    "slack.deleteScheduledMessage": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey(
        "slack.deleteScheduledMessage",
        normalizedPayload,
      );
      const response = await sdk.deleteScheduledMessage({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        scheduledMessageId: String(normalizedPayload.scheduledMessageId ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "deleted" : "failed",
        provider_action_id: response.scheduledMessageId,
        channel: response.channel,
        scheduled_message_id: response.scheduledMessageId,
      };
    },
    "slack.removeReaction": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.removeReaction", normalizedPayload);
      const response = await sdk.removeReaction({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        ts: String(normalizedPayload.ts ?? ""),
        name: String(normalizedPayload.name ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "removed" : "failed",
        provider_action_id: `slack_ts_${response.ts}`,
        channel: response.channel,
        ts: response.ts,
        name: response.name,
      };
    },
    "slack.pinMessage": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.pinMessage", normalizedPayload);
      const response = await sdk.pinMessage({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        ts: String(normalizedPayload.ts ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "pinned" : "failed",
        provider_action_id: `slack_ts_${response.ts}`,
        channel: response.channel,
        ts: response.ts,
      };
    },
    "slack.unpinMessage": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.unpinMessage", normalizedPayload);
      const response = await sdk.unpinMessage({
        accessToken,
        namespace,
        channel: String(normalizedPayload.channel ?? ""),
        ts: String(normalizedPayload.ts ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "unpinned" : "failed",
        provider_action_id: `slack_ts_${response.ts}`,
        channel: response.channel,
        ts: response.ts,
      };
    },
    "slack.deleteFile": async ({ normalizedPayload, accessToken, namespace }) => {
      const idempotencyKey = buildProviderIdempotencyKey("slack.deleteFile", normalizedPayload);
      const response = await sdk.deleteFile({
        accessToken,
        namespace,
        fileId: String(normalizedPayload.fileId ?? ""),
        idempotencyKey,
      });
      return {
        status: response.ok ? "deleted" : "failed",
        provider_action_id: response.fileId,
        file_id: response.fileId,
      };
    },
  };

  class SlackConnector extends BaseConnector<
    SlackReadDispatchInput,
    SlackPrepareDispatchInput,
    SlackWriteDispatchInput,
    typeof slackTools
  > {
    constructor() {
      super({
        provider: "slack",
        tools: slackTools,
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
    ): SlackReadDispatchInput {
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
    ): SlackPrepareDispatchInput {
      return { validated };
    }

    protected buildWriteDispatchInput(
      _toolName: string,
      normalizedPayload: Record<string, unknown>,
      _context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): SlackWriteDispatchInput {
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
        return `Unsupported Slack read tool ${toolName}`;
      }
      return `Unsupported Slack write tool ${toolName}`;
    }
  }

  return new SlackConnector();
};
const connector = createSlackConnector();

export default connector;
