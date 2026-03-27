import { createRealSdkFactory } from "../sdk-factory.js";
import { createRealGmailClient } from "./client.js";
import { GmailSdk } from "./sdk-runtime.js";

export const createRealGmailSdk = createRealSdkFactory(
  (options): GmailSdk =>
    new GmailSdk({
      createClient: createRealGmailClient,
      runtime: "real",
      ...options,
    }),
);
