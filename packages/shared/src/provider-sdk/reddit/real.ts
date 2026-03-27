import { createRealSdkFactory } from "../sdk-factory.js";
import { createRealRedditClient } from "./client.js";
import { RedditSdk } from "./sdk-runtime.js";

export const createRealRedditSdk = createRealSdkFactory(
  (options): RedditSdk =>
    new RedditSdk({
      createClient: createRealRedditClient,
      runtime: "real",
      ...options,
    }),
);
