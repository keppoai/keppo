import type {
  GmailAttachment,
  GmailDraft,
  GmailFilter,
  GmailLabel,
  GmailMessage,
  GmailSendAsAlias,
  GmailVacationSettings,
} from "./types.js";

export type GmailFixtureMessage = Partial<GmailMessage> & {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
  unread: boolean;
  historyId: string;
  labelIds: string[];
};

export type GmailFixtureLabel = Partial<GmailLabel> & {
  id: string;
  name: string;
  type: "system" | "user";
  labelListVisibility: string;
  messageListVisibility: string;
  messagesTotal: number;
  messagesUnread: number;
  threadsTotal: number;
  threadsUnread: number;
};

export type GmailFixtureDraft = Partial<GmailDraft> & {
  id: string;
  messageId: string;
  threadId: string;
  raw: string;
};

export type GmailFixtureFilter = Partial<GmailFilter> & {
  id: string;
  criteria: {
    from?: string;
    to?: string;
    subject?: string;
    query?: string;
    negatedQuery?: string;
    hasAttachment?: boolean;
    sizeComparison?: "larger" | "smaller";
    size?: number;
  };
  action: {
    addLabelIds?: string[];
    removeLabelIds?: string[];
    forward?: string;
  };
};

export type GmailFixtureSendAsAlias = Partial<GmailSendAsAlias> & {
  sendAsEmail: string;
  displayName: string;
  replyToAddress?: string;
  signature?: string;
  isPrimary: boolean;
  isDefault: boolean;
  treatAsAlias: boolean;
};

export type GmailFixtureVacationSettings = Partial<GmailVacationSettings> & {
  enableAutoReply: boolean;
  responseSubject: string;
  responseBodyPlainText: string;
  responseBodyHtml: string;
  restrictToContacts: boolean;
  restrictToDomain: boolean;
  startTime?: string;
  endTime?: string;
};

export type GmailFixtureAttachment = Partial<GmailAttachment> & {
  attachmentId: string;
  messageId: string;
  data: string;
  size: number;
};

export const seedGmailMessages = (): GmailFixtureMessage[] => [
  {
    id: "msg_seed_1",
    threadId: "thr_seed_1",
    from: "support@example.com",
    to: "automation@example.com",
    subject: "Welcome to Keppo",
    snippet: "Welcome to Keppo and thanks for signing up.",
    body: "Welcome to Keppo and thanks for signing up.",
    unread: true,
    historyId: "1001",
    labelIds: ["INBOX", "UNREAD"],
  },
  {
    id: "msg_seed_2",
    threadId: "thr_seed_2",
    from: "billing@example.com",
    to: "automation@example.com",
    subject: "Invoice Ready",
    snippet: "Your invoice is attached.",
    body: "Your invoice is attached.",
    unread: false,
    historyId: "1002",
    labelIds: ["INBOX"],
  },
];

export const seedGmailLabels = (): GmailFixtureLabel[] => [
  {
    id: "INBOX",
    name: "INBOX",
    type: "system",
    labelListVisibility: "labelShow",
    messageListVisibility: "show",
    messagesTotal: 2,
    messagesUnread: 1,
    threadsTotal: 2,
    threadsUnread: 1,
  },
  {
    id: "UNREAD",
    name: "UNREAD",
    type: "system",
    labelListVisibility: "labelHide",
    messageListVisibility: "show",
    messagesTotal: 1,
    messagesUnread: 1,
    threadsTotal: 1,
    threadsUnread: 1,
  },
  {
    id: "STARRED",
    name: "STARRED",
    type: "system",
    labelListVisibility: "labelShow",
    messageListVisibility: "show",
    messagesTotal: 0,
    messagesUnread: 0,
    threadsTotal: 0,
    threadsUnread: 0,
  },
  {
    id: "Label_1",
    name: "Needs-Response",
    type: "user",
    labelListVisibility: "labelShow",
    messageListVisibility: "show",
    messagesTotal: 0,
    messagesUnread: 0,
    threadsTotal: 0,
    threadsUnread: 0,
  },
];

export const seedGmailDrafts = (): GmailFixtureDraft[] => [
  {
    id: "dr_seed_1",
    messageId: "msg_seed_1",
    threadId: "thr_seed_1",
    raw: "VG86IHN1cHBvcnRAZXhhbXBsZS5jb20NClN1YmplY3Q6IERyYWZ0IFJlc3BvbnNlDQoNCkRyYWZ0IG1lc3NhZ2U=",
  },
];

export const seedGmailFilters = (): GmailFixtureFilter[] => [
  {
    id: "filter_1",
    criteria: {
      from: "alerts@example.com",
      hasAttachment: true,
    },
    action: {
      addLabelIds: ["Label_1"],
      removeLabelIds: ["INBOX"],
    },
  },
];

export const seedGmailSendAsAliases = (): GmailFixtureSendAsAlias[] => [
  {
    sendAsEmail: "automation@example.com",
    displayName: "Keppo Automation",
    replyToAddress: "support@example.com",
    signature: "Best,\nKeppo Automation",
    isPrimary: true,
    isDefault: true,
    treatAsAlias: false,
  },
  {
    sendAsEmail: "support@example.com",
    displayName: "Support Team",
    replyToAddress: "support@example.com",
    signature: "Regards,\nSupport Team",
    isPrimary: false,
    isDefault: false,
    treatAsAlias: true,
  },
];

export const seedGmailVacationSettings = (): GmailFixtureVacationSettings => ({
  enableAutoReply: false,
  responseSubject: "Out of office",
  responseBodyPlainText: "I am currently away and will reply soon.",
  responseBodyHtml: "<p>I am currently away and will reply soon.</p>",
  restrictToContacts: false,
  restrictToDomain: false,
});

export const seedGmailAttachments = (): GmailFixtureAttachment[] => [
  {
    attachmentId: "att_seed_1",
    messageId: "msg_seed_1",
    data: "U2FtcGxlIGF0dGFjaG1lbnQgY29udGVudA",
    size: 25,
  },
];
