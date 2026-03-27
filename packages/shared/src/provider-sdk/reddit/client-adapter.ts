import type { RedditClient } from "./client-interface.js";
import type { InMemoryRedditEngine } from "./fake-client-runtime.js";

export const createFakeRedditClient = (
  engine: InMemoryRedditEngine,
  accessToken: string,
  namespace?: string,
): RedditClient => {
  return {
    searchPosts: async (args) => {
      const posts = await engine.searchPosts({
        accessToken,
        namespace,
        subreddit: args.subreddit,
        query: args.query,
        limit: args.limit,
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });
      return { posts };
    },
    listPosts: async (args) => {
      const posts =
        args.mode === "hot"
          ? await engine.listHot({ accessToken, namespace, ...args })
          : args.mode === "new"
            ? await engine.listNew({ accessToken, namespace, ...args })
            : args.mode === "top"
              ? await engine.listTop({ accessToken, namespace, ...args })
              : args.mode === "rising"
                ? await engine.listRising({ accessToken, namespace, ...args })
                : await engine.listControversial({ accessToken, namespace, ...args });
      return { posts };
    },
    searchSubreddits: async (args) => {
      const subreddits = await engine.searchSubreddits({ accessToken, namespace, ...args });
      return { subreddits };
    },
    getUserOverview: async (args) => {
      return engine.getUserOverview({ accessToken, namespace, ...args });
    },
    getUserAbout: async (args) => {
      const user = await engine.getUserAbout({ accessToken, namespace, ...args });
      return { user };
    },
    createPost: async (args) => engine.createPost({ accessToken, namespace, ...args }),
    createComment: async (args) => engine.createComment({ accessToken, namespace, ...args }),
    getPostComments: async (args) => engine.getPostComments({ accessToken, namespace, ...args }),
    getInfo: async (args) => {
      const items = await engine.getInfo({ accessToken, namespace, ...args });
      return { items };
    },
    editPost: async (args) => engine.editPost({ accessToken, namespace, ...args }),
    deletePost: async (args) => engine.deletePost({ accessToken, namespace, ...args }),
    approve: async (args) => engine.approve({ accessToken, namespace, ...args }),
    removeContent: async (args) => engine.removeContent({ accessToken, namespace, ...args }),
    distinguish: async (args) => engine.distinguish({ accessToken, namespace, ...args }),
    lockPost: async (args) => engine.lockPost({ accessToken, namespace, ...args }),
    unlockPost: async (args) => engine.unlockPost({ accessToken, namespace, ...args }),
    stickyPost: async (args) => engine.stickyPost({ accessToken, namespace, ...args }),
    markNsfw: async (args) => engine.markNsfw({ accessToken, namespace, ...args }),
    unmarkNsfw: async (args) => engine.unmarkNsfw({ accessToken, namespace, ...args }),
    spoiler: async (args) => engine.spoiler({ accessToken, namespace, ...args }),
    unspoiler: async (args) => engine.unspoiler({ accessToken, namespace, ...args }),
    selectFlair: async (args) => engine.selectFlair({ accessToken, namespace, ...args }),
    subscribe: async (args) => engine.subscribe({ accessToken, namespace, ...args }),
    savePost: async (args) => engine.savePost({ accessToken, namespace, ...args }),
    unsavePost: async (args) => engine.unsavePost({ accessToken, namespace, ...args }),
    hidePost: async (args) => engine.hidePost({ accessToken, namespace, ...args }),
    unhidePost: async (args) => engine.unhidePost({ accessToken, namespace, ...args }),
    reportContent: async (args) => engine.reportContent({ accessToken, namespace, ...args }),
    readMessage: async (args) => engine.readMessage({ accessToken, namespace, ...args }),
    readAllMessages: async (args) => engine.readAllMessages({ accessToken, namespace, ...args }),
    vote: async (args) => engine.vote({ accessToken, namespace, ...args }),
    composeMessage: async (args) => engine.composeMessage({ accessToken, namespace, ...args }),
    listInbox: async (args) => {
      const messages = await engine.listInbox({ accessToken, namespace, ...args });
      return { messages };
    },
    listUnreadMessages: async (args) => {
      const messages = await engine.listUnreadMessages({ accessToken, namespace, ...args });
      return { messages };
    },
    listSentMessages: async (args) => {
      const messages = await engine.listSentMessages({ accessToken, namespace, ...args });
      return { messages };
    },
    listMentions: async (args) => {
      const messages = await engine.listMentions({ accessToken, namespace, ...args });
      return { messages };
    },
    getSubredditInfo: async (args) => {
      const subreddit = await engine.getSubredditInfo({ accessToken, namespace, ...args });
      return { subreddit };
    },
    getModQueue: async (args) => {
      const items = await engine.getModQueue({ accessToken, namespace, ...args });
      return { items };
    },
    getReports: async (args) => {
      const items = await engine.getReports({ accessToken, namespace, ...args });
      return { items };
    },
    getModLog: async (args) => {
      const entries = await engine.getModLog({ accessToken, namespace, ...args });
      return { entries };
    },
    getSubredditRules: async (args) => {
      const rules = await engine.getSubredditRules({ accessToken, namespace, ...args });
      return { rules };
    },
    listModmail: async (args) => {
      const conversations = await engine.listModmail({ accessToken, namespace, ...args });
      return { conversations };
    },
    getModmail: async (args) => {
      const conversation = await engine.getModmail({ accessToken, namespace, ...args });
      return { conversation };
    },
    replyModmail: async (args) => engine.replyModmail({ accessToken, namespace, ...args }),
    getMe: async () => {
      const me = await engine.getMe({ accessToken, namespace });
      return { me };
    },
  };
};
