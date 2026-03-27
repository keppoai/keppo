import { createFakeSdkFactory } from "../sdk-factory.js";
import { StripeSdk } from "./sdk-runtime.js";
import { FakeStripeClientStore, createFakeStripeClientStore } from "./fake-client-runtime.js";

export { FakeStripeClientStore, createFakeStripeClientStore } from "./fake-client-runtime.js";

export const createFakeStripeSdk = createFakeSdkFactory<StripeSdk, FakeStripeClientStore>({
  createClientStore: createFakeStripeClientStore,
  build: (clientStore, options): StripeSdk =>
    new StripeSdk({
      createClient: clientStore.createClient,
      runtime: "fake",
      ...options,
    }),
});
