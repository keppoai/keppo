import { ProviderSdkError, type ProviderSdkCallLog } from "../port.js";
import { BaseFakeClient } from "../base-fake-client.js";
import { seedSlackChannels, seedSlackMessages, seedSlackUsers } from "./fixtures.js";
import { toProviderSdkError } from "./errors.js";
import type { CreateSlackClient } from "./client-interface.js";
import { createFakeSlackClient } from "./fake-client-adapter.js";
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
  SlackSearchMessagesArgs,
  SlackSearchFilesArgs,
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

type SlackNamespaceState = {
  channels: Array<
    SlackChannel & {
      isArchived?: boolean | undefined;
      purpose?: string | undefined;
      topic?: string | undefined;
      memberIds: string[];
    }
  >;
  users: SlackUser[];
  messages: SlackMessage[];
  scheduledMessages: SlackScheduledMessage[];
  files: SlackFile[];
  pins: SlackPinItem[];
  bookmarks: SlackBookmark[];
  reminders: SlackReminder[];
  userGroups: Array<
    SlackUserGroup & {
      memberIds: string[];
    }
  >;
  presenceByUserId: Record<string, SlackUserPresence>;
  dmCounter: number;
  channelCount: number;
  scheduledCount: number;
  messageCount: number;
  ephemeralCount: number;
  fileCount: number;
  bookmarkCount: number;
  reminderCount: number;
  idempotentResponses: Map<string, unknown>;
  forceRateLimit: boolean;
  forceTimeout: boolean;
};

const normalizeChannelValue = (value: string): string => {
  return value.trim().replace(/^#/, "").toLowerCase();
};

const toSlackTs = (counter: number): string => {
  return `1700000001.${String(counter).padStart(6, "0")}`;
};

const toBookmarkId = (counter: number): string => {
  return `Bk${String(counter).padStart(6, "0")}`;
};

const toReminderId = (counter: number): string => {
  return `Rm${String(counter).padStart(6, "0")}`;
};

const toChannelState = (channel: SlackChannel, memberIds: string[]) => {
  return {
    ...channel,
    memberIds: [...memberIds],
  };
};

const toChannelInfo = (
  channel: SlackNamespaceState["channels"][number],
  isMember: boolean,
): SlackChannelInfo => {
  return {
    id: channel.id,
    name: channel.name,
    ...(typeof channel.isPrivate === "boolean" ? { isPrivate: channel.isPrivate } : {}),
    ...(typeof channel.isArchived === "boolean" ? { isArchived: channel.isArchived } : {}),
    isMember,
    memberCount: channel.memberIds.length,
  };
};

export class InMemorySlackEngine extends BaseFakeClient<SlackNamespaceState> {
  constructor(options?: { callLog?: ProviderSdkCallLog }) {
    super({
      providerId: "slack",
      ...(options?.callLog ? { callLog: options.callLog } : {}),
    });
  }

  async listChannels(args: SlackListChannelsArgs): Promise<SlackChannel[]> {
    const method = "slack.conversations.list";
    const normalizedArgs = {
      namespace: args.namespace,
      limit: args.limit,
    };
    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const safeLimit = Math.max(1, Math.min(200, Number(args.limit) || 100));
        return state.channels.slice(0, safeLimit).map((channel) => ({
          id: channel.id,
          name: channel.name,
          ...(typeof channel.isPrivate === "boolean" ? { isPrivate: channel.isPrivate } : {}),
        }));
      },
    });
  }

  async getChannelHistory(args: SlackGetChannelHistoryArgs): Promise<SlackMessage[]> {
    const method = "slack.conversations.history";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      limit: args.limit,
    };
    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }

        const safeLimit = Math.max(1, Math.min(200, Number(args.limit) || 50));
        return state.messages
          .filter((message) => message.channel === channel.id)
          .sort((left, right) => right.ts.localeCompare(left.ts))
          .slice(0, safeLimit);
      },
    });
  }

  async getThreadReplies(args: SlackGetThreadRepliesArgs): Promise<SlackMessage[]> {
    const method = "slack.conversations.replies";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      threadTs: args.threadTs,
      limit: args.limit,
    };

    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }

        const safeLimit = Math.max(1, Math.min(200, Number(args.limit) || 50));
        return state.messages
          .filter(
            (message) =>
              message.channel === channel.id &&
              (message.ts === args.threadTs || message.threadTs === args.threadTs),
          )
          .sort((left, right) => left.ts.localeCompare(right.ts))
          .slice(0, safeLimit);
      },
    });
  }

  async getReactions(args: SlackGetReactionsArgs): Promise<SlackMessageReaction[]> {
    const method = "slack.reactions.get";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
    };

    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => this.getMessage(state, args.channel, args.ts).reactions ?? [],
    });
  }

  async listReactions(args: SlackListReactionsArgs): Promise<SlackListedReaction[]> {
    const method = "slack.reactions.list";
    const normalizedArgs = {
      namespace: args.namespace,
      ...(typeof args.userId === "string" ? { userId: args.userId } : {}),
      limit: args.limit,
    };

    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const userId =
          typeof args.userId === "string" && args.userId.length > 0
            ? this.resolveUser(state, args.userId)?.id
            : null;
        const safeLimit = Math.max(1, Math.min(200, Number(args.limit) || 20));

        const listed: SlackListedReaction[] = [];
        for (const message of state.messages) {
          if (!Array.isArray(message.reactions) || message.reactions.length === 0) {
            continue;
          }
          for (const reaction of message.reactions) {
            if (userId && !reaction.users.includes(userId)) {
              continue;
            }
            listed.push({
              channel: message.channel,
              ts: message.ts,
              name: reaction.name,
              count: reaction.count,
              users: [...reaction.users],
            });
            if (listed.length >= safeLimit) {
              return listed;
            }
          }
        }
        return listed;
      },
    });
  }

  async listUsers(args: SlackListUsersArgs): Promise<SlackUser[]> {
    const method = "slack.users.list";
    const normalizedArgs = {
      namespace: args.namespace,
      limit: args.limit,
    };

    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const safeLimit = Math.max(1, Math.min(200, Number(args.limit) || 200));
        return state.users.slice(0, safeLimit);
      },
    });
  }

  async getUserInfo(args: SlackGetUserInfoArgs): Promise<SlackUser> {
    const method = "slack.users.info";
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
    };

    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const user = this.resolveUser(state, args.userId);
        if (!user) {
          throw new Error("user_not_found");
        }
        return user;
      },
    });
  }

  async getUserPresence(args: SlackGetUserPresenceArgs): Promise<SlackUserPresence> {
    const method = "slack.users.getPresence";
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
    };

    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const user = this.resolveUser(state, args.userId);
        if (!user) {
          throw new Error("user_not_found");
        }
        return (
          state.presenceByUserId[user.id] ??
          ({
            userId: user.id,
            presence: user.isBot ? "active" : "away",
            online: !!user.isBot,
            autoAway: !user.isBot,
            manualAway: false,
            lastActivity: 1_700_000_000,
            connectionCount: user.isBot ? 1 : 0,
          } as SlackUserPresence)
        );
      },
    });
  }

  async getChannelInfo(args: SlackGetChannelInfoArgs): Promise<SlackChannelInfo> {
    const method = "slack.conversations.info";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };

    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        return toChannelInfo(channel, channel.memberIds.includes("U003"));
      },
    });
  }

  async searchMessages(args: SlackSearchMessagesArgs): Promise<SlackMessage[]> {
    const method = "slack.search.messages";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      limit: args.limit,
    };

    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const query = args.query.trim().toLowerCase();
        if (!query) {
          throw new Error("missing_query");
        }
        const safeLimit = Math.max(1, Math.min(100, Number(args.limit) || 20));
        return state.messages
          .filter((message) => message.text.toLowerCase().includes(query))
          .sort((left, right) => right.ts.localeCompare(left.ts))
          .slice(0, safeLimit);
      },
    });
  }

  async listBookmarks(args: SlackListBookmarksArgs): Promise<SlackBookmark[]> {
    const method = "slack.bookmarks.list";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };

    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        return state.bookmarks.filter((entry) => entry.channel === channel.id);
      },
    });
  }

  async listReminders(args: SlackListRemindersArgs): Promise<SlackReminder[]> {
    const method = "slack.reminders.list";
    const normalizedArgs = {
      namespace: args.namespace,
      ...(typeof args.userId === "string" ? { userId: args.userId } : {}),
    };

    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const userId =
          typeof args.userId === "string" && args.userId.length > 0
            ? this.resolveUser(state, args.userId)?.id
            : null;
        return state.reminders.filter((entry) => !userId || entry.userId === userId);
      },
    });
  }

  async listUserGroups(args: SlackListUserGroupsArgs): Promise<SlackUserGroup[]> {
    const method = "slack.usergroups.list";
    const normalizedArgs = {
      namespace: args.namespace,
      ...(typeof args.includeDisabled === "boolean"
        ? { includeDisabled: args.includeDisabled }
        : {}),
    };

    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) =>
        state.userGroups
          .filter((group) => args.includeDisabled || !group.isDisabled)
          .map((group) => ({
            id: group.id,
            handle: group.handle,
            name: group.name,
            ...(typeof group.isDisabled === "boolean" ? { isDisabled: group.isDisabled } : {}),
            userCount: group.memberIds.length,
          })),
    });
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

    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const normalizedId = args.userGroupId.trim().toLowerCase();
        const userGroup =
          state.userGroups.find((entry) => entry.id.toLowerCase() === normalizedId) ??
          state.userGroups.find((entry) => entry.handle.toLowerCase() === normalizedId);
        if (!userGroup) {
          throw new Error("usergroup_not_found");
        }
        if (userGroup.isDisabled && !args.includeDisabled) {
          throw new Error("usergroup_disabled");
        }
        return [...userGroup.memberIds];
      },
    });
  }

  async postMessage(args: SlackPostMessageArgs): Promise<SlackPostMessageResponse> {
    const method = "slack.chat.postMessage";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      text: args.text,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        if (!args.text.trim()) {
          throw new Error("missing_text");
        }
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }

        state.messageCount += 1;
        const ts = toSlackTs(state.messageCount);
        state.messages.unshift({
          ts,
          channel: channel.id,
          text: args.text,
          userId: "U003",
        });
        return {
          ok: true,
          channel: channel.id,
          ts,
          message: {
            text: args.text,
            client_msg_id: `msg_${state.messageCount}`,
          },
        };
      },
    });
  }

  async updateMessage(args: SlackUpdateMessageArgs): Promise<SlackUpdateMessageResponse> {
    const method = "slack.chat.update";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
      text: args.text,
    };

    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        if (!args.text.trim()) {
          throw new Error("missing_text");
        }
        const message = this.getMessage(state, args.channel, args.ts);
        const next: SlackMessage = {
          ...message,
          text: args.text,
        };
        state.messages = state.messages.map((entry) =>
          entry.channel === message.channel && entry.ts === message.ts ? next : entry,
        );
        return {
          ok: true,
          channel: next.channel,
          ts: next.ts,
          message: {
            text: next.text,
            client_msg_id: `msg_update_${next.ts.replace(".", "_")}`,
          },
        };
      },
    });
  }

  async deleteMessage(args: SlackDeleteMessageArgs): Promise<SlackDeleteMessageResponse> {
    const method = "slack.chat.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
    };

    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const message = this.getMessage(state, args.channel, args.ts);
        state.messages = state.messages.filter(
          (entry) => !(entry.channel === message.channel && entry.ts === message.ts),
        );
        return {
          ok: true,
          channel: message.channel,
          ts: message.ts,
        };
      },
    });
  }

  async addReaction(args: SlackAddReactionArgs): Promise<SlackAddReactionResponse> {
    const method = "slack.reactions.add";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
      name: args.name,
    };

    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        if (!args.name.trim()) {
          throw new Error("missing_name");
        }

        const message = this.getMessage(state, args.channel, args.ts);
        const existingReactionIndex = (message.reactions ?? []).findIndex(
          (reaction) => reaction.name === args.name,
        );
        const nextReactions = [...(message.reactions ?? [])];
        if (existingReactionIndex >= 0) {
          const existingReaction = nextReactions[existingReactionIndex];
          if (existingReaction) {
            if (!existingReaction.users.includes("U003")) {
              existingReaction.users.push("U003");
            }
            existingReaction.count = existingReaction.users.length;
          }
        } else {
          nextReactions.push({
            name: args.name,
            count: 1,
            users: ["U003"],
          });
        }
        state.messages = state.messages.map((entry) =>
          entry.channel === message.channel && entry.ts === message.ts
            ? {
                ...entry,
                reactions: nextReactions,
              }
            : entry,
        );
        return {
          ok: true,
          channel: message.channel,
          ts: message.ts,
          name: args.name,
        };
      },
    });
  }

  async postEphemeral(args: SlackPostEphemeralArgs): Promise<SlackPostEphemeralResponse> {
    const method = "slack.chat.postEphemeral";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      userId: args.userId,
      text: args.text,
    };

    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        if (!args.text.trim()) {
          throw new Error("missing_text");
        }
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        const user = this.resolveUser(state, args.userId);
        if (!user) {
          throw new Error("user_not_found");
        }

        state.ephemeralCount += 1;
        return {
          ok: true,
          channel: channel.id,
          messageTs: `1700000002.${String(state.ephemeralCount).padStart(6, "0")}`,
        };
      },
    });
  }

  async uploadFile(args: SlackUploadFileArgs): Promise<SlackUploadFileResponse> {
    const method = "slack.files.uploadV2";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      filename: args.filename,
      ...(typeof args.title === "string" ? { title: args.title } : {}),
    };

    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        if (!args.filename.trim()) {
          throw new Error("missing_filename");
        }
        if (!args.content.trim()) {
          throw new Error("missing_content");
        }

        state.fileCount += 1;
        const file: SlackFile = {
          id: `F${String(200 + state.fileCount).padStart(3, "0")}`,
          name: args.filename,
          ...(typeof args.title === "string" ? { title: args.title } : {}),
          url: `https://files.slack.test/${channel.id}/${encodeURIComponent(args.filename)}`,
          channels: [channel.id],
          userId: "U003",
          mimetype: "text/plain",
          size: args.content.length,
        };
        state.files = [file, ...state.files.filter((entry) => entry.id !== file.id)];
        return {
          ok: true,
          file,
        };
      },
    });
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
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        if (!args.title.trim()) {
          throw new Error("missing_title");
        }
        if (!args.link.trim()) {
          throw new Error("missing_link");
        }

        state.bookmarkCount += 1;
        const bookmark: SlackBookmark = {
          id: toBookmarkId(state.bookmarkCount),
          channel: channel.id,
          title: args.title.trim(),
          link: args.link.trim(),
          ...(typeof args.emoji === "string" ? { emoji: args.emoji } : {}),
        };
        state.bookmarks = [bookmark, ...state.bookmarks];
        const response: SlackAddBookmarkResponse = {
          ok: true,
          bookmark,
        };
        return response;
      },
    });
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

    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        const bookmark = state.bookmarks.find(
          (entry) => entry.channel === channel.id && entry.id === args.bookmarkId,
        );
        if (!bookmark) {
          throw new Error("bookmark_not_found");
        }
        if (
          typeof args.title !== "string" &&
          typeof args.link !== "string" &&
          typeof args.emoji !== "string"
        ) {
          throw new Error("missing_update");
        }
        if (typeof args.title === "string") {
          if (!args.title.trim()) {
            throw new Error("missing_title");
          }
          bookmark.title = args.title.trim();
        }
        if (typeof args.link === "string") {
          if (!args.link.trim()) {
            throw new Error("missing_link");
          }
          bookmark.link = args.link.trim();
        }
        if (typeof args.emoji === "string") {
          bookmark.emoji = args.emoji;
        }
        const response: SlackEditBookmarkResponse = {
          ok: true,
          bookmark: { ...bookmark },
        };
        return response;
      },
    });
  }

  async removeBookmark(args: SlackRemoveBookmarkArgs): Promise<SlackRemoveBookmarkResponse> {
    const method = "slack.bookmarks.remove";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      bookmarkId: args.bookmarkId,
    };

    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        const before = state.bookmarks.length;
        state.bookmarks = state.bookmarks.filter(
          (entry) => !(entry.channel === channel.id && entry.id === args.bookmarkId),
        );
        if (state.bookmarks.length === before) {
          throw new Error("bookmark_not_found");
        }
        const response: SlackRemoveBookmarkResponse = {
          ok: true,
          channel: channel.id,
          bookmarkId: args.bookmarkId,
        };
        return response;
      },
    });
  }

  async addReminder(args: SlackAddReminderArgs): Promise<SlackAddReminderResponse> {
    const method = "slack.reminders.add";
    const normalizedArgs = {
      namespace: args.namespace,
      text: args.text,
      time: args.time,
      ...(typeof args.userId === "string" ? { userId: args.userId } : {}),
    };

    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        if (!args.text.trim()) {
          throw new Error("missing_text");
        }
        if (!Number.isFinite(args.time) || args.time <= 0) {
          throw new Error("invalid_time");
        }
        const userId =
          typeof args.userId === "string" && args.userId.length > 0
            ? this.resolveUser(state, args.userId)?.id
            : "U003";
        if (!userId) {
          throw new Error("user_not_found");
        }

        state.reminderCount += 1;
        const reminder: SlackReminder = {
          id: toReminderId(state.reminderCount),
          text: args.text.trim(),
          time: Math.floor(args.time),
          userId,
        };
        state.reminders = [reminder, ...state.reminders];
        const response: SlackAddReminderResponse = {
          ok: true,
          reminder,
        };
        return response;
      },
    });
  }

  async deleteReminder(args: SlackDeleteReminderArgs): Promise<SlackDeleteReminderResponse> {
    const method = "slack.reminders.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      reminderId: args.reminderId,
    };

    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const before = state.reminders.length;
        state.reminders = state.reminders.filter((entry) => entry.id !== args.reminderId);
        if (state.reminders.length === before) {
          throw new Error("reminder_not_found");
        }
        const response: SlackDeleteReminderResponse = {
          ok: true,
          reminderId: args.reminderId,
        };
        return response;
      },
    });
  }

  async meMessage(args: SlackMeMessageArgs): Promise<SlackMeMessageResponse> {
    const method = "slack.chat.meMessage";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      text: args.text,
    };

    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        if (!args.text.trim()) {
          throw new Error("missing_text");
        }
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }

        state.messageCount += 1;
        const ts = toSlackTs(state.messageCount);
        state.messages = [
          {
            ts,
            channel: channel.id,
            text: `_${args.text.trim()}_`,
            userId: "U003",
          },
          ...state.messages,
        ];
        const response: SlackMeMessageResponse = {
          ok: true,
          channel: channel.id,
          ts,
          text: `_${args.text.trim()}_`,
        };
        return response;
      },
    });
  }

  async createChannel(args: SlackCreateChannelArgs): Promise<SlackCreateChannelResponse> {
    const method = "slack.conversations.create";
    const normalizedArgs = {
      namespace: args.namespace,
      name: args.name,
      ...(typeof args.isPrivate === "boolean" ? { isPrivate: args.isPrivate } : {}),
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const name = args.name.trim().replace(/^#/, "");
        if (!name) {
          throw new Error("missing_name");
        }
        if (state.channels.some((channel) => channel.name.toLowerCase() === name.toLowerCase())) {
          throw new Error("name_taken");
        }

        state.channelCount += 1;
        const created = {
          id: `C${String(100 + state.channelCount).padStart(3, "0")}`,
          name,
          ...(typeof args.isPrivate === "boolean" ? { isPrivate: args.isPrivate } : {}),
          isArchived: false,
          memberIds: ["U003"],
        };
        state.channels = [created, ...state.channels];
        const response: SlackCreateChannelResponse = {
          ok: true,
          channel: toChannelInfo(created, true),
        };
        return response;
      },
    });
  }

  async inviteToChannel(args: SlackInviteToChannelArgs): Promise<SlackInviteToChannelResponse> {
    const method = "slack.conversations.invite";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      userIds: args.userIds,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        if (args.userIds.length === 0) {
          throw new Error("missing_users");
        }
        for (const userId of args.userIds) {
          const user = this.resolveUser(state, userId);
          if (!user) {
            throw new Error("user_not_found");
          }
          if (!channel.memberIds.includes(user.id)) {
            channel.memberIds.push(user.id);
          }
        }
        const response: SlackInviteToChannelResponse = {
          ok: true,
          channel: toChannelInfo(channel, channel.memberIds.includes("U003")),
          invitedUserIds: args.userIds.map((entry) => String(entry)),
        };
        return response;
      },
    });
  }

  async joinChannel(args: SlackJoinChannelArgs): Promise<SlackJoinChannelResponse> {
    const method = "slack.conversations.join";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        if (!channel.memberIds.includes("U003")) {
          channel.memberIds.push("U003");
        }
        const response: SlackJoinChannelResponse = {
          ok: true,
          channel: toChannelInfo(channel, true),
        };
        return response;
      },
    });
  }

  async listChannelMembers(args: SlackListChannelMembersArgs): Promise<string[]> {
    const method = "slack.conversations.members";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      limit: args.limit,
    };
    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        const safeLimit = Math.max(1, Math.min(1000, Number(args.limit) || 200));
        return channel.memberIds.slice(0, safeLimit);
      },
    });
  }

  async markChannelRead(args: SlackMarkChannelReadArgs): Promise<SlackMarkChannelReadResponse> {
    const method = "slack.conversations.mark";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        if (!args.ts.trim()) {
          throw new Error("missing_ts");
        }
        return {
          ok: true,
          channel: channel.id,
          ts: args.ts,
        };
      },
    });
  }

  async archiveChannel(args: SlackArchiveChannelArgs): Promise<SlackArchiveChannelResponse> {
    const method = "slack.conversations.archive";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        channel.isArchived = true;
        return {
          ok: true,
          channel: toChannelInfo(channel, channel.memberIds.includes("U003")),
        };
      },
    });
  }

  async unarchiveChannel(args: SlackArchiveChannelArgs): Promise<SlackArchiveChannelResponse> {
    const method = "slack.conversations.unarchive";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        channel.isArchived = false;
        return {
          ok: true,
          channel: toChannelInfo(channel, channel.memberIds.includes("U003")),
        };
      },
    });
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
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        if (!args.purpose.trim()) {
          throw new Error("missing_purpose");
        }
        channel.purpose = args.purpose;
        return {
          ok: true,
          channel: channel.id,
          purpose: args.purpose,
        };
      },
    });
  }

  async setChannelTopic(args: SlackSetChannelTopicArgs): Promise<SlackSetChannelTopicResponse> {
    const method = "slack.conversations.setTopic";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      topic: args.topic,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        if (!args.topic.trim()) {
          throw new Error("missing_topic");
        }
        channel.topic = args.topic;
        return {
          ok: true,
          channel: channel.id,
          topic: args.topic,
        };
      },
    });
  }

  async openDM(args: SlackOpenDmArgs): Promise<SlackOpenDmResponse> {
    const method = "slack.conversations.open";
    const normalizedArgs = {
      namespace: args.namespace,
      userIds: args.userIds,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        if (args.userIds.length === 0) {
          throw new Error("missing_users");
        }
        const uniqueIds = [
          ...new Set(args.userIds.map((entry) => String(entry).trim()).filter(Boolean)),
        ];
        for (const userId of uniqueIds) {
          if (!this.resolveUser(state, userId)) {
            throw new Error("user_not_found");
          }
        }
        if (!uniqueIds.includes("U003")) {
          uniqueIds.push("U003");
        }
        const canonicalName = `dm-${[...uniqueIds].sort().join("-").toLowerCase()}`;
        let channel = state.channels.find(
          (entry) => entry.name === canonicalName && entry.id.startsWith("D"),
        );
        if (!channel) {
          state.dmCounter += 1;
          channel = {
            id: `D${String(state.dmCounter).padStart(3, "0")}`,
            name: canonicalName,
            isPrivate: true,
            isArchived: false,
            memberIds: [...uniqueIds],
          };
          state.channels = [channel, ...state.channels];
        }
        const response: SlackOpenDmResponse = {
          ok: true,
          channel: toChannelInfo(channel, channel.memberIds.includes("U003")),
          userIds: uniqueIds,
        };
        return response;
      },
    });
  }

  async renameChannel(args: SlackRenameChannelArgs): Promise<SlackRenameChannelResponse> {
    const method = "slack.conversations.rename";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      name: args.name,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        const nextName = normalizeChannelValue(args.name);
        if (!nextName) {
          throw new Error("missing_name");
        }
        if (
          state.channels.some(
            (entry) => entry.id !== channel.id && normalizeChannelValue(entry.name) === nextName,
          )
        ) {
          throw new Error("name_taken");
        }
        channel.name = nextName;
        return {
          ok: true,
          channel: toChannelInfo(channel, channel.memberIds.includes("U003")),
        };
      },
    });
  }

  async kickFromChannel(args: SlackKickFromChannelArgs): Promise<SlackKickFromChannelResponse> {
    const method = "slack.conversations.kick";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      userId: args.userId,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        const user = this.resolveUser(state, args.userId);
        if (!user) {
          throw new Error("user_not_found");
        }
        if (!channel.memberIds.includes(user.id)) {
          throw new Error("user_not_in_channel");
        }
        channel.memberIds = channel.memberIds.filter((memberId) => memberId !== user.id);
        return {
          ok: true,
          channel: toChannelInfo(channel, channel.memberIds.includes("U003")),
          userId: user.id,
        };
      },
    });
  }

  async leaveChannel(args: SlackLeaveChannelArgs): Promise<SlackLeaveChannelResponse> {
    const method = "slack.conversations.leave";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        if (!channel.memberIds.includes("U003")) {
          throw new Error("not_in_channel");
        }
        channel.memberIds = channel.memberIds.filter((memberId) => memberId !== "U003");
        return {
          ok: true,
          channel: toChannelInfo(channel, false),
        };
      },
    });
  }

  async closeDM(args: SlackCloseDmArgs): Promise<SlackCloseDmResponse> {
    const method = "slack.conversations.close";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        channel.isArchived = true;
        return {
          ok: true,
          channel: toChannelInfo(channel, channel.memberIds.includes("U003")),
        };
      },
    });
  }

  async scheduleMessage(args: SlackScheduleMessageArgs): Promise<SlackScheduleMessageResponse> {
    const method = "slack.chat.scheduleMessage";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      text: args.text,
      postAt: args.postAt,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        if (!args.text.trim()) {
          throw new Error("missing_text");
        }
        if (!Number.isFinite(args.postAt) || args.postAt <= 0) {
          throw new Error("invalid_post_at");
        }
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        state.scheduledCount += 1;
        const scheduledMessageId = `Q${String(state.scheduledCount).padStart(6, "0")}`;
        const scheduled: SlackScheduledMessage = {
          id: scheduledMessageId,
          channel: channel.id,
          text: args.text,
          postAt: Math.floor(args.postAt),
        };
        state.scheduledMessages = [scheduled, ...state.scheduledMessages];
        return {
          ok: true,
          channel: channel.id,
          scheduledMessageId,
          postAt: scheduled.postAt,
          messageTs: `1700000010.${String(state.scheduledCount).padStart(6, "0")}`,
        };
      },
    });
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
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        const before = state.scheduledMessages.length;
        state.scheduledMessages = state.scheduledMessages.filter(
          (entry) => !(entry.channel === channel.id && entry.id === args.scheduledMessageId),
        );
        if (state.scheduledMessages.length === before) {
          throw new Error("scheduled_message_not_found");
        }
        return {
          ok: true,
          channel: channel.id,
          scheduledMessageId: args.scheduledMessageId,
        };
      },
    });
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
    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const safeLimit = Math.max(1, Math.min(100, Number(args.limit) || 20));
        const channel =
          typeof args.channel === "string" ? this.resolveChannel(state, args.channel) : null;
        return state.scheduledMessages
          .filter((entry) => !channel || entry.channel === channel.id)
          .slice(0, safeLimit);
      },
    });
  }

  async getPermalink(args: SlackGetPermalinkArgs): Promise<SlackGetPermalinkResponse> {
    const method = "slack.chat.getPermalink";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
    };
    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const message = this.getMessage(state, args.channel, args.ts);
        return {
          ok: true,
          channel: message.channel,
          ts: message.ts,
          permalink: `https://slack.test/archives/${message.channel}/p${message.ts.replace(".", "")}`,
        };
      },
    });
  }

  async removeReaction(args: SlackRemoveReactionArgs): Promise<SlackRemoveReactionResponse> {
    const method = "slack.reactions.remove";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
      name: args.name,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        if (!args.name.trim()) {
          throw new Error("missing_name");
        }
        const message = this.getMessage(state, args.channel, args.ts);
        const nextReactions = [...(message.reactions ?? [])];
        const index = nextReactions.findIndex((entry) => entry.name === args.name);
        if (index < 0) {
          throw new Error("reaction_not_found");
        }
        const reaction = nextReactions[index];
        if (reaction) {
          reaction.users = reaction.users.filter((entry) => entry !== "U003");
          reaction.count = reaction.users.length;
          if (reaction.count <= 0) {
            nextReactions.splice(index, 1);
          }
        }
        state.messages = state.messages.map((entry) =>
          entry.channel === message.channel && entry.ts === message.ts
            ? {
                ...entry,
                ...(nextReactions.length > 0 ? { reactions: nextReactions } : {}),
              }
            : entry,
        );
        return {
          ok: true,
          channel: message.channel,
          ts: message.ts,
          name: args.name,
        };
      },
    });
  }

  async pinMessage(args: SlackPinMessageArgs): Promise<SlackPinMessageResponse> {
    const method = "slack.pins.add";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const message = this.getMessage(state, args.channel, args.ts);
        if (!state.pins.some((pin) => pin.channel === message.channel && pin.ts === message.ts)) {
          state.pins.unshift({
            channel: message.channel,
            ts: message.ts,
            text: message.text,
          });
        }
        return {
          ok: true,
          channel: message.channel,
          ts: message.ts,
        };
      },
    });
  }

  async unpinMessage(args: SlackPinMessageArgs): Promise<SlackPinMessageResponse> {
    const method = "slack.pins.remove";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
      ts: args.ts,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        const before = state.pins.length;
        state.pins = state.pins.filter(
          (pin) => !(pin.channel === channel.id && pin.ts === args.ts),
        );
        if (state.pins.length === before) {
          throw new Error("pin_not_found");
        }
        return {
          ok: true,
          channel: channel.id,
          ts: args.ts,
        };
      },
    });
  }

  async listPins(args: SlackListPinsArgs): Promise<SlackPinItem[]> {
    const method = "slack.pins.list";
    const normalizedArgs = {
      namespace: args.namespace,
      channel: args.channel,
    };
    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const channel = this.resolveChannel(state, args.channel);
        if (!channel) {
          throw new Error("channel_not_found");
        }
        return state.pins.filter((pin) => pin.channel === channel.id);
      },
    });
  }

  async listFiles(args: SlackListFilesArgs): Promise<SlackFile[]> {
    const method = "slack.files.list";
    const normalizedArgs = {
      namespace: args.namespace,
      ...(typeof args.channel === "string" ? { channel: args.channel } : {}),
      ...(typeof args.userId === "string" ? { userId: args.userId } : {}),
      limit: args.limit,
    };
    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const safeLimit = Math.max(1, Math.min(200, Number(args.limit) || 20));
        const channel =
          typeof args.channel === "string" ? this.resolveChannel(state, args.channel) : null;
        const userId =
          typeof args.userId === "string" ? this.resolveUser(state, args.userId)?.id : null;
        return state.files
          .filter((file) => !channel || (file.channels ?? []).includes(channel.id))
          .filter((file) => !userId || file.userId === userId)
          .slice(0, safeLimit);
      },
    });
  }

  async getFileInfo(args: SlackGetFileInfoArgs): Promise<SlackFile> {
    const method = "slack.files.info";
    const normalizedArgs = {
      namespace: args.namespace,
      fileId: args.fileId,
    };
    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const file = state.files.find((entry) => entry.id === args.fileId);
        if (!file) {
          throw new Error("file_not_found");
        }
        return file;
      },
    });
  }

  async deleteFile(args: SlackDeleteFileArgs): Promise<SlackDeleteFileResponse> {
    const method = "slack.files.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      fileId: args.fileId,
    };
    return this.runSlackIdempotentMutation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      method,
      normalizedArgs,
      execute: (state) => {
        const before = state.files.length;
        state.files = state.files.filter((entry) => entry.id !== args.fileId);
        if (state.files.length === before) {
          throw new Error("file_not_found");
        }
        return {
          ok: true,
          fileId: args.fileId,
        };
      },
    });
  }

  async getUserProfile(args: SlackGetUserProfileArgs): Promise<SlackUserProfile> {
    const method = "slack.users.profile.get";
    const normalizedArgs = {
      namespace: args.namespace,
      userId: args.userId,
    };
    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const user = this.resolveUser(state, args.userId);
        if (!user) {
          throw new Error("user_not_found");
        }
        return {
          userId: user.id,
          displayName: user.name,
          ...(typeof user.realName === "string" ? { realName: user.realName } : {}),
          email: `${user.name}@example.test`,
          ...(user.isBot ? { title: "Automation Bot" } : { title: "Support Automation" }),
          statusText: user.isBot ? "Automating workflows" : "Helping customers",
          statusEmoji: user.isBot ? ":robot_face:" : ":speech_balloon:",
        };
      },
    });
  }

  async searchFiles(args: SlackSearchFilesArgs): Promise<SlackFile[]> {
    const method = "slack.search.files";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      limit: args.limit,
    };
    return this.runSlackOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method,
      normalizedArgs,
      execute: (state) => {
        const query = args.query.trim().toLowerCase();
        if (!query) {
          throw new Error("missing_query");
        }
        const safeLimit = Math.max(1, Math.min(100, Number(args.limit) || 20));
        return state.files
          .filter((file) => {
            const title = typeof file.title === "string" ? file.title : "";
            return (
              file.name.toLowerCase().includes(query) ||
              title.toLowerCase().includes(query) ||
              file.id.toLowerCase().includes(query)
            );
          })
          .slice(0, safeLimit);
      },
    });
  }

  seed(namespace: string, seed: Record<string, unknown>): void {
    const state = this.getState(namespace);

    if (Array.isArray(seed.channels)) {
      state.channels = seed.channels
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `C${String(index + 1).padStart(3, "0")}`),
          name: String(entry.name ?? "channel"),
          ...(typeof entry.isPrivate === "boolean" ? { isPrivate: entry.isPrivate } : {}),
          ...(typeof entry.isArchived === "boolean" ? { isArchived: entry.isArchived } : {}),
          ...(typeof entry.purpose === "string" ? { purpose: entry.purpose } : {}),
          ...(typeof entry.topic === "string" ? { topic: entry.topic } : {}),
          memberIds: Array.isArray(entry.memberIds)
            ? entry.memberIds.map((memberId) => String(memberId))
            : ["U001", "U002", "U003"],
        }));
    }

    if (Array.isArray(seed.users)) {
      state.users = seed.users
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `U${String(index + 1).padStart(3, "0")}`),
          name: String(entry.name ?? `user_${index + 1}`),
          ...(typeof entry.realName === "string" ? { realName: entry.realName } : {}),
          ...(typeof entry.isBot === "boolean" ? { isBot: entry.isBot } : {}),
          ...(typeof entry.isDeleted === "boolean" ? { isDeleted: entry.isDeleted } : {}),
        }));
    }

    if (Array.isArray(seed.messages)) {
      state.messages = seed.messages
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          ts: String(entry.ts ?? toSlackTs(index + 1)),
          channel: String(entry.channel ?? "C001"),
          text: String(entry.text ?? ""),
          ...(typeof entry.userId === "string" ? { userId: entry.userId } : {}),
          ...(typeof entry.threadTs === "string" ? { threadTs: entry.threadTs } : {}),
          ...(Array.isArray(entry.reactions)
            ? {
                reactions: entry.reactions
                  .filter((reaction): reaction is Record<string, unknown> => {
                    return !!reaction && typeof reaction === "object" && !Array.isArray(reaction);
                  })
                  .map((reaction) => ({
                    name: String(reaction.name ?? ""),
                    count: Math.max(
                      0,
                      Number.isFinite(Number(reaction.count))
                        ? Math.floor(Number(reaction.count))
                        : 0,
                    ),
                    users: Array.isArray(reaction.users)
                      ? reaction.users.map((user) => String(user))
                      : [],
                  })),
              }
            : {}),
        }));
    }

    if (Array.isArray(seed.scheduledMessages)) {
      state.scheduledMessages = seed.scheduledMessages
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `Q${String(index + 1).padStart(6, "0")}`),
          channel: String(entry.channel ?? "C001"),
          text: String(entry.text ?? ""),
          postAt: Math.max(1, Math.floor(Number(entry.postAt ?? Date.now() / 1000))),
        }));
    }

    if (Array.isArray(seed.files)) {
      state.files = seed.files
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `F${String(index + 1).padStart(3, "0")}`),
          name: String(entry.name ?? `file-${index + 1}.txt`),
          ...(typeof entry.title === "string" ? { title: entry.title } : {}),
          ...(typeof entry.url === "string" ? { url: entry.url } : {}),
          channels: Array.isArray(entry.channels)
            ? entry.channels.map((channel) => String(channel))
            : ["C001"],
          ...(typeof entry.userId === "string" ? { userId: entry.userId } : { userId: "U003" }),
          ...(typeof entry.mimetype === "string" ? { mimetype: entry.mimetype } : {}),
          ...(typeof entry.size === "number" ? { size: entry.size } : {}),
        }));
    }

    if (Array.isArray(seed.pins)) {
      state.pins = seed.pins
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry) => ({
          channel: String(entry.channel ?? "C001"),
          ts: String(entry.ts ?? "1700000000.000001"),
          ...(typeof entry.text === "string" ? { text: entry.text } : {}),
        }));
    }

    if (Array.isArray(seed.bookmarks)) {
      state.bookmarks = seed.bookmarks
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? toBookmarkId(index + 1)),
          channel: String(entry.channel ?? "C001"),
          title: String(entry.title ?? `Bookmark ${index + 1}`),
          link: String(entry.link ?? "https://example.test"),
          ...(typeof entry.emoji === "string" ? { emoji: entry.emoji } : {}),
          ...(typeof entry.entityId === "string" ? { entityId: entry.entityId } : {}),
        }));
    }

    if (Array.isArray(seed.reminders)) {
      state.reminders = seed.reminders
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? toReminderId(index + 1)),
          text: String(entry.text ?? `Reminder ${index + 1}`),
          time: Math.max(1, Math.floor(Number(entry.time ?? Date.now() / 1000))),
          ...(typeof entry.userId === "string" ? { userId: entry.userId } : { userId: "U003" }),
        }));
    }

    if (Array.isArray(seed.userGroups)) {
      state.userGroups = seed.userGroups
        .filter((entry): entry is Record<string, unknown> => {
          return !!entry && typeof entry === "object" && !Array.isArray(entry);
        })
        .map((entry, index) => ({
          id: String(entry.id ?? `S${String(index + 1).padStart(3, "0")}`),
          handle: String(entry.handle ?? `group-${index + 1}`),
          name: String(entry.name ?? `Group ${index + 1}`),
          ...(typeof entry.isDisabled === "boolean" ? { isDisabled: entry.isDisabled } : {}),
          ...(typeof entry.userCount === "number" ? { userCount: entry.userCount } : {}),
          memberIds: Array.isArray(entry.memberIds)
            ? entry.memberIds.map((memberId) => String(memberId))
            : ["U001", "U003"],
        }));
    }

    if (seed.presenceByUserId && typeof seed.presenceByUserId === "object") {
      const nextPresence: Record<string, SlackUserPresence> = {};
      for (const [userId, value] of Object.entries(seed.presenceByUserId)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          continue;
        }
        const record = value as Record<string, unknown>;
        const rawPresence = String(record.presence ?? "away").toLowerCase();
        nextPresence[userId] = {
          userId,
          presence: rawPresence === "active" ? "active" : "away",
          ...(typeof record.online === "boolean" ? { online: record.online } : {}),
          ...(typeof record.autoAway === "boolean" ? { autoAway: record.autoAway } : {}),
          ...(typeof record.manualAway === "boolean" ? { manualAway: record.manualAway } : {}),
          ...(typeof record.lastActivity === "number"
            ? { lastActivity: Math.floor(record.lastActivity) }
            : {}),
          ...(typeof record.connectionCount === "number"
            ? { connectionCount: Math.floor(record.connectionCount) }
            : {}),
        };
      }
      state.presenceByUserId = nextPresence;
    }

    if (typeof seed.forceRateLimit === "boolean") {
      state.forceRateLimit = seed.forceRateLimit;
    }
    if (typeof seed.forceTimeout === "boolean") {
      state.forceTimeout = seed.forceTimeout;
    }
    state.channelCount = state.channels.length;
    state.dmCounter = state.channels.filter((channel) => channel.id.startsWith("D")).length;
    state.scheduledCount = state.scheduledMessages.length;
    state.fileCount = state.files.length;
    state.bookmarkCount = state.bookmarks.length;
    state.reminderCount = state.reminders.length;
  }

  protected createDefaultState(): SlackNamespaceState {
    const seededMessages = seedSlackMessages();
    const seededUsers = seedSlackUsers();
    const seededChannels = seedSlackChannels().map((channel) =>
      toChannelState(
        channel,
        seededUsers.map((user) => user.id),
      ),
    );
    const seededFiles: SlackFile[] = [
      {
        id: "F201",
        name: "handoff.txt",
        title: "Handoff Notes",
        url: "https://files.slack.test/C001/handoff.txt",
        channels: ["C001"],
        userId: "U001",
        mimetype: "text/plain",
        size: 512,
      },
      {
        id: "F202",
        name: "incident-log.md",
        title: "Incident Log",
        url: "https://files.slack.test/C002/incident-log.md",
        channels: ["C002"],
        userId: "U002",
        mimetype: "text/markdown",
        size: 1024,
      },
    ];
    const seededPins: SlackPinItem[] = [
      {
        channel: "C001",
        ts: "1700000000.000001",
        text: "Customer asked for refund details",
      },
    ];
    const seededBookmarks: SlackBookmark[] = [
      {
        id: "Bk000001",
        channel: "C001",
        title: "Escalation Runbook",
        link: "https://docs.example.test/runbooks/escalation",
        emoji: ":bookmark:",
      },
    ];
    const seededReminders: SlackReminder[] = [
      {
        id: "Rm000001",
        text: "Review unresolved support threads",
        time: 1_900_000_100,
        userId: "U003",
      },
    ];
    const seededUserGroups: Array<SlackUserGroup & { memberIds: string[] }> = [
      {
        id: "S001",
        handle: "support-team",
        name: "Support Team",
        isDisabled: false,
        userCount: 2,
        memberIds: ["U001", "U003"],
      },
      {
        id: "S002",
        handle: "ops-team",
        name: "Ops Team",
        isDisabled: false,
        userCount: 1,
        memberIds: ["U002"],
      },
    ];
    const seededPresenceByUserId: Record<string, SlackUserPresence> = {
      U001: {
        userId: "U001",
        presence: "active",
        online: true,
        autoAway: false,
        manualAway: false,
        lastActivity: 1_700_000_001,
        connectionCount: 1,
      },
      U002: {
        userId: "U002",
        presence: "away",
        online: false,
        autoAway: true,
        manualAway: false,
        lastActivity: 1_699_999_500,
        connectionCount: 0,
      },
      U003: {
        userId: "U003",
        presence: "active",
        online: true,
        autoAway: false,
        manualAway: false,
        lastActivity: 1_700_000_050,
        connectionCount: 1,
      },
    };
    const seededScheduledMessages: SlackScheduledMessage[] = [
      {
        id: "Q000001",
        channel: "C001",
        text: "Follow up with customer tomorrow",
        postAt: 1_900_000_000,
      },
    ];
    const created: SlackNamespaceState = {
      channels: seededChannels,
      users: seededUsers,
      messages: seededMessages,
      scheduledMessages: seededScheduledMessages,
      files: seededFiles,
      pins: seededPins,
      bookmarks: seededBookmarks,
      reminders: seededReminders,
      userGroups: seededUserGroups,
      presenceByUserId: seededPresenceByUserId,
      dmCounter: 0,
      channelCount: seededChannels.length,
      scheduledCount: seededScheduledMessages.length,
      messageCount: seededMessages.length,
      ephemeralCount: 0,
      fileCount: seededFiles.length,
      bookmarkCount: seededBookmarks.length,
      reminderCount: seededReminders.length,
      idempotentResponses: new Map(),
      forceRateLimit: false,
      forceTimeout: false,
    };
    return created;
  }

  private async runSlackOperation<TResult>(options: {
    namespace?: string | undefined;
    accessToken: string | null | undefined;
    method: string;
    normalizedArgs: unknown;
    idempotencyKey?: string | undefined;
    execute: (state: SlackNamespaceState) => Promise<TResult> | TResult;
  }): Promise<TResult> {
    return this.runProviderOperation({
      namespace: options.namespace,
      method: options.method,
      args: options.normalizedArgs,
      accessToken: options.accessToken,
      assertToken: (accessToken) => this.assertToken(accessToken),
      idempotencyKey: options.idempotencyKey,
      mapError: toProviderSdkError,
      before: (state) => this.applyFailureFlags(state),
      execute: options.execute,
    });
  }

  private async runSlackIdempotentMutation<TResult>(options: {
    namespace?: string | undefined;
    accessToken: string | null | undefined;
    method: string;
    normalizedArgs: unknown;
    idempotencyKey?: string | undefined;
    execute: (state: SlackNamespaceState) => Promise<TResult> | TResult;
  }): Promise<TResult> {
    return this.runProviderIdempotentOperation({
      namespace: options.namespace,
      method: options.method,
      args: options.normalizedArgs,
      accessToken: options.accessToken,
      idempotencyKey: options.idempotencyKey,
      assertToken: (accessToken) => this.assertToken(accessToken),
      mapError: toProviderSdkError,
      before: (state) => this.applyFailureFlags(state),
      getResponses: (state) => state.idempotentResponses,
      execute: async (state) => {
        return await options.execute(state);
      },
    });
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

  private applyFailureFlags(state: SlackNamespaceState): void {
    if (state.forceRateLimit) {
      throw new Error("rate_limited");
    }
    if (state.forceTimeout) {
      throw new Error("gateway_timeout");
    }
  }

  private resolveChannel(
    state: SlackNamespaceState,
    value: string,
  ): SlackNamespaceState["channels"][number] | null {
    const normalized = normalizeChannelValue(value);
    if (!normalized) {
      return null;
    }
    return (
      state.channels.find((channel) => channel.id.toLowerCase() === normalized) ??
      state.channels.find((channel) => channel.name.toLowerCase() === normalized) ??
      null
    );
  }

  private resolveUser(state: SlackNamespaceState, value: string): SlackUser | null {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return (
      state.users.find((user) => user.id.toLowerCase() === normalized) ??
      state.users.find((user) => user.name.toLowerCase() === normalized) ??
      null
    );
  }

  private getMessage(state: SlackNamespaceState, channelInput: string, ts: string): SlackMessage {
    const channel = this.resolveChannel(state, channelInput);
    if (!channel) {
      throw new Error("channel_not_found");
    }
    const message = state.messages.find((entry) => entry.channel === channel.id && entry.ts === ts);
    if (!message) {
      throw new Error("message_not_found");
    }
    return message;
  }
}

const createNoopCallLog = (): ProviderSdkCallLog => {
  return {
    capture: () => {},
    list: () => [],
    reset: () => {},
  };
};

export class FakeSlackClientStore {
  private readonly engine = new InMemorySlackEngine({ callLog: createNoopCallLog() });

  readonly createClient: CreateSlackClient = (accessToken, namespace, options) => {
    return createFakeSlackClient(this.engine, accessToken, namespace, options);
  };

  reset(namespace?: string): void {
    this.engine.reset(namespace);
  }

  seed(namespace: string, seed: Record<string, unknown>): void {
    this.engine.seed(namespace, seed);
  }
}

export const createFakeSlackClientStore = (): FakeSlackClientStore => {
  return new FakeSlackClientStore();
};
