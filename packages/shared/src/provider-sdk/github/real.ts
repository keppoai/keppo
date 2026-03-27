import { createRealSdkFactory } from "../sdk-factory.js";
import { createRealGithubClient } from "./client.js";
import { GithubSdk } from "./sdk-runtime.js";

export const createRealGithubSdk = createRealSdkFactory(
  (options): GithubSdk =>
    new GithubSdk({
      createClient: createRealGithubClient,
      runtime: "real",
      ...options,
    }),
);
