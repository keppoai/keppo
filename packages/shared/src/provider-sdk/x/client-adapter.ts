import type { XClient } from "./client-interface.js";
import type { InMemoryXEngine } from "./fake-client-runtime.js";

export const createFakeXClient = (
  engine: InMemoryXEngine,
  accessToken: string,
  namespace?: string,
): XClient => {
  return {
    searchRecentPosts: async (args) => {
      const posts = await engine.searchRecentPosts({
        accessToken,
        namespace,
        query: args.query,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { posts };
    },
    createPost: async (args) => engine.createPost({ accessToken, namespace, ...args }),
    deletePost: async (args) => engine.deletePost({ accessToken, namespace, ...args }),
    getPost: async (args) => {
      const post = await engine.getPost({ accessToken, namespace, ...args });
      return { post };
    },
    getPosts: async (args) => {
      const posts = await engine.getPosts({ accessToken, namespace, ...args });
      return { posts };
    },
    getUserTimeline: async (args) => {
      const posts = await engine.getUserTimeline({
        accessToken,
        namespace,
        userId: args.userId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { posts };
    },
    getUserMentions: async (args) => {
      const posts = await engine.getUserMentions({
        accessToken,
        namespace,
        userId: args.userId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { posts };
    },
    getQuoteTweets: async (args) => {
      const posts = await engine.getQuoteTweets({
        accessToken,
        namespace,
        postId: args.postId,
        maxResults: args.maxResults,
      });
      return { posts };
    },
    getUserByUsername: async (args) => {
      const user = await engine.getUserByUsername({ accessToken, namespace, ...args });
      return { user };
    },
    getUserById: async (args) => {
      const user = await engine.getUserById({ accessToken, namespace, ...args });
      return { user };
    },
    getMe: async () => {
      const me = await engine.getMe({ accessToken, namespace });
      return { me };
    },
    getFollowers: async (args) => {
      const users = await engine.getFollowers({
        accessToken,
        namespace,
        userId: args.userId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { users };
    },
    getFollowing: async (args) => {
      const users = await engine.getFollowing({
        accessToken,
        namespace,
        userId: args.userId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { users };
    },
    followUser: async (args) => engine.followUser({ accessToken, namespace, ...args }),
    unfollowUser: async (args) => engine.unfollowUser({ accessToken, namespace, ...args }),
    likePost: async (args) => engine.likePost({ accessToken, namespace, ...args }),
    unlikePost: async (args) => engine.unlikePost({ accessToken, namespace, ...args }),
    getLikingUsers: async (args) => {
      const users = await engine.getLikingUsers({
        accessToken,
        namespace,
        postId: args.postId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { users };
    },
    getLikedPosts: async (args) => {
      const posts = await engine.getLikedPosts({
        accessToken,
        namespace,
        userId: args.userId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { posts };
    },
    repost: async (args) => engine.repost({ accessToken, namespace, ...args }),
    undoRepost: async (args) => engine.undoRepost({ accessToken, namespace, ...args }),
    getRepostedBy: async (args) => {
      const users = await engine.getRepostedBy({
        accessToken,
        namespace,
        postId: args.postId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { users };
    },
    blockUser: async (args) => engine.blockUser({ accessToken, namespace, ...args }),
    unblockUser: async (args) => engine.unblockUser({ accessToken, namespace, ...args }),
    getBlockedUsers: async (args) => {
      const users = await engine.getBlockedUsers({
        accessToken,
        namespace,
        userId: args.userId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { users };
    },
    muteUser: async (args) => engine.muteUser({ accessToken, namespace, ...args }),
    unmuteUser: async (args) => engine.unmuteUser({ accessToken, namespace, ...args }),
    getMutedUsers: async (args) => {
      const users = await engine.getMutedUsers({
        accessToken,
        namespace,
        userId: args.userId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { users };
    },
    createBookmark: async (args) => engine.createBookmark({ accessToken, namespace, ...args }),
    deleteBookmark: async (args) => engine.deleteBookmark({ accessToken, namespace, ...args }),
    getBookmarks: async (args) => {
      const posts = await engine.getBookmarks({
        accessToken,
        namespace,
        userId: args.userId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { posts };
    },
    sendDm: async (args) => {
      const event = await engine.sendDm({ accessToken, namespace, ...args });
      return { event };
    },
    createDmConversation: async (args) =>
      engine.createDmConversation({ accessToken, namespace, ...args }),
    getDmEvents: async (args) => {
      const events = await engine.getDmEvents({
        accessToken,
        namespace,
        maxResults: args.maxResults,
        ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      });
      return { events };
    },
    searchUsers: async (args) => {
      const users = await engine.searchUsers({
        accessToken,
        namespace,
        query: args.query,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { users };
    },
    getUsersByUsernames: async (args) => {
      const users = await engine.getUsersByUsernames({
        accessToken,
        namespace,
        usernames: args.usernames,
      });
      return { users };
    },
    createList: async (args) => {
      const list = await engine.createList({ accessToken, namespace, ...args });
      return { list };
    },
    deleteList: async (args) => engine.deleteList({ accessToken, namespace, ...args }),
    updateList: async (args) => {
      const list = await engine.updateList({ accessToken, namespace, ...args });
      return { list };
    },
    getList: async (args) => {
      const list = await engine.getList({ accessToken, namespace, ...args });
      return { list };
    },
    getOwnedLists: async (args) => {
      const lists = await engine.getOwnedLists({
        accessToken,
        namespace,
        userId: args.userId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { lists };
    },
    addListMember: async (args) => engine.addListMember({ accessToken, namespace, ...args }),
    removeListMember: async (args) => engine.removeListMember({ accessToken, namespace, ...args }),
    getListMembers: async (args) => {
      const users = await engine.getListMembers({
        accessToken,
        namespace,
        listId: args.listId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { users };
    },
    getListTweets: async (args) => {
      const posts = await engine.getListTweets({
        accessToken,
        namespace,
        listId: args.listId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { posts };
    },
    getHomeTimeline: async (args) => {
      const posts = await engine.getHomeTimeline({
        accessToken,
        namespace,
        userId: args.userId,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { posts };
    },
    searchAllPosts: async (args) => {
      const posts = await engine.searchAllPosts({
        accessToken,
        namespace,
        query: args.query,
        maxResults: args.maxResults,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { posts };
    },
    getPostCounts: async (args) => {
      const counts = await engine.getPostCounts({
        accessToken,
        namespace,
        query: args.query,
      });
      return { counts };
    },
  };
};
