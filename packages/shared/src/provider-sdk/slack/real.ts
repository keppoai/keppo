import { createRealSdkFactory } from "../sdk-factory.js";
import { createRealSlackClient } from "./client.js";
import { SlackSdk } from "./sdk-runtime.js";

export const createRealSlackSdk = createRealSdkFactory(
  (options): SlackSdk =>
    new SlackSdk({
      createClient: createRealSlackClient,
      runtime: "real",
      ...options,
    }),
);
