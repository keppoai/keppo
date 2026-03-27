import {
  createFakeSlackClientStore,
  createFakeSlackSdk,
  type FakeSlackClientStore,
} from "../../../../packages/shared/src/provider-sdk/slack/fake.js";
import { BaseProviderFake } from "../base-fake";
import type { ProviderReadRequest, ProviderWriteRequest } from "../contract/provider-contract";

const defaultFakeToken = (): string =>
  process.env.KEPPO_FAKE_SLACK_ACCESS_TOKEN ?? "fake_slack_access_token";

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

export class SlackFake extends BaseProviderFake {
  private readonly clientStore: FakeSlackClientStore = createFakeSlackClientStore();
  private readonly sdk = createFakeSlackSdk({ clientStore: this.clientStore });

  override async listResources(request: ProviderReadRequest): Promise<Record<string, unknown>> {
    if (request.resource === "channels") {
      const channels = await this.sdk.listChannels({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        limit: Number(request.query.limit ?? "200") || 200,
      });
      return {
        ok: true,
        channels: channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          ...(typeof channel.isPrivate === "boolean" ? { is_private: channel.isPrivate } : {}),
        })),
      };
    }

    if (request.resource === "channels/history") {
      return {
        ok: true,
        messages: await this.sdk.getChannelHistory({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          channel: String(request.query.channel ?? ""),
          limit: Number(request.query.limit ?? "50") || 50,
        }),
      };
    }

    if (request.resource === "threads/replies") {
      return {
        ok: true,
        messages: await this.sdk.getThreadReplies({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          channel: String(request.query.channel ?? ""),
          threadTs: String(request.query.threadTs ?? request.query.ts ?? ""),
          limit: Number(request.query.limit ?? "50") || 50,
        }),
      };
    }

    if (request.resource === "users") {
      return {
        ok: true,
        members: await this.sdk.listUsers({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          limit: Number(request.query.limit ?? "200") || 200,
        }),
      };
    }

    if (request.resource === "search/messages") {
      const matches = await this.sdk.searchMessages({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        query: String(request.query.query ?? request.query.q ?? ""),
        limit: Number(request.query.limit ?? "20") || 20,
      });
      return {
        ok: true,
        messages: {
          matches: matches.map((message) => ({
            ts: message.ts,
            text: message.text,
            ...(message.userId ? { user: message.userId } : {}),
            ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
            channel: {
              id: message.channel,
              name: message.channel,
            },
          })),
        },
      };
    }

    if (request.resource === "channels/members") {
      return {
        ok: true,
        members: await this.sdk.listChannelMembers({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          channel: String(request.query.channel ?? ""),
          limit: Number(request.query.limit ?? "200") || 200,
        }),
      };
    }

    if (request.resource === "scheduled/messages") {
      return {
        ok: true,
        scheduled_messages: await this.sdk.listScheduledMessages({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          ...(typeof request.query.channel === "string" && request.query.channel.length > 0
            ? { channel: request.query.channel }
            : {}),
          limit: Number(request.query.limit ?? "20") || 20,
        }),
      };
    }

    if (request.resource === "bookmarks") {
      return {
        ok: true,
        bookmarks: await this.sdk.listBookmarks({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          channel: String(request.query.channel_id ?? request.query.channel ?? ""),
        }),
      };
    }

    if (request.resource === "reminders") {
      return {
        ok: true,
        reminders: await this.sdk.listReminders({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          ...(typeof request.query.user === "string" && request.query.user.length > 0
            ? { userId: request.query.user }
            : {}),
        }),
      };
    }

    if (request.resource === "usergroups") {
      return {
        ok: true,
        usergroups: await this.sdk.listUserGroups({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          ...(typeof request.query.include_disabled === "string"
            ? { includeDisabled: request.query.include_disabled === "true" }
            : {}),
        }),
      };
    }

    if (request.resource === "usergroups/users") {
      return {
        ok: true,
        users: await this.sdk.listUserGroupMembers({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          userGroupId: String(request.query.usergroup ?? request.query.userGroupId ?? ""),
          ...(typeof request.query.include_disabled === "string"
            ? { includeDisabled: request.query.include_disabled === "true" }
            : {}),
        }),
      };
    }

    if (request.resource === "reactions/list") {
      return {
        ok: true,
        items: await this.sdk.listReactions({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          ...(typeof request.query.user === "string" && request.query.user.length > 0
            ? { userId: request.query.user }
            : {}),
          limit: Number(request.query.count ?? request.query.limit ?? "20") || 20,
        }),
      };
    }

    if (request.resource === "pins") {
      return {
        ok: true,
        items: await this.sdk.listPins({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          channel: String(request.query.channel ?? ""),
        }),
      };
    }

    if (request.resource === "files") {
      return {
        ok: true,
        files: await this.sdk.listFiles({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          ...(typeof request.query.channel === "string" && request.query.channel.length > 0
            ? { channel: request.query.channel }
            : {}),
          ...(typeof request.query.user === "string" && request.query.user.length > 0
            ? { userId: request.query.user }
            : {}),
          limit: Number(request.query.limit ?? "20") || 20,
        }),
      };
    }

    if (request.resource === "search/files") {
      return {
        ok: true,
        files: {
          matches: await this.sdk.searchFiles({
            accessToken: defaultFakeToken(),
            namespace: request.namespace,
            query: String(request.query.query ?? request.query.q ?? ""),
            limit: Number(request.query.limit ?? "20") || 20,
          }),
        },
      };
    }

    throw new Error(`unsupported_resource:${request.resource}`);
  }

  override async readResource(request: ProviderReadRequest): Promise<Record<string, unknown>> {
    if (request.resource === "reactions") {
      return {
        ok: true,
        message: {
          ts: String(request.query.ts ?? ""),
          reactions: await this.sdk.getReactions({
            accessToken: defaultFakeToken(),
            namespace: request.namespace,
            channel: String(request.query.channel ?? ""),
            ts: String(request.query.ts ?? ""),
          }),
        },
      };
    }

    if (request.resource.startsWith("users/")) {
      const userId = request.resource.replace("users/", "");
      if (userId.endsWith("/profile")) {
        const profileUserId = userId.replace(/\/profile$/, "");
        return {
          ok: true,
          profile: await this.sdk.getUserProfile({
            accessToken: defaultFakeToken(),
            namespace: request.namespace,
            userId: profileUserId,
          }),
        };
      }
      if (userId.endsWith("/presence")) {
        const presenceUserId = userId.replace(/\/presence$/, "");
        return {
          ok: true,
          ...(await this.sdk.getUserPresence({
            accessToken: defaultFakeToken(),
            namespace: request.namespace,
            userId: presenceUserId,
          })),
        };
      }
      return {
        ok: true,
        user: await this.sdk.getUserInfo({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          userId,
        }),
      };
    }

    if (request.resource.startsWith("channels/")) {
      const channel = request.resource.replace("channels/", "");
      if (channel.endsWith("/permalink")) {
        const normalized = channel.replace(/\/permalink$/, "");
        const permalink = await this.sdk.getPermalink({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          channel: normalized,
          ts: String(request.query.ts ?? request.query.message_ts ?? ""),
        });
        return {
          ok: permalink.ok,
          channel: permalink.channel,
          permalink: permalink.permalink,
        };
      }
      return {
        ok: true,
        channel: await this.sdk.getChannelInfo({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          channel,
        }),
      };
    }

    if (request.resource.startsWith("files/")) {
      const fileId = request.resource.replace("files/", "");
      return {
        ok: true,
        file: await this.sdk.getFileInfo({
          accessToken: defaultFakeToken(),
          namespace: request.namespace,
          fileId,
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
    if (request.resource === "chat.postMessage") {
      return await this.sdk.postMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        text: String(payload.text ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "chat.update") {
      return await this.sdk.updateMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        ts: String(payload.ts ?? ""),
        text: String(payload.text ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "chat.delete") {
      return await this.sdk.deleteMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        ts: String(payload.ts ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "reactions.add") {
      return await this.sdk.addReaction({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        ts: String(payload.timestamp ?? payload.ts ?? ""),
        name: String(payload.name ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "chat.postEphemeral") {
      return await this.sdk.postEphemeral({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        userId: String(payload.user ?? payload.userId ?? ""),
        text: String(payload.text ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "bookmarks.add") {
      return await this.sdk.addBookmark({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel_id ?? payload.channel ?? ""),
        title: String(payload.title ?? ""),
        link: String(payload.link ?? ""),
        ...(typeof payload.emoji === "string" ? { emoji: payload.emoji } : {}),
        idempotencyKey,
      });
    }

    if (request.resource === "bookmarks.edit") {
      return await this.sdk.editBookmark({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel_id ?? payload.channel ?? ""),
        bookmarkId: String(payload.bookmark_id ?? payload.bookmarkId ?? ""),
        ...(typeof payload.title === "string" ? { title: payload.title } : {}),
        ...(typeof payload.link === "string" ? { link: payload.link } : {}),
        ...(typeof payload.emoji === "string" ? { emoji: payload.emoji } : {}),
        idempotencyKey,
      });
    }

    if (request.resource === "bookmarks.remove") {
      return await this.sdk.removeBookmark({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel_id ?? payload.channel ?? ""),
        bookmarkId: String(payload.bookmark_id ?? payload.bookmarkId ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "reminders.add") {
      return await this.sdk.addReminder({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        text: String(payload.text ?? ""),
        time: Number(payload.time ?? 0),
        ...(typeof payload.user === "string" ? { userId: payload.user } : {}),
        idempotencyKey,
      });
    }

    if (request.resource === "reminders.delete") {
      return await this.sdk.deleteReminder({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        reminderId: String(payload.reminder ?? payload.reminderId ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "chat.meMessage") {
      return await this.sdk.meMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        text: String(payload.text ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "conversations.create") {
      return await this.sdk.createChannel({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        name: String(payload.name ?? ""),
        ...(typeof payload.is_private === "boolean" ? { isPrivate: payload.is_private } : {}),
        idempotencyKey,
      });
    }

    if (request.resource === "conversations.invite") {
      return await this.sdk.inviteToChannel({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        userIds: String(payload.users ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
        idempotencyKey,
      });
    }

    if (request.resource === "conversations.join") {
      return await this.sdk.joinChannel({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "conversations.mark") {
      return await this.sdk.markChannelRead({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        ts: String(payload.ts ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "conversations.archive") {
      return await this.sdk.archiveChannel({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "conversations.unarchive") {
      return await this.sdk.unarchiveChannel({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "conversations.setPurpose") {
      return await this.sdk.setChannelPurpose({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        purpose: String(payload.purpose ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "conversations.setTopic") {
      return await this.sdk.setChannelTopic({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        topic: String(payload.topic ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "conversations.open") {
      return await this.sdk.openDM({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        userIds: String(payload.users ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
        idempotencyKey,
      });
    }

    if (request.resource === "conversations.rename") {
      return await this.sdk.renameChannel({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        name: String(payload.name ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "conversations.kick") {
      return await this.sdk.kickFromChannel({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        userId: String(payload.user ?? payload.userId ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "conversations.leave") {
      return await this.sdk.leaveChannel({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "conversations.close") {
      return await this.sdk.closeDM({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "chat.scheduleMessage") {
      return await this.sdk.scheduleMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        text: String(payload.text ?? ""),
        postAt: Number(payload.post_at ?? payload.postAt ?? 0),
        idempotencyKey,
      });
    }

    if (request.resource === "chat.deleteScheduledMessage") {
      return await this.sdk.deleteScheduledMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        scheduledMessageId: String(
          payload.scheduled_message_id ?? payload.scheduledMessageId ?? "",
        ),
        idempotencyKey,
      });
    }

    if (request.resource === "reactions.remove") {
      return await this.sdk.removeReaction({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        ts: String(payload.timestamp ?? payload.ts ?? ""),
        name: String(payload.name ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "pins.add") {
      return await this.sdk.pinMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        ts: String(payload.timestamp ?? payload.ts ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "pins.remove") {
      return await this.sdk.unpinMessage({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        channel: String(payload.channel ?? ""),
        ts: String(payload.timestamp ?? payload.ts ?? ""),
        idempotencyKey,
      });
    }

    if (request.resource === "files.uploadV2") {
      const files = Array.isArray(payload.file_uploads) ? payload.file_uploads : [];
      const first =
        files.length > 0 && files[0] && typeof files[0] === "object" && !Array.isArray(files[0])
          ? (files[0] as Record<string, unknown>)
          : {};

      return {
        ok: true,
        files: [
          (
            await this.sdk.uploadFile({
              accessToken: defaultFakeToken(),
              namespace: request.namespace,
              channel: String(payload.channel_id ?? payload.channel ?? ""),
              filename: String(first.filename ?? payload.filename ?? ""),
              content: String(first.content ?? payload.content ?? ""),
              ...(typeof payload.title === "string" ? { title: payload.title } : {}),
              idempotencyKey,
            })
          ).file,
        ],
      };
    }

    if (request.resource === "files.delete") {
      return await this.sdk.deleteFile({
        accessToken: defaultFakeToken(),
        namespace: request.namespace,
        fileId: String(payload.file ?? payload.fileId ?? ""),
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
