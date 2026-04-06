import { createFakeSdkFactory } from "../sdk-factory.js";
import { FakeLinkedInClientStore, createFakeLinkedInClientStore } from "./fake-client-runtime.js";
import { LinkedInSdk } from "./sdk-runtime.js";

export { FakeLinkedInClientStore, createFakeLinkedInClientStore } from "./fake-client-runtime.js";

export const createFakeLinkedInSdk = createFakeSdkFactory<LinkedInSdk, FakeLinkedInClientStore>({
  createClientStore: createFakeLinkedInClientStore,
  build: (clientStore, options): LinkedInSdk =>
    new LinkedInSdk({
      createClient: clientStore.createClient,
      runtime: "fake",
      ...options,
    }),
});
