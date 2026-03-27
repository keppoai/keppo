import type {
  RedditComment,
  RedditMessage,
  RedditModmailConversation,
  RedditPost,
  RedditSubredditInfo,
  RedditSubredditRule,
  RedditUser,
} from "./types.js";

export const seedRedditPosts = (): RedditPost[] => {
  return [
    {
      id: "t3_100",
      subreddit: "support",
      title: "Keppo release notes",
      body: "Highlights from this week",
      score: 120,
      author: "support_mod",
      createdUtc: 1_710_000_100,
    },
    {
      id: "t3_101",
      subreddit: "support",
      title: "Support workflow tips",
      body: "How we triage quickly",
      score: 52,
      author: "automation_one",
      createdUtc: 1_710_000_200,
    },
    {
      id: "t3_102",
      subreddit: "all",
      title: "Platform announcement",
      body: "Provider SDK migration updates",
      score: 31,
      author: "automation_two",
      createdUtc: 1_710_000_300,
    },
  ];
};

export const seedRedditComments = (): RedditComment[] => {
  return [
    {
      id: "t1_500",
      parentId: "t3_100",
      postId: "t3_100",
      body: "Great summary, thanks.",
      author: "automation_one",
      score: 10,
    },
    {
      id: "t1_501",
      parentId: "t3_100",
      postId: "t3_100",
      body: "Can we get follow-up details?",
      author: "automation_two",
      score: 4,
    },
  ];
};

export const seedRedditMessages = (): RedditMessage[] => {
  return [
    {
      id: "t4_700",
      to: "keppo_user",
      from: "mod_support",
      subject: "Welcome",
      body: "Thanks for joining the support subreddit.",
      unread: true,
    },
    {
      id: "t4_701",
      to: "keppo_user",
      from: "mod_bot",
      subject: "Mention summary",
      body: "u/keppo_user was mentioned in this week's highlights.",
      unread: true,
    },
  ];
};

export const seedRedditSubreddits = (): RedditSubredditInfo[] => {
  return [
    {
      id: "t5_support",
      name: "support",
      title: "Keppo Support",
      description: "Support workflows and announcements",
      subscribers: 1432,
    },
    {
      id: "t5_all",
      name: "all",
      title: "All",
      description: "Global feed",
      subscribers: 1_000_000,
    },
  ];
};

export const seedRedditSubredditRules = (): Record<string, RedditSubredditRule[]> => {
  return {
    support: [
      {
        shortName: "Be civil",
        description: "Treat other members with respect.",
        kind: "all",
        priority: 1,
      },
      {
        shortName: "No secrets",
        description: "Do not share credentials or API keys.",
        kind: "all",
        priority: 2,
      },
    ],
    all: [
      {
        shortName: "Sitewide rules apply",
        description: "Follow Reddit content policy.",
        kind: "all",
        priority: 1,
      },
    ],
  };
};

export const seedRedditModmailConversations = (): RedditModmailConversation[] => {
  return [
    {
      id: "modmail_900",
      subreddit: "support",
      subject: "Escalation follow-up",
      participant: "automation_one",
      state: "new",
      lastUpdatedUtc: 1_710_000_450,
      messages: [
        {
          id: "modmail_msg_900_1",
          author: "automation_one",
          body: "Could a mod review this escalation?",
          isInternal: false,
          createdUtc: 1_710_000_440,
        },
      ],
    },
    {
      id: "modmail_901",
      subreddit: "support",
      subject: "Rule clarification",
      participant: "automation_two",
      state: "inprogress",
      lastUpdatedUtc: 1_710_000_470,
      messages: [
        {
          id: "modmail_msg_901_1",
          author: "automation_two",
          body: "Can we post links in weekly updates?",
          isInternal: false,
          createdUtc: 1_710_000_460,
        },
      ],
    },
  ];
};

export const seedRedditMe = (): RedditUser => {
  return {
    id: "u_100",
    name: "keppo_user",
    commentKarma: 231,
    linkKarma: 544,
  };
};
