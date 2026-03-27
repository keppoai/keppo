import { createFakeSdkFactory } from "../sdk-factory.js";
import { SlackSdk } from "./sdk-runtime.js";
import { FakeSlackClientStore, createFakeSlackClientStore } from "./fake-client-runtime.js";

export { FakeSlackClientStore, createFakeSlackClientStore } from "./fake-client-runtime.js";

export const createFakeSlackSdk = createFakeSdkFactory<SlackSdk, FakeSlackClientStore>({
  createClientStore: createFakeSlackClientStore,
  build: (clientStore, options): SlackSdk =>
    new SlackSdk({
      createClient: clientStore.createClient,
      runtime: "fake",
      ...options,
    }),
});
