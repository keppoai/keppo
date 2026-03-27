import { BaseFakeClient } from "../base-fake-client.js";
import { createFakeProviderSdkErrorFactory, matchErrorCodes } from "../fake-error.js";
import { ProviderSdkError, type ProviderSdkCallLog } from "../port.js";
import type { CreateGmailClient, GmailClient } from "./client-interface.js";
import { createFakeGmailClient } from "./client-adapter.js";
import {
  seedGmailAttachments,
  seedGmailDrafts,
  seedGmailFilters,
  seedGmailLabels,
  seedGmailMessages,
  seedGmailSendAsAliases,
  seedGmailVacationSettings,
  type GmailFixtureAttachment,
  type GmailFixtureDraft,
  type GmailFixtureFilter,
  type GmailFixtureLabel,
  type GmailFixtureMessage,
  type GmailFixtureSendAsAlias,
  type GmailFixtureVacationSettings,
} from "./fixtures.js";
import type {
  GmailBatchModifyMessagesArgs,
  GmailBatchModifyMessagesResponse,
  GmailCreateFilterArgs,
  GmailCreateFilterResponse,
  GmailCreateDraftArgs,
  GmailCreateDraftResponse,
  GmailCreateLabelArgs,
  GmailCreateLabelResponse,
  GmailDeleteLabelArgs,
  GmailDeleteLabelResponse,
  GmailDeleteDraftArgs,
  GmailDeleteDraftResponse,
  GmailDeleteFilterArgs,
  GmailDeleteFilterResponse,
  GmailDownloadAttachmentArgs,
  GmailDownloadAttachmentResponse,
  GmailDraft,
  GmailGetDraftArgs,
  GmailGetDraftResponse,
  GmailGetFilterArgs,
  GmailGetFilterResponse,
  GmailGetLabelArgs,
  GmailGetLabelResponse,
  GmailGetMessageArgs,
  GmailGetProfileArgs,
  GmailGetSendAsAliasArgs,
  GmailGetSendAsAliasResponse,
  GmailGetThreadArgs,
  GmailGetVacationArgs,
  GmailGetVacationResponse,
  GmailHistoryRecord,
  GmailListDraftsArgs,
  GmailListDraftsResponse,
  GmailListFiltersArgs,
  GmailListFiltersResponse,
  GmailListHistoryArgs,
  GmailListHistoryResponse,
  GmailListLabelsArgs,
  GmailListLabelsResponse,
  GmailListMessagesArgs,
  GmailListMessagesResponse,
  GmailListSendAsAliasesArgs,
  GmailListSendAsAliasesResponse,
  GmailMessage,
  GmailModifyThreadArgs,
  GmailModifyThreadResponse,
  GmailProfile,
  GmailSdkPort,
  GmailSendDraftArgs,
  GmailSendDraftResponse,
  GmailSendMessageArgs,
  GmailSendMessageResponse,
  GmailStopWatchArgs,
  GmailStopWatchResponse,
  GmailThread,
  GmailTrashMessageArgs,
  GmailTrashMessageResponse,
  GmailTrashThreadArgs,
  GmailTrashThreadResponse,
  GmailUntrashMessageArgs,
  GmailUntrashMessageResponse,
  GmailUntrashThreadArgs,
  GmailUntrashThreadResponse,
  GmailUpdateDraftArgs,
  GmailUpdateDraftResponse,
  GmailUpdateLabelArgs,
  GmailUpdateLabelResponse,
  GmailUpdateSendAsAliasArgs,
  GmailUpdateSendAsAliasResponse,
  GmailUpdateVacationArgs,
  GmailUpdateVacationResponse,
  GmailWatchArgs,
  GmailWatchResponse,
} from "./types.js";

type GmailWatchState = {
  topicName: string;
  labelIds: string[];
  labelFilterBehavior: "include" | "exclude";
  historyId: string;
  expiration: string;
};

type GmailNamespaceState = {
  sentCount: number;
  labelCount: number;
  draftCount: number;
  filterCount: number;
  historyCounter: number;
  messages: GmailFixtureMessage[];
  labels: GmailFixtureLabel[];
  drafts: GmailFixtureDraft[];
  filters: GmailFixtureFilter[];
  sendAsAliases: GmailFixtureSendAsAlias[];
  vacation: GmailFixtureVacationSettings;
  attachments: GmailFixtureAttachment[];
  watches: GmailWatchState[];
  forceRateLimit: boolean;
  forceTimeout: boolean;
  idempotentResponses: Map<string, unknown>;
};

const toBase64Url = (value: string): string =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
};

const parseRawMessage = (raw: string): { to: string; subject: string; body: string } => {
  if (!raw.trim()) {
    return { to: "", subject: "", body: "" };
  }

  const decoded = fromBase64Url(raw);
  const [headerBlock = "", ...bodyParts] = decoded.split(/\r?\n\r?\n/);
  const body = bodyParts.join("\n\n");

  const headers = headerBlock
    .split(/\r?\n/)
    .map((line) => {
      const split = line.split(":");
      const name = split.shift() ?? "";
      const valueParts = split;
      return {
        name: name.trim().toLowerCase(),
        value: valueParts.join(":").trim(),
      };
    })
    .filter((header) => header.name.length > 0);

  const to = headers.find((header) => header.name === "to")?.value ?? "";
  const subject = headers.find((header) => header.name === "subject")?.value ?? "";
  return { to, subject, body };
};

const buildMessagePayload = (
  message: GmailFixtureMessage,
): NonNullable<GmailMessage["payload"]> => {
  return {
    headers: [
      { name: "From", value: message.from },
      { name: "To", value: message.to },
      { name: "Subject", value: message.subject },
    ],
    parts: [
      {
        mimeType: "text/plain",
        body: {
          data: toBase64Url(message.body),
        },
      },
    ],
  };
};

const toProviderSdkError = createFakeProviderSdkErrorFactory("google", [
  {
    match: (_signals, message) => message === "rate_limited",
    category: "rate_limit",
    code: "rate_limited",
    status: 429,
    retryable: true,
  },
  {
    match: (_signals, message) => message === "gateway_timeout",
    category: "timeout",
    code: "timeout",
    status: 504,
    retryable: true,
  },
  {
    match: matchErrorCodes("missing_access_token", "invalid_access_token", "expired_access_token"),
    category: "auth",
    code: "invalid_token",
    status: 401,
    retryable: false,
  },
  {
    match: matchErrorCodes("not_found"),
    category: "not_found",
    code: (message) => message,
    status: 404,
    retryable: false,
  },
]);

export class InMemoryGmailSdk extends BaseFakeClient<GmailNamespaceState> implements GmailSdkPort {
  constructor(options?: { callLog?: ProviderSdkCallLog }) {
    super({
      providerId: "google",
      ...(options?.callLog ? { callLog: options.callLog } : {}),
    });
  }

  async listMessages(args: GmailListMessagesArgs): Promise<GmailListMessagesResponse> {
    const method = "gmail.users.messages.list";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      maxResults: args.maxResults,
    };

    return this.runGmailOperation(args, method, normalizedArgs, (state) => {
      const needle = args.query.toLowerCase().trim();
      const limit = Math.max(1, Math.min(50, Number(args.maxResults) || 20));
      const filtered = state.messages.filter((message) => {
        if (!needle) {
          return true;
        }
        if (needle === "is:unread") {
          return message.unread;
        }
        return (
          message.subject.toLowerCase().includes(needle) ||
          message.snippet.toLowerCase().includes(needle) ||
          message.from.toLowerCase().includes(needle) ||
          message.to.toLowerCase().includes(needle)
        );
      });

      const response: GmailListMessagesResponse = {
        messages: filtered.slice(0, limit).map((message) => ({ id: message.id })),
      };
      return response;
    });
  }

  async getMessage(args: GmailGetMessageArgs): Promise<GmailMessage> {
    const method = "gmail.users.messages.get";
    const normalizedArgs = {
      namespace: args.namespace,
      messageId: args.messageId,
      format: args.format ?? "full",
    };

    return this.runGmailOperation(args, method, normalizedArgs, (state) => {
      const message = state.messages.find((entry) => entry.id === args.messageId);
      if (!message) {
        throw new Error("message_not_found");
      }

      const response: GmailMessage = {
        id: message.id,
        threadId: message.threadId,
        snippet: message.snippet,
        payload: buildMessagePayload(message),
        historyId: message.historyId,
        internalDate: message.internalDate ?? message.historyId,
        labelIds: [...message.labelIds],
      };
      return response;
    });
  }

  async sendMessage(args: GmailSendMessageArgs): Promise<GmailSendMessageResponse> {
    const method = "gmail.users.messages.send";
    const normalizedArgs = {
      namespace: args.namespace,
      threadId: args.threadId,
      hasRaw: Boolean(args.raw),
    };

    return this.runGmailCachedOperation(args, method, normalizedArgs, (state) => {
      const parsed = parseRawMessage(args.raw);
      state.sentCount += 1;
      state.historyCounter += 1;

      const messageId = `msg_sent_${state.sentCount}`;
      const threadId = args.threadId ?? `thr_sent_${state.sentCount}`;
      const sentMessage: GmailFixtureMessage = {
        id: messageId,
        threadId,
        from: "automation@example.com",
        to: parsed.to,
        subject: parsed.subject || "(no subject)",
        snippet: parsed.body.slice(0, 120),
        body: parsed.body,
        unread: false,
        historyId: String(state.historyCounter),
        labelIds: ["SENT"],
      };
      state.messages.unshift(sentMessage);

      const response: GmailSendMessageResponse = {
        id: messageId,
        threadId,
      };
      return response;
    });
  }

  async modifyThread(args: GmailModifyThreadArgs): Promise<GmailModifyThreadResponse> {
    const method = "gmail.users.threads.modify";
    const normalizedArgs = {
      namespace: args.namespace,
      threadId: args.threadId,
      addLabelIds: args.addLabelIds ?? [],
      removeLabelIds: args.removeLabelIds ?? [],
    };

    return this.runGmailCachedOperation(args, method, normalizedArgs, (state) => {
      let touched = false;
      for (const message of state.messages) {
        if (message.threadId !== args.threadId) {
          continue;
        }
        touched = true;
        const labels = new Set(message.labelIds);
        for (const label of args.addLabelIds ?? []) {
          labels.add(label);
        }
        for (const label of args.removeLabelIds ?? []) {
          labels.delete(label);
        }
        message.labelIds = [...labels];
      }
      if (!touched) {
        throw new Error("thread_not_found");
      }

      state.historyCounter += 1;
      const response: GmailModifyThreadResponse = {
        id: args.threadId,
        historyId: String(state.historyCounter),
      };
      return response;
    });
  }

  async getProfile(args: GmailGetProfileArgs): Promise<GmailProfile> {
    const method = "gmail.users.getProfile";
    const normalizedArgs = { namespace: args.namespace };

    return this.runGmailOperation(args, method, normalizedArgs, (state) => {
      const latestHistoryId = state.messages.reduce<number>((max, message) => {
        const id = Number.parseInt(message.historyId, 10);
        return Number.isFinite(id) ? Math.max(max, id) : max;
      }, state.historyCounter);

      const response: GmailProfile = {
        emailAddress: "automation@example.com",
        historyId: String(latestHistoryId),
        messagesTotal: state.messages.length,
        threadsTotal: new Set(state.messages.map((message) => message.threadId)).size,
      };
      return response;
    });
  }

  async getThread(args: GmailGetThreadArgs): Promise<GmailThread> {
    const method = "gmail.users.threads.get";
    const normalizedArgs = {
      namespace: args.namespace,
      threadId: args.threadId,
      format: args.format ?? "full",
      metadataHeaders: args.metadataHeaders ?? [],
    };

    return this.runGmailOperation(args, method, normalizedArgs, (state) => {
      const messages = state.messages.filter((entry) => entry.threadId === args.threadId);
      if (messages.length === 0) {
        throw new Error("thread_not_found");
      }

      const historyId = messages.reduce<number>((max, message) => {
        const id = Number.parseInt(message.historyId, 10);
        return Number.isFinite(id) ? Math.max(max, id) : max;
      }, 0);

      const response: GmailThread = {
        id: args.threadId,
        historyId: String(historyId),
        messages: messages.map((message) => ({
          id: message.id,
          threadId: message.threadId,
          labelIds: [...message.labelIds],
          snippet: message.snippet,
          payload: buildMessagePayload(message),
        })),
      };
      return response;
    });
  }

  async listLabels(args: GmailListLabelsArgs): Promise<GmailListLabelsResponse> {
    const method = "gmail.users.labels.list";
    const normalizedArgs = { namespace: args.namespace };

    return this.runGmailOperation(args, method, normalizedArgs, (state) => {
      const response: GmailListLabelsResponse = {
        labels: state.labels.map((label) => this.toLabelResponse(label)),
      };
      return response;
    });
  }

  async createLabel(args: GmailCreateLabelArgs): Promise<GmailCreateLabelResponse> {
    const method = "gmail.users.labels.create";
    const normalizedArgs = {
      namespace: args.namespace,
      name: args.name,
      labelListVisibility: args.labelListVisibility,
      messageListVisibility: args.messageListVisibility,
    };

    return this.runGmailCachedOperation(args, method, normalizedArgs, (state) => {
      state.labelCount += 1;
      const created: GmailFixtureLabel = {
        id: `Label_${state.labelCount}`,
        name: args.name,
        type: "user",
        labelListVisibility: args.labelListVisibility ?? "labelShow",
        messageListVisibility: args.messageListVisibility ?? "show",
        messagesTotal: 0,
        messagesUnread: 0,
        threadsTotal: 0,
        threadsUnread: 0,
      };
      state.labels.push(created);

      return this.toLabelResponse(created);
    });
  }

  async updateLabel(args: GmailUpdateLabelArgs): Promise<GmailUpdateLabelResponse> {
    const method = "gmail.users.labels.update";
    const normalizedArgs = {
      namespace: args.namespace,
      labelId: args.labelId,
      name: args.name,
      labelListVisibility: args.labelListVisibility,
      messageListVisibility: args.messageListVisibility,
    };

    return this.runGmailCachedOperation(args, method, normalizedArgs, (state) => {
      const label = state.labels.find((entry) => entry.id === args.labelId);
      if (!label) {
        throw new Error("label_not_found");
      }

      if (typeof args.name === "string" && args.name.length > 0) {
        label.name = args.name;
      }
      if (typeof args.labelListVisibility === "string" && args.labelListVisibility.length > 0) {
        label.labelListVisibility = args.labelListVisibility;
      }
      if (typeof args.messageListVisibility === "string" && args.messageListVisibility.length > 0) {
        label.messageListVisibility = args.messageListVisibility;
      }

      return this.toLabelResponse(label);
    });
  }

  async deleteLabel(args: GmailDeleteLabelArgs): Promise<GmailDeleteLabelResponse> {
    const method = "gmail.users.labels.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      labelId: args.labelId,
    };

    return this.runGmailCachedOperation(args, method, normalizedArgs, (state) => {
      const index = state.labels.findIndex((entry) => entry.id === args.labelId);
      if (index < 0) {
        throw new Error("label_not_found");
      }

      const [removed] = state.labels.splice(index, 1);
      if (removed) {
        for (const message of state.messages) {
          message.labelIds = message.labelIds.filter((labelId) => labelId !== removed.id);
        }
      }

      const response: GmailDeleteLabelResponse = {
        deleted: true,
        labelId: args.labelId,
      };
      return response;
    });
  }

  async createDraft(args: GmailCreateDraftArgs): Promise<GmailCreateDraftResponse> {
    const method = "gmail.users.drafts.create";
    const normalizedArgs = {
      namespace: args.namespace,
      threadId: args.threadId,
      hasRaw: Boolean(args.raw),
    };

    return this.runGmailCachedOperation(args, method, normalizedArgs, (state) => {
      const draft = this.createDraftEntry(state, args.raw, args.threadId);
      return this.toDraftResponse(state, draft);
    });
  }

  async listDrafts(args: GmailListDraftsArgs): Promise<GmailListDraftsResponse> {
    const method = "gmail.users.drafts.list";
    const normalizedArgs = {
      namespace: args.namespace,
      maxResults: args.maxResults,
    };

    return this.runGmailOperation(args, method, normalizedArgs, (state) => {
      const limit = Math.max(1, Math.min(50, Number(args.maxResults) || 20));
      return {
        drafts: state.drafts.slice(0, limit).map((draft) => ({ id: draft.id })),
      };
    });
  }

  async getDraft(args: GmailGetDraftArgs): Promise<GmailGetDraftResponse> {
    const method = "gmail.users.drafts.get";
    const normalizedArgs = {
      namespace: args.namespace,
      draftId: args.draftId,
      format: args.format ?? "full",
      metadataHeaders: args.metadataHeaders ?? [],
    };

    return this.runGmailOperation(args, method, normalizedArgs, (state) => {
      const draft = state.drafts.find((entry) => entry.id === args.draftId);
      if (!draft) {
        throw new Error("draft_not_found");
      }

      return this.toDraftResponse(state, draft);
    });
  }

  async updateDraft(args: GmailUpdateDraftArgs): Promise<GmailUpdateDraftResponse> {
    const method = "gmail.users.drafts.update";
    const normalizedArgs = {
      namespace: args.namespace,
      draftId: args.draftId,
      threadId: args.threadId,
      hasRaw: Boolean(args.raw),
    };

    return this.runGmailCachedOperation(args, method, normalizedArgs, (state) => {
      const draftIndex = state.drafts.findIndex((entry) => entry.id === args.draftId);
      if (draftIndex < 0) {
        throw new Error("draft_not_found");
      }

      const current = state.drafts[draftIndex];
      if (!current) {
        throw new Error("draft_not_found");
      }

      const parsed = parseRawMessage(args.raw);
      const threadId = args.threadId ?? current.threadId;
      const messageId = current.messageId;
      const existingMessage = state.messages.find((entry) => entry.id === messageId);
      if (existingMessage) {
        existingMessage.threadId = threadId;
        existingMessage.to = parsed.to;
        existingMessage.subject = parsed.subject || existingMessage.subject;
        existingMessage.body = parsed.body;
        existingMessage.snippet = parsed.body.slice(0, 120);
      }

      const updatedDraft: GmailFixtureDraft = {
        ...current,
        threadId,
        raw: args.raw,
      };
      state.drafts[draftIndex] = updatedDraft;

      return this.toDraftResponse(state, updatedDraft);
    });
  }

  async sendDraft(args: GmailSendDraftArgs): Promise<GmailSendDraftResponse> {
    const method = "gmail.users.drafts.send";
    const normalizedArgs = {
      namespace: args.namespace,
      draftId: args.draftId,
    };

    return this.runGmailCachedOperation(args, method, normalizedArgs, (state) => {
      const draftIndex = state.drafts.findIndex((entry) => entry.id === args.draftId);
      if (draftIndex < 0) {
        throw new Error("draft_not_found");
      }

      const draft = state.drafts[draftIndex];
      if (!draft) {
        throw new Error("draft_not_found");
      }
      const parsed = parseRawMessage(draft.raw);
      state.sentCount += 1;
      state.historyCounter += 1;
      const sentMessageId = `msg_sent_draft_${state.sentCount}`;

      state.messages.unshift({
        id: sentMessageId,
        threadId: draft.threadId,
        from: "automation@example.com",
        to: parsed.to,
        subject: parsed.subject || "(no subject)",
        snippet: parsed.body.slice(0, 120),
        body: parsed.body,
        unread: false,
        historyId: String(state.historyCounter),
        labelIds: ["SENT"],
      });

      state.drafts.splice(draftIndex, 1);

      const response: GmailSendDraftResponse = {
        id: sentMessageId,
        threadId: draft.threadId,
      };
      return response;
    });
  }

  async batchModifyMessages(
    args: GmailBatchModifyMessagesArgs,
  ): Promise<GmailBatchModifyMessagesResponse> {
    const method = "gmail.users.messages.batchModify";
    const normalizedArgs = {
      namespace: args.namespace,
      messageIds: args.messageIds,
      addLabelIds: args.addLabelIds ?? [],
      removeLabelIds: args.removeLabelIds ?? [],
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const existing = this.getIdempotent<GmailBatchModifyMessagesResponse>(
        state,
        args.idempotencyKey,
      );
      if (existing) {
        this.captureOk(args.namespace, method, normalizedArgs, existing, args.idempotencyKey);
        return existing;
      }

      const targets = new Set(args.messageIds);
      let modifiedCount = 0;
      for (const message of state.messages) {
        if (!targets.has(message.id)) {
          continue;
        }
        modifiedCount += 1;
        const labels = new Set(message.labelIds);
        for (const label of args.addLabelIds ?? []) {
          labels.add(label);
        }
        for (const label of args.removeLabelIds ?? []) {
          labels.delete(label);
        }
        message.labelIds = [...labels];
      }

      state.historyCounter += 1;
      const response: GmailBatchModifyMessagesResponse = {
        modifiedCount,
      };

      this.setIdempotent(state, args.idempotencyKey, response);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listHistory(args: GmailListHistoryArgs): Promise<GmailListHistoryResponse> {
    const method = "gmail.users.history.list";
    const normalizedArgs = {
      namespace: args.namespace,
      startHistoryId: args.startHistoryId,
      maxResults: args.maxResults,
      labelId: args.labelId,
      pageToken: args.pageToken,
      historyTypes: args.historyTypes ?? [],
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const start = Number.parseInt(args.startHistoryId, 10);
      if (!Number.isFinite(start)) {
        throw new Error("invalid_start_history_id");
      }

      const limit = Math.max(1, Math.min(100, Number(args.maxResults) || 20));
      const startOffset = Math.max(0, Number.parseInt(args.pageToken ?? "0", 10) || 0);
      const wantsMessageAdded =
        !args.historyTypes || args.historyTypes.length === 0
          ? true
          : args.historyTypes.includes("messageAdded");
      const filtered = state.messages
        .filter((message) => {
          const historyId = Number.parseInt(message.historyId, 10);
          if (!Number.isFinite(historyId) || historyId <= start) {
            return false;
          }
          if (args.labelId) {
            return message.labelIds.includes(args.labelId);
          }
          return true;
        })
        .slice(startOffset, startOffset + limit);

      const history: GmailHistoryRecord[] = filtered.map((message) => {
        const messageStub = {
          id: message.id,
          threadId: message.threadId,
          labelIds: [...message.labelIds],
          internalDate: message.internalDate ?? message.historyId,
        };
        return {
          id: message.historyId,
          messages: [messageStub],
          ...(wantsMessageAdded
            ? {
                messagesAdded: [
                  {
                    message: messageStub,
                  },
                ],
              }
            : {}),
        };
      });
      const remaining = state.messages.filter((message) => {
        const historyId = Number.parseInt(message.historyId, 10);
        if (!Number.isFinite(historyId) || historyId <= start) {
          return false;
        }
        if (args.labelId) {
          return message.labelIds.includes(args.labelId);
        }
        return true;
      });

      const response: GmailListHistoryResponse = {
        history,
        historyId: String(state.historyCounter),
        ...(startOffset + filtered.length < remaining.length
          ? { nextPageToken: String(startOffset + filtered.length) }
          : {}),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async watch(args: GmailWatchArgs): Promise<GmailWatchResponse> {
    const method = "gmail.users.watch";
    const normalizedArgs = {
      namespace: args.namespace,
      topicName: args.topicName,
      labelIds: args.labelIds ?? [],
      labelFilterBehavior: args.labelFilterBehavior ?? "include",
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const existing = this.getIdempotent<GmailWatchResponse>(state, args.idempotencyKey);
      if (existing) {
        this.captureOk(args.namespace, method, normalizedArgs, existing, args.idempotencyKey);
        return existing;
      }
      if (args.topicName.trim().length === 0) {
        throw new Error("invalid_topic_name");
      }

      state.historyCounter += 1;
      const response: GmailWatchResponse = {
        historyId: String(state.historyCounter),
        expiration: String(Date.now() + 86_400_000),
      };

      state.watches = [
        {
          topicName: args.topicName,
          labelIds: [...(args.labelIds ?? [])],
          labelFilterBehavior: args.labelFilterBehavior ?? "include",
          historyId: response.historyId ?? String(state.historyCounter),
          expiration: response.expiration ?? String(Date.now() + 86_400_000),
        },
      ];

      this.setIdempotent(state, args.idempotencyKey, response);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async stopWatch(args: GmailStopWatchArgs): Promise<GmailStopWatchResponse> {
    const method = "gmail.users.stop";
    const normalizedArgs = { namespace: args.namespace };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const existing = this.getIdempotent<GmailStopWatchResponse>(state, args.idempotencyKey);
      if (existing) {
        this.captureOk(args.namespace, method, normalizedArgs, existing, args.idempotencyKey);
        return existing;
      }

      state.watches = [];
      const response: GmailStopWatchResponse = { stopped: true };
      this.setIdempotent(state, args.idempotencyKey, response);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async trashThread(args: GmailTrashThreadArgs): Promise<GmailTrashThreadResponse> {
    const method = "gmail.users.threads.trash";
    const normalizedArgs = {
      namespace: args.namespace,
      threadId: args.threadId,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const existing = this.getIdempotent<GmailTrashThreadResponse>(state, args.idempotencyKey);
      if (existing) {
        this.captureOk(args.namespace, method, normalizedArgs, existing, args.idempotencyKey);
        return existing;
      }

      const threadMessages = state.messages.filter((message) => message.threadId === args.threadId);
      if (threadMessages.length === 0) {
        throw new Error("thread_not_found");
      }

      for (const message of threadMessages) {
        const labels = new Set(message.labelIds);
        labels.add("TRASH");
        labels.delete("INBOX");
        message.labelIds = [...labels];
      }

      state.historyCounter += 1;
      const response: GmailTrashThreadResponse = {
        id: args.threadId,
        historyId: String(state.historyCounter),
      };

      this.setIdempotent(state, args.idempotencyKey, response);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async untrashThread(args: GmailUntrashThreadArgs): Promise<GmailUntrashThreadResponse> {
    const method = "gmail.users.threads.untrash";
    const normalizedArgs = {
      namespace: args.namespace,
      threadId: args.threadId,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const existing = this.getIdempotent<GmailUntrashThreadResponse>(state, args.idempotencyKey);
      if (existing) {
        this.captureOk(args.namespace, method, normalizedArgs, existing, args.idempotencyKey);
        return existing;
      }

      const threadMessages = state.messages.filter((message) => message.threadId === args.threadId);
      if (threadMessages.length === 0) {
        throw new Error("thread_not_found");
      }

      for (const message of threadMessages) {
        const labels = new Set(message.labelIds);
        labels.delete("TRASH");
        labels.add("INBOX");
        message.labelIds = [...labels];
      }

      state.historyCounter += 1;
      const response: GmailUntrashThreadResponse = {
        id: args.threadId,
        historyId: String(state.historyCounter),
      };

      this.setIdempotent(state, args.idempotencyKey, response);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async trashMessage(args: GmailTrashMessageArgs): Promise<GmailTrashMessageResponse> {
    const method = "gmail.users.messages.trash";
    const normalizedArgs = {
      namespace: args.namespace,
      messageId: args.messageId,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const existing = this.getIdempotent<GmailTrashMessageResponse>(state, args.idempotencyKey);
      if (existing) {
        this.captureOk(args.namespace, method, normalizedArgs, existing, args.idempotencyKey);
        return existing;
      }

      const message = state.messages.find((entry) => entry.id === args.messageId);
      if (!message) {
        throw new Error("message_not_found");
      }
      const labels = new Set(message.labelIds);
      labels.add("TRASH");
      labels.delete("INBOX");
      message.labelIds = [...labels];

      state.historyCounter += 1;
      const response: GmailTrashMessageResponse = {
        id: message.id,
        threadId: message.threadId,
      };

      this.setIdempotent(state, args.idempotencyKey, response);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async untrashMessage(args: GmailUntrashMessageArgs): Promise<GmailUntrashMessageResponse> {
    const method = "gmail.users.messages.untrash";
    const normalizedArgs = {
      namespace: args.namespace,
      messageId: args.messageId,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const existing = this.getIdempotent<GmailUntrashMessageResponse>(state, args.idempotencyKey);
      if (existing) {
        this.captureOk(args.namespace, method, normalizedArgs, existing, args.idempotencyKey);
        return existing;
      }

      const message = state.messages.find((entry) => entry.id === args.messageId);
      if (!message) {
        throw new Error("message_not_found");
      }
      const labels = new Set(message.labelIds);
      labels.delete("TRASH");
      labels.add("INBOX");
      message.labelIds = [...labels];

      state.historyCounter += 1;
      const response: GmailUntrashMessageResponse = {
        id: message.id,
        threadId: message.threadId,
      };

      this.setIdempotent(state, args.idempotencyKey, response);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async downloadAttachment(
    args: GmailDownloadAttachmentArgs,
  ): Promise<GmailDownloadAttachmentResponse> {
    const method = "gmail.users.messages.attachments.get";
    const normalizedArgs = {
      namespace: args.namespace,
      messageId: args.messageId,
      attachmentId: args.attachmentId,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const attachment = state.attachments.find(
        (entry) => entry.messageId === args.messageId && entry.attachmentId === args.attachmentId,
      );
      if (!attachment) {
        throw new Error("attachment_not_found");
      }

      const response: GmailDownloadAttachmentResponse = {
        attachmentId: attachment.attachmentId,
        data: attachment.data,
        size: attachment.size,
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async deleteDraft(args: GmailDeleteDraftArgs): Promise<GmailDeleteDraftResponse> {
    const method = "gmail.users.drafts.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      draftId: args.draftId,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const existing = this.getIdempotent<GmailDeleteDraftResponse>(state, args.idempotencyKey);
      if (existing) {
        this.captureOk(args.namespace, method, normalizedArgs, existing, args.idempotencyKey);
        return existing;
      }

      const index = state.drafts.findIndex((draft) => draft.id === args.draftId);
      if (index < 0) {
        throw new Error("draft_not_found");
      }
      const [deletedDraft] = state.drafts.splice(index, 1);
      if (deletedDraft) {
        state.messages = state.messages.filter((message) => message.id !== deletedDraft.messageId);
      }

      const response: GmailDeleteDraftResponse = {
        deleted: true,
        draftId: args.draftId,
      };

      this.setIdempotent(state, args.idempotencyKey, response);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listFilters(args: GmailListFiltersArgs): Promise<GmailListFiltersResponse> {
    const method = "gmail.users.settings.filters.list";
    const normalizedArgs = {
      namespace: args.namespace,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const response: GmailListFiltersResponse = {
        filter: state.filters.map((entry) => ({
          id: entry.id,
          criteria: { ...entry.criteria },
          action: {
            ...(entry.action.addLabelIds ? { addLabelIds: [...entry.action.addLabelIds] } : {}),
            ...(entry.action.removeLabelIds
              ? { removeLabelIds: [...entry.action.removeLabelIds] }
              : {}),
            ...(entry.action.forward ? { forward: entry.action.forward } : {}),
          },
        })),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createFilter(args: GmailCreateFilterArgs): Promise<GmailCreateFilterResponse> {
    const method = "gmail.users.settings.filters.create";
    const normalizedArgs = {
      namespace: args.namespace,
      criteria: args.criteria,
      action: args.action,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const existing = this.getIdempotent<GmailCreateFilterResponse>(state, args.idempotencyKey);
      if (existing) {
        this.captureOk(args.namespace, method, normalizedArgs, existing, args.idempotencyKey);
        return existing;
      }

      const criteria =
        args.criteria && typeof args.criteria === "object" ? { ...args.criteria } : {};
      const action = args.action && typeof args.action === "object" ? { ...args.action } : {};
      if (Object.keys(criteria).length === 0 || Object.keys(action).length === 0) {
        throw new Error("invalid_filter");
      }

      state.filterCount += 1;
      const created: GmailFixtureFilter = {
        id: `filter_${state.filterCount}`,
        criteria: {
          ...(typeof criteria.from === "string" ? { from: criteria.from } : {}),
          ...(typeof criteria.to === "string" ? { to: criteria.to } : {}),
          ...(typeof criteria.subject === "string" ? { subject: criteria.subject } : {}),
          ...(typeof criteria.query === "string" ? { query: criteria.query } : {}),
          ...(typeof criteria.negatedQuery === "string"
            ? { negatedQuery: criteria.negatedQuery }
            : {}),
          ...(typeof criteria.hasAttachment === "boolean"
            ? { hasAttachment: criteria.hasAttachment }
            : {}),
          ...(criteria.sizeComparison === "larger" || criteria.sizeComparison === "smaller"
            ? { sizeComparison: criteria.sizeComparison }
            : {}),
          ...(typeof criteria.size === "number" ? { size: Number(criteria.size) } : {}),
        },
        action: {
          ...(Array.isArray(action.addLabelIds)
            ? { addLabelIds: action.addLabelIds.map((entry) => String(entry)) }
            : {}),
          ...(Array.isArray(action.removeLabelIds)
            ? { removeLabelIds: action.removeLabelIds.map((entry) => String(entry)) }
            : {}),
          ...(typeof action.forward === "string" ? { forward: action.forward } : {}),
        },
      };
      state.filters.unshift(created);

      const response: GmailCreateFilterResponse = {
        id: created.id,
        criteria: { ...created.criteria },
        action: {
          ...(created.action.addLabelIds ? { addLabelIds: [...created.action.addLabelIds] } : {}),
          ...(created.action.removeLabelIds
            ? { removeLabelIds: [...created.action.removeLabelIds] }
            : {}),
          ...(created.action.forward ? { forward: created.action.forward } : {}),
        },
      };

      this.setIdempotent(state, args.idempotencyKey, response);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async deleteFilter(args: GmailDeleteFilterArgs): Promise<GmailDeleteFilterResponse> {
    const method = "gmail.users.settings.filters.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      filterId: args.filterId,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const existing = this.getIdempotent<GmailDeleteFilterResponse>(state, args.idempotencyKey);
      if (existing) {
        this.captureOk(args.namespace, method, normalizedArgs, existing, args.idempotencyKey);
        return existing;
      }

      const index = state.filters.findIndex((entry) => entry.id === args.filterId);
      if (index < 0) {
        throw new Error("filter_not_found");
      }
      state.filters.splice(index, 1);

      const response: GmailDeleteFilterResponse = {
        deleted: true,
        filterId: args.filterId,
      };

      this.setIdempotent(state, args.idempotencyKey, response);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getFilter(args: GmailGetFilterArgs): Promise<GmailGetFilterResponse> {
    const method = "gmail.users.settings.filters.get";
    const normalizedArgs = {
      namespace: args.namespace,
      filterId: args.filterId,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const filter = state.filters.find((entry) => entry.id === args.filterId);
      if (!filter) {
        throw new Error("filter_not_found");
      }

      const response: GmailGetFilterResponse = {
        id: filter.id,
        criteria: { ...filter.criteria },
        action: {
          ...(filter.action.addLabelIds ? { addLabelIds: [...filter.action.addLabelIds] } : {}),
          ...(filter.action.removeLabelIds
            ? { removeLabelIds: [...filter.action.removeLabelIds] }
            : {}),
          ...(filter.action.forward ? { forward: filter.action.forward } : {}),
        },
      };
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listSendAsAliases(
    args: GmailListSendAsAliasesArgs,
  ): Promise<GmailListSendAsAliasesResponse> {
    const method = "gmail.users.settings.sendAs.list";
    const normalizedArgs = {
      namespace: args.namespace,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const response: GmailListSendAsAliasesResponse = {
        sendAs: state.sendAsAliases.map((alias) => ({
          sendAsEmail: alias.sendAsEmail,
          displayName: alias.displayName,
          ...(alias.replyToAddress ? { replyToAddress: alias.replyToAddress } : {}),
          ...(alias.signature ? { signature: alias.signature } : {}),
          isPrimary: alias.isPrimary,
          isDefault: alias.isDefault,
          treatAsAlias: alias.treatAsAlias,
        })),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getSendAsAlias(args: GmailGetSendAsAliasArgs): Promise<GmailGetSendAsAliasResponse> {
    const method = "gmail.users.settings.sendAs.get";
    const normalizedArgs = {
      namespace: args.namespace,
      sendAsEmail: args.sendAsEmail,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const alias = state.sendAsAliases.find((entry) => entry.sendAsEmail === args.sendAsEmail);
      if (!alias) {
        throw new Error("send_as_not_found");
      }

      const response: GmailGetSendAsAliasResponse = {
        sendAsEmail: alias.sendAsEmail,
        displayName: alias.displayName,
        ...(alias.replyToAddress ? { replyToAddress: alias.replyToAddress } : {}),
        ...(alias.signature ? { signature: alias.signature } : {}),
        isPrimary: alias.isPrimary,
        isDefault: alias.isDefault,
        treatAsAlias: alias.treatAsAlias,
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async updateSendAsAlias(
    args: GmailUpdateSendAsAliasArgs,
  ): Promise<GmailUpdateSendAsAliasResponse> {
    const method = "gmail.users.settings.sendAs.update";
    const normalizedArgs = {
      namespace: args.namespace,
      sendAsEmail: args.sendAsEmail,
      displayName: args.displayName,
      replyToAddress: args.replyToAddress,
      signature: args.signature,
      treatAsAlias: args.treatAsAlias,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const existing = this.getIdempotent<GmailUpdateSendAsAliasResponse>(
        state,
        args.idempotencyKey,
      );
      if (existing) {
        this.captureOk(args.namespace, method, normalizedArgs, existing, args.idempotencyKey);
        return existing;
      }

      const alias = state.sendAsAliases.find((entry) => entry.sendAsEmail === args.sendAsEmail);
      if (!alias) {
        throw new Error("send_as_not_found");
      }

      if (typeof args.displayName === "string" && args.displayName.length > 0) {
        alias.displayName = args.displayName;
      }
      if (typeof args.replyToAddress === "string" && args.replyToAddress.length > 0) {
        alias.replyToAddress = args.replyToAddress;
      }
      if (typeof args.signature === "string" && args.signature.length > 0) {
        alias.signature = args.signature;
      }
      if (typeof args.treatAsAlias === "boolean") {
        alias.treatAsAlias = args.treatAsAlias;
      }

      const response: GmailUpdateSendAsAliasResponse = {
        sendAsEmail: alias.sendAsEmail,
        displayName: alias.displayName,
        ...(alias.replyToAddress ? { replyToAddress: alias.replyToAddress } : {}),
        ...(alias.signature ? { signature: alias.signature } : {}),
        isPrimary: alias.isPrimary,
        isDefault: alias.isDefault,
        treatAsAlias: alias.treatAsAlias,
      };

      this.setIdempotent(state, args.idempotencyKey, response);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getVacation(args: GmailGetVacationArgs): Promise<GmailGetVacationResponse> {
    const method = "gmail.users.settings.getVacation";
    const normalizedArgs = {
      namespace: args.namespace,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const response: GmailGetVacationResponse = {
        enableAutoReply: state.vacation.enableAutoReply,
        responseSubject: state.vacation.responseSubject,
        responseBodyPlainText: state.vacation.responseBodyPlainText,
        responseBodyHtml: state.vacation.responseBodyHtml,
        restrictToContacts: state.vacation.restrictToContacts,
        restrictToDomain: state.vacation.restrictToDomain,
        ...(state.vacation.startTime ? { startTime: state.vacation.startTime } : {}),
        ...(state.vacation.endTime ? { endTime: state.vacation.endTime } : {}),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async updateVacation(args: GmailUpdateVacationArgs): Promise<GmailUpdateVacationResponse> {
    const method = "gmail.users.settings.updateVacation";
    const normalizedArgs = {
      namespace: args.namespace,
      vacation: args.vacation,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const existing = this.getIdempotent<GmailUpdateVacationResponse>(state, args.idempotencyKey);
      if (existing) {
        this.captureOk(args.namespace, method, normalizedArgs, existing, args.idempotencyKey);
        return existing;
      }

      state.vacation = {
        enableAutoReply: Boolean(args.vacation.enableAutoReply),
        responseSubject: String(args.vacation.responseSubject ?? ""),
        responseBodyPlainText: String(args.vacation.responseBodyPlainText ?? ""),
        responseBodyHtml: String(args.vacation.responseBodyHtml ?? ""),
        restrictToContacts: Boolean(args.vacation.restrictToContacts),
        restrictToDomain: Boolean(args.vacation.restrictToDomain),
        ...(args.vacation.startTime ? { startTime: String(args.vacation.startTime) } : {}),
        ...(args.vacation.endTime ? { endTime: String(args.vacation.endTime) } : {}),
      };

      const response: GmailUpdateVacationResponse = {
        enableAutoReply: state.vacation.enableAutoReply,
        responseSubject: state.vacation.responseSubject,
        responseBodyPlainText: state.vacation.responseBodyPlainText,
        responseBodyHtml: state.vacation.responseBodyHtml,
        restrictToContacts: state.vacation.restrictToContacts,
        restrictToDomain: state.vacation.restrictToDomain,
        ...(state.vacation.startTime ? { startTime: state.vacation.startTime } : {}),
        ...(state.vacation.endTime ? { endTime: state.vacation.endTime } : {}),
      };

      this.setIdempotent(state, args.idempotencyKey, response);
      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getLabel(args: GmailGetLabelArgs): Promise<GmailGetLabelResponse> {
    const method = "gmail.users.labels.get";
    const normalizedArgs = {
      namespace: args.namespace,
      labelId: args.labelId,
    };

    try {
      this.assertToken(args.accessToken);
      const state = this.getState(args.namespace);
      this.applyFailureFlags(state);

      const label = state.labels.find((entry) => entry.id === args.labelId);
      if (!label) {
        throw new Error("label_not_found");
      }

      const response: GmailGetLabelResponse = this.toLabelResponse(label);
      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  seed(namespace: string, seed: Record<string, unknown>): void {
    const state = this.getState(namespace);

    if (Array.isArray(seed.messages)) {
      state.messages = seed.messages
        .filter((entry): entry is GmailFixtureMessage => {
          return !!entry && typeof entry === "object";
        })
        .map((entry) => ({
          id: String(entry.id ?? ""),
          threadId: String(entry.threadId ?? entry.id ?? ""),
          from: String(entry.from ?? ""),
          to: String(entry.to ?? ""),
          subject: String(entry.subject ?? ""),
          snippet: String(entry.snippet ?? ""),
          body: String(entry.body ?? ""),
          unread: Boolean(entry.unread),
          historyId: String(entry.historyId ?? "1"),
          labelIds: Array.isArray(entry.labelIds)
            ? entry.labelIds.map((label) => String(label))
            : [],
        }));
    }

    if (Array.isArray(seed.labels)) {
      state.labels = seed.labels
        .filter((entry): entry is GmailFixtureLabel => !!entry && typeof entry === "object")
        .map((entry) => ({
          id: String(entry.id ?? ""),
          name: String(entry.name ?? ""),
          type: entry.type === "system" ? "system" : "user",
          labelListVisibility: String(entry.labelListVisibility ?? "labelShow"),
          messageListVisibility: String(entry.messageListVisibility ?? "show"),
          messagesTotal: Number(entry.messagesTotal ?? 0),
          messagesUnread: Number(entry.messagesUnread ?? 0),
          threadsTotal: Number(entry.threadsTotal ?? 0),
          threadsUnread: Number(entry.threadsUnread ?? 0),
        }));
      state.labelCount = state.labels.filter((label) => label.type === "user").length;
    }

    if (Array.isArray(seed.drafts)) {
      state.drafts = seed.drafts
        .filter((entry): entry is GmailFixtureDraft => !!entry && typeof entry === "object")
        .map((entry) => ({
          id: String(entry.id ?? ""),
          messageId: String(entry.messageId ?? ""),
          threadId: String(entry.threadId ?? ""),
          raw: String(entry.raw ?? ""),
        }));
      state.draftCount = state.drafts.length;
    }

    if (Array.isArray(seed.filters)) {
      state.filters = seed.filters
        .filter((entry): entry is GmailFixtureFilter => !!entry && typeof entry === "object")
        .map((entry) => ({
          id: String(entry.id ?? ""),
          criteria:
            entry.criteria && typeof entry.criteria === "object" ? { ...entry.criteria } : {},
          action: entry.action && typeof entry.action === "object" ? { ...entry.action } : {},
        }));
      state.filterCount = state.filters.length;
    }

    if (Array.isArray(seed.sendAsAliases)) {
      state.sendAsAliases = seed.sendAsAliases
        .filter((entry): entry is GmailFixtureSendAsAlias => !!entry && typeof entry === "object")
        .map((entry) => ({
          sendAsEmail: String(entry.sendAsEmail ?? ""),
          displayName: String(entry.displayName ?? ""),
          ...(typeof entry.replyToAddress === "string"
            ? { replyToAddress: entry.replyToAddress }
            : {}),
          ...(typeof entry.signature === "string" ? { signature: entry.signature } : {}),
          isPrimary: Boolean(entry.isPrimary),
          isDefault: Boolean(entry.isDefault),
          treatAsAlias: Boolean(entry.treatAsAlias),
        }));
    }

    if (seed.vacation && typeof seed.vacation === "object") {
      const vacation = seed.vacation as Record<string, unknown>;
      state.vacation = {
        enableAutoReply: Boolean(vacation.enableAutoReply),
        responseSubject: String(vacation.responseSubject ?? ""),
        responseBodyPlainText: String(vacation.responseBodyPlainText ?? ""),
        responseBodyHtml: String(vacation.responseBodyHtml ?? ""),
        restrictToContacts: Boolean(vacation.restrictToContacts),
        restrictToDomain: Boolean(vacation.restrictToDomain),
        ...(typeof vacation.startTime === "string" ? { startTime: vacation.startTime } : {}),
        ...(typeof vacation.endTime === "string" ? { endTime: vacation.endTime } : {}),
      };
    }

    if (Array.isArray(seed.attachments)) {
      state.attachments = seed.attachments
        .filter((entry): entry is GmailFixtureAttachment => !!entry && typeof entry === "object")
        .map((entry) => ({
          attachmentId: String(entry.attachmentId ?? ""),
          messageId: String(entry.messageId ?? ""),
          data: String(entry.data ?? ""),
          size: Number(entry.size ?? 0),
        }));
    }
    if (Array.isArray(seed.watches)) {
      state.watches = seed.watches
        .filter((entry): entry is GmailWatchState => !!entry && typeof entry === "object")
        .map((entry) => ({
          topicName: String(entry.topicName ?? ""),
          labelIds: Array.isArray(entry.labelIds)
            ? entry.labelIds.map((label) => String(label))
            : [],
          labelFilterBehavior: entry.labelFilterBehavior === "exclude" ? "exclude" : "include",
          historyId: String(entry.historyId ?? "1"),
          expiration: String(entry.expiration ?? Date.now() + 86_400_000),
        }));
    }
    if (typeof seed.historyCounter === "number" && Number.isFinite(seed.historyCounter)) {
      state.historyCounter = Math.max(0, Math.floor(seed.historyCounter));
    }

    if (typeof seed.forceRateLimit === "boolean") {
      state.forceRateLimit = seed.forceRateLimit;
    }
    if (typeof seed.forceTimeout === "boolean") {
      state.forceTimeout = seed.forceTimeout;
    }

    const maxSeedHistory = state.messages.reduce<number>((max, message) => {
      const id = Number.parseInt(message.historyId, 10);
      return Number.isFinite(id) ? Math.max(max, id) : max;
    }, state.historyCounter);
    state.historyCounter = Math.max(state.historyCounter, maxSeedHistory);
  }

  protected createDefaultState(): GmailNamespaceState {
    const seededMessages = seedGmailMessages();
    const seededLabels = seedGmailLabels();
    const seededDrafts = seedGmailDrafts();
    const seededFilters = seedGmailFilters();
    const seededSendAsAliases = seedGmailSendAsAliases();
    const seededVacation = seedGmailVacationSettings();
    const seededAttachments = seedGmailAttachments();
    const maxHistory = seededMessages.reduce<number>((max, message) => {
      const id = Number.parseInt(message.historyId, 10);
      return Number.isFinite(id) ? Math.max(max, id) : max;
    }, 0);

    const created: GmailNamespaceState = {
      sentCount: 0,
      labelCount: seededLabels.filter((label) => label.type === "user").length,
      draftCount: seededDrafts.length,
      filterCount: seededFilters.length,
      historyCounter: maxHistory,
      messages: seededMessages,
      labels: seededLabels,
      drafts: seededDrafts,
      filters: seededFilters,
      sendAsAliases: seededSendAsAliases,
      vacation: seededVacation,
      attachments: seededAttachments,
      watches: [],
      forceRateLimit: false,
      forceTimeout: false,
      idempotentResponses: new Map(),
    };

    return created;
  }

  private applyFailureFlags(state: GmailNamespaceState): void {
    if (state.forceRateLimit) {
      throw new Error("rate_limited");
    }
    if (state.forceTimeout) {
      throw new Error("gateway_timeout");
    }
  }

  private assertToken(accessToken: string | null | undefined): void {
    this.assertAccessToken(accessToken);
  }

  private toLabelResponse(label: GmailFixtureLabel): GmailCreateLabelResponse {
    return {
      id: label.id,
      name: label.name,
      type: label.type,
      labelListVisibility: label.labelListVisibility,
      messageListVisibility: label.messageListVisibility,
      messagesTotal: label.messagesTotal,
      messagesUnread: label.messagesUnread,
      threadsTotal: label.threadsTotal,
      threadsUnread: label.threadsUnread,
    };
  }

  private toDraftResponse(state: GmailNamespaceState, draft: GmailFixtureDraft): GmailDraft {
    const draftMessage = state.messages.find((entry) => entry.id === draft.messageId);
    if (!draftMessage) {
      throw new Error("draft_not_found");
    }

    return {
      id: draft.id,
      message: {
        id: draftMessage.id,
        threadId: draftMessage.threadId,
        labelIds: [...draftMessage.labelIds],
        snippet: draftMessage.snippet,
        payload: buildMessagePayload(draftMessage),
      },
    };
  }

  private createDraftEntry(
    state: GmailNamespaceState,
    raw: string,
    threadIdOverride?: string,
  ): GmailFixtureDraft {
    const parsed = parseRawMessage(raw);
    state.draftCount += 1;
    state.historyCounter += 1;

    const messageId = `msg_draft_${state.draftCount}`;
    const threadId = threadIdOverride ?? `thr_draft_${state.draftCount}`;

    state.messages.unshift({
      id: messageId,
      threadId,
      from: "automation@example.com",
      to: parsed.to,
      subject: parsed.subject || "(no subject)",
      snippet: parsed.body.slice(0, 120),
      body: parsed.body,
      unread: false,
      historyId: String(state.historyCounter),
      labelIds: ["DRAFT"],
    });

    const draft: GmailFixtureDraft = {
      id: `dr_${state.draftCount}`,
      messageId,
      threadId,
      raw,
    };
    state.drafts.unshift(draft);
    return draft;
  }

  private getIdempotent<T>(state: GmailNamespaceState, key?: string): T | null {
    if (!key) {
      return null;
    }
    const existing = state.idempotentResponses.get(key);
    if (!existing) {
      return null;
    }
    return existing as T;
  }

  private setIdempotent(state: GmailNamespaceState, key: string | undefined, value: unknown): void {
    if (!key) {
      return;
    }
    state.idempotentResponses.set(key, value);
  }

  private runGmailOperation<TResult>(
    args: { namespace?: string | undefined; accessToken?: string | null | undefined },
    method: string,
    normalizedArgs: unknown,
    execute: (state: GmailNamespaceState) => Promise<TResult> | TResult,
  ): Promise<TResult> {
    return this.runProviderOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      mapError: toProviderSdkError,
      before: (state) => this.applyFailureFlags(state),
      execute,
    });
  }

  private runGmailCachedOperation<TResult>(
    args: {
      namespace?: string | undefined;
      accessToken?: string | null | undefined;
      idempotencyKey?: string | undefined;
    },
    method: string,
    normalizedArgs: unknown,
    execute: (state: GmailNamespaceState) => Promise<TResult> | TResult,
  ): Promise<TResult> {
    return this.runProviderCachedOperation({
      namespace: args.namespace,
      method,
      args: normalizedArgs,
      accessToken: args.accessToken,
      idempotencyKey: args.idempotencyKey,
      mapError: toProviderSdkError,
      before: (state) => this.applyFailureFlags(state),
      getCachedValue: (state) => this.getIdempotent<TResult>(state, args.idempotencyKey),
      setCachedValue: (state, response) => this.setIdempotent(state, args.idempotencyKey, response),
      execute,
    });
  }
}

export const createInMemoryGmailSdk = (options?: {
  callLog?: ProviderSdkCallLog;
}): InMemoryGmailSdk => {
  return new InMemoryGmailSdk(options);
};

export class FakeGmailClientStore {
  private readonly sdk: InMemoryGmailSdk;

  readonly createClient: CreateGmailClient;

  constructor(options?: { callLog?: ProviderSdkCallLog }) {
    this.sdk = new InMemoryGmailSdk(options);
    this.createClient = (accessToken: string, namespace?: string): GmailClient => {
      return createFakeGmailClient(this.sdk, accessToken, namespace);
    };
  }

  reset(namespace?: string): void {
    this.sdk.reset(namespace);
  }

  seed(namespace: string, seedData: Record<string, unknown>): void {
    this.sdk.seed(namespace, seedData);
  }
}

export const createFakeGmailClientStore = (options?: {
  callLog?: ProviderSdkCallLog;
}): FakeGmailClientStore => {
  return new FakeGmailClientStore(options);
};
