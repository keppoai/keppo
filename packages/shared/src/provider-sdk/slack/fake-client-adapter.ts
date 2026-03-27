import type { SlackClient } from "./client-interface.js";
import type { SlackMessage, SlackSdkPort } from "./types.js";

const toSlackApiMessage = (message: SlackMessage): Record<string, unknown> => {
  return {
    ts: message.ts,
    text: message.text,
    ...(message.userId ? { user: message.userId } : {}),
    ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
    ...(Array.isArray(message.reactions) ? { reactions: message.reactions } : {}),
  };
};

export const createFakeSlackClient = (
  engine: SlackSdkPort,
  accessToken: string,
  namespace?: string,
  options?: { idempotencyKey?: string },
): SlackClient => {
  return {
    conversations: {
      list: async ({ limit }) => {
        const channels = await engine.listChannels({
          accessToken,
          namespace,
          limit,
        });
        return {
          ok: true,
          channels: channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
            ...(typeof channel.isPrivate === "boolean" ? { is_private: channel.isPrivate } : {}),
          })),
        };
      },
      history: async ({ channel, limit }) => {
        const messages = await engine.getChannelHistory({
          accessToken,
          namespace,
          channel,
          limit,
        });
        return {
          ok: true,
          messages: messages.map(toSlackApiMessage),
        };
      },
      replies: async ({ channel, ts, limit }) => {
        const messages = await engine.getThreadReplies({
          accessToken,
          namespace,
          channel,
          threadTs: ts,
          limit,
        });
        return {
          ok: true,
          messages: messages.map(toSlackApiMessage),
        };
      },
      info: async ({ channel }) => {
        const info = await engine.getChannelInfo({
          accessToken,
          namespace,
          channel,
        });
        return {
          ok: true,
          channel: {
            id: info.id,
            name: info.name,
            ...(typeof info.isPrivate === "boolean" ? { is_private: info.isPrivate } : {}),
            ...(typeof info.isArchived === "boolean" ? { is_archived: info.isArchived } : {}),
            ...(typeof info.isMember === "boolean" ? { is_member: info.isMember } : {}),
            ...(typeof info.memberCount === "number" ? { num_members: info.memberCount } : {}),
          },
        };
      },
      create: async ({ name, is_private }) => {
        const response = await engine.createChannel({
          accessToken,
          namespace,
          name,
          ...(typeof is_private === "boolean" ? { isPrivate: is_private } : {}),
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          channel: {
            id: response.channel.id,
            name: response.channel.name,
            ...(typeof response.channel.isPrivate === "boolean"
              ? { is_private: response.channel.isPrivate }
              : {}),
            ...(typeof response.channel.isArchived === "boolean"
              ? { is_archived: response.channel.isArchived }
              : {}),
            ...(typeof response.channel.isMember === "boolean"
              ? { is_member: response.channel.isMember }
              : {}),
            ...(typeof response.channel.memberCount === "number"
              ? { num_members: response.channel.memberCount }
              : {}),
          },
        };
      },
      invite: async ({ channel, users }) => {
        const response = await engine.inviteToChannel({
          accessToken,
          namespace,
          channel,
          userIds: users
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          channel: {
            id: response.channel.id,
            name: response.channel.name,
            ...(typeof response.channel.isPrivate === "boolean"
              ? { is_private: response.channel.isPrivate }
              : {}),
            ...(typeof response.channel.isArchived === "boolean"
              ? { is_archived: response.channel.isArchived }
              : {}),
            ...(typeof response.channel.isMember === "boolean"
              ? { is_member: response.channel.isMember }
              : {}),
            ...(typeof response.channel.memberCount === "number"
              ? { num_members: response.channel.memberCount }
              : {}),
          },
        };
      },
      join: async ({ channel }) => {
        const response = await engine.joinChannel({
          accessToken,
          namespace,
          channel,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          channel: {
            id: response.channel.id,
            name: response.channel.name,
            ...(typeof response.channel.isPrivate === "boolean"
              ? { is_private: response.channel.isPrivate }
              : {}),
            ...(typeof response.channel.isArchived === "boolean"
              ? { is_archived: response.channel.isArchived }
              : {}),
            ...(typeof response.channel.isMember === "boolean"
              ? { is_member: response.channel.isMember }
              : {}),
            ...(typeof response.channel.memberCount === "number"
              ? { num_members: response.channel.memberCount }
              : {}),
          },
        };
      },
      members: async ({ channel, limit }) => {
        const members = await engine.listChannelMembers({
          accessToken,
          namespace,
          channel,
          limit: Number(limit ?? 200) || 200,
        });
        return {
          ok: true,
          members,
        };
      },
      mark: async ({ channel, ts }) => {
        const response = await engine.markChannelRead({
          accessToken,
          namespace,
          channel,
          ts,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
        };
      },
      archive: async ({ channel }) => {
        const response = await engine.archiveChannel({
          accessToken,
          namespace,
          channel,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
        };
      },
      unarchive: async ({ channel }) => {
        const response = await engine.unarchiveChannel({
          accessToken,
          namespace,
          channel,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
        };
      },
      setPurpose: async ({ channel, purpose }) => {
        const response = await engine.setChannelPurpose({
          accessToken,
          namespace,
          channel,
          purpose,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          channel: {
            id: channel,
            name: channel,
          },
          purpose: response.purpose,
        } as unknown as Awaited<ReturnType<SlackClient["conversations"]["setPurpose"]>>;
      },
      setTopic: async ({ channel, topic }) => {
        const response = await engine.setChannelTopic({
          accessToken,
          namespace,
          channel,
          topic,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          channel: {
            id: channel,
            name: channel,
          },
          topic: response.topic,
        } as unknown as Awaited<ReturnType<SlackClient["conversations"]["setTopic"]>>;
      },
      open: async ({ users }) => {
        const response = await engine.openDM({
          accessToken,
          namespace,
          userIds: users
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          channel: {
            id: response.channel.id,
            name: response.channel.name,
            ...(typeof response.channel.isPrivate === "boolean"
              ? { is_private: response.channel.isPrivate }
              : {}),
            ...(typeof response.channel.isArchived === "boolean"
              ? { is_archived: response.channel.isArchived }
              : {}),
            ...(typeof response.channel.isMember === "boolean"
              ? { is_member: response.channel.isMember }
              : {}),
            ...(typeof response.channel.memberCount === "number"
              ? { num_members: response.channel.memberCount }
              : {}),
          },
        };
      },
      rename: async ({ channel, name }) => {
        const response = await engine.renameChannel({
          accessToken,
          namespace,
          channel,
          name,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          channel: {
            id: response.channel.id,
            name: response.channel.name,
            ...(typeof response.channel.isPrivate === "boolean"
              ? { is_private: response.channel.isPrivate }
              : {}),
            ...(typeof response.channel.isArchived === "boolean"
              ? { is_archived: response.channel.isArchived }
              : {}),
            ...(typeof response.channel.isMember === "boolean"
              ? { is_member: response.channel.isMember }
              : {}),
            ...(typeof response.channel.memberCount === "number"
              ? { num_members: response.channel.memberCount }
              : {}),
          },
        };
      },
      kick: async ({ channel, user }) => {
        const response = await engine.kickFromChannel({
          accessToken,
          namespace,
          channel,
          userId: user,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          ...(response.channel.id
            ? {
                channel: {
                  id: response.channel.id,
                  name: response.channel.name,
                },
              }
            : {}),
        } as unknown as Awaited<ReturnType<SlackClient["conversations"]["kick"]>>;
      },
      leave: async ({ channel }) => {
        const response = await engine.leaveChannel({
          accessToken,
          namespace,
          channel,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          ...(response.channel.id
            ? {
                channel: {
                  id: response.channel.id,
                  name: response.channel.name,
                },
              }
            : {}),
        } as unknown as Awaited<ReturnType<SlackClient["conversations"]["leave"]>>;
      },
      close: async ({ channel }) => {
        const response = await engine.closeDM({
          accessToken,
          namespace,
          channel,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          ...(response.channel.id
            ? {
                channel: {
                  id: response.channel.id,
                  name: response.channel.name,
                },
              }
            : {}),
        } as unknown as Awaited<ReturnType<SlackClient["conversations"]["close"]>>;
      },
    },
    reactions: {
      get: async ({ channel, timestamp }) => {
        const reactions = await engine.getReactions({
          accessToken,
          namespace,
          channel,
          ts: timestamp,
        });
        return {
          ok: true,
          message: {
            ts: timestamp,
            reactions,
          },
        };
      },
      add: async ({ channel, timestamp, name }) => {
        return await engine.addReaction({
          accessToken,
          namespace,
          channel,
          ts: timestamp,
          name,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      list: async ({ user, count }) => {
        const items = await engine.listReactions({
          accessToken,
          namespace,
          ...(typeof user === "string" ? { userId: user } : {}),
          limit: Number(count ?? 20) || 20,
        });
        return {
          ok: true,
          items: items.map((entry) => ({
            type: "message",
            channel: entry.channel,
            message: {
              ts: entry.ts,
              reactions: [
                {
                  name: entry.name,
                  count: entry.count,
                  users: entry.users,
                },
              ],
            },
          })),
        } as unknown as Awaited<ReturnType<SlackClient["reactions"]["list"]>>;
      },
      remove: async ({ channel, timestamp, name }) => {
        return await engine.removeReaction({
          accessToken,
          namespace,
          channel,
          ts: timestamp,
          name,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
    },
    users: {
      list: async ({ limit }) => {
        const users = await engine.listUsers({
          accessToken,
          namespace,
          limit,
        });
        return {
          ok: true,
          members: users.map((user) => ({
            id: user.id,
            name: user.name,
            ...(typeof user.realName === "string" ? { real_name: user.realName } : {}),
            ...(typeof user.isBot === "boolean" ? { is_bot: user.isBot } : {}),
            ...(typeof user.isDeleted === "boolean" ? { deleted: user.isDeleted } : {}),
          })),
        };
      },
      info: async ({ user }) => {
        const response = await engine.getUserInfo({
          accessToken,
          namespace,
          userId: user,
        });
        return {
          ok: true,
          user: {
            id: response.id,
            name: response.name,
            ...(typeof response.realName === "string" ? { real_name: response.realName } : {}),
            ...(typeof response.isBot === "boolean" ? { is_bot: response.isBot } : {}),
            ...(typeof response.isDeleted === "boolean" ? { deleted: response.isDeleted } : {}),
          },
        };
      },
      getPresence: async ({ user }) => {
        const presence = await engine.getUserPresence({
          accessToken,
          namespace,
          userId: user,
        });
        return {
          ok: true,
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
        };
      },
      profile: {
        get: async ({ user }) => {
          const profile = await engine.getUserProfile({
            accessToken,
            namespace,
            userId: user,
          });
          return {
            ok: true,
            profile: {
              ...(typeof profile.displayName === "string"
                ? { display_name: profile.displayName }
                : {}),
              ...(typeof profile.realName === "string" ? { real_name: profile.realName } : {}),
              ...(typeof profile.email === "string" ? { email: profile.email } : {}),
              ...(typeof profile.title === "string" ? { title: profile.title } : {}),
              ...(typeof profile.statusText === "string"
                ? { status_text: profile.statusText }
                : {}),
              ...(typeof profile.statusEmoji === "string"
                ? { status_emoji: profile.statusEmoji }
                : {}),
            },
          };
        },
      },
    },
    bookmarks: {
      add: async ({ channel_id, title, link, emoji }) => {
        const response = await engine.addBookmark({
          accessToken,
          namespace,
          channel: channel_id,
          title,
          link,
          ...(typeof emoji === "string" ? { emoji } : {}),
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          bookmark: {
            id: response.bookmark.id,
            channel_id: response.bookmark.channel,
            title: response.bookmark.title,
            link: response.bookmark.link,
            ...(typeof response.bookmark.emoji === "string"
              ? { emoji: response.bookmark.emoji }
              : {}),
            ...(typeof response.bookmark.entityId === "string"
              ? { entity_id: response.bookmark.entityId }
              : {}),
          },
        } as unknown as Awaited<ReturnType<SlackClient["bookmarks"]["add"]>>;
      },
      edit: async ({ channel_id, bookmark_id, title, link, emoji }) => {
        const response = await engine.editBookmark({
          accessToken,
          namespace,
          channel: channel_id,
          bookmarkId: bookmark_id,
          ...(typeof title === "string" ? { title } : {}),
          ...(typeof link === "string" ? { link } : {}),
          ...(typeof emoji === "string" ? { emoji } : {}),
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          bookmark: {
            id: response.bookmark.id,
            channel_id: response.bookmark.channel,
            title: response.bookmark.title,
            link: response.bookmark.link,
            ...(typeof response.bookmark.emoji === "string"
              ? { emoji: response.bookmark.emoji }
              : {}),
            ...(typeof response.bookmark.entityId === "string"
              ? { entity_id: response.bookmark.entityId }
              : {}),
          },
        } as unknown as Awaited<ReturnType<SlackClient["bookmarks"]["edit"]>>;
      },
      remove: async ({ channel_id, bookmark_id }) => {
        const response = await engine.removeBookmark({
          accessToken,
          namespace,
          channel: channel_id,
          bookmarkId: bookmark_id,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
        } as Awaited<ReturnType<SlackClient["bookmarks"]["remove"]>>;
      },
      list: async ({ channel_id }) => {
        const bookmarks = await engine.listBookmarks({
          accessToken,
          namespace,
          channel: channel_id,
        });
        return {
          ok: true,
          bookmarks: bookmarks.map((entry) => ({
            id: entry.id,
            channel_id: entry.channel,
            title: entry.title,
            link: entry.link,
            ...(typeof entry.emoji === "string" ? { emoji: entry.emoji } : {}),
            ...(typeof entry.entityId === "string" ? { entity_id: entry.entityId } : {}),
          })),
        } as unknown as Awaited<ReturnType<SlackClient["bookmarks"]["list"]>>;
      },
    },
    reminders: {
      add: async ({ text, time, user }) => {
        const response = await engine.addReminder({
          accessToken,
          namespace,
          text,
          time,
          ...(typeof user === "string" ? { userId: user } : {}),
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          reminder: {
            id: response.reminder.id,
            text: response.reminder.text,
            time: response.reminder.time,
            ...(typeof response.reminder.userId === "string"
              ? { user: response.reminder.userId }
              : {}),
          },
        } as Awaited<ReturnType<SlackClient["reminders"]["add"]>>;
      },
      list: async () => {
        const reminders = await engine.listReminders({
          accessToken,
          namespace,
        });
        return {
          ok: true,
          reminders: reminders.map((entry) => ({
            id: entry.id,
            text: entry.text,
            time: entry.time,
            ...(typeof entry.userId === "string" ? { user: entry.userId } : {}),
          })),
        } as Awaited<ReturnType<SlackClient["reminders"]["list"]>>;
      },
      delete: async ({ reminder }) => {
        const response = await engine.deleteReminder({
          accessToken,
          namespace,
          reminderId: reminder,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
        } as Awaited<ReturnType<SlackClient["reminders"]["delete"]>>;
      },
    },
    usergroups: {
      list: async (params) => {
        const groups = await engine.listUserGroups({
          accessToken,
          namespace,
          ...(typeof params?.include_disabled === "boolean"
            ? { includeDisabled: params.include_disabled }
            : {}),
        });
        return {
          ok: true,
          usergroups: groups.map((entry) => ({
            id: entry.id,
            handle: entry.handle,
            name: entry.name,
            date_delete: entry.isDisabled ? 1 : 0,
          })),
        };
      },
      users: {
        list: async ({ usergroup, include_disabled }) => {
          const users = await engine.listUserGroupMembers({
            accessToken,
            namespace,
            userGroupId: usergroup,
            ...(typeof include_disabled === "boolean" ? { includeDisabled: include_disabled } : {}),
          });
          return {
            ok: true,
            users,
          };
        },
      },
    },
    search: {
      messages: async ({ query, count }) => {
        const matches = await engine.searchMessages({
          accessToken,
          namespace,
          query,
          limit: count,
        });
        return {
          ok: true,
          messages: {
            matches: matches.map((message) => ({
              ...toSlackApiMessage(message),
              channel: {
                id: message.channel,
                name: message.channel,
              },
            })),
          },
        };
      },
      files: async ({ query, count }) => {
        const files = await engine.searchFiles({
          accessToken,
          namespace,
          query,
          limit: count,
        });
        return {
          ok: true,
          files: {
            matches: files.map((file) => ({
              id: file.id,
              name: file.name,
              ...(typeof file.title === "string" ? { title: file.title } : {}),
              ...(typeof file.url === "string" ? { permalink: file.url } : {}),
              ...(Array.isArray(file.channels) ? { channels: file.channels } : {}),
              ...(typeof file.mimetype === "string" ? { mimetype: file.mimetype } : {}),
              ...(typeof file.size === "number" ? { size: file.size } : {}),
            })),
          },
        } as unknown as Awaited<ReturnType<SlackClient["search"]["files"]>>;
      },
    },
    chat: {
      postMessage: async ({ channel, text }) => {
        return await engine.postMessage({
          accessToken,
          namespace,
          channel,
          text,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      meMessage: async ({ channel, text }) => {
        const response = await engine.meMessage({
          accessToken,
          namespace,
          channel,
          text,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          channel: response.channel,
          ts: response.ts,
          text: response.text,
        };
      },
      update: async ({ channel, ts, text }) => {
        return await engine.updateMessage({
          accessToken,
          namespace,
          channel,
          ts,
          text,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      delete: async ({ channel, ts }) => {
        return await engine.deleteMessage({
          accessToken,
          namespace,
          channel,
          ts,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      postEphemeral: async ({ channel, user, text }) => {
        const response = await engine.postEphemeral({
          accessToken,
          namespace,
          channel,
          userId: user,
          text,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          channel: response.channel,
          message_ts: response.messageTs,
        };
      },
      scheduleMessage: async ({ channel, text, post_at }) => {
        const response = await engine.scheduleMessage({
          accessToken,
          namespace,
          channel,
          text,
          postAt: post_at,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          channel: response.channel,
          post_at: response.postAt,
          scheduled_message_id: response.scheduledMessageId,
          ...(typeof response.messageTs === "string" ? { message_ts: response.messageTs } : {}),
        };
      },
      deleteScheduledMessage: async ({ channel, scheduled_message_id }) => {
        const response = await engine.deleteScheduledMessage({
          accessToken,
          namespace,
          channel,
          scheduledMessageId: scheduled_message_id,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          channel: response.channel,
          scheduled_message_id: response.scheduledMessageId,
        };
      },
      scheduledMessages: {
        list: async ({ channel, limit }) => {
          const scheduledMessages = await engine.listScheduledMessages({
            accessToken,
            namespace,
            ...(typeof channel === "string" ? { channel } : {}),
            limit: Number(limit ?? 20) || 20,
          });
          return {
            ok: true,
            scheduled_messages: scheduledMessages.map((message) => ({
              id: message.id,
              channel_id: message.channel,
              text: message.text,
              post_at: message.postAt,
            })),
          };
        },
      },
      getPermalink: async ({ channel, message_ts }) => {
        const response = await engine.getPermalink({
          accessToken,
          namespace,
          channel,
          ts: message_ts,
        });
        return {
          ok: response.ok,
          channel: response.channel,
          permalink: response.permalink,
        };
      },
    },
    pins: {
      add: async ({ channel, timestamp }) => {
        return await engine.pinMessage({
          accessToken,
          namespace,
          channel,
          ts: timestamp,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      remove: async ({ channel, timestamp }) => {
        return await engine.unpinMessage({
          accessToken,
          namespace,
          channel,
          ts: timestamp,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      list: async ({ channel }) => {
        const pins = await engine.listPins({
          accessToken,
          namespace,
          channel,
        });
        return {
          ok: true,
          items: pins.map((pin) => ({
            channel_id: pin.channel,
            message: {
              ts: pin.ts,
              ...(typeof pin.text === "string" ? { text: pin.text } : {}),
            },
          })),
        } as unknown as Awaited<ReturnType<SlackClient["pins"]["list"]>>;
      },
    },
    files: {
      upload: async ({ channels, filename, content, title }) => {
        const response = await engine.uploadFile({
          accessToken,
          namespace,
          channel: channels,
          filename,
          content,
          ...(typeof title === "string" ? { title } : {}),
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
          file: {
            id: response.file.id,
            name: response.file.name,
            ...(typeof response.file.title === "string" ? { title: response.file.title } : {}),
            ...(typeof response.file.url === "string" ? { permalink: response.file.url } : {}),
          },
          files: [
            {
              id: response.file.id,
              name: response.file.name,
              ...(typeof response.file.title === "string" ? { title: response.file.title } : {}),
              ...(typeof response.file.url === "string" ? { permalink: response.file.url } : {}),
            },
          ],
        };
      },
      list: async ({ channel, user, count }) => {
        const files = await engine.listFiles({
          accessToken,
          namespace,
          ...(typeof channel === "string" ? { channel } : {}),
          ...(typeof user === "string" ? { userId: user } : {}),
          limit: Number(count ?? 20) || 20,
        });
        return {
          ok: true,
          files: files.map((file) => ({
            id: file.id,
            name: file.name,
            ...(typeof file.title === "string" ? { title: file.title } : {}),
            ...(typeof file.url === "string" ? { permalink: file.url } : {}),
            ...(Array.isArray(file.channels) ? { channels: file.channels } : {}),
            ...(typeof file.userId === "string" ? { user: file.userId } : {}),
            ...(typeof file.mimetype === "string" ? { mimetype: file.mimetype } : {}),
            ...(typeof file.size === "number" ? { size: file.size } : {}),
          })),
        };
      },
      info: async ({ file }) => {
        const response = await engine.getFileInfo({
          accessToken,
          namespace,
          fileId: file,
        });
        return {
          ok: true,
          file: {
            id: response.id,
            name: response.name,
            ...(typeof response.title === "string" ? { title: response.title } : {}),
            ...(typeof response.url === "string" ? { permalink: response.url } : {}),
            ...(Array.isArray(response.channels) ? { channels: response.channels } : {}),
            ...(typeof response.userId === "string" ? { user: response.userId } : {}),
            ...(typeof response.mimetype === "string" ? { mimetype: response.mimetype } : {}),
            ...(typeof response.size === "number" ? { size: response.size } : {}),
          },
        };
      },
      delete: async ({ file }) => {
        const response = await engine.deleteFile({
          accessToken,
          namespace,
          fileId: file,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
        return {
          ok: response.ok,
        };
      },
    },
  };
};
