import type { gmail_v1 } from "googleapis";
import type { ProviderSdkCallLog, ProviderSdkRuntime } from "../port.js";
import { BaseSdkPort } from "../base-sdk.js";
import {
  createGaxiosSafeFetchAdapter,
  createGaxiosSafeFetchAdapterWithHeaders,
} from "./gaxios-safe-fetch-adapter.js";
import type { CreateGmailClient } from "./client-interface.js";
import { toProviderSdkError } from "./errors.js";
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

export class GmailSdk extends BaseSdkPort<CreateGmailClient> implements GmailSdkPort {
  constructor(options: {
    createClient: CreateGmailClient;
    runtime?: ProviderSdkRuntime;
    callLog?: ProviderSdkCallLog;
  }) {
    super({
      providerId: "google",
      createClient: options.createClient,
      ...(options.runtime ? { runtime: options.runtime } : {}),
      ...(options.callLog ? { callLog: options.callLog } : {}),
    });
  }

  /**
   * Unwrap a Gmail client call and cast its data to the expected Schema type.
   * Our GmailClient interface uses Record<string, unknown> for all endpoints;
   * this helper narrows to the real Gmail SDK Schema type at each call site.
   */
  private async gmailData<T>(call: Promise<{ data: Record<string, unknown> }>): Promise<T> {
    const { data } = await call;
    return data as unknown as T;
  }

  async listMessages(args: GmailListMessagesArgs): Promise<GmailListMessagesResponse> {
    const method = "gmail.users.messages.list";
    const normalizedArgs = {
      namespace: args.namespace,
      query: args.query,
      maxResults: args.maxResults,
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$ListMessagesResponse>(
        gmail.users.messages.list(
          {
            userId: "me",
            q: args.query,
            maxResults: args.maxResults,
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.list_messages", args.namespace),
          },
        ),
      );

      const response: GmailListMessagesResponse = {
        messages: Array.isArray(data.messages) ? data.messages : [],
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getMessage(args: GmailGetMessageArgs): Promise<GmailMessage> {
    const method = "gmail.users.messages.get";
    const normalizedArgs = {
      namespace: args.namespace,
      messageId: args.messageId,
      format: args.format ?? "full",
      metadataHeaders: args.metadataHeaders ?? [],
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Message>(
        gmail.users.messages.get(
          {
            userId: "me",
            id: args.messageId,
            format: args.format ?? "full",
            ...(args.metadataHeaders && args.metadataHeaders.length > 0
              ? { metadataHeaders: args.metadataHeaders }
              : {}),
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.get_message", args.namespace),
          },
        ),
      );

      const response: GmailMessage = {
        id: data.id ?? "",
        threadId: data.threadId ?? "",
        ...(data.snippet ? { snippet: data.snippet } : {}),
        ...(data.payload ? { payload: data.payload } : {}),
        ...(data.historyId ? { historyId: data.historyId } : {}),
        ...(data.internalDate ? { internalDate: data.internalDate } : {}),
        ...(Array.isArray(data.labelIds) ? { labelIds: data.labelIds } : {}),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async sendMessage(args: GmailSendMessageArgs): Promise<GmailSendMessageResponse> {
    const method = "gmail.users.messages.send";
    const normalizedArgs = {
      namespace: args.namespace,
      threadId: args.threadId,
      hasRaw: Boolean(args.raw),
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Message>(
        gmail.users.messages.send(
          {
            userId: "me",
            requestBody: {
              raw: args.raw,
              ...(args.threadId ? { threadId: args.threadId } : {}),
            },
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.send_message",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
            ...(args.idempotencyKey
              ? {
                  headers: {
                    "x-idempotency-key": args.idempotencyKey,
                  },
                }
              : {}),
          },
        ),
      );

      const response: GmailSendMessageResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.threadId ? { threadId: data.threadId } : {}),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async modifyThread(args: GmailModifyThreadArgs): Promise<GmailModifyThreadResponse> {
    const method = "gmail.users.threads.modify";
    const normalizedArgs = {
      namespace: args.namespace,
      threadId: args.threadId,
      addLabelIds: args.addLabelIds ?? [],
      removeLabelIds: args.removeLabelIds ?? [],
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Thread>(
        gmail.users.threads.modify(
          {
            userId: "me",
            id: args.threadId,
            requestBody: {
              ...(args.addLabelIds ? { addLabelIds: args.addLabelIds } : {}),
              ...(args.removeLabelIds ? { removeLabelIds: args.removeLabelIds } : {}),
            },
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.modify_thread",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailModifyThreadResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.historyId ? { historyId: data.historyId } : {}),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async getProfile(args: GmailGetProfileArgs): Promise<GmailProfile> {
    const method = "gmail.users.getProfile";
    const normalizedArgs = {
      namespace: args.namespace,
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Profile>(
        gmail.users.getProfile(
          {
            userId: "me",
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.get_profile", args.namespace),
          },
        ),
      );

      const response: GmailProfile = {
        ...(data.emailAddress ? { emailAddress: data.emailAddress } : {}),
        ...(data.historyId ? { historyId: data.historyId } : {}),
        ...(typeof data.messagesTotal === "number" ? { messagesTotal: data.messagesTotal } : {}),
        ...(typeof data.threadsTotal === "number" ? { threadsTotal: data.threadsTotal } : {}),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getThread(args: GmailGetThreadArgs): Promise<GmailThread> {
    const method = "gmail.users.threads.get";
    const normalizedArgs = {
      namespace: args.namespace,
      threadId: args.threadId,
      format: args.format ?? "full",
      metadataHeaders: args.metadataHeaders ?? [],
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Thread>(
        gmail.users.threads.get(
          {
            userId: "me",
            id: args.threadId,
            format: args.format ?? "full",
            ...(args.metadataHeaders && args.metadataHeaders.length > 0
              ? { metadataHeaders: args.metadataHeaders }
              : {}),
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.get_thread", args.namespace),
          },
        ),
      );

      const response: GmailThread = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.historyId ? { historyId: data.historyId } : {}),
        messages: Array.isArray(data.messages) ? data.messages : [],
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async listLabels(args: GmailListLabelsArgs): Promise<GmailListLabelsResponse> {
    const method = "gmail.users.labels.list";
    const normalizedArgs = {
      namespace: args.namespace,
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$ListLabelsResponse>(
        gmail.users.labels.list(
          {
            userId: "me",
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.list_labels", args.namespace),
          },
        ),
      );

      const response: GmailListLabelsResponse = {
        labels: Array.isArray(data.labels) ? data.labels : [],
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async createLabel(args: GmailCreateLabelArgs): Promise<GmailCreateLabelResponse> {
    const method = "gmail.users.labels.create";
    const normalizedArgs = {
      namespace: args.namespace,
      name: args.name,
      labelListVisibility: args.labelListVisibility,
      messageListVisibility: args.messageListVisibility,
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Label>(
        gmail.users.labels.create(
          {
            userId: "me",
            requestBody: {
              name: args.name,
              ...(args.labelListVisibility
                ? { labelListVisibility: args.labelListVisibility }
                : {}),
              ...(args.messageListVisibility
                ? { messageListVisibility: args.messageListVisibility }
                : {}),
            },
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.create_label",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailCreateLabelResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.name ? { name: data.name } : {}),
        ...(data.type ? { type: data.type } : {}),
        ...(data.labelListVisibility ? { labelListVisibility: data.labelListVisibility } : {}),
        ...(data.messageListVisibility
          ? { messageListVisibility: data.messageListVisibility }
          : {}),
        ...(typeof data.messagesTotal === "number" ? { messagesTotal: data.messagesTotal } : {}),
        ...(typeof data.messagesUnread === "number" ? { messagesUnread: data.messagesUnread } : {}),
        ...(typeof data.threadsTotal === "number" ? { threadsTotal: data.threadsTotal } : {}),
        ...(typeof data.threadsUnread === "number" ? { threadsUnread: data.threadsUnread } : {}),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
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

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Label>(
        gmail.users.labels.update(
          {
            userId: "me",
            id: args.labelId,
            requestBody: {
              ...(args.name ? { name: args.name } : {}),
              ...(args.labelListVisibility
                ? { labelListVisibility: args.labelListVisibility }
                : {}),
              ...(args.messageListVisibility
                ? { messageListVisibility: args.messageListVisibility }
                : {}),
            },
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.update_label",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailUpdateLabelResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.name ? { name: data.name } : {}),
        ...(data.type ? { type: data.type } : {}),
        ...(data.labelListVisibility ? { labelListVisibility: data.labelListVisibility } : {}),
        ...(data.messageListVisibility
          ? { messageListVisibility: data.messageListVisibility }
          : {}),
        ...(typeof data.messagesTotal === "number" ? { messagesTotal: data.messagesTotal } : {}),
        ...(typeof data.messagesUnread === "number" ? { messagesUnread: data.messagesUnread } : {}),
        ...(typeof data.threadsTotal === "number" ? { threadsTotal: data.threadsTotal } : {}),
        ...(typeof data.threadsUnread === "number" ? { threadsUnread: data.threadsUnread } : {}),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async deleteLabel(args: GmailDeleteLabelArgs): Promise<GmailDeleteLabelResponse> {
    const method = "gmail.users.labels.delete";
    const normalizedArgs = {
      namespace: args.namespace,
      labelId: args.labelId,
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      await gmail.users.labels.delete(
        {
          userId: "me",
          id: args.labelId,
        },
        {
          adapter: createGaxiosSafeFetchAdapterWithHeaders(
            "gmail.sdk.delete_label",
            args.namespace,
            args.idempotencyKey
              ? {
                  "x-idempotency-key": args.idempotencyKey,
                }
              : undefined,
          ),
        },
      );

      const response: GmailDeleteLabelResponse = {
        deleted: true,
        labelId: args.labelId,
      };

      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async createDraft(args: GmailCreateDraftArgs): Promise<GmailCreateDraftResponse> {
    const method = "gmail.users.drafts.create";
    const normalizedArgs = {
      namespace: args.namespace,
      threadId: args.threadId,
      hasRaw: Boolean(args.raw),
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Draft>(
        gmail.users.drafts.create(
          {
            userId: "me",
            requestBody: {
              message: {
                raw: args.raw,
                ...(args.threadId ? { threadId: args.threadId } : {}),
              },
            },
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.create_draft",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailCreateDraftResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.message ? { message: data.message } : {}),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async listDrafts(args: GmailListDraftsArgs): Promise<GmailListDraftsResponse> {
    const method = "gmail.users.drafts.list";
    const normalizedArgs = {
      namespace: args.namespace,
      maxResults: args.maxResults,
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$ListDraftsResponse>(
        gmail.users.drafts.list(
          {
            userId: "me",
            maxResults: args.maxResults,
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.list_drafts", args.namespace),
          },
        ),
      );

      const response: GmailListDraftsResponse = {
        drafts: Array.isArray(data.drafts) ? data.drafts : [],
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async getDraft(args: GmailGetDraftArgs): Promise<GmailGetDraftResponse> {
    const method = "gmail.users.drafts.get";
    const normalizedArgs = {
      namespace: args.namespace,
      draftId: args.draftId,
      format: args.format ?? "full",
      metadataHeaders: args.metadataHeaders ?? [],
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Draft>(
        gmail.users.drafts.get(
          {
            userId: "me",
            id: args.draftId,
            format: args.format ?? "full",
            ...(args.metadataHeaders && args.metadataHeaders.length > 0
              ? { metadataHeaders: args.metadataHeaders }
              : {}),
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.get_draft", args.namespace),
          },
        ),
      );

      const response: GmailGetDraftResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.message ? { message: data.message } : {}),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }

  async updateDraft(args: GmailUpdateDraftArgs): Promise<GmailUpdateDraftResponse> {
    const method = "gmail.users.drafts.update";
    const normalizedArgs = {
      namespace: args.namespace,
      draftId: args.draftId,
      threadId: args.threadId,
      hasRaw: Boolean(args.raw),
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Draft>(
        gmail.users.drafts.update(
          {
            userId: "me",
            id: args.draftId,
            requestBody: {
              id: args.draftId,
              message: {
                raw: args.raw,
                ...(args.threadId ? { threadId: args.threadId } : {}),
              },
            },
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.update_draft",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailUpdateDraftResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.message ? { message: data.message } : {}),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
  }

  async sendDraft(args: GmailSendDraftArgs): Promise<GmailSendDraftResponse> {
    const method = "gmail.users.drafts.send";
    const normalizedArgs = {
      namespace: args.namespace,
      draftId: args.draftId,
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Message>(
        gmail.users.drafts.send(
          {
            userId: "me",
            requestBody: {
              id: args.draftId,
            },
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.send_draft",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailSendDraftResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.threadId ? { threadId: data.threadId } : {}),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response, args.idempotencyKey);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError, args.idempotencyKey);
      throw sdkError;
    }
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
      const gmail = this.createClient(args.accessToken, args.namespace);
      await gmail.users.messages.batchModify(
        {
          userId: "me",
          requestBody: {
            ids: args.messageIds,
            ...(args.addLabelIds ? { addLabelIds: args.addLabelIds } : {}),
            ...(args.removeLabelIds ? { removeLabelIds: args.removeLabelIds } : {}),
          },
        },
        {
          adapter: createGaxiosSafeFetchAdapterWithHeaders(
            "gmail.sdk.batch_modify_messages",
            args.namespace,
            args.idempotencyKey
              ? {
                  "x-idempotency-key": args.idempotencyKey,
                }
              : undefined,
          ),
        },
      );

      const response: GmailBatchModifyMessagesResponse = {
        modifiedCount: args.messageIds.length,
      };

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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$ListHistoryResponse>(
        gmail.users.history.list(
          {
            userId: "me",
            startHistoryId: args.startHistoryId,
            maxResults: args.maxResults,
            ...(args.labelId ? { labelId: args.labelId } : {}),
            ...(args.pageToken ? { pageToken: args.pageToken } : {}),
            ...(args.historyTypes && args.historyTypes.length > 0
              ? { historyTypes: args.historyTypes }
              : {}),
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.list_history", args.namespace),
          },
        ),
      );

      const response: GmailListHistoryResponse = {
        history: Array.isArray(data.history) ? data.history : [],
        ...(data.historyId ? { historyId: data.historyId } : {}),
        ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
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
      labelFilterBehavior: args.labelFilterBehavior,
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$WatchResponse>(
        gmail.users.watch(
          {
            userId: "me",
            requestBody: {
              topicName: args.topicName,
              ...(args.labelIds ? { labelIds: args.labelIds } : {}),
              ...(args.labelFilterBehavior
                ? { labelFilterBehavior: args.labelFilterBehavior }
                : {}),
            },
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.watch",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailWatchResponse = {
        ...(data.historyId ? { historyId: data.historyId } : {}),
        ...(data.expiration ? { expiration: data.expiration } : {}),
      };

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
    const normalizedArgs = {
      namespace: args.namespace,
    };

    try {
      const gmail = this.createClient(args.accessToken, args.namespace);
      await gmail.users.stop(
        {
          userId: "me",
        },
        {
          adapter: createGaxiosSafeFetchAdapterWithHeaders(
            "gmail.sdk.stop_watch",
            args.namespace,
            args.idempotencyKey
              ? {
                  "x-idempotency-key": args.idempotencyKey,
                }
              : undefined,
          ),
        },
      );

      const response: GmailStopWatchResponse = {
        stopped: true,
      };

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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Thread>(
        gmail.users.threads.trash(
          {
            userId: "me",
            id: args.threadId,
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.trash_thread",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailTrashThreadResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.historyId ? { historyId: data.historyId } : {}),
      };

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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Thread>(
        gmail.users.threads.untrash(
          {
            userId: "me",
            id: args.threadId,
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.untrash_thread",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailUntrashThreadResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.historyId ? { historyId: data.historyId } : {}),
      };

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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Message>(
        gmail.users.messages.trash(
          {
            userId: "me",
            id: args.messageId,
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.trash_message",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailTrashMessageResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.threadId ? { threadId: data.threadId } : {}),
      };

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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Message>(
        gmail.users.messages.untrash(
          {
            userId: "me",
            id: args.messageId,
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.untrash_message",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailUntrashMessageResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.threadId ? { threadId: data.threadId } : {}),
      };

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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$MessagePartBody>(
        gmail.users.messages.attachments.get(
          {
            userId: "me",
            messageId: args.messageId,
            id: args.attachmentId,
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.download_attachment", args.namespace),
          },
        ),
      );

      const response: GmailDownloadAttachmentResponse = {
        ...(data.attachmentId ? { attachmentId: data.attachmentId } : {}),
        ...(data.data ? { data: data.data } : {}),
        ...(typeof data.size === "number" ? { size: data.size } : {}),
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
      const gmail = this.createClient(args.accessToken, args.namespace);
      await gmail.users.drafts.delete(
        {
          userId: "me",
          id: args.draftId,
        },
        {
          adapter: createGaxiosSafeFetchAdapterWithHeaders(
            "gmail.sdk.delete_draft",
            args.namespace,
            args.idempotencyKey
              ? {
                  "x-idempotency-key": args.idempotencyKey,
                }
              : undefined,
          ),
        },
      );

      const response: GmailDeleteDraftResponse = {
        deleted: true,
        draftId: args.draftId,
      };

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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$ListFiltersResponse>(
        gmail.users.settings.filters.list(
          {
            userId: "me",
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.list_filters", args.namespace),
          },
        ),
      );

      const response: GmailListFiltersResponse = {
        filter: Array.isArray(data.filter) ? data.filter : [],
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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Filter>(
        gmail.users.settings.filters.create(
          {
            userId: "me",
            requestBody: {
              criteria: args.criteria,
              action: args.action,
            },
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.create_filter",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailCreateFilterResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.criteria ? { criteria: data.criteria } : {}),
        ...(data.action ? { action: data.action } : {}),
      };

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
      const gmail = this.createClient(args.accessToken, args.namespace);
      await gmail.users.settings.filters.delete(
        {
          userId: "me",
          id: args.filterId,
        },
        {
          adapter: createGaxiosSafeFetchAdapterWithHeaders(
            "gmail.sdk.delete_filter",
            args.namespace,
            args.idempotencyKey
              ? {
                  "x-idempotency-key": args.idempotencyKey,
                }
              : undefined,
          ),
        },
      );

      const response: GmailDeleteFilterResponse = {
        deleted: true,
        filterId: args.filterId,
      };

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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Filter>(
        gmail.users.settings.filters.get(
          {
            userId: "me",
            id: args.filterId,
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.get_filter", args.namespace),
          },
        ),
      );

      const response: GmailGetFilterResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.criteria ? { criteria: data.criteria } : {}),
        ...(data.action ? { action: data.action } : {}),
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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$ListSendAsResponse>(
        gmail.users.settings.sendAs.list(
          {
            userId: "me",
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.list_send_as_aliases", args.namespace),
          },
        ),
      );

      const response: GmailListSendAsAliasesResponse = {
        sendAs: Array.isArray(data.sendAs) ? data.sendAs : [],
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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$SendAs>(
        gmail.users.settings.sendAs.get(
          {
            userId: "me",
            sendAsEmail: args.sendAsEmail,
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.get_send_as_alias", args.namespace),
          },
        ),
      );

      const response: GmailGetSendAsAliasResponse = {
        ...(data.sendAsEmail ? { sendAsEmail: data.sendAsEmail } : {}),
        ...(data.displayName ? { displayName: data.displayName } : {}),
        ...(data.replyToAddress ? { replyToAddress: data.replyToAddress } : {}),
        ...(typeof data.isPrimary === "boolean" ? { isPrimary: data.isPrimary } : {}),
        ...(typeof data.isDefault === "boolean" ? { isDefault: data.isDefault } : {}),
        ...(typeof data.treatAsAlias === "boolean" ? { treatAsAlias: data.treatAsAlias } : {}),
        ...(data.signature ? { signature: data.signature } : {}),
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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$SendAs>(
        gmail.users.settings.sendAs.update(
          {
            userId: "me",
            sendAsEmail: args.sendAsEmail,
            requestBody: {
              ...(typeof args.displayName === "string" ? { displayName: args.displayName } : {}),
              ...(typeof args.replyToAddress === "string"
                ? { replyToAddress: args.replyToAddress }
                : {}),
              ...(typeof args.signature === "string" ? { signature: args.signature } : {}),
              ...(typeof args.treatAsAlias === "boolean"
                ? { treatAsAlias: args.treatAsAlias }
                : {}),
            },
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.update_send_as_alias",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailUpdateSendAsAliasResponse = {
        ...(data.sendAsEmail ? { sendAsEmail: data.sendAsEmail } : {}),
        ...(data.displayName ? { displayName: data.displayName } : {}),
        ...(data.replyToAddress ? { replyToAddress: data.replyToAddress } : {}),
        ...(typeof data.isPrimary === "boolean" ? { isPrimary: data.isPrimary } : {}),
        ...(typeof data.isDefault === "boolean" ? { isDefault: data.isDefault } : {}),
        ...(typeof data.treatAsAlias === "boolean" ? { treatAsAlias: data.treatAsAlias } : {}),
        ...(data.signature ? { signature: data.signature } : {}),
      };

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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$VacationSettings>(
        gmail.users.settings.getVacation(
          {
            userId: "me",
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.get_vacation", args.namespace),
          },
        ),
      );

      const response: GmailGetVacationResponse = {
        ...(typeof data.enableAutoReply === "boolean"
          ? { enableAutoReply: data.enableAutoReply }
          : {}),
        ...(data.responseSubject ? { responseSubject: data.responseSubject } : {}),
        ...(data.responseBodyPlainText
          ? { responseBodyPlainText: data.responseBodyPlainText }
          : {}),
        ...(data.responseBodyHtml ? { responseBodyHtml: data.responseBodyHtml } : {}),
        ...(typeof data.restrictToContacts === "boolean"
          ? { restrictToContacts: data.restrictToContacts }
          : {}),
        ...(typeof data.restrictToDomain === "boolean"
          ? { restrictToDomain: data.restrictToDomain }
          : {}),
        ...(data.startTime ? { startTime: data.startTime } : {}),
        ...(data.endTime ? { endTime: data.endTime } : {}),
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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$VacationSettings>(
        gmail.users.settings.updateVacation(
          {
            userId: "me",
            requestBody: args.vacation,
          },
          {
            adapter: createGaxiosSafeFetchAdapterWithHeaders(
              "gmail.sdk.update_vacation",
              args.namespace,
              args.idempotencyKey
                ? {
                    "x-idempotency-key": args.idempotencyKey,
                  }
                : undefined,
            ),
          },
        ),
      );

      const response: GmailUpdateVacationResponse = {
        ...(typeof data.enableAutoReply === "boolean"
          ? { enableAutoReply: data.enableAutoReply }
          : {}),
        ...(data.responseSubject ? { responseSubject: data.responseSubject } : {}),
        ...(data.responseBodyPlainText
          ? { responseBodyPlainText: data.responseBodyPlainText }
          : {}),
        ...(data.responseBodyHtml ? { responseBodyHtml: data.responseBodyHtml } : {}),
        ...(typeof data.restrictToContacts === "boolean"
          ? { restrictToContacts: data.restrictToContacts }
          : {}),
        ...(typeof data.restrictToDomain === "boolean"
          ? { restrictToDomain: data.restrictToDomain }
          : {}),
        ...(data.startTime ? { startTime: data.startTime } : {}),
        ...(data.endTime ? { endTime: data.endTime } : {}),
      };

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
      const gmail = this.createClient(args.accessToken, args.namespace);
      const data = await this.gmailData<gmail_v1.Schema$Label>(
        gmail.users.labels.get(
          {
            userId: "me",
            id: args.labelId,
          },
          {
            adapter: createGaxiosSafeFetchAdapter("gmail.sdk.get_label", args.namespace),
          },
        ),
      );

      const response: GmailGetLabelResponse = {
        ...(data.id ? { id: data.id } : {}),
        ...(data.name ? { name: data.name } : {}),
        ...(data.type ? { type: data.type } : {}),
        ...(data.labelListVisibility ? { labelListVisibility: data.labelListVisibility } : {}),
        ...(data.messageListVisibility
          ? { messageListVisibility: data.messageListVisibility }
          : {}),
        ...(typeof data.messagesTotal === "number" ? { messagesTotal: data.messagesTotal } : {}),
        ...(typeof data.messagesUnread === "number" ? { messagesUnread: data.messagesUnread } : {}),
        ...(typeof data.threadsTotal === "number" ? { threadsTotal: data.threadsTotal } : {}),
        ...(typeof data.threadsUnread === "number" ? { threadsUnread: data.threadsUnread } : {}),
      };

      this.captureOk(args.namespace, method, normalizedArgs, response);
      return response;
    } catch (error) {
      const sdkError = toProviderSdkError(method, error);
      this.captureError(args.namespace, method, normalizedArgs, sdkError);
      throw sdkError;
    }
  }
}
