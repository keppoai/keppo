import { createFakeSdkFactory } from "../sdk-factory.js";
import { FakeXClientStore, createFakeXClientStore } from "./fake-client-runtime.js";
import { XSdk } from "./sdk-runtime.js";

export { FakeXClientStore, createFakeXClientStore } from "./fake-client-runtime.js";

export const createFakeXSdk = createFakeSdkFactory<XSdk, FakeXClientStore>({
  createClientStore: createFakeXClientStore,
  build: (clientStore, options): XSdk =>
    new XSdk({
      createClient: clientStore.createClient,
      runtime: "fake",
      ...options,
    }),
});
