import { createRealSdkFactory } from "../sdk-factory.js";
import { createRealLinkedInClient } from "./client.js";
import { LinkedInSdk } from "./sdk-runtime.js";

export const createRealLinkedInSdk = createRealSdkFactory(
  (options): LinkedInSdk =>
    new LinkedInSdk({
      createClient: createRealLinkedInClient,
      runtime: "real",
      ...options,
    }),
);
