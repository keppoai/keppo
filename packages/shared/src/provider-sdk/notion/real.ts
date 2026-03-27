import { createRealSdkFactory } from "../sdk-factory.js";
import { createRealNotionClient } from "./client.js";
import { NotionSdk } from "./sdk-runtime.js";

export const createRealNotionSdk = createRealSdkFactory(
  (options): NotionSdk =>
    new NotionSdk({
      createClient: createRealNotionClient,
      runtime: "real",
      ...options,
    }),
);
