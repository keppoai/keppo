import type {
  BookmarksAddResponse,
  BookmarksEditResponse,
  BookmarksListResponse,
  BookmarksRemoveResponse,
  ChatDeleteResponse,
  ChatMeMessageResponse,
  ChatPostEphemeralResponse,
  ChatPostMessageResponse,
  ChatUpdateResponse,
  ConversationsHistoryResponse,
  ConversationsInfoResponse,
  ConversationsListResponse,
  ConversationsRepliesResponse,
  FilesUploadResponse,
  ReactionsListResponse,
  RemindersAddResponse,
  RemindersDeleteResponse,
  RemindersListResponse,
  SearchMessagesResponse,
  UsergroupsListResponse,
  UsergroupsUsersListResponse,
  UsersGetPresenceResponse,
  UsersInfoResponse,
  UsersListResponse,
} from "@slack/web-api";
import type { ProviderSdkPort } from "../port.js";

type SlackConversation = NonNullable<ConversationsListResponse["channels"]>[number];
type SlackPostedMessage = NonNullable<ChatPostMessageResponse["message"]>;
type SlackUpdatedMessage = NonNullable<ChatUpdateResponse["message"]>;
type SlackHistoryMessage = NonNullable<ConversationsHistoryResponse["messages"]>[number];
type SlackReplyMessage = NonNullable<ConversationsRepliesResponse["messages"]>[number];
type SlackReactionMessage = NonNullable<ConversationsRepliesResponse["messages"]>[number];
type SlackMember = NonNullable<UsersListResponse["members"]>[number];
type SlackUserDetails = NonNullable<UsersInfoResponse["user"]>;
type SlackConversationInfo = NonNullable<ConversationsInfoResponse["channel"]>;
type SlackSearchMatch = NonNullable<
  NonNullable<SearchMessagesResponse["messages"]>["matches"]
>[number];
type SlackUploadedFile = NonNullable<FilesUploadResponse["file"]>;
type SlackBookmarkPayload = NonNullable<BookmarksListResponse["bookmarks"]>[number];
type SlackReminderPayload = NonNullable<RemindersListResponse["reminders"]>[number];
type SlackUserGroupPayload = NonNullable<UsergroupsListResponse["usergroups"]>[number];
type SlackReactionListPayload = NonNullable<ReactionsListResponse["items"]>[number];

export type SlackSdkContext = {
  accessToken: string;
  namespace?: string | undefined;
};

export type SlackMessageReaction = {
  name: string;
  count: number;
  users: string[];
};

export type SlackMessage = {
  ts: string;
  channel: string;
  text: string;
  userId?: string | undefined;
  threadTs?: string | undefined;
  reactions?: SlackMessageReaction[] | undefined;
};

export type SlackChannel = {
  id: NonNullable<SlackConversation["id"]>;
  name: NonNullable<SlackConversation["name"]>;
  isPrivate?: SlackConversation["is_private"];
};

export type SlackChannelInfo = SlackChannel & {
  isArchived?: boolean | undefined;
  isMember?: boolean | undefined;
  memberCount?: number | undefined;
};

export type SlackUser = {
  id: NonNullable<SlackMember["id"]>;
  name: NonNullable<SlackMember["name"]>;
  realName?: string | undefined;
  isBot?: boolean | undefined;
  isDeleted?: boolean | undefined;
};

export type SlackFile = {
  id: NonNullable<SlackUploadedFile["id"]>;
  name: NonNullable<SlackUploadedFile["name"]>;
  title?: string | undefined;
  url?: string | undefined;
  channels?: string[] | undefined;
  userId?: string | undefined;
  mimetype?: string | undefined;
  size?: number | undefined;
};

export type SlackBookmark = {
  id: string;
  channel: string;
  title: string;
  link: string;
  emoji?: string | undefined;
  entityId?: string | undefined;
};

export type SlackReminder = {
  id: string;
  text: string;
  time: number;
  userId?: string | undefined;
};

export type SlackUserGroup = {
  id: string;
  handle: string;
  name: string;
  isDisabled?: boolean | undefined;
  userCount?: number | undefined;
};

export type SlackUserPresence = {
  userId: string;
  presence: "active" | "away";
  online?: boolean | undefined;
  autoAway?: boolean | undefined;
  manualAway?: boolean | undefined;
  lastActivity?: number | undefined;
  connectionCount?: number | undefined;
};

export type SlackListedReaction = {
  channel: string;
  ts: string;
  name: string;
  count: number;
  users: string[];
};

export type SlackScheduledMessage = {
  id: string;
  channel: string;
  text: string;
  postAt: number;
};

export type SlackPinItem = {
  channel: string;
  ts: string;
  text?: string | undefined;
};

export type SlackUserProfile = {
  userId: string;
  displayName?: string | undefined;
  realName?: string | undefined;
  email?: string | undefined;
  title?: string | undefined;
  statusText?: string | undefined;
  statusEmoji?: string | undefined;
};

export type SlackListChannelsArgs = SlackSdkContext & {
  limit: number;
};

export type SlackGetChannelHistoryArgs = SlackSdkContext & {
  channel: string;
  limit: number;
};

export type SlackGetThreadRepliesArgs = SlackSdkContext & {
  channel: string;
  threadTs: string;
  limit: number;
};

export type SlackGetReactionsArgs = SlackSdkContext & {
  channel: string;
  ts: string;
};

export type SlackListUsersArgs = SlackSdkContext & {
  limit: number;
};

export type SlackGetUserInfoArgs = SlackSdkContext & {
  userId: string;
};

export type SlackGetChannelInfoArgs = SlackSdkContext & {
  channel: string;
};

export type SlackSearchMessagesArgs = SlackSdkContext & {
  query: string;
  limit: number;
};

export type SlackPostMessageArgs = SlackSdkContext & {
  channel: string;
  text: string;
  idempotencyKey?: string | undefined;
};

export type SlackUpdateMessageArgs = SlackSdkContext & {
  channel: string;
  ts: string;
  text: string;
  idempotencyKey?: string | undefined;
};

export type SlackDeleteMessageArgs = SlackSdkContext & {
  channel: string;
  ts: string;
  idempotencyKey?: string | undefined;
};

export type SlackAddReactionArgs = SlackSdkContext & {
  channel: string;
  ts: string;
  name: string;
  idempotencyKey?: string | undefined;
};

export type SlackPostEphemeralArgs = SlackSdkContext & {
  channel: string;
  userId: string;
  text: string;
  idempotencyKey?: string | undefined;
};

export type SlackUploadFileArgs = SlackSdkContext & {
  channel: string;
  filename: string;
  content: string;
  title?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type SlackAddBookmarkArgs = SlackSdkContext & {
  channel: string;
  title: string;
  link: string;
  emoji?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type SlackEditBookmarkArgs = SlackSdkContext & {
  channel: string;
  bookmarkId: string;
  title?: string | undefined;
  link?: string | undefined;
  emoji?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type SlackRemoveBookmarkArgs = SlackSdkContext & {
  channel: string;
  bookmarkId: string;
  idempotencyKey?: string | undefined;
};

export type SlackListBookmarksArgs = SlackSdkContext & {
  channel: string;
};

export type SlackAddReminderArgs = SlackSdkContext & {
  text: string;
  time: number;
  userId?: string | undefined;
  idempotencyKey?: string | undefined;
};

export type SlackListRemindersArgs = SlackSdkContext & {
  userId?: string | undefined;
};

export type SlackDeleteReminderArgs = SlackSdkContext & {
  reminderId: string;
  idempotencyKey?: string | undefined;
};

export type SlackListUserGroupsArgs = SlackSdkContext & {
  includeDisabled?: boolean | undefined;
};

export type SlackListUserGroupMembersArgs = SlackSdkContext & {
  userGroupId: string;
  includeDisabled?: boolean | undefined;
};

export type SlackGetUserPresenceArgs = SlackSdkContext & {
  userId: string;
};

export type SlackListReactionsArgs = SlackSdkContext & {
  userId?: string | undefined;
  limit: number;
};

export type SlackMeMessageArgs = SlackSdkContext & {
  channel: string;
  text: string;
  idempotencyKey?: string | undefined;
};

export type SlackCreateChannelArgs = SlackSdkContext & {
  name: string;
  isPrivate?: boolean | undefined;
  idempotencyKey?: string | undefined;
};

export type SlackInviteToChannelArgs = SlackSdkContext & {
  channel: string;
  userIds: string[];
  idempotencyKey?: string | undefined;
};

export type SlackJoinChannelArgs = SlackSdkContext & {
  channel: string;
  idempotencyKey?: string | undefined;
};

export type SlackListChannelMembersArgs = SlackSdkContext & {
  channel: string;
  limit: number;
};

export type SlackMarkChannelReadArgs = SlackSdkContext & {
  channel: string;
  ts: string;
  idempotencyKey?: string | undefined;
};

export type SlackArchiveChannelArgs = SlackSdkContext & {
  channel: string;
  idempotencyKey?: string | undefined;
};

export type SlackSetChannelPurposeArgs = SlackSdkContext & {
  channel: string;
  purpose: string;
  idempotencyKey?: string | undefined;
};

export type SlackSetChannelTopicArgs = SlackSdkContext & {
  channel: string;
  topic: string;
  idempotencyKey?: string | undefined;
};

export type SlackOpenDmArgs = SlackSdkContext & {
  userIds: string[];
  idempotencyKey?: string | undefined;
};

export type SlackRenameChannelArgs = SlackSdkContext & {
  channel: string;
  name: string;
  idempotencyKey?: string | undefined;
};

export type SlackKickFromChannelArgs = SlackSdkContext & {
  channel: string;
  userId: string;
  idempotencyKey?: string | undefined;
};

export type SlackLeaveChannelArgs = SlackSdkContext & {
  channel: string;
  idempotencyKey?: string | undefined;
};

export type SlackCloseDmArgs = SlackSdkContext & {
  channel: string;
  idempotencyKey?: string | undefined;
};

export type SlackScheduleMessageArgs = SlackSdkContext & {
  channel: string;
  text: string;
  postAt: number;
  idempotencyKey?: string | undefined;
};

export type SlackDeleteScheduledMessageArgs = SlackSdkContext & {
  channel: string;
  scheduledMessageId: string;
  idempotencyKey?: string | undefined;
};

export type SlackListScheduledMessagesArgs = SlackSdkContext & {
  channel?: string | undefined;
  limit: number;
};

export type SlackGetPermalinkArgs = SlackSdkContext & {
  channel: string;
  ts: string;
};

export type SlackRemoveReactionArgs = SlackSdkContext & {
  channel: string;
  ts: string;
  name: string;
  idempotencyKey?: string | undefined;
};

export type SlackPinMessageArgs = SlackSdkContext & {
  channel: string;
  ts: string;
  idempotencyKey?: string | undefined;
};

export type SlackListPinsArgs = SlackSdkContext & {
  channel: string;
};

export type SlackListFilesArgs = SlackSdkContext & {
  channel?: string | undefined;
  userId?: string | undefined;
  limit: number;
};

export type SlackGetFileInfoArgs = SlackSdkContext & {
  fileId: string;
};

export type SlackDeleteFileArgs = SlackSdkContext & {
  fileId: string;
  idempotencyKey?: string | undefined;
};

export type SlackGetUserProfileArgs = SlackSdkContext & {
  userId: string;
};

export type SlackSearchFilesArgs = SlackSdkContext & {
  query: string;
  limit: number;
};

export type SlackPostMessageResponse = {
  ok: NonNullable<ChatPostMessageResponse["ok"]>;
  channel: NonNullable<ChatPostMessageResponse["channel"]>;
  ts: NonNullable<ChatPostMessageResponse["ts"]>;
  message: {
    text: NonNullable<SlackPostedMessage["text"]>;
    client_msg_id?: string;
  };
};

export type SlackUpdateMessageResponse = {
  ok: NonNullable<ChatUpdateResponse["ok"]>;
  channel: NonNullable<ChatUpdateResponse["channel"]>;
  ts: NonNullable<ChatUpdateResponse["ts"]>;
  message: {
    text: NonNullable<SlackUpdatedMessage["text"]>;
    client_msg_id?: string;
  };
};

export type SlackDeleteMessageResponse = {
  ok: NonNullable<ChatDeleteResponse["ok"]>;
  channel: NonNullable<ChatDeleteResponse["channel"]>;
  ts: NonNullable<ChatDeleteResponse["ts"]>;
};

export type SlackAddReactionResponse = {
  ok: boolean;
  channel: string;
  ts: string;
  name: string;
};

export type SlackPostEphemeralResponse = {
  ok: NonNullable<ChatPostEphemeralResponse["ok"]>;
  channel: string;
  messageTs: NonNullable<ChatPostEphemeralResponse["message_ts"]>;
};

export type SlackUploadFileResponse = {
  ok: NonNullable<FilesUploadResponse["ok"]>;
  file: SlackFile;
};

export type SlackAddBookmarkResponse = {
  ok: NonNullable<BookmarksAddResponse["ok"]>;
  bookmark: SlackBookmark;
};

export type SlackEditBookmarkResponse = {
  ok: NonNullable<BookmarksEditResponse["ok"]>;
  bookmark: SlackBookmark;
};

export type SlackRemoveBookmarkResponse = {
  ok: NonNullable<BookmarksRemoveResponse["ok"]>;
  channel: string;
  bookmarkId: string;
};

export type SlackAddReminderResponse = {
  ok: NonNullable<RemindersAddResponse["ok"]>;
  reminder: SlackReminder;
};

export type SlackDeleteReminderResponse = {
  ok: NonNullable<RemindersDeleteResponse["ok"]>;
  reminderId: string;
};

export type SlackMeMessageResponse = {
  ok: NonNullable<ChatMeMessageResponse["ok"]>;
  channel: string;
  ts: string;
  text: string;
};

export type SlackCreateChannelResponse = {
  ok: boolean;
  channel: SlackChannelInfo;
};

export type SlackInviteToChannelResponse = {
  ok: boolean;
  channel: SlackChannelInfo;
  invitedUserIds: string[];
};

export type SlackJoinChannelResponse = {
  ok: boolean;
  channel: SlackChannelInfo;
};

export type SlackMarkChannelReadResponse = {
  ok: boolean;
  channel: string;
  ts: string;
};

export type SlackArchiveChannelResponse = {
  ok: boolean;
  channel: SlackChannelInfo;
};

export type SlackSetChannelPurposeResponse = {
  ok: boolean;
  channel: string;
  purpose: string;
};

export type SlackSetChannelTopicResponse = {
  ok: boolean;
  channel: string;
  topic: string;
};

export type SlackOpenDmResponse = {
  ok: boolean;
  channel: SlackChannelInfo;
  userIds: string[];
};

export type SlackRenameChannelResponse = {
  ok: boolean;
  channel: SlackChannelInfo;
};

export type SlackKickFromChannelResponse = {
  ok: boolean;
  channel: SlackChannelInfo;
  userId: string;
};

export type SlackLeaveChannelResponse = {
  ok: boolean;
  channel: SlackChannelInfo;
};

export type SlackCloseDmResponse = {
  ok: boolean;
  channel: SlackChannelInfo;
};

export type SlackScheduleMessageResponse = {
  ok: boolean;
  channel: string;
  scheduledMessageId: string;
  postAt: number;
  messageTs?: string | undefined;
};

export type SlackDeleteScheduledMessageResponse = {
  ok: boolean;
  channel: string;
  scheduledMessageId: string;
};

export type SlackGetPermalinkResponse = {
  ok: boolean;
  channel: string;
  ts: string;
  permalink: string;
};

export type SlackRemoveReactionResponse = {
  ok: boolean;
  channel: string;
  ts: string;
  name: string;
};

export type SlackPinMessageResponse = {
  ok: boolean;
  channel: string;
  ts: string;
};

export type SlackDeleteFileResponse = {
  ok: boolean;
  fileId: string;
};

export interface SlackSdkPort extends ProviderSdkPort {
  listChannels(args: SlackListChannelsArgs): Promise<SlackChannel[]>;
  getChannelHistory(args: SlackGetChannelHistoryArgs): Promise<SlackMessage[]>;
  getThreadReplies(args: SlackGetThreadRepliesArgs): Promise<SlackMessage[]>;
  getReactions(args: SlackGetReactionsArgs): Promise<SlackMessageReaction[]>;
  listUsers(args: SlackListUsersArgs): Promise<SlackUser[]>;
  getUserInfo(args: SlackGetUserInfoArgs): Promise<SlackUser>;
  getChannelInfo(args: SlackGetChannelInfoArgs): Promise<SlackChannelInfo>;
  searchMessages(args: SlackSearchMessagesArgs): Promise<SlackMessage[]>;
  postMessage(args: SlackPostMessageArgs): Promise<SlackPostMessageResponse>;
  updateMessage(args: SlackUpdateMessageArgs): Promise<SlackUpdateMessageResponse>;
  deleteMessage(args: SlackDeleteMessageArgs): Promise<SlackDeleteMessageResponse>;
  addReaction(args: SlackAddReactionArgs): Promise<SlackAddReactionResponse>;
  postEphemeral(args: SlackPostEphemeralArgs): Promise<SlackPostEphemeralResponse>;
  uploadFile(args: SlackUploadFileArgs): Promise<SlackUploadFileResponse>;
  addBookmark(args: SlackAddBookmarkArgs): Promise<SlackAddBookmarkResponse>;
  editBookmark(args: SlackEditBookmarkArgs): Promise<SlackEditBookmarkResponse>;
  removeBookmark(args: SlackRemoveBookmarkArgs): Promise<SlackRemoveBookmarkResponse>;
  listBookmarks(args: SlackListBookmarksArgs): Promise<SlackBookmark[]>;
  addReminder(args: SlackAddReminderArgs): Promise<SlackAddReminderResponse>;
  listReminders(args: SlackListRemindersArgs): Promise<SlackReminder[]>;
  deleteReminder(args: SlackDeleteReminderArgs): Promise<SlackDeleteReminderResponse>;
  listUserGroups(args: SlackListUserGroupsArgs): Promise<SlackUserGroup[]>;
  listUserGroupMembers(args: SlackListUserGroupMembersArgs): Promise<string[]>;
  getUserPresence(args: SlackGetUserPresenceArgs): Promise<SlackUserPresence>;
  listReactions(args: SlackListReactionsArgs): Promise<SlackListedReaction[]>;
  meMessage(args: SlackMeMessageArgs): Promise<SlackMeMessageResponse>;
  createChannel(args: SlackCreateChannelArgs): Promise<SlackCreateChannelResponse>;
  inviteToChannel(args: SlackInviteToChannelArgs): Promise<SlackInviteToChannelResponse>;
  joinChannel(args: SlackJoinChannelArgs): Promise<SlackJoinChannelResponse>;
  listChannelMembers(args: SlackListChannelMembersArgs): Promise<string[]>;
  markChannelRead(args: SlackMarkChannelReadArgs): Promise<SlackMarkChannelReadResponse>;
  archiveChannel(args: SlackArchiveChannelArgs): Promise<SlackArchiveChannelResponse>;
  unarchiveChannel(args: SlackArchiveChannelArgs): Promise<SlackArchiveChannelResponse>;
  setChannelPurpose(args: SlackSetChannelPurposeArgs): Promise<SlackSetChannelPurposeResponse>;
  setChannelTopic(args: SlackSetChannelTopicArgs): Promise<SlackSetChannelTopicResponse>;
  openDM(args: SlackOpenDmArgs): Promise<SlackOpenDmResponse>;
  renameChannel(args: SlackRenameChannelArgs): Promise<SlackRenameChannelResponse>;
  kickFromChannel(args: SlackKickFromChannelArgs): Promise<SlackKickFromChannelResponse>;
  leaveChannel(args: SlackLeaveChannelArgs): Promise<SlackLeaveChannelResponse>;
  closeDM(args: SlackCloseDmArgs): Promise<SlackCloseDmResponse>;
  scheduleMessage(args: SlackScheduleMessageArgs): Promise<SlackScheduleMessageResponse>;
  deleteScheduledMessage(
    args: SlackDeleteScheduledMessageArgs,
  ): Promise<SlackDeleteScheduledMessageResponse>;
  listScheduledMessages(args: SlackListScheduledMessagesArgs): Promise<SlackScheduledMessage[]>;
  getPermalink(args: SlackGetPermalinkArgs): Promise<SlackGetPermalinkResponse>;
  removeReaction(args: SlackRemoveReactionArgs): Promise<SlackRemoveReactionResponse>;
  pinMessage(args: SlackPinMessageArgs): Promise<SlackPinMessageResponse>;
  unpinMessage(args: SlackPinMessageArgs): Promise<SlackPinMessageResponse>;
  listPins(args: SlackListPinsArgs): Promise<SlackPinItem[]>;
  listFiles(args: SlackListFilesArgs): Promise<SlackFile[]>;
  getFileInfo(args: SlackGetFileInfoArgs): Promise<SlackFile>;
  deleteFile(args: SlackDeleteFileArgs): Promise<SlackDeleteFileResponse>;
  getUserProfile(args: SlackGetUserProfileArgs): Promise<SlackUserProfile>;
  searchFiles(args: SlackSearchFilesArgs): Promise<SlackFile[]>;
}

const _slackChannelTypeCompatibilityCheck: Pick<SlackConversation, "id" | "name"> =
  {} as SlackChannel;
void _slackChannelTypeCompatibilityCheck;

const _slackMessageTypeCompatibilityCheck: Pick<SlackHistoryMessage, "ts" | "text"> = {} as {
  ts: SlackMessage["ts"];
  text: SlackMessage["text"];
};
void _slackMessageTypeCompatibilityCheck;

const _slackReplyTypeCompatibilityCheck: Pick<SlackReplyMessage, "ts" | "text"> = {} as {
  ts: SlackMessage["ts"];
  text: SlackMessage["text"];
};
void _slackReplyTypeCompatibilityCheck;

const _slackReactionTypeCompatibilityCheck: Pick<SlackReactionMessage, "reactions"> = {
  reactions: [],
};
void _slackReactionTypeCompatibilityCheck;

const _slackUserTypeCompatibilityCheck: Pick<SlackUserDetails, "id" | "name"> = {} as SlackUser;
void _slackUserTypeCompatibilityCheck;

const _slackChannelInfoTypeCompatibilityCheck: Pick<SlackConversationInfo, "id" | "name"> =
  {} as SlackChannelInfo;
void _slackChannelInfoTypeCompatibilityCheck;

const _slackSearchTypeCompatibilityCheck: Pick<SlackSearchMatch, "ts" | "text"> = {} as {
  ts: SlackMessage["ts"];
  text: SlackMessage["text"];
};
void _slackSearchTypeCompatibilityCheck;

const _slackBookmarkTypeCompatibilityCheck: Pick<SlackBookmarkPayload, "id" | "title"> = {} as {
  id: SlackBookmark["id"];
  title: SlackBookmark["title"];
};
void _slackBookmarkTypeCompatibilityCheck;

const _slackReminderTypeCompatibilityCheck: Pick<SlackReminderPayload, "id" | "text"> = {} as {
  id: SlackReminder["id"];
  text: SlackReminder["text"];
};
void _slackReminderTypeCompatibilityCheck;

const _slackUserGroupTypeCompatibilityCheck: Pick<SlackUserGroupPayload, "id" | "name"> = {} as {
  id: SlackUserGroup["id"];
  name: SlackUserGroup["name"];
};
void _slackUserGroupTypeCompatibilityCheck;

const _slackPresenceTypeCompatibilityCheck: Pick<UsersGetPresenceResponse, "presence"> = {} as {
  presence: SlackUserPresence["presence"];
};
void _slackPresenceTypeCompatibilityCheck;

const _slackReactionsListTypeCompatibilityCheck: Pick<SlackReactionListPayload, "type"> = {
  type: "message",
};
void _slackReactionsListTypeCompatibilityCheck;

const _slackUsergroupMembersTypeCompatibilityCheck: Pick<UsergroupsUsersListResponse, "users"> = {
  users: [],
};
void _slackUsergroupMembersTypeCompatibilityCheck;
