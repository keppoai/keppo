import { createFakeSdkFactory } from "../sdk-factory.js";
import { FakeGmailClientStore, createFakeGmailClientStore } from "./fake-client-runtime.js";
import { GmailSdk } from "./sdk-runtime.js";

export { FakeGmailClientStore, createFakeGmailClientStore } from "./fake-client-runtime.js";

export const createFakeGmailSdk = createFakeSdkFactory<GmailSdk, FakeGmailClientStore>({
  createClientStore: createFakeGmailClientStore,
  build: (clientStore, options): GmailSdk =>
    new GmailSdk({
      createClient: clientStore.createClient,
      runtime: "fake",
      ...options,
    }),
});
