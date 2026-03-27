import type { RedditTypedHttpClient } from "./http-client.js";

export type RedditClient = RedditTypedHttpClient;

export type CreateRedditClient = (accessToken: string, namespace?: string) => RedditClient;
