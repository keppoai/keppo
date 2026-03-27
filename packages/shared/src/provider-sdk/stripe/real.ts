import { createRealSdkFactory } from "../sdk-factory.js";
import { createRealStripeClient } from "./client.js";
import { StripeSdk } from "./sdk-runtime.js";

export const createRealStripeSdk = createRealSdkFactory(
  (options): StripeSdk =>
    new StripeSdk({
      createClient: createRealStripeClient,
      runtime: "real",
      ...options,
    }),
);
