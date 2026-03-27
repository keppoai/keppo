import { CANONICAL_PROVIDER_IDS } from "../../provider-catalog.js";
import type { ProviderAutomationTriggerDefinition, ProviderModuleV2 } from "../registry/types.js";
import { assertProviderModulesV2Invariants } from "../registry/invariants.js";
import { customProviderModule } from "./custom/index.js";
import { githubProviderModule } from "./github/index.js";
import { googleProviderModule } from "./google/index.js";
import { notionProviderModule } from "./notion/index.js";
import { redditProviderModule } from "./reddit/index.js";
import { slackProviderModule } from "./slack/index.js";
import { stripeProviderModule } from "./stripe/index.js";
import { xProviderModule } from "./x/index.js";

export {
  customProviderModule,
  githubProviderModule,
  googleProviderModule,
  notionProviderModule,
  redditProviderModule,
  slackProviderModule,
  stripeProviderModule,
  xProviderModule,
};

export const providerModulesV2: Array<ProviderModuleV2> = [
  googleProviderModule,
  stripeProviderModule,
  githubProviderModule,
  slackProviderModule,
  notionProviderModule,
  redditProviderModule,
  xProviderModule,
  customProviderModule,
];

assertProviderModulesV2Invariants(providerModulesV2);

export const providerModuleV2ById = new Map(
  providerModulesV2.map((module) => [module.providerId, module] as const),
);

for (const providerId of CANONICAL_PROVIDER_IDS) {
  if (!providerModuleV2ById.has(providerId)) {
    throw new Error(`ProviderModuleV2 is missing canonical provider "${providerId}".`);
  }
}

export const getProviderModuleV2 = (providerId: string): ProviderModuleV2 => {
  const module = providerModuleV2ById.get(providerId as ProviderModuleV2["providerId"]);
  if (!module) {
    throw new Error(`ProviderModuleV2 "${providerId}" is not registered.`);
  }
  return module;
};

export const listPollingAutomationTriggers = (): Array<{
  providerId: ProviderModuleV2["providerId"];
  trigger: ProviderAutomationTriggerDefinition;
}> => {
  return providerModulesV2.flatMap((module) => {
    const triggerEntries = Object.values(module.facets.automationTriggers?.triggers ?? {});
    return triggerEntries
      .filter((trigger) => trigger.scheduler.strategy === "polling")
      .map((trigger) => ({
        providerId: module.providerId,
        trigger,
      }));
  });
};
