import { createFakeSdkFactory } from "../sdk-factory.js";
import { GithubSdk } from "./sdk-runtime.js";
import { FakeGithubClientStore, createFakeGithubClientStore } from "./fake-client-runtime.js";

export { FakeGithubClientStore, createFakeGithubClientStore } from "./fake-client-runtime.js";

export const createFakeGithubSdk = createFakeSdkFactory<GithubSdk, FakeGithubClientStore>({
  createClientStore: createFakeGithubClientStore,
  build: (clientStore, options): GithubSdk =>
    new GithubSdk({
      createClient: clientStore.createClient,
      runtime: "fake",
      ...options,
    }),
});
