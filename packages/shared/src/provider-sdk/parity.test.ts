import { describe, expect, it } from "vitest";
import { createFakeGmailClientStore, createFakeGmailSdk } from "./google/fake.js";
import { createFakeStripeClientStore, createFakeStripeSdk } from "./stripe/fake.js";
import { createFakeGithubClientStore, createFakeGithubSdk } from "./github/fake.js";
import { createFakeSlackClientStore, createFakeSlackSdk } from "./slack/fake.js";
import { createFakeNotionClientStore, createFakeNotionSdk } from "./notion/fake.js";
import { createFakeRedditClientStore, createFakeRedditSdk } from "./reddit/fake.js";
import { createFakeXClientStore, createFakeXSdk } from "./x/fake.js";

const toBase64Url = (value: string): string =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const expectRateLimited = async (operation: () => Promise<unknown>): Promise<void> => {
  await expect(operation()).rejects.toMatchObject({
    shape: {
      category: "rate_limit",
    },
  });
};

describe("provider sdk parity", () => {
  it("gmail fake store drives shared sdk idempotency + reset", async () => {
    const namespace = "gmail-parity";
    const clientStore = createFakeGmailClientStore();
    const sdk = createFakeGmailSdk({ clientStore });
    const accessToken = "fake_gmail_access_token";

    const raw = toBase64Url("To: support@example.com\r\nSubject: parity\r\n\r\nhello from parity");
    const first = await sdk.sendMessage({
      accessToken,
      namespace,
      raw,
      idempotencyKey: "gmail-idem-1",
    });
    const second = await sdk.sendMessage({
      accessToken,
      namespace,
      raw,
      idempotencyKey: "gmail-idem-1",
    });
    expect(second).toEqual(first);

    clientStore.seed(namespace, { forceRateLimit: true });
    await expectRateLimited(() =>
      sdk.listMessages({
        accessToken,
        namespace,
        query: "",
        maxResults: 5,
      }),
    );

    clientStore.reset(namespace);
    const listing = await sdk.listMessages({
      accessToken,
      namespace,
      query: "",
      maxResults: 5,
    });
    expect(Array.isArray(listing.messages)).toBe(true);
  });

  it("stripe fake store drives shared sdk idempotency + reset", async () => {
    const namespace = "stripe-parity";
    const clientStore = createFakeStripeClientStore();
    const sdk = createFakeStripeSdk({ clientStore });
    const accessToken = "fake_stripe_access_token";

    const first = await sdk.createRefund({
      accessToken,
      namespace,
      customerId: "cus_100",
      chargeId: "ch_cus_100",
      amount: 50,
      currency: "usd",
      idempotencyKey: "stripe-idem-1",
    });
    const second = await sdk.createRefund({
      accessToken,
      namespace,
      customerId: "cus_100",
      chargeId: "ch_cus_100",
      amount: 50,
      currency: "usd",
      idempotencyKey: "stripe-idem-1",
    });
    expect(second).toEqual(first);

    clientStore.seed(namespace, { forceRateLimit: true });
    await expectRateLimited(() =>
      sdk.listCharges({
        accessToken,
        namespace,
        customerId: "cus_100",
      }),
    );

    clientStore.reset(namespace);
    const charges = await sdk.listCharges({
      accessToken,
      namespace,
      customerId: "cus_100",
    });
    expect(Array.isArray(charges)).toBe(true);
  });

  it("github fake store drives shared sdk idempotency + seed/reset", async () => {
    const namespace = "github-parity";
    const clientStore = createFakeGithubClientStore();
    const sdk = createFakeGithubSdk({ clientStore });
    const accessToken = "fake_github_access_token";

    const first = await sdk.createIssue({
      accessToken,
      namespace,
      repo: "keppo",
      title: "Parity issue",
      body: "created in parity test",
      idempotencyKey: "github-idem-1",
    });
    const second = await sdk.createIssue({
      accessToken,
      namespace,
      repo: "keppo",
      title: "Parity issue",
      body: "created in parity test",
      idempotencyKey: "github-idem-1",
    });
    expect(second).toEqual(first);

    clientStore.seed(namespace, {
      repo: "keppo",
      issues: [{ id: 900, number: 900, title: "Seeded Issue", state: "open" }],
    });
    const seeded = await sdk.listIssues({
      accessToken,
      namespace,
      repo: "keppo",
      state: "open",
      perPage: 20,
    });
    expect(seeded.some((issue) => issue.title === "Seeded Issue")).toBe(true);

    clientStore.reset(namespace);
    const reset = await sdk.listIssues({
      accessToken,
      namespace,
      repo: "keppo",
      state: "open",
      perPage: 20,
    });
    expect(reset.some((issue) => issue.title === "Seeded Issue")).toBe(false);
  });

  it("slack fake store drives shared sdk idempotency + reset", async () => {
    const namespace = "slack-parity";
    const clientStore = createFakeSlackClientStore();
    const sdk = createFakeSlackSdk({ clientStore });
    const accessToken = "fake_slack_access_token";

    const channels = await sdk.listChannels({
      accessToken,
      namespace,
      limit: 1,
    });
    const channel = channels[0]?.id ?? "C123";

    const first = await sdk.postMessage({
      accessToken,
      namespace,
      channel,
      text: "parity message",
      idempotencyKey: "slack-idem-1",
    });
    const second = await sdk.postMessage({
      accessToken,
      namespace,
      channel,
      text: "parity message",
      idempotencyKey: "slack-idem-1",
    });
    expect(second).toEqual(first);

    clientStore.seed(namespace, { forceRateLimit: true });
    await expectRateLimited(() =>
      sdk.listChannels({
        accessToken,
        namespace,
        limit: 20,
      }),
    );

    clientStore.reset(namespace);
    const resetChannels = await sdk.listChannels({
      accessToken,
      namespace,
      limit: 20,
    });
    expect(Array.isArray(resetChannels)).toBe(true);
  });

  it("notion fake store drives shared sdk idempotency + reset", async () => {
    const namespace = "notion-parity";
    const clientStore = createFakeNotionClientStore();
    const sdk = createFakeNotionSdk({ clientStore });
    const accessToken = "fake_notion_access_token";

    const first = await sdk.createPage({
      accessToken,
      namespace,
      title: "Parity page",
      content: "notion parity",
      idempotencyKey: "notion-idem-1",
    });
    const second = await sdk.createPage({
      accessToken,
      namespace,
      title: "Parity page",
      content: "notion parity",
      idempotencyKey: "notion-idem-1",
    });
    expect(second).toEqual(first);

    const createdDatabase = await sdk.createDatabase({
      accessToken,
      namespace,
      title: "Parity DB",
      propertyNames: ["Name", "Status"],
      parentPageId: "page_100",
      idempotencyKey: "notion-idem-db-1",
    });
    const createdDatabaseReplay = await sdk.createDatabase({
      accessToken,
      namespace,
      title: "Parity DB",
      propertyNames: ["Name", "Status"],
      parentPageId: "page_100",
      idempotencyKey: "notion-idem-db-1",
    });
    expect(createdDatabaseReplay).toEqual(createdDatabase);

    const updatedDatabase = await sdk.updateDatabase({
      accessToken,
      namespace,
      databaseId: "db_100",
      title: "Parity DB Updated",
      propertyNames: ["Name", "Status", "Priority"],
      idempotencyKey: "notion-idem-db-2",
    });
    expect(updatedDatabase.title).toBe("Parity DB Updated");

    const block = await sdk.getBlock({
      accessToken,
      namespace,
      blockId: "blk_100_1",
    });
    expect(block.id).toBe("blk_100_1");

    const updatedBlock = await sdk.updateBlock({
      accessToken,
      namespace,
      blockId: "blk_100_1",
      content: "Parity block update",
      idempotencyKey: "notion-idem-block-1",
    });
    const updatedBlockReplay = await sdk.updateBlock({
      accessToken,
      namespace,
      blockId: "blk_100_1",
      content: "Parity block update",
      idempotencyKey: "notion-idem-block-1",
    });
    expect(updatedBlockReplay).toEqual(updatedBlock);

    const deletedBlock = await sdk.deleteBlock({
      accessToken,
      namespace,
      blockId: "blk_101_1",
      idempotencyKey: "notion-idem-block-2",
    });
    const deletedBlockReplay = await sdk.deleteBlock({
      accessToken,
      namespace,
      blockId: "blk_101_1",
      idempotencyKey: "notion-idem-block-2",
    });
    expect(deletedBlockReplay).toEqual(deletedBlock);
    expect(deletedBlock.archived).toBe(true);

    const property = await sdk.getPageProperty({
      accessToken,
      namespace,
      pageId: "page_100",
      propertyId: "title",
    });
    expect(property.pageId).toBe("page_100");

    const users = await sdk.listUsers({
      accessToken,
      namespace,
      pageSize: 5,
    });
    expect(users.length).toBeGreaterThan(0);
    const user = await sdk.getUser({
      accessToken,
      namespace,
      userId: users[0]!.id,
    });
    expect(user.id).toBe(users[0]!.id);

    const botUser = await sdk.getBotUser({
      accessToken,
      namespace,
    });
    expect(botUser.type).toBe("bot");

    clientStore.seed(namespace, { forceRateLimit: true });
    await expectRateLimited(() =>
      sdk.searchPages({
        accessToken,
        namespace,
        query: "",
        pageSize: 5,
      }),
    );

    clientStore.reset(namespace);
    const pages = await sdk.searchPages({
      accessToken,
      namespace,
      query: "",
      pageSize: 5,
    });
    expect(Array.isArray(pages)).toBe(true);
  });

  it("reddit fake store drives shared sdk idempotency + reset", async () => {
    const namespace = "reddit-parity";
    const clientStore = createFakeRedditClientStore();
    const sdk = createFakeRedditSdk({ clientStore });
    const accessToken = "fake_reddit_access_token";

    const first = await sdk.createPost({
      accessToken,
      namespace,
      subreddit: "all",
      title: "Parity post",
      body: "reddit parity",
      idempotencyKey: "reddit-idem-1",
    });
    const second = await sdk.createPost({
      accessToken,
      namespace,
      subreddit: "all",
      title: "Parity post",
      body: "reddit parity",
      idempotencyKey: "reddit-idem-1",
    });
    expect(second).toEqual(first);

    const rising = await sdk.listRising({
      accessToken,
      namespace,
      subreddit: "support",
      limit: 5,
    });
    expect(Array.isArray(rising)).toBe(true);

    const controversial = await sdk.listControversial({
      accessToken,
      namespace,
      subreddit: "support",
      limit: 5,
    });
    expect(Array.isArray(controversial)).toBe(true);

    const subreddits = await sdk.searchSubreddits({
      accessToken,
      namespace,
      query: "support",
      limit: 5,
    });
    expect(subreddits.some((entry) => entry.name === "support")).toBe(true);

    const overview = await sdk.getUserOverview({
      accessToken,
      namespace,
      username: "support_mod",
      limit: 5,
    });
    expect(overview.username).toBe("support_mod");

    const about = await sdk.getUserAbout({
      accessToken,
      namespace,
      username: "support_mod",
    });
    expect(about.name).toBe("support_mod");

    const edited = await sdk.editPost({
      accessToken,
      namespace,
      thingId: "t3_100",
      body: "edited parity body",
      idempotencyKey: "reddit-idem-2",
    });
    const editedReplay = await sdk.editPost({
      accessToken,
      namespace,
      thingId: "t3_100",
      body: "edited parity body",
      idempotencyKey: "reddit-idem-2",
    });
    expect(editedReplay).toEqual(edited);

    const approved = await sdk.approve({
      accessToken,
      namespace,
      thingId: "t3_100",
      idempotencyKey: "reddit-idem-3",
    });
    const approvedReplay = await sdk.approve({
      accessToken,
      namespace,
      thingId: "t3_100",
      idempotencyKey: "reddit-idem-3",
    });
    expect(approvedReplay).toEqual(approved);

    await sdk.removeContent({
      accessToken,
      namespace,
      thingId: "t3_100",
      idempotencyKey: "reddit-idem-4",
    });
    await sdk.lockPost({
      accessToken,
      namespace,
      thingId: "t3_100",
      idempotencyKey: "reddit-idem-5",
    });
    await sdk.unlockPost({
      accessToken,
      namespace,
      thingId: "t3_100",
      idempotencyKey: "reddit-idem-6",
    });

    const distinguished = await sdk.distinguish({
      accessToken,
      namespace,
      thingId: "t3_100",
      sticky: true,
      idempotencyKey: "reddit-idem-6b",
    });
    expect(distinguished.distinguished).toBe(true);

    const sticky = await sdk.stickyPost({
      accessToken,
      namespace,
      thingId: "t3_100",
      state: true,
      slot: 1,
      idempotencyKey: "reddit-idem-6c",
    });
    expect(sticky.state).toBe(true);

    await sdk.markNsfw({
      accessToken,
      namespace,
      thingId: "t3_100",
      idempotencyKey: "reddit-idem-6d",
    });
    await sdk.unmarkNsfw({
      accessToken,
      namespace,
      thingId: "t3_100",
      idempotencyKey: "reddit-idem-6e",
    });
    await sdk.spoiler({
      accessToken,
      namespace,
      thingId: "t3_100",
      idempotencyKey: "reddit-idem-6f",
    });
    await sdk.unspoiler({
      accessToken,
      namespace,
      thingId: "t3_100",
      idempotencyKey: "reddit-idem-6g",
    });
    await sdk.selectFlair({
      accessToken,
      namespace,
      subreddit: "support",
      thingId: "t3_100",
      text: "Announcement",
      cssClass: "announcement",
      idempotencyKey: "reddit-idem-6h",
    });
    await sdk.subscribe({
      accessToken,
      namespace,
      subreddit: "support",
      action: "sub",
      idempotencyKey: "reddit-idem-6i",
    });

    const modQueue = await sdk.getModQueue({
      accessToken,
      namespace,
      subreddit: "support",
      limit: 5,
    });
    expect(Array.isArray(modQueue)).toBe(true);

    await sdk.reportContent({
      accessToken,
      namespace,
      thingId: "t3_100",
      reason: "parity-report",
      idempotencyKey: "reddit-idem-6j",
    });
    const reports = await sdk.getReports({
      accessToken,
      namespace,
      subreddit: "support",
      limit: 5,
    });
    expect(Array.isArray(reports)).toBe(true);

    const modLog = await sdk.getModLog({
      accessToken,
      namespace,
      subreddit: "support",
      limit: 5,
    });
    expect(Array.isArray(modLog)).toBe(true);

    const rules = await sdk.getSubredditRules({
      accessToken,
      namespace,
      subreddit: "support",
    });
    expect(rules.length).toBeGreaterThan(0);

    const modmail = await sdk.listModmail({
      accessToken,
      namespace,
      subreddit: "support",
      limit: 5,
    });
    expect(modmail.length).toBeGreaterThan(0);

    const modmailConversation = await sdk.getModmail({
      accessToken,
      namespace,
      conversationId: modmail[0]!.id,
    });
    expect(modmailConversation.id).toBe(modmail[0]!.id);

    const modmailReply = await sdk.replyModmail({
      accessToken,
      namespace,
      conversationId: modmailConversation.id,
      body: "Thanks for the report.",
      isInternal: false,
      idempotencyKey: "reddit-idem-6k",
    });
    expect(modmailReply.conversationId).toBe(modmailConversation.id);

    await sdk.savePost({
      accessToken,
      namespace,
      thingId: "t3_100",
      idempotencyKey: "reddit-idem-7",
    });
    await sdk.unsavePost({
      accessToken,
      namespace,
      thingId: "t3_100",
      idempotencyKey: "reddit-idem-8",
    });
    await sdk.hidePost({
      accessToken,
      namespace,
      thingId: "t3_100",
      idempotencyKey: "reddit-idem-9",
    });
    await sdk.unhidePost({
      accessToken,
      namespace,
      thingId: "t3_100",
      idempotencyKey: "reddit-idem-10",
    });
    await sdk.reportContent({
      accessToken,
      namespace,
      thingId: "t3_100",
      reason: "parity report",
      idempotencyKey: "reddit-idem-11",
    });

    const composed = await sdk.composeMessage({
      accessToken,
      namespace,
      to: "support_mod",
      subject: "parity message",
      body: "hello from parity",
      idempotencyKey: "reddit-idem-12",
    });
    expect(composed.to).toBe("support_mod");

    const sent = await sdk.listSentMessages({
      accessToken,
      namespace,
      limit: 5,
    });
    expect(sent.length).toBeGreaterThan(0);

    const mentions = await sdk.listMentions({
      accessToken,
      namespace,
      limit: 5,
    });
    expect(Array.isArray(mentions)).toBe(true);

    const read = await sdk.readMessage({
      accessToken,
      namespace,
      messageId: "t4_700",
      idempotencyKey: "reddit-idem-13",
    });
    expect(read.unread).toBe(false);

    const readAll = await sdk.readAllMessages({
      accessToken,
      namespace,
      idempotencyKey: "reddit-idem-14",
    });
    expect(readAll.readCount).toBeGreaterThanOrEqual(0);

    const deleted = await sdk.deletePost({
      accessToken,
      namespace,
      thingId: "t3_102",
      idempotencyKey: "reddit-idem-15",
    });
    expect(deleted.success).toBe(true);

    clientStore.seed(namespace, { forceRateLimit: true });
    await expectRateLimited(() =>
      sdk.listHot({
        accessToken,
        namespace,
        subreddit: "all",
        limit: 5,
      }),
    );

    clientStore.reset(namespace);
    const posts = await sdk.listHot({
      accessToken,
      namespace,
      subreddit: "all",
      limit: 5,
    });
    expect(Array.isArray(posts)).toBe(true);
  });

  it("x fake store drives shared sdk idempotency + reset", async () => {
    const namespace = "x-parity";
    const clientStore = createFakeXClientStore();
    const sdk = createFakeXSdk({ clientStore });
    const accessToken = "fake_x_access_token";

    const first = await sdk.createPost({
      accessToken,
      namespace,
      text: "x parity post",
      idempotencyKey: "x-idem-1",
    });
    const second = await sdk.createPost({
      accessToken,
      namespace,
      text: "x parity post",
      idempotencyKey: "x-idem-1",
    });
    expect(second).toEqual(first);

    const quoteTweets = await sdk.getQuoteTweets({
      accessToken,
      namespace,
      postId: "x_100",
      maxResults: 5,
    });
    expect(Array.isArray(quoteTweets)).toBe(true);

    const followers = await sdk.getFollowers({
      accessToken,
      namespace,
      userId: "u_100",
      maxResults: 5,
    });
    expect(followers.some((entry) => entry.id === "u_101")).toBe(true);

    const following = await sdk.getFollowing({
      accessToken,
      namespace,
      userId: "u_100",
      maxResults: 5,
    });
    expect(following.some((entry) => entry.id === "u_101")).toBe(true);

    const followed = await sdk.followUser({
      accessToken,
      namespace,
      userId: "u_100",
      targetUserId: "u_101",
      idempotencyKey: "x-idem-2",
    });
    const followedReplay = await sdk.followUser({
      accessToken,
      namespace,
      userId: "u_100",
      targetUserId: "u_101",
      idempotencyKey: "x-idem-2",
    });
    expect(followedReplay).toEqual(followed);

    const unfollowed = await sdk.unfollowUser({
      accessToken,
      namespace,
      userId: "u_100",
      targetUserId: "u_101",
      idempotencyKey: "x-idem-3",
    });
    const unfollowedReplay = await sdk.unfollowUser({
      accessToken,
      namespace,
      userId: "u_100",
      targetUserId: "u_101",
      idempotencyKey: "x-idem-3",
    });
    expect(unfollowedReplay).toEqual(unfollowed);

    const liked = await sdk.likePost({
      accessToken,
      namespace,
      userId: "u_100",
      postId: "x_100",
      idempotencyKey: "x-idem-4",
    });
    const likedReplay = await sdk.likePost({
      accessToken,
      namespace,
      userId: "u_100",
      postId: "x_100",
      idempotencyKey: "x-idem-4",
    });
    expect(likedReplay).toEqual(liked);

    const likingUsers = await sdk.getLikingUsers({
      accessToken,
      namespace,
      postId: "x_100",
      maxResults: 5,
    });
    expect(likingUsers.some((entry) => entry.id === "u_100")).toBe(true);

    const likedPosts = await sdk.getLikedPosts({
      accessToken,
      namespace,
      userId: "u_100",
      maxResults: 5,
    });
    expect(likedPosts.some((entry) => entry.id === "x_100")).toBe(true);

    await sdk.unlikePost({
      accessToken,
      namespace,
      userId: "u_100",
      postId: "x_100",
      idempotencyKey: "x-idem-5",
    });

    const reposted = await sdk.repost({
      accessToken,
      namespace,
      userId: "u_100",
      postId: "x_100",
      idempotencyKey: "x-idem-6",
    });
    const repostedReplay = await sdk.repost({
      accessToken,
      namespace,
      userId: "u_100",
      postId: "x_100",
      idempotencyKey: "x-idem-6",
    });
    expect(repostedReplay).toEqual(reposted);

    const repostedBy = await sdk.getRepostedBy({
      accessToken,
      namespace,
      postId: "x_100",
      maxResults: 5,
    });
    expect(repostedBy.some((entry) => entry.id === "u_100")).toBe(true);

    await sdk.undoRepost({
      accessToken,
      namespace,
      userId: "u_100",
      postId: "x_100",
      idempotencyKey: "x-idem-7",
    });

    const blocked = await sdk.blockUser({
      accessToken,
      namespace,
      userId: "u_100",
      targetUserId: "u_101",
      idempotencyKey: "x-idem-8",
    });
    const blockedReplay = await sdk.blockUser({
      accessToken,
      namespace,
      userId: "u_100",
      targetUserId: "u_101",
      idempotencyKey: "x-idem-8",
    });
    expect(blockedReplay).toEqual(blocked);

    const blockedUsers = await sdk.getBlockedUsers({
      accessToken,
      namespace,
      userId: "u_100",
      maxResults: 5,
    });
    expect(blockedUsers.some((entry) => entry.id === "u_101")).toBe(true);

    await sdk.unblockUser({
      accessToken,
      namespace,
      userId: "u_100",
      targetUserId: "u_101",
      idempotencyKey: "x-idem-9",
    });

    const muted = await sdk.muteUser({
      accessToken,
      namespace,
      userId: "u_100",
      targetUserId: "u_101",
      idempotencyKey: "x-idem-10",
    });
    const mutedReplay = await sdk.muteUser({
      accessToken,
      namespace,
      userId: "u_100",
      targetUserId: "u_101",
      idempotencyKey: "x-idem-10",
    });
    expect(mutedReplay).toEqual(muted);

    const mutedUsers = await sdk.getMutedUsers({
      accessToken,
      namespace,
      userId: "u_100",
      maxResults: 5,
    });
    expect(mutedUsers.some((entry) => entry.id === "u_101")).toBe(true);

    await sdk.unmuteUser({
      accessToken,
      namespace,
      userId: "u_100",
      targetUserId: "u_101",
      idempotencyKey: "x-idem-11",
    });

    const bookmark = await sdk.createBookmark({
      accessToken,
      namespace,
      userId: "u_100",
      postId: "x_100",
      idempotencyKey: "x-idem-12",
    });
    const bookmarkReplay = await sdk.createBookmark({
      accessToken,
      namespace,
      userId: "u_100",
      postId: "x_100",
      idempotencyKey: "x-idem-12",
    });
    expect(bookmarkReplay).toEqual(bookmark);

    const bookmarks = await sdk.getBookmarks({
      accessToken,
      namespace,
      userId: "u_100",
      maxResults: 5,
    });
    expect(bookmarks.some((entry) => entry.id === "x_100")).toBe(true);

    await sdk.deleteBookmark({
      accessToken,
      namespace,
      userId: "u_100",
      postId: "x_100",
      idempotencyKey: "x-idem-13",
    });

    const dmConversation = await sdk.createDmConversation({
      accessToken,
      namespace,
      participantIds: ["u_100", "u_101"],
      text: "hello x parity",
      idempotencyKey: "x-idem-14",
    });
    const dmConversationReplay = await sdk.createDmConversation({
      accessToken,
      namespace,
      participantIds: ["u_100", "u_101"],
      text: "hello x parity",
      idempotencyKey: "x-idem-14",
    });
    expect(dmConversationReplay).toEqual(dmConversation);

    const searchedUsers = await sdk.searchUsers({
      accessToken,
      namespace,
      query: "keppo",
      maxResults: 5,
    });
    expect(searchedUsers.some((entry) => entry.username === "keppo")).toBe(true);

    const usersByUsernames = await sdk.getUsersByUsernames({
      accessToken,
      namespace,
      usernames: ["keppo", "support_bot"],
    });
    expect(usersByUsernames.length).toBeGreaterThanOrEqual(2);

    const createdList = await sdk.createList({
      accessToken,
      namespace,
      name: "Parity X List",
      description: "list parity",
      isPrivate: false,
      idempotencyKey: "x-idem-15",
    });
    const createdListReplay = await sdk.createList({
      accessToken,
      namespace,
      name: "Parity X List",
      description: "list parity",
      isPrivate: false,
      idempotencyKey: "x-idem-15",
    });
    expect(createdListReplay).toEqual(createdList);

    const updatedList = await sdk.updateList({
      accessToken,
      namespace,
      listId: createdList.id,
      name: "Parity X List Updated",
      idempotencyKey: "x-idem-16",
    });
    expect(updatedList.name).toBe("Parity X List Updated");

    const readList = await sdk.getList({
      accessToken,
      namespace,
      listId: createdList.id,
    });
    expect(readList.id).toBe(createdList.id);

    const ownedLists = await sdk.getOwnedLists({
      accessToken,
      namespace,
      userId: "u_100",
      maxResults: 10,
    });
    expect(ownedLists.some((entry) => entry.id === createdList.id)).toBe(true);

    const addedMember = await sdk.addListMember({
      accessToken,
      namespace,
      listId: createdList.id,
      userId: "u_101",
      idempotencyKey: "x-idem-17",
    });
    const addedMemberReplay = await sdk.addListMember({
      accessToken,
      namespace,
      listId: createdList.id,
      userId: "u_101",
      idempotencyKey: "x-idem-17",
    });
    expect(addedMemberReplay).toEqual(addedMember);

    const members = await sdk.getListMembers({
      accessToken,
      namespace,
      listId: createdList.id,
      maxResults: 10,
    });
    expect(members.some((entry) => entry.id === "u_101")).toBe(true);

    const listTweets = await sdk.getListTweets({
      accessToken,
      namespace,
      listId: createdList.id,
      maxResults: 10,
    });
    expect(Array.isArray(listTweets)).toBe(true);

    const homeTimeline = await sdk.getHomeTimeline({
      accessToken,
      namespace,
      userId: "u_100",
      maxResults: 10,
    });
    expect(Array.isArray(homeTimeline)).toBe(true);

    const allPosts = await sdk.searchAllPosts({
      accessToken,
      namespace,
      query: "keppo",
      maxResults: 10,
    });
    expect(Array.isArray(allPosts)).toBe(true);

    const postCounts = await sdk.getPostCounts({
      accessToken,
      namespace,
      query: "keppo",
    });
    expect(postCounts.total).toBeGreaterThanOrEqual(1);

    await sdk.removeListMember({
      accessToken,
      namespace,
      listId: createdList.id,
      userId: "u_101",
      idempotencyKey: "x-idem-18",
    });

    const deletedList = await sdk.deleteList({
      accessToken,
      namespace,
      listId: createdList.id,
      idempotencyKey: "x-idem-19",
    });
    expect(deletedList.deleted).toBe(true);

    clientStore.seed(namespace, { forceRateLimit: true });
    await expectRateLimited(() =>
      sdk.searchRecentPosts({
        accessToken,
        namespace,
        query: "parity",
        maxResults: 5,
      }),
    );

    clientStore.reset(namespace);
    const posts = await sdk.searchRecentPosts({
      accessToken,
      namespace,
      query: "parity",
      maxResults: 5,
    });
    expect(Array.isArray(posts)).toBe(true);
  });
});
