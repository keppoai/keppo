import type { CanonicalProviderId } from "../../provider-catalog.js";
import type { ProviderAutomationTriggersFacet } from "../registry/types.js";
import { metadata as googleMetadata } from "./google/metadata.js";
import { automationTriggers as googleAutomationTriggers } from "./google/schemas.js";
import { metadata as redditMetadata } from "./reddit/metadata.js";
import { automationTriggers as redditAutomationTriggers } from "./reddit/schemas.js";
import { metadata as xMetadata } from "./x/metadata.js";
import { automationTriggers as xAutomationTriggers } from "./x/schemas.js";

export type AutomationTriggerModuleEntry = {
  providerId: CanonicalProviderId;
  automationTriggers: ProviderAutomationTriggersFacet;
};

export const automationTriggerModules: AutomationTriggerModuleEntry[] = [
  {
    providerId: googleMetadata.providerId,
    automationTriggers: googleAutomationTriggers,
  },
  {
    providerId: redditMetadata.providerId,
    automationTriggers: redditAutomationTriggers,
  },
  {
    providerId: xMetadata.providerId,
    automationTriggers: xAutomationTriggers,
  },
];
