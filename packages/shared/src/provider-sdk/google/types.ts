import type { gmail_v1 } from "googleapis";
import type { ProviderSdkPort } from "../port.js";

export type GmailMessageHeader = gmail_v1.Schema$MessagePartHeader;

export type GmailMessage = Pick<
  gmail_v1.Schema$Message,
  "id" | "threadId" | "snippet" | "payload" | "historyId" | "internalDate" | "labelIds"
>;

export type GmailThread = Pick<gmail_v1.Schema$Thread, "id" | "historyId" | "messages">;

export type GmailProfile = Pick<
  gmail_v1.Schema$Profile,
  "emailAddress" | "historyId" | "messagesTotal" | "threadsTotal"
>;

export type GmailLabel = Pick<
  gmail_v1.Schema$Label,
  | "id"
  | "name"
  | "type"
  | "labelListVisibility"
  | "messageListVisibility"
  | "messagesTotal"
  | "messagesUnread"
  | "threadsTotal"
  | "threadsUnread"
>;

export type GmailAttachment = Pick<
  gmail_v1.Schema$MessagePartBody,
  "attachmentId" | "data" | "size"
>;

export type GmailFilterCriteria = gmail_v1.Schema$FilterCriteria;

export type GmailFilterAction = gmail_v1.Schema$FilterAction;

export type GmailFilter = Pick<gmail_v1.Schema$Filter, "id" | "criteria" | "action">;

export type GmailSendAsAlias = Pick<
  gmail_v1.Schema$SendAs,
  | "sendAsEmail"
  | "displayName"
  | "replyToAddress"
  | "isPrimary"
  | "isDefault"
  | "treatAsAlias"
  | "signature"
>;

export type GmailVacationSettings = Pick<
  gmail_v1.Schema$VacationSettings,
  | "enableAutoReply"
  | "responseSubject"
  | "responseBodyPlainText"
  | "responseBodyHtml"
  | "restrictToContacts"
  | "restrictToDomain"
  | "startTime"
  | "endTime"
>;

export type GmailDraft = Pick<gmail_v1.Schema$Draft, "id" | "message">;

export type GmailHistoryRecord = Pick<
  gmail_v1.Schema$History,
  "id" | "messages" | "messagesAdded" | "labelsAdded" | "labelsRemoved"
>;

export type GmailSdkContext = {
  accessToken: string;
  namespace?: string | undefined;
};

export type GmailListMessagesArgs = GmailSdkContext & {
  query: string;
  maxResults: number;
};

export type GmailListMessagesResponse = Pick<gmail_v1.Schema$ListMessagesResponse, "messages">;

export type GmailGetMessageArgs = GmailSdkContext & {
  messageId: string;
  format?: "full" | "metadata";
  metadataHeaders?: string[];
};

export type GmailSendMessageArgs = GmailSdkContext & {
  raw: string;
  threadId?: string;
  idempotencyKey?: string | undefined;
};

export type GmailSendMessageResponse = Pick<gmail_v1.Schema$Message, "id" | "threadId">;

export type GmailModifyThreadArgs = GmailSdkContext & {
  threadId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
  idempotencyKey?: string | undefined;
};

export type GmailModifyThreadResponse = Pick<gmail_v1.Schema$Thread, "id" | "historyId">;

export type GmailGetProfileArgs = GmailSdkContext;

export type GmailGetThreadArgs = GmailSdkContext & {
  threadId: string;
  format?: "full" | "metadata";
  metadataHeaders?: string[];
};

export type GmailListLabelsArgs = GmailSdkContext;

export type GmailListLabelsResponse = Pick<gmail_v1.Schema$ListLabelsResponse, "labels">;

export type GmailCreateLabelArgs = GmailSdkContext & {
  name: string;
  labelListVisibility?: string;
  messageListVisibility?: string;
  idempotencyKey?: string | undefined;
};

export type GmailCreateLabelResponse = GmailLabel;

export type GmailUpdateLabelArgs = GmailSdkContext & {
  labelId: string;
  name?: string;
  labelListVisibility?: string;
  messageListVisibility?: string;
  idempotencyKey?: string | undefined;
};

export type GmailUpdateLabelResponse = GmailLabel;

export type GmailDeleteLabelArgs = GmailSdkContext & {
  labelId: string;
  idempotencyKey?: string | undefined;
};

export type GmailDeleteLabelResponse = {
  deleted: true;
  labelId: string;
};

export type GmailCreateDraftArgs = GmailSdkContext & {
  raw: string;
  threadId?: string;
  idempotencyKey?: string | undefined;
};

export type GmailCreateDraftResponse = GmailDraft;

export type GmailListDraftsArgs = GmailSdkContext & {
  maxResults: number;
};

export type GmailListDraftsResponse = Pick<gmail_v1.Schema$ListDraftsResponse, "drafts">;

export type GmailGetDraftArgs = GmailSdkContext & {
  draftId: string;
  format?: "full" | "metadata";
  metadataHeaders?: string[];
};

export type GmailGetDraftResponse = GmailDraft;

export type GmailUpdateDraftArgs = GmailSdkContext & {
  draftId: string;
  raw: string;
  threadId?: string;
  idempotencyKey?: string | undefined;
};

export type GmailUpdateDraftResponse = GmailDraft;

export type GmailSendDraftArgs = GmailSdkContext & {
  draftId: string;
  idempotencyKey?: string | undefined;
};

export type GmailSendDraftResponse = Pick<gmail_v1.Schema$Message, "id" | "threadId">;

export type GmailBatchModifyMessagesArgs = GmailSdkContext & {
  messageIds: string[];
  addLabelIds?: string[];
  removeLabelIds?: string[];
  idempotencyKey?: string | undefined;
};

export type GmailBatchModifyMessagesResponse = {
  modifiedCount: number;
};

export type GmailListHistoryArgs = GmailSdkContext & {
  startHistoryId: string;
  maxResults: number;
  labelId?: string;
  pageToken?: string;
  historyTypes?: Array<"messageAdded" | "labelAdded" | "labelRemoved">;
};

export type GmailListHistoryResponse = Pick<
  gmail_v1.Schema$ListHistoryResponse,
  "history" | "historyId" | "nextPageToken"
>;

export type GmailWatchArgs = GmailSdkContext & {
  topicName: string;
  labelIds?: string[];
  labelFilterBehavior?: "include" | "exclude";
  idempotencyKey?: string | undefined;
};

export type GmailWatchResponse = Pick<gmail_v1.Schema$WatchResponse, "historyId" | "expiration">;

export type GmailStopWatchArgs = GmailSdkContext & {
  idempotencyKey?: string | undefined;
};

export type GmailStopWatchResponse = {
  stopped: true;
};

export type GmailTrashThreadArgs = GmailSdkContext & {
  threadId: string;
  idempotencyKey?: string | undefined;
};

export type GmailTrashThreadResponse = Pick<gmail_v1.Schema$Thread, "id" | "historyId">;

export type GmailUntrashThreadArgs = GmailSdkContext & {
  threadId: string;
  idempotencyKey?: string | undefined;
};

export type GmailUntrashThreadResponse = Pick<gmail_v1.Schema$Thread, "id" | "historyId">;

export type GmailTrashMessageArgs = GmailSdkContext & {
  messageId: string;
  idempotencyKey?: string | undefined;
};

export type GmailTrashMessageResponse = Pick<gmail_v1.Schema$Message, "id" | "threadId">;

export type GmailUntrashMessageArgs = GmailSdkContext & {
  messageId: string;
  idempotencyKey?: string | undefined;
};

export type GmailUntrashMessageResponse = Pick<gmail_v1.Schema$Message, "id" | "threadId">;

export type GmailDownloadAttachmentArgs = GmailSdkContext & {
  messageId: string;
  attachmentId: string;
};

export type GmailDownloadAttachmentResponse = GmailAttachment;

export type GmailDeleteDraftArgs = GmailSdkContext & {
  draftId: string;
  idempotencyKey?: string | undefined;
};

export type GmailDeleteDraftResponse = {
  deleted: true;
  draftId: string;
};

export type GmailListFiltersArgs = GmailSdkContext;

export type GmailListFiltersResponse = Pick<gmail_v1.Schema$ListFiltersResponse, "filter">;

export type GmailCreateFilterArgs = GmailSdkContext & {
  criteria: GmailFilterCriteria;
  action: GmailFilterAction;
  idempotencyKey?: string | undefined;
};

export type GmailCreateFilterResponse = GmailFilter;

export type GmailDeleteFilterArgs = GmailSdkContext & {
  filterId: string;
  idempotencyKey?: string | undefined;
};

export type GmailDeleteFilterResponse = {
  deleted: true;
  filterId: string;
};

export type GmailGetFilterArgs = GmailSdkContext & {
  filterId: string;
};

export type GmailGetFilterResponse = GmailFilter;

export type GmailListSendAsAliasesArgs = GmailSdkContext;

export type GmailListSendAsAliasesResponse = Pick<gmail_v1.Schema$ListSendAsResponse, "sendAs">;

export type GmailGetSendAsAliasArgs = GmailSdkContext & {
  sendAsEmail: string;
};

export type GmailGetSendAsAliasResponse = GmailSendAsAlias;

export type GmailUpdateSendAsAliasArgs = GmailSdkContext & {
  sendAsEmail: string;
  displayName?: string;
  replyToAddress?: string;
  signature?: string;
  treatAsAlias?: boolean;
  idempotencyKey?: string | undefined;
};

export type GmailUpdateSendAsAliasResponse = GmailSendAsAlias;

export type GmailGetVacationArgs = GmailSdkContext;

export type GmailGetVacationResponse = GmailVacationSettings;

export type GmailUpdateVacationArgs = GmailSdkContext & {
  vacation: GmailVacationSettings;
  idempotencyKey?: string | undefined;
};

export type GmailUpdateVacationResponse = GmailVacationSettings;

export type GmailGetLabelArgs = GmailSdkContext & {
  labelId: string;
};

export type GmailGetLabelResponse = GmailLabel;

export interface GmailSdkPort extends ProviderSdkPort {
  listMessages(args: GmailListMessagesArgs): Promise<GmailListMessagesResponse>;
  getMessage(args: GmailGetMessageArgs): Promise<GmailMessage>;
  sendMessage(args: GmailSendMessageArgs): Promise<GmailSendMessageResponse>;
  modifyThread(args: GmailModifyThreadArgs): Promise<GmailModifyThreadResponse>;
  getProfile(args: GmailGetProfileArgs): Promise<GmailProfile>;
  getThread(args: GmailGetThreadArgs): Promise<GmailThread>;
  listLabels(args: GmailListLabelsArgs): Promise<GmailListLabelsResponse>;
  createLabel(args: GmailCreateLabelArgs): Promise<GmailCreateLabelResponse>;
  updateLabel(args: GmailUpdateLabelArgs): Promise<GmailUpdateLabelResponse>;
  deleteLabel(args: GmailDeleteLabelArgs): Promise<GmailDeleteLabelResponse>;
  createDraft(args: GmailCreateDraftArgs): Promise<GmailCreateDraftResponse>;
  listDrafts(args: GmailListDraftsArgs): Promise<GmailListDraftsResponse>;
  getDraft(args: GmailGetDraftArgs): Promise<GmailGetDraftResponse>;
  updateDraft(args: GmailUpdateDraftArgs): Promise<GmailUpdateDraftResponse>;
  sendDraft(args: GmailSendDraftArgs): Promise<GmailSendDraftResponse>;
  batchModifyMessages(
    args: GmailBatchModifyMessagesArgs,
  ): Promise<GmailBatchModifyMessagesResponse>;
  listHistory(args: GmailListHistoryArgs): Promise<GmailListHistoryResponse>;
  watch(args: GmailWatchArgs): Promise<GmailWatchResponse>;
  stopWatch(args: GmailStopWatchArgs): Promise<GmailStopWatchResponse>;
  trashThread(args: GmailTrashThreadArgs): Promise<GmailTrashThreadResponse>;
  untrashThread(args: GmailUntrashThreadArgs): Promise<GmailUntrashThreadResponse>;
  trashMessage(args: GmailTrashMessageArgs): Promise<GmailTrashMessageResponse>;
  untrashMessage(args: GmailUntrashMessageArgs): Promise<GmailUntrashMessageResponse>;
  downloadAttachment(args: GmailDownloadAttachmentArgs): Promise<GmailDownloadAttachmentResponse>;
  deleteDraft(args: GmailDeleteDraftArgs): Promise<GmailDeleteDraftResponse>;
  listFilters(args: GmailListFiltersArgs): Promise<GmailListFiltersResponse>;
  createFilter(args: GmailCreateFilterArgs): Promise<GmailCreateFilterResponse>;
  deleteFilter(args: GmailDeleteFilterArgs): Promise<GmailDeleteFilterResponse>;
  getFilter(args: GmailGetFilterArgs): Promise<GmailGetFilterResponse>;
  listSendAsAliases(args: GmailListSendAsAliasesArgs): Promise<GmailListSendAsAliasesResponse>;
  getSendAsAlias(args: GmailGetSendAsAliasArgs): Promise<GmailGetSendAsAliasResponse>;
  updateSendAsAlias(args: GmailUpdateSendAsAliasArgs): Promise<GmailUpdateSendAsAliasResponse>;
  getVacation(args: GmailGetVacationArgs): Promise<GmailGetVacationResponse>;
  updateVacation(args: GmailUpdateVacationArgs): Promise<GmailUpdateVacationResponse>;
  getLabel(args: GmailGetLabelArgs): Promise<GmailGetLabelResponse>;
}

const _gmailTypeCompatibilityCheck: GmailListMessagesResponse =
  {} as gmail_v1.Schema$ListMessagesResponse;
const _gmailThreadCompatibilityCheck: GmailThread = {} as gmail_v1.Schema$Thread;
void _gmailTypeCompatibilityCheck;
void _gmailThreadCompatibilityCheck;
