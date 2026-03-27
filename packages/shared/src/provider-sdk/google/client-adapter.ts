import {
  asNumber,
  asRecord,
  asString,
  asStringArray,
  toDataRecord,
  withRequestIdempotencyKey,
} from "../client-adapter-utils.js";
import type { GmailClient } from "./client-interface.js";
import type { InMemoryGmailSdk } from "./fake-client-runtime.js";

export const createFakeGmailClient = (
  sdk: InMemoryGmailSdk,
  accessToken: string,
  namespace?: string,
): GmailClient => {
  return {
    users: {
      messages: {
        list: async (params) => {
          const payload = asRecord(params);
          const data = await sdk.listMessages({
            accessToken,
            namespace,
            query: asString(payload.q),
            maxResults: asNumber(payload.maxResults, 20),
          });
          return { data: toDataRecord(data) };
        },
        get: async (params) => {
          const payload = asRecord(params);
          const metadataHeaders = asStringArray(payload.metadataHeaders);
          const format = asString(payload.format);
          const data = await sdk.getMessage({
            accessToken,
            namespace,
            messageId: asString(payload.id),
            ...(format ? { format: format as "full" | "metadata" } : {}),
            ...(metadataHeaders.length > 0 ? { metadataHeaders } : {}),
          });
          return { data: toDataRecord(data) };
        },
        send: async (params, options) => {
          const payload = asRecord(params);
          const requestBody = asRecord(payload.requestBody);
          const data = await sdk.sendMessage({
            accessToken,
            namespace,
            raw: asString(requestBody.raw),
            ...(asString(requestBody.threadId) ? { threadId: asString(requestBody.threadId) } : {}),
            ...withRequestIdempotencyKey(options),
          });
          return { data: toDataRecord(data) };
        },
        batchModify: async (params, options) => {
          const payload = asRecord(params);
          const requestBody = asRecord(payload.requestBody);
          const data = await sdk.batchModifyMessages({
            accessToken,
            namespace,
            messageIds: asStringArray(requestBody.ids),
            addLabelIds: asStringArray(requestBody.addLabelIds),
            removeLabelIds: asStringArray(requestBody.removeLabelIds),
            ...withRequestIdempotencyKey(options),
          });
          return { data: toDataRecord(data) };
        },
        trash: async (params) => {
          const payload = asRecord(params);
          const data = await sdk.trashMessage({
            accessToken,
            namespace,
            messageId: asString(payload.id),
          });
          return { data: toDataRecord(data) };
        },
        untrash: async (params) => {
          const payload = asRecord(params);
          const data = await sdk.untrashMessage({
            accessToken,
            namespace,
            messageId: asString(payload.id),
          });
          return { data: toDataRecord(data) };
        },
        attachments: {
          get: async (params) => {
            const payload = asRecord(params);
            const data = await sdk.downloadAttachment({
              accessToken,
              namespace,
              messageId: asString(payload.messageId),
              attachmentId: asString(payload.id),
            });
            return { data: toDataRecord(data) };
          },
        },
      },
      threads: {
        modify: async (params, options) => {
          const payload = asRecord(params);
          const requestBody = asRecord(payload.requestBody);
          const data = await sdk.modifyThread({
            accessToken,
            namespace,
            threadId: asString(payload.id),
            addLabelIds: asStringArray(requestBody.addLabelIds),
            removeLabelIds: asStringArray(requestBody.removeLabelIds),
            ...withRequestIdempotencyKey(options),
          });
          return { data: toDataRecord(data) };
        },
        get: async (params) => {
          const payload = asRecord(params);
          const metadataHeaders = asStringArray(payload.metadataHeaders);
          const format = asString(payload.format);
          const data = await sdk.getThread({
            accessToken,
            namespace,
            threadId: asString(payload.id),
            ...(format ? { format: format as "full" | "metadata" } : {}),
            ...(metadataHeaders.length > 0 ? { metadataHeaders } : {}),
          });
          return { data: toDataRecord(data) };
        },
        trash: async (params) => {
          const payload = asRecord(params);
          const data = await sdk.trashThread({
            accessToken,
            namespace,
            threadId: asString(payload.id),
          });
          return { data: toDataRecord(data) };
        },
        untrash: async (params) => {
          const payload = asRecord(params);
          const data = await sdk.untrashThread({
            accessToken,
            namespace,
            threadId: asString(payload.id),
          });
          return { data: toDataRecord(data) };
        },
      },
      getProfile: async () => {
        const data = await sdk.getProfile({ accessToken, namespace });
        return { data: toDataRecord(data) };
      },
      labels: {
        list: async () => {
          const data = await sdk.listLabels({ accessToken, namespace });
          return { data: toDataRecord(data) };
        },
        create: async (params, options) => {
          const payload = asRecord(params);
          const requestBody = asRecord(payload.requestBody);
          const data = await sdk.createLabel({
            accessToken,
            namespace,
            name: asString(requestBody.name),
            ...(asString(requestBody.labelListVisibility)
              ? { labelListVisibility: asString(requestBody.labelListVisibility) }
              : {}),
            ...(asString(requestBody.messageListVisibility)
              ? { messageListVisibility: asString(requestBody.messageListVisibility) }
              : {}),
            ...withRequestIdempotencyKey(options),
          });
          return { data: toDataRecord(data) };
        },
        get: async (params) => {
          const payload = asRecord(params);
          const data = await sdk.getLabel({
            accessToken,
            namespace,
            labelId: asString(payload.id),
          });
          return { data: toDataRecord(data) };
        },
        update: async (params, options) => {
          const payload = asRecord(params);
          const requestBody = asRecord(payload.requestBody);
          const data = await sdk.updateLabel({
            accessToken,
            namespace,
            labelId: asString(payload.id),
            ...(asString(requestBody.name) ? { name: asString(requestBody.name) } : {}),
            ...(asString(requestBody.labelListVisibility)
              ? { labelListVisibility: asString(requestBody.labelListVisibility) }
              : {}),
            ...(asString(requestBody.messageListVisibility)
              ? { messageListVisibility: asString(requestBody.messageListVisibility) }
              : {}),
            ...withRequestIdempotencyKey(options),
          });
          return { data: toDataRecord(data) };
        },
        delete: async (params, options) => {
          const payload = asRecord(params);
          const data = await sdk.deleteLabel({
            accessToken,
            namespace,
            labelId: asString(payload.id),
            ...withRequestIdempotencyKey(options),
          });
          return { data: toDataRecord(data) };
        },
      },
      drafts: {
        create: async (params, options) => {
          const payload = asRecord(params);
          const requestBody = asRecord(payload.requestBody);
          const message = asRecord(requestBody.message);
          const data = await sdk.createDraft({
            accessToken,
            namespace,
            raw: asString(message.raw),
            ...(asString(message.threadId) ? { threadId: asString(message.threadId) } : {}),
            ...withRequestIdempotencyKey(options),
          });
          return { data: toDataRecord(data) };
        },
        list: async (params) => {
          const payload = asRecord(params);
          const data = await sdk.listDrafts({
            accessToken,
            namespace,
            maxResults: asNumber(payload.maxResults, 20),
          });
          return { data: toDataRecord(data) };
        },
        get: async (params) => {
          const payload = asRecord(params);
          const metadataHeaders = asStringArray(payload.metadataHeaders);
          const format = asString(payload.format);
          const data = await sdk.getDraft({
            accessToken,
            namespace,
            draftId: asString(payload.id),
            ...(format ? { format: format as "full" | "metadata" } : {}),
            ...(metadataHeaders.length > 0 ? { metadataHeaders } : {}),
          });
          return { data: toDataRecord(data) };
        },
        update: async (params, options) => {
          const payload = asRecord(params);
          const requestBody = asRecord(payload.requestBody);
          const message = asRecord(requestBody.message);
          const data = await sdk.updateDraft({
            accessToken,
            namespace,
            draftId: asString(payload.id),
            raw: asString(message.raw),
            ...(asString(message.threadId) ? { threadId: asString(message.threadId) } : {}),
            ...withRequestIdempotencyKey(options),
          });
          return { data: toDataRecord(data) };
        },
        send: async (params, options) => {
          const payload = asRecord(params);
          const requestBody = asRecord(payload.requestBody);
          const data = await sdk.sendDraft({
            accessToken,
            namespace,
            draftId: asString(requestBody.id),
            ...withRequestIdempotencyKey(options),
          });
          return { data: toDataRecord(data) };
        },
        delete: async (params) => {
          const payload = asRecord(params);
          const data = await sdk.deleteDraft({
            accessToken,
            namespace,
            draftId: asString(payload.id),
          });
          return { data: toDataRecord(data) };
        },
      },
      history: {
        list: async (params) => {
          const payload = asRecord(params);
          const data = await sdk.listHistory({
            accessToken,
            namespace,
            startHistoryId: asString(payload.startHistoryId),
            maxResults: asNumber(payload.maxResults, 20),
            ...(asString(payload.labelId) ? { labelId: asString(payload.labelId) } : {}),
            ...(asString(payload.pageToken) ? { pageToken: asString(payload.pageToken) } : {}),
            ...(asStringArray(payload.historyTypes).length > 0
              ? {
                  historyTypes: asStringArray(payload.historyTypes) as Array<
                    "messageAdded" | "labelAdded" | "labelRemoved"
                  >,
                }
              : {}),
          });
          return { data: toDataRecord(data) };
        },
      },
      watch: async (params, options) => {
        const payload = asRecord(params);
        const requestBody = asRecord(payload.requestBody);
        const behavior = asString(requestBody.labelFilterBehavior);
        const data = await sdk.watch({
          accessToken,
          namespace,
          topicName: asString(requestBody.topicName),
          labelIds: asStringArray(requestBody.labelIds),
          ...(behavior === "include" || behavior === "exclude"
            ? { labelFilterBehavior: behavior }
            : {}),
          ...withRequestIdempotencyKey(options),
        });
        return { data: toDataRecord(data) };
      },
      stop: async (_params, options) => {
        const data = await sdk.stopWatch({
          accessToken,
          namespace,
          ...withRequestIdempotencyKey(options),
        });
        return { data: toDataRecord(data) };
      },
      settings: {
        filters: {
          list: async () => {
            const data = await sdk.listFilters({ accessToken, namespace });
            return { data: toDataRecord(data) };
          },
          create: async (params, options) => {
            const payload = asRecord(params);
            const requestBody = asRecord(payload.requestBody);
            const data = await sdk.createFilter({
              accessToken,
              namespace,
              criteria: asRecord(requestBody.criteria),
              action: asRecord(requestBody.action),
              ...withRequestIdempotencyKey(options),
            });
            return { data: toDataRecord(data) };
          },
          delete: async (params) => {
            const payload = asRecord(params);
            const data = await sdk.deleteFilter({
              accessToken,
              namespace,
              filterId: asString(payload.id),
            });
            return { data: toDataRecord(data) };
          },
          get: async (params) => {
            const payload = asRecord(params);
            const data = await sdk.getFilter({
              accessToken,
              namespace,
              filterId: asString(payload.id),
            });
            return { data: toDataRecord(data) };
          },
        },
        sendAs: {
          list: async () => {
            const data = await sdk.listSendAsAliases({ accessToken, namespace });
            return { data: toDataRecord(data) };
          },
          get: async (params) => {
            const payload = asRecord(params);
            const data = await sdk.getSendAsAlias({
              accessToken,
              namespace,
              sendAsEmail: asString(payload.sendAsEmail),
            });
            return { data: toDataRecord(data) };
          },
          update: async (params, options) => {
            const payload = asRecord(params);
            const requestBody = asRecord(payload.requestBody);
            const data = await sdk.updateSendAsAlias({
              accessToken,
              namespace,
              sendAsEmail: asString(payload.sendAsEmail),
              ...(asString(requestBody.displayName)
                ? { displayName: asString(requestBody.displayName) }
                : {}),
              ...(asString(requestBody.replyToAddress)
                ? { replyToAddress: asString(requestBody.replyToAddress) }
                : {}),
              ...(asString(requestBody.signature)
                ? { signature: asString(requestBody.signature) }
                : {}),
              ...(typeof requestBody.treatAsAlias === "boolean"
                ? { treatAsAlias: requestBody.treatAsAlias }
                : {}),
              ...withRequestIdempotencyKey(options),
            });
            return { data: toDataRecord(data) };
          },
        },
        getVacation: async () => {
          const data = await sdk.getVacation({ accessToken, namespace });
          return { data: toDataRecord(data) };
        },
        updateVacation: async (params, options) => {
          const payload = asRecord(params);
          const data = await sdk.updateVacation({
            accessToken,
            namespace,
            vacation: asRecord(payload.requestBody),
            ...withRequestIdempotencyKey(options),
          });
          return { data: toDataRecord(data) };
        },
      },
    },
  };
};
