import type { SlackChannel, SlackMessage, SlackMessageReaction, SlackUser } from "./types.js";

export const seedSlackChannels = (): SlackChannel[] => {
  return [
    {
      id: "C001",
      name: "support",
      isPrivate: false,
    },
    {
      id: "C002",
      name: "ops",
      isPrivate: false,
    },
    {
      id: "C003",
      name: "eng-internal",
      isPrivate: true,
    },
  ];
};

export const seedSlackUsers = (): SlackUser[] => {
  return [
    {
      id: "U001",
      name: "alice",
      realName: "Alice Support",
      isBot: false,
      isDeleted: false,
    },
    {
      id: "U002",
      name: "bob",
      realName: "Bob Ops",
      isBot: false,
      isDeleted: false,
    },
    {
      id: "U003",
      name: "keppo-bot",
      realName: "Keppo Bot",
      isBot: true,
      isDeleted: false,
    },
  ];
};

const seedSupportReactions = (): SlackMessageReaction[] => {
  return [
    {
      name: "eyes",
      count: 1,
      users: ["U001"],
    },
  ];
};

export const seedSlackMessages = (): SlackMessage[] => {
  return [
    {
      ts: "1700000000.000001",
      channel: "C001",
      text: "Customer asked for refund details",
      userId: "U001",
      reactions: seedSupportReactions(),
    },
    {
      ts: "1700000000.000002",
      channel: "C001",
      text: "Investigating with billing team",
      userId: "U002",
      threadTs: "1700000000.000001",
    },
    {
      ts: "1700000000.000003",
      channel: "C001",
      text: "Please share invoice id",
      userId: "U003",
      threadTs: "1700000000.000001",
    },
    {
      ts: "1700000000.000004",
      channel: "C002",
      text: "OPS: incident resolved",
      userId: "U002",
    },
  ];
};
