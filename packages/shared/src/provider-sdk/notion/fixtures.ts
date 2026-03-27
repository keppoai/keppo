import type {
  NotionBlock,
  NotionComment,
  NotionDatabase,
  NotionPage,
  NotionUser,
} from "./types.js";

export const seedNotionPages = (): NotionPage[] => {
  return [
    {
      id: "page_100",
      title: "Support Playbook",
      content: "Triage and escalation steps for support incidents.",
      url: "https://example.notion.so/page_100",
      properties: {
        title: {
          id: "title",
          type: "title",
          value: "Support Playbook",
        },
        Status: {
          id: "status",
          type: "select",
          value: "Active",
        },
      },
    },
    {
      id: "page_101",
      title: "Escalation Policy",
      content: "Escalate incidents with customer impact over 30 minutes.",
      url: "https://example.notion.so/page_101",
      properties: {
        title: {
          id: "title",
          type: "title",
          value: "Escalation Policy",
        },
        Status: {
          id: "status",
          type: "select",
          value: "Draft",
        },
      },
    },
  ];
};

export const seedNotionDatabases = (): NotionDatabase[] => {
  return [
    {
      id: "db_100",
      title: "Support Tickets",
      propertyKeys: ["Name", "Status", "Priority"],
      parentPageId: "page_100",
      url: "https://example.notion.so/db_100",
    },
    {
      id: "db_101",
      title: "Escalation Queue",
      propertyKeys: ["Name", "Owner", "Severity"],
      parentPageId: "page_101",
      url: "https://example.notion.so/db_101",
    },
  ];
};

export const seedNotionBlocks = (): Record<string, NotionBlock[]> => {
  return {
    page_100: [
      {
        id: "blk_100_1",
        type: "paragraph",
        text: "Support Playbook introduction",
        hasChildren: false,
      },
      {
        id: "blk_100_2",
        type: "paragraph",
        text: "Escalation runbook section",
        hasChildren: false,
      },
    ],
    page_101: [
      {
        id: "blk_101_1",
        type: "paragraph",
        text: "Escalation policy summary",
        hasChildren: false,
      },
    ],
  };
};

export const seedNotionComments = (): NotionComment[] => {
  return [
    {
      id: "cmt_100",
      pageId: "page_100",
      content: "Please keep this playbook updated monthly.",
      createdBy: "support-bot",
    },
    {
      id: "cmt_101",
      pageId: "page_101",
      content: "Escalation threshold needs legal review.",
      createdBy: "ops-manager",
    },
  ];
};

export const seedNotionUsers = (): NotionUser[] => {
  return [
    {
      id: "usr_100",
      type: "person",
      name: "Casey Support",
      email: "casey@example.com",
    },
    {
      id: "usr_101",
      type: "person",
      name: "Riley Ops",
      email: "riley@example.com",
    },
  ];
};

export const seedNotionBotUser = (): NotionUser => {
  return {
    id: "bot_100",
    type: "bot",
    name: "Keppo Bot",
  };
};
