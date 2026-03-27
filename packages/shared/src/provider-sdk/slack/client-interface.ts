import type {
  BookmarksAddResponse,
  BookmarksEditResponse,
  BookmarksListResponse,
  BookmarksRemoveResponse,
  ChatDeleteScheduledMessageResponse,
  ChatGetPermalinkResponse,
  ChatDeleteResponse,
  ChatMeMessageResponse,
  ChatScheduleMessageResponse,
  ChatScheduledMessagesListResponse,
  ChatPostEphemeralResponse,
  ChatPostMessageResponse,
  ChatUpdateResponse,
  ConversationsArchiveResponse,
  ConversationsCloseResponse,
  ConversationsCreateResponse,
  ConversationsHistoryResponse,
  ConversationsInfoResponse,
  ConversationsInviteResponse,
  ConversationsJoinResponse,
  ConversationsKickResponse,
  ConversationsLeaveResponse,
  ConversationsListResponse,
  ConversationsMembersResponse,
  ConversationsOpenResponse,
  ConversationsRenameResponse,
  ConversationsSetPurposeResponse,
  ConversationsSetTopicResponse,
  ConversationsMarkResponse,
  ConversationsRepliesResponse,
  ConversationsUnarchiveResponse,
  FilesDeleteResponse,
  FilesInfoResponse,
  FilesListResponse,
  FilesUploadResponse,
  ReactionsAddResponse,
  ReactionsGetResponse,
  ReactionsListResponse,
  ReactionsRemoveResponse,
  RemindersAddResponse,
  RemindersDeleteResponse,
  RemindersListResponse,
  SearchMessagesResponse,
  SearchFilesResponse,
  PinsAddResponse,
  PinsListResponse,
  PinsRemoveResponse,
  UsersProfileGetResponse,
  UsergroupsListResponse,
  UsergroupsUsersListResponse,
  UsersGetPresenceResponse,
  UsersInfoResponse,
  UsersListResponse,
} from "@slack/web-api";

export type SlackClientRequestOptions = {
  requestContext: string;
  idempotencyKey?: string;
};

export interface SlackClient {
  conversations: {
    list(params: { limit: number; types: string }): Promise<ConversationsListResponse>;
    history(params: { channel: string; limit: number }): Promise<ConversationsHistoryResponse>;
    replies(params: {
      channel: string;
      ts: string;
      limit: number;
    }): Promise<ConversationsRepliesResponse>;
    info(params: { channel: string }): Promise<ConversationsInfoResponse>;
    create(params: { name: string; is_private?: boolean }): Promise<ConversationsCreateResponse>;
    invite(params: { channel: string; users: string }): Promise<ConversationsInviteResponse>;
    join(params: { channel: string }): Promise<ConversationsJoinResponse>;
    members(params: { channel: string; limit?: number }): Promise<ConversationsMembersResponse>;
    mark(params: { channel: string; ts: string }): Promise<ConversationsMarkResponse>;
    archive(params: { channel: string }): Promise<ConversationsArchiveResponse>;
    unarchive(params: { channel: string }): Promise<ConversationsUnarchiveResponse>;
    setPurpose(params: {
      channel: string;
      purpose: string;
    }): Promise<ConversationsSetPurposeResponse>;
    setTopic(params: { channel: string; topic: string }): Promise<ConversationsSetTopicResponse>;
    open(params: { users: string }): Promise<ConversationsOpenResponse>;
    rename(params: { channel: string; name: string }): Promise<ConversationsRenameResponse>;
    kick(params: { channel: string; user: string }): Promise<ConversationsKickResponse>;
    leave(params: { channel: string }): Promise<ConversationsLeaveResponse>;
    close(params: { channel: string }): Promise<ConversationsCloseResponse>;
  };
  reactions: {
    get(params: {
      channel: string;
      timestamp: string;
      full: boolean;
    }): Promise<ReactionsGetResponse>;
    add(params: {
      channel: string;
      timestamp: string;
      name: string;
    }): Promise<ReactionsAddResponse>;
    list(params: { user?: string; full?: boolean; count?: number }): Promise<ReactionsListResponse>;
    remove(params: {
      channel: string;
      timestamp: string;
      name: string;
    }): Promise<ReactionsRemoveResponse>;
  };
  users: {
    list(params: { limit: number }): Promise<UsersListResponse>;
    info(params: { user: string }): Promise<UsersInfoResponse>;
    getPresence(params: { user: string }): Promise<UsersGetPresenceResponse>;
    profile: {
      get(params: { user: string }): Promise<UsersProfileGetResponse>;
    };
  };
  bookmarks: {
    add(params: {
      channel_id: string;
      title: string;
      type: "link";
      link: string;
      emoji?: string;
    }): Promise<BookmarksAddResponse>;
    edit(params: {
      channel_id: string;
      bookmark_id: string;
      title?: string;
      link?: string;
      emoji?: string;
    }): Promise<BookmarksEditResponse>;
    remove(params: { channel_id: string; bookmark_id: string }): Promise<BookmarksRemoveResponse>;
    list(params: { channel_id: string }): Promise<BookmarksListResponse>;
  };
  reminders: {
    add(params: { text: string; time: number; user?: string }): Promise<RemindersAddResponse>;
    list(): Promise<RemindersListResponse>;
    delete(params: { reminder: string }): Promise<RemindersDeleteResponse>;
  };
  usergroups: {
    list(params?: { include_disabled?: boolean }): Promise<UsergroupsListResponse>;
    users: {
      list(params: {
        usergroup: string;
        include_disabled?: boolean;
      }): Promise<UsergroupsUsersListResponse>;
    };
  };
  search: {
    messages(params: { query: string; count: number }): Promise<SearchMessagesResponse>;
    files(params: { query: string; count: number }): Promise<SearchFilesResponse>;
  };
  chat: {
    postMessage(params: { channel: string; text: string }): Promise<ChatPostMessageResponse>;
    meMessage(params: { channel: string; text: string }): Promise<ChatMeMessageResponse>;
    update(params: { channel: string; ts: string; text: string }): Promise<ChatUpdateResponse>;
    delete(params: { channel: string; ts: string }): Promise<ChatDeleteResponse>;
    postEphemeral(params: {
      channel: string;
      user: string;
      text: string;
    }): Promise<ChatPostEphemeralResponse>;
    scheduleMessage(params: {
      channel: string;
      text: string;
      post_at: number;
    }): Promise<ChatScheduleMessageResponse>;
    deleteScheduledMessage(params: {
      channel: string;
      scheduled_message_id: string;
    }): Promise<ChatDeleteScheduledMessageResponse>;
    scheduledMessages: {
      list(params: {
        channel?: string;
        limit?: number;
      }): Promise<ChatScheduledMessagesListResponse>;
    };
    getPermalink(params: {
      channel: string;
      message_ts: string;
    }): Promise<ChatGetPermalinkResponse>;
  };
  pins: {
    add(params: { channel: string; timestamp: string }): Promise<PinsAddResponse>;
    remove(params: { channel: string; timestamp: string }): Promise<PinsRemoveResponse>;
    list(params: { channel: string }): Promise<PinsListResponse>;
  };
  files: {
    upload(params: {
      channels: string;
      filename: string;
      content: string;
      title?: string;
    }): Promise<FilesUploadResponse>;
    list(params: { channel?: string; user?: string; count?: number }): Promise<FilesListResponse>;
    info(params: { file: string }): Promise<FilesInfoResponse>;
    delete(params: { file: string }): Promise<FilesDeleteResponse>;
  };
}

export type CreateSlackClient = (
  accessToken: string,
  namespace?: string,
  options?: SlackClientRequestOptions,
) => SlackClient;
