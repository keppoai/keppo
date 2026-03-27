import { createFakeSdkFactory } from "../sdk-factory.js";
import { FakeRedditClientStore, createFakeRedditClientStore } from "./fake-client-runtime.js";
import { RedditSdk } from "./sdk-runtime.js";

export { FakeRedditClientStore, createFakeRedditClientStore } from "./fake-client-runtime.js";

export const createFakeRedditSdk = createFakeSdkFactory<RedditSdk, FakeRedditClientStore>({
  createClientStore: createFakeRedditClientStore,
  build: (clientStore, options): RedditSdk =>
    new RedditSdk({
      createClient: clientStore.createClient,
      runtime: "fake",
      ...options,
    }),
});
