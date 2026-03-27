import { gmailTools } from "../../../tool-definitions.js";
import { BaseConnector } from "../../../connectors/base-connector.js";
import type { Connector, ConnectorContext, PreparedWrite } from "../../../connectors/base.js";
import { buildProviderIdempotencyKey } from "../../../provider-write-utils.js";
import { createRealGmailSdk } from "../../../provider-sdk/google/real.js";
import type { GmailMessage, GmailSdkPort } from "../../../provider-sdk/google/types.js";
import { resolveNamespaceFromContext } from "../_shared/connector_helpers.js";
import {
  createProviderCircuitBreaker,
  wrapObjectWithCircuitBreaker,
} from "../../../circuit-breaker.js";

const requiredScopesByTool: Record<string, string[]> = {
  "gmail.searchThreads": ["gmail.readonly"],
  "gmail.listUnread": ["gmail.readonly"],
  "gmail.fetchMessageBody": ["gmail.readonly"],
  "gmail.fetchAttachmentsMetadata": ["gmail.readonly"],
  "gmail.sendEmail": ["gmail.send"],
  "gmail.replyToThread": ["gmail.send"],
  "gmail.applyLabel": ["gmail.modify"],
  "gmail.archive": ["gmail.modify"],
  "gmail.getProfile": ["gmail.readonly"],
  "gmail.getThread": ["gmail.readonly"],
  "gmail.listLabels": ["gmail.labels"],
  "gmail.createLabel": ["gmail.labels"],
  "gmail.createDraft": ["gmail.compose"],
  "gmail.listDrafts": ["gmail.compose"],
  "gmail.getDraft": ["gmail.compose"],
  "gmail.updateDraft": ["gmail.compose"],
  "gmail.sendDraft": ["gmail.compose"],
  "gmail.batchModifyMessages": ["gmail.modify"],
  "gmail.listHistory": ["gmail.readonly"],
  "gmail.watch": ["gmail.modify"],
  "gmail.stopWatch": ["gmail.modify"],
  "gmail.trashThread": ["gmail.modify"],
  "gmail.untrashThread": ["gmail.modify"],
  "gmail.trashMessage": ["gmail.modify"],
  "gmail.untrashMessage": ["gmail.modify"],
  "gmail.downloadAttachment": ["gmail.readonly"],
  "gmail.deleteDraft": ["gmail.compose"],
  "gmail.listFilters": ["gmail.settings.basic"],
  "gmail.createFilter": ["gmail.settings.basic"],
  "gmail.deleteFilter": ["gmail.settings.basic"],
  "gmail.listSendAsAliases": ["gmail.settings.basic"],
  "gmail.getVacation": ["gmail.settings.basic"],
  "gmail.updateVacation": ["gmail.settings.basic"],
  "gmail.removeLabel": ["gmail.modify"],
  "gmail.getLabel": ["gmail.labels"],
  "gmail.updateLabel": ["gmail.labels"],
  "gmail.deleteLabel": ["gmail.labels"],
  "gmail.getFilter": ["gmail.settings.basic"],
  "gmail.getSendAsAlias": ["gmail.settings.basic"],
  "gmail.updateSendAsAlias": ["gmail.settings.basic"],
};

const assertIntegrationConnected = (context: ConnectorContext): void => {
  const hasAccountId =
    typeof context.integration_account_id === "string" && context.integration_account_id.length > 0;
  const hasToken =
    (typeof context.access_token === "string" && context.access_token.length > 0) ||
    (typeof context.refresh_token === "string" && context.refresh_token.length > 0);

  // Some disconnected test states may temporarily surface an empty connector context
  // before upstream "integration not connected" checks short-circuit.
  if (!hasAccountId && !hasToken && context.scopes.length === 0) {
    throw new Error(`Integration google is not connected for workspace ${context.workspaceId}`);
  }
};

const requiredTokenMessage = "Gmail access token missing. Reconnect Gmail integration.";
const FAKE_GMAIL_ACCESS_TOKEN = process.env.KEPPO_FAKE_GMAIL_ACCESS_TOKEN?.trim();

const getToken = (context: ConnectorContext): string => {
  if (context.access_token) {
    return context.access_token;
  }
  if (FAKE_GMAIL_ACCESS_TOKEN) {
    return FAKE_GMAIL_ACCESS_TOKEN;
  }
  if (!context.access_token) {
    throw new Error(requiredTokenMessage);
  }
  return context.access_token;
};

const toBase64Url = (value: string): string =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const decodeBody = (raw?: string): string =>
  raw ? Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "";

const getHeader = (
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string | undefined =>
  headers?.find((header) => (header.name ?? "").toLowerCase() === name.toLowerCase())?.value ??
  undefined;

const getRecipients = (value?: string): string[] =>
  typeof value === "string"
    ? value
        .split(",")
        .map((recipient) => recipient.trim())
        .filter(Boolean)
    : [];

type GmailMessagePart = NonNullable<GmailMessage["payload"]>;

const collectMessageContent = (
  node: GmailMessagePart | null | undefined,
): {
  body: string;
  attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId?: string }>;
} => {
  let body = "";
  const attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    attachmentId?: string;
  }> = [];

  const walk = (part: GmailMessagePart | null | undefined) => {
    if (!part) {
      return;
    }

    if (part.body?.attachmentId && part.filename) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId,
      });
      return;
    }

    if (part.mimeType?.startsWith("text/") && part.body?.data) {
      const candidate = decodeBody(part.body.data);
      if (candidate) {
        body = candidate;
      }
    }

    if (Array.isArray(part.parts)) {
      part.parts.forEach((child) => walk(child));
    }
  };

  walk(node);
  return { body, attachments };
};

const buildRawMessage = (input: {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
}): string => {
  const headerLines = [
    `To: ${input.to}`,
    input.cc && input.cc.length > 0 ? `Cc: ${input.cc.join(", ")}` : null,
    input.bcc && input.bcc.length > 0 ? `Bcc: ${input.bcc.join(", ")}` : null,
    input.subject ? `Subject: ${input.subject}` : null,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ].filter((line): line is string => line !== null);

  return toBase64Url(`${headerLines.join("\r\n")}\r\n\r\n${input.body}`);
};

const buildThreadSummary = (
  message: {
    id: string;
    threadId: string;
    from: string;
    snippet: string;
    subject: string;
  },
  includeUnread = false,
): Record<string, unknown> => ({
  threadId: message.threadId || message.id,
  messageId: message.id,
  subject: message.subject,
  from: message.from,
  snippet: message.snippet,
  unread: includeUnread,
});

const fetchMessageMetadata = async (
  sdk: GmailSdkPort,
  context: ConnectorContext,
  messageId: string,
) => {
  const token = getToken(context);
  const namespace = resolveNamespaceFromContext(context);
  const message = await sdk.getMessage({
    accessToken: token,
    namespace,
    messageId,
    format: "full",
    metadataHeaders: ["From", "To", "Subject"],
  });

  const headers = message.payload?.headers;
  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    snippet: message.snippet ?? "",
    from: getHeader(headers, "From") ?? "",
    to: getHeader(headers, "To"),
    subject: getHeader(headers, "Subject") ?? "",
    payload: message.payload,
  };
};

const extractMessageShape = (message: {
  id?: string | null | undefined;
  threadId?: string | null | undefined;
  snippet?: string | null | undefined;
  payload?: GmailMessagePart | null | undefined;
}): {
  messageId: string;
  threadId: string;
  snippet: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
} => {
  const headers = message.payload?.headers;
  const content = collectMessageContent(message.payload);
  return {
    messageId: message.id ?? "",
    threadId: message.threadId ?? "",
    snippet: message.snippet ?? "",
    from: getHeader(headers, "From") ?? "",
    to: getRecipients(getHeader(headers, "To")),
    subject: getHeader(headers, "Subject") ?? "",
    body: content.body,
  };
};

const parseDraftPayload = (
  value: unknown,
): {
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  threadId?: string;
} => {
  const record = value as Record<string, unknown>;
  return {
    to: Array.isArray(record.to) ? record.to.map((entry) => String(entry)).join(", ") : "",
    cc: Array.isArray(record.cc) ? record.cc.map((entry) => String(entry)) : [],
    bcc: Array.isArray(record.bcc) ? record.bcc.map((entry) => String(entry)) : [],
    subject: String(record.subject ?? ""),
    body: String(record.body ?? ""),
    ...(typeof record.threadId === "string" && record.threadId.length > 0
      ? { threadId: record.threadId }
      : {}),
  };
};

const providerCircuitBreaker = createProviderCircuitBreaker("google");

type GoogleReadDispatchInput = {
  validated: Record<string, unknown>;
  token: string;
  namespace: string | undefined;
  context: ConnectorContext;
};

type GooglePrepareDispatchInput = {
  validated: Record<string, unknown>;
};

type GoogleWriteDispatchInput = {
  normalizedPayload: Record<string, unknown>;
  token: string;
  namespace: string | undefined;
  idempotencyKey: string;
};

const buildGmailProviderActionId = (
  prefix: string,
  idempotencyKey: string,
  responseId?: string | null,
) => {
  return responseId ?? `${prefix}_${idempotencyKey}`;
};

export const createGoogleConnector = (options?: { sdk?: GmailSdkPort }): Connector => {
  const sdk = wrapObjectWithCircuitBreaker(
    options?.sdk ?? createRealGmailSdk(),
    providerCircuitBreaker,
  );

  const readMap = {
    "gmail.searchThreads": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const query = String(validated.query ?? "").toLowerCase();
      const limit = Number(validated.limit ?? 20);
      const response = await sdk.listMessages({
        accessToken: token,
        namespace,
        query,
        maxResults: limit,
      });

      const threadIds = response.messages ?? [];
      const threads = await Promise.all(
        threadIds.slice(0, limit).map(async (thread) => {
          const details = await fetchMessageMetadata(sdk, context, String(thread.id ?? ""));
          return buildThreadSummary(
            {
              id: details.id,
              threadId: details.threadId,
              from: details.from,
              subject: details.subject,
              snippet: details.snippet,
            },
            false,
          );
        }),
      );

      return { threads };
    },
    "gmail.listUnread": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const limit = Number(validated.limit ?? 20);
      const response = await sdk.listMessages({
        accessToken: token,
        namespace,
        query: "is:unread",
        maxResults: limit,
      });

      const threadIds = response.messages ?? [];
      const threads = await Promise.all(
        threadIds.slice(0, limit).map(async (thread) => {
          const details = await fetchMessageMetadata(sdk, context, String(thread.id ?? ""));
          return buildThreadSummary(
            {
              id: details.id,
              threadId: details.threadId,
              from: details.from,
              subject: details.subject,
              snippet: details.snippet,
            },
            true,
          );
        }),
      );
      return { threads };
    },
    "gmail.fetchMessageBody": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const message = await fetchMessageMetadata(sdk, context, String(validated.messageId));
      const extracted = collectMessageContent(message.payload);
      return {
        messageId: validated.messageId,
        body: extracted.body,
        from: message.from,
        to: getRecipients(message.to),
        subject: message.subject,
      };
    },
    "gmail.fetchAttachmentsMetadata": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const message = await fetchMessageMetadata(sdk, context, String(validated.messageId));
      const extracted = collectMessageContent(message.payload);
      return {
        messageId: validated.messageId,
        attachments: extracted.attachments,
      };
    },
    "gmail.getProfile": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const profile = await sdk.getProfile({
        accessToken: token,
        namespace,
      });

      return {
        emailAddress: profile.emailAddress ?? "",
        historyId: profile.historyId ?? "",
        messagesTotal: Number(profile.messagesTotal ?? 0),
        threadsTotal: Number(profile.threadsTotal ?? 0),
      };
    },
    "gmail.getThread": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const thread = await sdk.getThread({
        accessToken: token,
        namespace,
        threadId: String(validated.threadId),
        format: "full",
        metadataHeaders: ["From", "To", "Subject"],
      });

      const messages = (thread.messages ?? []).map((entry) => {
        const parsed = extractMessageShape({
          id: entry.id,
          threadId: entry.threadId,
          snippet: entry.snippet,
          payload: entry.payload,
        });
        return {
          messageId: parsed.messageId,
          threadId: parsed.threadId,
          snippet: parsed.snippet,
          from: parsed.from,
          to: parsed.to,
          subject: parsed.subject,
          body: parsed.body,
        };
      });

      return {
        threadId: thread.id ?? String(validated.threadId),
        historyId: thread.historyId ?? "",
        messages,
      };
    },
    "gmail.listLabels": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const response = await sdk.listLabels({
        accessToken: token,
        namespace,
      });

      return {
        labels: (response.labels ?? []).map((label) => ({
          id: label.id ?? "",
          name: label.name ?? "",
          type: label.type ?? "",
          labelListVisibility: label.labelListVisibility ?? "",
          messageListVisibility: label.messageListVisibility ?? "",
        })),
      };
    },
    "gmail.listDrafts": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const limit = Number(validated.limit ?? 20);
      const response = await sdk.listDrafts({
        accessToken: token,
        namespace,
        maxResults: limit,
      });

      return {
        drafts: (response.drafts ?? []).map((draft) => ({
          draftId: draft.id ?? "",
        })),
      };
    },
    "gmail.getDraft": async ({ validated, token, namespace, context }: GoogleReadDispatchInput) => {
      const draft = await sdk.getDraft({
        accessToken: token,
        namespace,
        draftId: String(validated.draftId),
        format: "full",
        metadataHeaders: ["From", "To", "Subject"],
      });

      const parsed = extractMessageShape({
        id: draft.message?.id,
        threadId: draft.message?.threadId,
        snippet: draft.message?.snippet,
        payload: draft.message?.payload,
      });

      return {
        draftId: draft.id ?? String(validated.draftId),
        messageId: parsed.messageId,
        threadId: parsed.threadId,
        to: parsed.to,
        subject: parsed.subject,
        body: parsed.body,
      };
    },
    "gmail.listHistory": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const response = await sdk.listHistory({
        accessToken: token,
        namespace,
        startHistoryId: String(validated.startHistoryId),
        maxResults: Number(validated.limit ?? 20),
        ...(typeof validated.labelId === "string" && validated.labelId.length > 0
          ? { labelId: validated.labelId }
          : {}),
      });

      return {
        startHistoryId: String(validated.startHistoryId),
        historyId: response.historyId ?? "",
        records: (response.history ?? []).map((record) => ({
          historyId: record.id ?? "",
          messageIds: (record.messages ?? []).map((message) => message.id ?? "").filter(Boolean),
          threadIds: (record.messages ?? [])
            .map((message) => message.threadId ?? "")
            .filter(Boolean),
        })),
      };
    },
    "gmail.downloadAttachment": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const attachment = await sdk.downloadAttachment({
        accessToken: token,
        namespace,
        messageId: String(validated.messageId),
        attachmentId: String(validated.attachmentId),
      });

      return {
        messageId: String(validated.messageId),
        attachmentId: attachment.attachmentId ?? String(validated.attachmentId),
        data: attachment.data ?? "",
        size: Number(attachment.size ?? 0),
      };
    },
    "gmail.listFilters": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const response = await sdk.listFilters({
        accessToken: token,
        namespace,
      });

      return {
        filters: (response.filter ?? []).map((filter) => ({
          filterId: filter.id ?? "",
          criteria: filter.criteria ?? {},
          action: filter.action ?? {},
        })),
      };
    },
    "gmail.listSendAsAliases": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const response = await sdk.listSendAsAliases({
        accessToken: token,
        namespace,
      });

      return {
        aliases: (response.sendAs ?? []).map((alias) => ({
          sendAsEmail: alias.sendAsEmail ?? "",
          displayName: alias.displayName ?? "",
          replyToAddress: alias.replyToAddress ?? "",
          isPrimary: Boolean(alias.isPrimary),
          isDefault: Boolean(alias.isDefault),
          treatAsAlias: Boolean(alias.treatAsAlias),
        })),
      };
    },
    "gmail.getVacation": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const vacation = await sdk.getVacation({
        accessToken: token,
        namespace,
      });

      return {
        enableAutoReply: Boolean(vacation.enableAutoReply),
        responseSubject: vacation.responseSubject ?? "",
        responseBodyPlainText: vacation.responseBodyPlainText ?? "",
        responseBodyHtml: vacation.responseBodyHtml ?? "",
        restrictToContacts: Boolean(vacation.restrictToContacts),
        restrictToDomain: Boolean(vacation.restrictToDomain),
        startTime: vacation.startTime ?? "",
        endTime: vacation.endTime ?? "",
      };
    },
    "gmail.getLabel": async ({ validated, token, namespace, context }: GoogleReadDispatchInput) => {
      const label = await sdk.getLabel({
        accessToken: token,
        namespace,
        labelId: String(validated.labelId),
      });

      return {
        labelId: label.id ?? String(validated.labelId),
        name: label.name ?? "",
        type: label.type ?? "",
        labelListVisibility: label.labelListVisibility ?? "",
        messageListVisibility: label.messageListVisibility ?? "",
        messagesTotal: Number(label.messagesTotal ?? 0),
        messagesUnread: Number(label.messagesUnread ?? 0),
        threadsTotal: Number(label.threadsTotal ?? 0),
        threadsUnread: Number(label.threadsUnread ?? 0),
      };
    },
    "gmail.getFilter": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const filter = await sdk.getFilter({
        accessToken: token,
        namespace,
        filterId: String(validated.filterId),
      });

      return {
        filterId: filter.id ?? String(validated.filterId),
        criteria: filter.criteria ?? {},
        action: filter.action ?? {},
      };
    },
    "gmail.getSendAsAlias": async ({
      validated,
      token,
      namespace,
      context,
    }: GoogleReadDispatchInput) => {
      const alias = await sdk.getSendAsAlias({
        accessToken: token,
        namespace,
        sendAsEmail: String(validated.sendAsEmail),
      });

      return {
        sendAsEmail: alias.sendAsEmail ?? String(validated.sendAsEmail),
        displayName: alias.displayName ?? "",
        replyToAddress: alias.replyToAddress ?? "",
        isPrimary: Boolean(alias.isPrimary),
        isDefault: Boolean(alias.isDefault),
        treatAsAlias: Boolean(alias.treatAsAlias),
        signature: alias.signature ?? "",
      };
    },
  };

  const prepareMap = {
    "gmail.sendEmail": async ({ validated }: GooglePrepareDispatchInput) => {
      const recipients = [validated.to, validated.cc, validated.bcc]
        .flatMap((value) => (Array.isArray(value) ? value : []))
        .filter((value): value is string => typeof value === "string");
      const normalized = {
        type: "send_email",
        to: validated.to,
        cc: validated.cc,
        bcc: validated.bcc,
        subject: validated.subject,
        body: validated.body,
      };
      const preview = {
        recipients,
        subject: validated.subject,
        body_preview: String(validated.body).slice(0, 120),
        recipient_count: recipients.length,
      };
      return { normalized_payload: normalized, payload_preview: preview };
    },
    "gmail.replyToThread": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "reply_email",
        threadId: validated.threadId,
        to: validated.to,
        body: validated.body,
      };
      const preview = {
        thread_id: validated.threadId,
        recipients: validated.to,
        body_preview: String(validated.body).slice(0, 120),
      };
      return { normalized_payload: normalized, payload_preview: preview };
    },
    "gmail.applyLabel": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "apply_label",
        threadId: validated.threadId,
        label: validated.label,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          thread_id: validated.threadId,
          label: validated.label,
        },
      };
    },
    "gmail.archive": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "archive_thread",
        threadId: validated.threadId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          thread_id: validated.threadId,
        },
      };
    },
    "gmail.createLabel": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "create_label",
        name: validated.name,
        labelListVisibility: validated.labelListVisibility,
        messageListVisibility: validated.messageListVisibility,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          name: validated.name,
          visibility: {
            labelList: validated.labelListVisibility,
            messageList: validated.messageListVisibility,
          },
        },
      };
    },
    "gmail.createDraft": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "create_draft",
        to: validated.to,
        cc: validated.cc,
        bcc: validated.bcc,
        subject: validated.subject,
        body: validated.body,
        threadId: validated.threadId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          recipients: validated.to,
          subject: validated.subject,
          thread_id: validated.threadId,
          body_preview: String(validated.body).slice(0, 120),
        },
      };
    },
    "gmail.updateDraft": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "update_draft",
        draftId: validated.draftId,
        to: validated.to,
        cc: validated.cc,
        bcc: validated.bcc,
        subject: validated.subject,
        body: validated.body,
        threadId: validated.threadId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          draft_id: validated.draftId,
          recipients: validated.to,
          subject: validated.subject,
          thread_id: validated.threadId,
          body_preview: String(validated.body).slice(0, 120),
        },
      };
    },
    "gmail.sendDraft": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "send_draft",
        draftId: validated.draftId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          draft_id: validated.draftId,
        },
      };
    },
    "gmail.batchModifyMessages": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "batch_modify_messages",
        messageIds: validated.messageIds,
        addLabelIds: validated.addLabelIds,
        removeLabelIds: validated.removeLabelIds,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          message_count: Array.isArray(validated.messageIds) ? validated.messageIds.length : 0,
          add_labels: validated.addLabelIds,
          remove_labels: validated.removeLabelIds,
        },
      };
    },
    "gmail.watch": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "watch",
        topicName: validated.topicName,
        labelIds: validated.labelIds,
        labelFilterBehavior: validated.labelFilterBehavior,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          topic_name: validated.topicName,
          label_ids: validated.labelIds,
          label_filter_behavior: validated.labelFilterBehavior,
        },
      };
    },
    "gmail.stopWatch": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "stop_watch",
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          action: "stop_watch",
        },
      };
    },
    "gmail.trashThread": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "trash_thread",
        threadId: validated.threadId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          thread_id: validated.threadId,
        },
      };
    },
    "gmail.untrashThread": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "untrash_thread",
        threadId: validated.threadId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          thread_id: validated.threadId,
        },
      };
    },
    "gmail.trashMessage": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "trash_message",
        messageId: validated.messageId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          message_id: validated.messageId,
        },
      };
    },
    "gmail.untrashMessage": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "untrash_message",
        messageId: validated.messageId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          message_id: validated.messageId,
        },
      };
    },
    "gmail.deleteDraft": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "delete_draft",
        draftId: validated.draftId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          draft_id: validated.draftId,
        },
      };
    },
    "gmail.createFilter": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "create_filter",
        criteria: validated.criteria,
        action: validated.action,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          criteria: validated.criteria,
          action: validated.action,
        },
      };
    },
    "gmail.deleteFilter": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "delete_filter",
        filterId: validated.filterId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          filter_id: validated.filterId,
        },
      };
    },
    "gmail.updateVacation": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "update_vacation",
        enableAutoReply: validated.enableAutoReply,
        responseSubject: validated.responseSubject,
        responseBodyPlainText: validated.responseBodyPlainText,
        responseBodyHtml: validated.responseBodyHtml,
        restrictToContacts: validated.restrictToContacts,
        restrictToDomain: validated.restrictToDomain,
        startTime: validated.startTime,
        endTime: validated.endTime,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          enable_auto_reply: validated.enableAutoReply,
          response_subject: validated.responseSubject,
          restrict_to_contacts: validated.restrictToContacts,
          restrict_to_domain: validated.restrictToDomain,
        },
      };
    },
    "gmail.removeLabel": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "remove_label",
        threadId: validated.threadId,
        label: validated.label,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          thread_id: validated.threadId,
          label: validated.label,
        },
      };
    },
    "gmail.updateLabel": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "update_label",
        labelId: validated.labelId,
        name: validated.name,
        labelListVisibility: validated.labelListVisibility,
        messageListVisibility: validated.messageListVisibility,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          label_id: validated.labelId,
          name: validated.name ?? "",
          label_list_visibility: validated.labelListVisibility ?? "",
          message_list_visibility: validated.messageListVisibility ?? "",
        },
      };
    },
    "gmail.deleteLabel": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "delete_label",
        labelId: validated.labelId,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          label_id: validated.labelId,
        },
      };
    },
    "gmail.updateSendAsAlias": async ({ validated }: GooglePrepareDispatchInput) => {
      const normalized = {
        type: "update_send_as_alias",
        sendAsEmail: validated.sendAsEmail,
        displayName: validated.displayName,
        replyToAddress: validated.replyToAddress,
        signature: validated.signature,
        treatAsAlias: validated.treatAsAlias,
      };
      return {
        normalized_payload: normalized,
        payload_preview: {
          send_as_email: validated.sendAsEmail,
          display_name: validated.displayName ?? "",
          reply_to_address: validated.replyToAddress ?? "",
          signature_preview:
            typeof validated.signature === "string" ? validated.signature.slice(0, 80) : "",
          treat_as_alias: validated.treatAsAlias ?? false,
        },
      };
    },
  };

  const writeMap = {
    "gmail.sendEmail": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const response = await sdk.sendMessage({
        accessToken: token,
        namespace,
        raw: buildRawMessage({
          to: Array.isArray(normalizedPayload.to)
            ? normalizedPayload.to.join(", ")
            : String(normalizedPayload.to),
          cc: Array.isArray(normalizedPayload.cc) ? normalizedPayload.cc : [],
          bcc: Array.isArray(normalizedPayload.bcc) ? normalizedPayload.bcc : [],
          subject: String(normalizedPayload.subject),
          body: String(normalizedPayload.body),
        }),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId("gmail_send", idempotencyKey, response.id),
        status: "sent",
        to: normalizedPayload.to,
        subject: normalizedPayload.subject,
      };
    },
    "gmail.replyToThread": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const response = await sdk.sendMessage({
        accessToken: token,
        namespace,
        raw: buildRawMessage({
          to: Array.isArray(normalizedPayload.to)
            ? normalizedPayload.to.join(", ")
            : String(normalizedPayload.to),
          subject: "Re:",
          body: String(normalizedPayload.body),
        }),
        threadId: String(normalizedPayload.threadId),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId("gmail_reply", idempotencyKey, response.id),
        status: "sent",
        threadId: normalizedPayload.threadId,
      };
    },
    "gmail.applyLabel": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      await sdk.modifyThread({
        accessToken: token,
        namespace,
        threadId: String(normalizedPayload.threadId),
        addLabelIds: [String(normalizedPayload.label)],
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId("gmail_label", idempotencyKey),
        status: "ok",
        label: normalizedPayload.label,
      };
    },
    "gmail.archive": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      await sdk.modifyThread({
        accessToken: token,
        namespace,
        threadId: String(normalizedPayload.threadId),
        removeLabelIds: ["INBOX"],
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId("gmail_archive", idempotencyKey),
        status: "ok",
        threadId: normalizedPayload.threadId,
      };
    },
    "gmail.createLabel": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const response = await sdk.createLabel({
        accessToken: token,
        namespace,
        name: String(normalizedPayload.name),
        ...(typeof normalizedPayload.labelListVisibility === "string"
          ? { labelListVisibility: normalizedPayload.labelListVisibility }
          : {}),
        ...(typeof normalizedPayload.messageListVisibility === "string"
          ? { messageListVisibility: normalizedPayload.messageListVisibility }
          : {}),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId(
          "gmail_create_label",
          idempotencyKey,
          response.id,
        ),
        status: "ok",
        labelId: response.id ?? "",
        name: response.name ?? String(normalizedPayload.name),
      };
    },
    "gmail.createDraft": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const draftPayload = parseDraftPayload(normalizedPayload);
      const response = await sdk.createDraft({
        accessToken: token,
        namespace,
        raw: buildRawMessage({
          to: draftPayload.to,
          cc: draftPayload.cc,
          bcc: draftPayload.bcc,
          subject: draftPayload.subject,
          body: draftPayload.body,
        }),
        ...(draftPayload.threadId ? { threadId: draftPayload.threadId } : {}),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId(
          "gmail_create_draft",
          idempotencyKey,
          response.id,
        ),
        status: "drafted",
        draftId: response.id ?? "",
        threadId: response.message?.threadId ?? draftPayload.threadId ?? "",
      };
    },
    "gmail.updateDraft": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const draftPayload = parseDraftPayload(normalizedPayload);
      const response = await sdk.updateDraft({
        accessToken: token,
        namespace,
        draftId: String(normalizedPayload.draftId),
        raw: buildRawMessage({
          to: draftPayload.to,
          cc: draftPayload.cc,
          bcc: draftPayload.bcc,
          subject: draftPayload.subject,
          body: draftPayload.body,
        }),
        ...(draftPayload.threadId ? { threadId: draftPayload.threadId } : {}),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId(
          "gmail_update_draft",
          idempotencyKey,
          response.id,
        ),
        status: "updated",
        draftId: response.id ?? String(normalizedPayload.draftId),
      };
    },
    "gmail.sendDraft": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const response = await sdk.sendDraft({
        accessToken: token,
        namespace,
        draftId: String(normalizedPayload.draftId),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId(
          "gmail_send_draft",
          idempotencyKey,
          response.id,
        ),
        status: "sent",
        draftId: normalizedPayload.draftId,
        messageId: response.id ?? "",
        threadId: response.threadId ?? "",
      };
    },
    "gmail.batchModifyMessages": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const messageIds = Array.isArray(normalizedPayload.messageIds)
        ? normalizedPayload.messageIds.map((entry) => String(entry))
        : [];
      const addLabelIds = Array.isArray(normalizedPayload.addLabelIds)
        ? normalizedPayload.addLabelIds.map((entry) => String(entry))
        : [];
      const removeLabelIds = Array.isArray(normalizedPayload.removeLabelIds)
        ? normalizedPayload.removeLabelIds.map((entry) => String(entry))
        : [];

      const response = await sdk.batchModifyMessages({
        accessToken: token,
        namespace,
        messageIds,
        addLabelIds,
        removeLabelIds,
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId("gmail_batch_modify", idempotencyKey),
        status: "ok",
        modifiedCount: response.modifiedCount,
      };
    },
    "gmail.watch": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const response = await sdk.watch({
        accessToken: token,
        namespace,
        topicName: String(normalizedPayload.topicName),
        labelIds: Array.isArray(normalizedPayload.labelIds)
          ? normalizedPayload.labelIds.map((entry) => String(entry))
          : [],
        labelFilterBehavior:
          normalizedPayload.labelFilterBehavior === "exclude" ? "exclude" : "include",
        idempotencyKey,
      });

      return {
        provider_action_id: `gmail_watch_${response.historyId ?? response.expiration ?? "unknown"}`,
        status: "watching",
        historyId: response.historyId ?? "",
        expiration: response.expiration ?? "",
      };
    },
    "gmail.stopWatch": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      await sdk.stopWatch({
        accessToken: token,
        namespace,
        idempotencyKey,
      });

      return {
        provider_action_id: `gmail_stop_watch_${idempotencyKey ?? "unknown"}`,
        status: "stopped",
      };
    },
    "gmail.trashThread": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const response = await sdk.trashThread({
        accessToken: token,
        namespace,
        threadId: String(normalizedPayload.threadId),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId(
          "gmail_trash_thread",
          idempotencyKey,
          response.id,
        ),
        status: "trashed",
        threadId: String(normalizedPayload.threadId),
        historyId: response.historyId ?? "",
      };
    },
    "gmail.untrashThread": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const response = await sdk.untrashThread({
        accessToken: token,
        namespace,
        threadId: String(normalizedPayload.threadId),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId(
          "gmail_untrash_thread",
          idempotencyKey,
          response.id,
        ),
        status: "restored",
        threadId: String(normalizedPayload.threadId),
        historyId: response.historyId ?? "",
      };
    },
    "gmail.trashMessage": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const response = await sdk.trashMessage({
        accessToken: token,
        namespace,
        messageId: String(normalizedPayload.messageId),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId(
          "gmail_trash_message",
          idempotencyKey,
          response.id,
        ),
        status: "trashed",
        messageId: String(normalizedPayload.messageId),
        threadId: response.threadId ?? "",
      };
    },
    "gmail.untrashMessage": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const response = await sdk.untrashMessage({
        accessToken: token,
        namespace,
        messageId: String(normalizedPayload.messageId),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId(
          "gmail_untrash_message",
          idempotencyKey,
          response.id,
        ),
        status: "restored",
        messageId: String(normalizedPayload.messageId),
        threadId: response.threadId ?? "",
      };
    },
    "gmail.deleteDraft": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      await sdk.deleteDraft({
        accessToken: token,
        namespace,
        draftId: String(normalizedPayload.draftId),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId("gmail_delete_draft", idempotencyKey),
        status: "deleted",
        draftId: String(normalizedPayload.draftId),
      };
    },
    "gmail.createFilter": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const criteriaSource =
        normalizedPayload.criteria && typeof normalizedPayload.criteria === "object"
          ? (normalizedPayload.criteria as Record<string, unknown>)
          : {};
      const actionSource =
        normalizedPayload.action && typeof normalizedPayload.action === "object"
          ? (normalizedPayload.action as Record<string, unknown>)
          : {};

      const criteria = {
        ...(typeof criteriaSource.from === "string" ? { from: criteriaSource.from } : {}),
        ...(typeof criteriaSource.to === "string" ? { to: criteriaSource.to } : {}),
        ...(typeof criteriaSource.subject === "string" ? { subject: criteriaSource.subject } : {}),
        ...(typeof criteriaSource.query === "string" ? { query: criteriaSource.query } : {}),
        ...(typeof criteriaSource.negatedQuery === "string"
          ? { negatedQuery: criteriaSource.negatedQuery }
          : {}),
        ...(typeof criteriaSource.hasAttachment === "boolean"
          ? { hasAttachment: criteriaSource.hasAttachment }
          : {}),
        ...(criteriaSource.sizeComparison === "larger" ||
        criteriaSource.sizeComparison === "smaller"
          ? { sizeComparison: criteriaSource.sizeComparison }
          : {}),
        ...(typeof criteriaSource.size === "number" ? { size: criteriaSource.size } : {}),
      };
      const action = {
        ...(Array.isArray(actionSource.addLabelIds)
          ? {
              addLabelIds: actionSource.addLabelIds.map((entry) => String(entry)),
            }
          : {}),
        ...(Array.isArray(actionSource.removeLabelIds)
          ? {
              removeLabelIds: actionSource.removeLabelIds.map((entry) => String(entry)),
            }
          : {}),
        ...(typeof actionSource.forward === "string" ? { forward: actionSource.forward } : {}),
      };

      const response = await sdk.createFilter({
        accessToken: token,
        namespace,
        criteria,
        action,
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId(
          "gmail_create_filter",
          idempotencyKey,
          response.id,
        ),
        status: "ok",
        filterId: response.id ?? "",
        criteria: response.criteria ?? criteria,
        action: response.action ?? action,
      };
    },
    "gmail.deleteFilter": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      await sdk.deleteFilter({
        accessToken: token,
        namespace,
        filterId: String(normalizedPayload.filterId),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId("gmail_delete_filter", idempotencyKey),
        status: "deleted",
        filterId: String(normalizedPayload.filterId),
      };
    },
    "gmail.updateVacation": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const response = await sdk.updateVacation({
        accessToken: token,
        namespace,
        vacation: {
          enableAutoReply: Boolean(normalizedPayload.enableAutoReply),
          responseSubject: String(normalizedPayload.responseSubject ?? ""),
          responseBodyPlainText: String(normalizedPayload.responseBodyPlainText ?? ""),
          responseBodyHtml: String(normalizedPayload.responseBodyHtml ?? ""),
          restrictToContacts: Boolean(normalizedPayload.restrictToContacts),
          restrictToDomain: Boolean(normalizedPayload.restrictToDomain),
          ...(typeof normalizedPayload.startTime === "string" &&
          normalizedPayload.startTime.length > 0
            ? { startTime: normalizedPayload.startTime }
            : {}),
          ...(typeof normalizedPayload.endTime === "string" && normalizedPayload.endTime.length > 0
            ? { endTime: normalizedPayload.endTime }
            : {}),
        },
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId("gmail_update_vacation", idempotencyKey),
        status: "updated",
        enableAutoReply: Boolean(response.enableAutoReply),
        responseSubject: response.responseSubject ?? "",
        restrictToContacts: Boolean(response.restrictToContacts),
        restrictToDomain: Boolean(response.restrictToDomain),
      };
    },
    "gmail.removeLabel": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      await sdk.modifyThread({
        accessToken: token,
        namespace,
        threadId: String(normalizedPayload.threadId),
        removeLabelIds: [String(normalizedPayload.label)],
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId("gmail_remove_label", idempotencyKey),
        status: "ok",
        threadId: String(normalizedPayload.threadId),
        label: String(normalizedPayload.label),
      };
    },
    "gmail.updateLabel": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const response = await sdk.updateLabel({
        accessToken: token,
        namespace,
        labelId: String(normalizedPayload.labelId),
        ...(typeof normalizedPayload.name === "string" && normalizedPayload.name.length > 0
          ? { name: normalizedPayload.name }
          : {}),
        ...(typeof normalizedPayload.labelListVisibility === "string" &&
        normalizedPayload.labelListVisibility.length > 0
          ? { labelListVisibility: normalizedPayload.labelListVisibility }
          : {}),
        ...(typeof normalizedPayload.messageListVisibility === "string" &&
        normalizedPayload.messageListVisibility.length > 0
          ? { messageListVisibility: normalizedPayload.messageListVisibility }
          : {}),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId("gmail_update_label", idempotencyKey),
        status: "updated",
        labelId: response.id ?? String(normalizedPayload.labelId),
        name: response.name ?? "",
        labelListVisibility: response.labelListVisibility ?? "",
        messageListVisibility: response.messageListVisibility ?? "",
      };
    },
    "gmail.deleteLabel": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      await sdk.deleteLabel({
        accessToken: token,
        namespace,
        labelId: String(normalizedPayload.labelId),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId("gmail_delete_label", idempotencyKey),
        status: "deleted",
        labelId: String(normalizedPayload.labelId),
      };
    },
    "gmail.updateSendAsAlias": async ({
      normalizedPayload,
      token,
      namespace,
      idempotencyKey,
    }: GoogleWriteDispatchInput) => {
      const response = await sdk.updateSendAsAlias({
        accessToken: token,
        namespace,
        sendAsEmail: String(normalizedPayload.sendAsEmail),
        ...(typeof normalizedPayload.displayName === "string" &&
        normalizedPayload.displayName.length > 0
          ? { displayName: normalizedPayload.displayName }
          : {}),
        ...(typeof normalizedPayload.replyToAddress === "string" &&
        normalizedPayload.replyToAddress.length > 0
          ? { replyToAddress: normalizedPayload.replyToAddress }
          : {}),
        ...(typeof normalizedPayload.signature === "string" &&
        normalizedPayload.signature.length > 0
          ? { signature: normalizedPayload.signature }
          : {}),
        ...(typeof normalizedPayload.treatAsAlias === "boolean"
          ? { treatAsAlias: normalizedPayload.treatAsAlias }
          : {}),
        idempotencyKey,
      });

      return {
        provider_action_id: buildGmailProviderActionId(
          "gmail_update_send_as_alias",
          idempotencyKey,
        ),
        status: "updated",
        sendAsEmail: response.sendAsEmail ?? String(normalizedPayload.sendAsEmail),
        displayName: response.displayName ?? "",
        replyToAddress: response.replyToAddress ?? "",
        treatAsAlias: Boolean(response.treatAsAlias),
        signature: response.signature ?? "",
      };
    },
  };

  class GoogleConnector extends BaseConnector<
    GoogleReadDispatchInput,
    GooglePrepareDispatchInput,
    GoogleWriteDispatchInput,
    typeof gmailTools
  > {
    constructor() {
      super({
        provider: "google",
        tools: gmailTools,
        requiredScopesByTool,
        readMap,
        prepareMap,
        writeMap,
      });
    }

    protected getToken(context: ConnectorContext): string {
      return getToken(context);
    }

    protected override async beforeRead(
      _toolName: string,
      _validated: Record<string, unknown>,
      context: ConnectorContext,
    ): Promise<void> {
      assertIntegrationConnected(context);
    }

    protected override async beforePrepareWrite(
      _toolName: string,
      _validated: Record<string, unknown>,
      context: ConnectorContext,
    ): Promise<void> {
      assertIntegrationConnected(context);
    }

    protected override async beforeWrite(
      _toolName: string,
      _normalizedPayload: Record<string, unknown>,
      context: ConnectorContext,
    ): Promise<void> {
      assertIntegrationConnected(context);
    }

    protected buildReadDispatchInput(
      _toolName: string,
      validated: Record<string, unknown>,
      context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): GoogleReadDispatchInput {
      return {
        validated,
        token: runtime.accessToken,
        namespace: runtime.namespace,
        context,
      };
    }

    protected buildPrepareDispatchInput(
      _toolName: string,
      validated: Record<string, unknown>,
      _context: ConnectorContext,
    ): GooglePrepareDispatchInput {
      return { validated };
    }

    protected buildWriteDispatchInput(
      toolName: string,
      normalizedPayload: Record<string, unknown>,
      _context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): GoogleWriteDispatchInput {
      return {
        normalizedPayload,
        token: runtime.accessToken,
        namespace: runtime.namespace,
        idempotencyKey: buildProviderIdempotencyKey(toolName, normalizedPayload),
      };
    }

    protected override unsupportedToolMessage(
      phase: "read" | "prepare" | "write",
      toolName: string,
    ): string {
      if (phase === "prepare") {
        return `Unsupported Gmail write tool ${toolName}`;
      }
      if (phase === "write") {
        return `Unsupported Gmail write execution tool ${toolName}`;
      }
      return `Unsupported Gmail read tool ${toolName}`;
    }
  }

  return new GoogleConnector();
};
const connector = createGoogleConnector();

export default connector;
