import { createFakeSdkFactory } from "../sdk-factory.js";
import { FakeNotionClientStore, createFakeNotionClientStore } from "./fake-client-runtime.js";
import { NotionSdk } from "./sdk-runtime.js";

export { FakeNotionClientStore, createFakeNotionClientStore } from "./fake-client-runtime.js";

export const createFakeNotionSdk = createFakeSdkFactory<NotionSdk, FakeNotionClientStore>({
  createClientStore: createFakeNotionClientStore,
  build: (clientStore, options): NotionSdk =>
    new NotionSdk({
      createClient: clientStore.createClient,
      runtime: "fake",
      ...options,
    }),
});
