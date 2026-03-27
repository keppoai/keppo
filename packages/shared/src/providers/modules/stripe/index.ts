import connector from "./connector.js";
import { createProviderModuleV2 } from "../../registry/builder.js";
import { PROVIDER_MODULE_SCHEMA_VERSION } from "../shared.js";
import { metadata } from "./metadata.js";
import { schemas } from "./schemas.js";
import { auth } from "./auth.js";
import { tools } from "./tools.js";
import { ui } from "./ui.js";
import { refresh } from "./refresh.js";
import { webhooks } from "./webhooks.js";

export { metadata } from "./metadata.js";
export { schemas } from "./schemas.js";
export { auth } from "./auth.js";
export { tools } from "./tools.js";
export { ui } from "./ui.js";
export { refresh } from "./refresh.js";
export { webhooks } from "./webhooks.js";

export const stripeProviderModule = createProviderModuleV2({
  schemaVersion: PROVIDER_MODULE_SCHEMA_VERSION,
  providerId: "stripe",
  metadata,
  connector,
  facets: {
    metadata,
    schemas,
    auth,
    tools,
    ui,
    refresh,
    webhooks,
  },
});
