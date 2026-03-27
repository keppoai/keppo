import type { XDmEvent, XList, XPost, XUser } from "./types.js";

export const seedXPosts = (): XPost[] => {
  return [
    {
      id: "x_100",
      text: "Shipping the new Keppo release",
    },
    {
      id: "x_101",
      text: "How we approve AI actions safely",
    },
  ];
};

export const seedXUsers = (): XUser[] => {
  return [
    {
      id: "u_100",
      username: "keppo",
      name: "Keppo",
    },
    {
      id: "u_101",
      username: "support_bot",
      name: "Support Bot",
    },
  ];
};

export const seedXLists = (): XList[] => {
  return [
    {
      id: "list_100",
      name: "Keppo Core",
      ownerId: "u_100",
      description: "Core Keppo launch list",
      isPrivate: false,
    },
  ];
};

export const seedXDmEvents = (): XDmEvent[] => {
  return [
    {
      id: "dm_100",
      conversationId: "dmconv_100",
      senderId: "u_101",
      text: "Welcome to Keppo support.",
      createdAt: "2026-02-28T00:15:00.000Z",
    },
  ];
};
