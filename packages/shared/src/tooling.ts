import { providerRegistry } from "./providers.js";
import {
  allTools,
  maskEmail,
  redactByPolicy,
  toolMap,
  type ToolDefinition,
} from "./tool-definitions.js";
import type { CanonicalProviderId } from "./provider-catalog.js";

const providerTools = (providerId: CanonicalProviderId): ToolDefinition[] =>
  providerRegistry.getProviderTools(providerId);

const createProviderToolView = (providerId: CanonicalProviderId): ToolDefinition[] => {
  return new Proxy([] as ToolDefinition[], {
    get(_target, property, _receiver) {
      const tools = providerTools(providerId);
      const value = Reflect.get(tools, property);
      return typeof value === "function" ? value.bind(tools) : value;
    },
    has(_target, property) {
      return property in providerTools(providerId);
    },
    ownKeys() {
      return Reflect.ownKeys(providerTools(providerId));
    },
    getOwnPropertyDescriptor(_target, property) {
      return Object.getOwnPropertyDescriptor(providerTools(providerId), property);
    },
  });
};

export const gmailTools = createProviderToolView("google");
export const stripeTools = createProviderToolView("stripe");
export const slackTools = createProviderToolView("slack");
export const githubTools = createProviderToolView("github");
export const notionTools = createProviderToolView("notion");
export const redditTools = createProviderToolView("reddit");
export const xTools = createProviderToolView("x");
export const linkedinTools = createProviderToolView("linkedin");
export const customTools = createProviderToolView("custom");

export const keppoInternalTools: ToolDefinition[] = allTools.filter(
  (tool) => tool.provider === "keppo",
);

export { allTools, maskEmail, redactByPolicy, toolMap };
export type { ToolDefinition };
