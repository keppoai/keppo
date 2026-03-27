import { createRealSdkFactory } from "../sdk-factory.js";
import { createRealXClient } from "./client.js";
import { XSdk } from "./sdk-runtime.js";

export const createRealXSdk = createRealSdkFactory(
  (options): XSdk =>
    new XSdk({
      createClient: createRealXClient,
      runtime: "real",
      ...options,
    }),
);
