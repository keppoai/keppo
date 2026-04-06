import { customTools } from "./tool-definitions/custom.js";
import { githubTools } from "./tool-definitions/github.js";
import { gmailTools } from "./tool-definitions/google.js";
import { keppoInternalTools } from "./tool-definitions/keppo.js";
import { linkedinTools } from "./tool-definitions/linkedin.js";
import { notionTools } from "./tool-definitions/notion.js";
import { redditTools } from "./tool-definitions/reddit.js";
import { slackTools } from "./tool-definitions/slack.js";
import { stripeTools } from "./tool-definitions/stripe.js";
import type { ToolDefinition } from "./tool-definitions/types.js";
import { xTools } from "./tool-definitions/x.js";

export type { ToolDefinition } from "./tool-definitions/types.js";
export {
  customTools,
  githubTools,
  gmailTools,
  keppoInternalTools,
  linkedinTools,
  notionTools,
  redditTools,
  slackTools,
  stripeTools,
  xTools,
};

export const allTools: ToolDefinition[] = [
  ...gmailTools,
  ...stripeTools,
  ...slackTools,
  ...githubTools,
  ...notionTools,
  ...redditTools,
  ...xTools,
  ...linkedinTools,
  ...customTools,
  ...keppoInternalTools,
];

export const toolMap = new Map(allTools.map((tool) => [tool.name, tool]));

export const maskEmail = (value: string): string => {
  const [local, domain] = value.split("@");
  if (!local || !domain) {
    return "[redacted]";
  }
  return `${local.slice(0, 1)}***@${domain}`;
};

export const redactByPolicy = (input: unknown, policy: string[]): unknown => {
  if (Array.isArray(input)) {
    return input.map((entry) => redactByPolicy(entry, policy));
  }
  if (!input || typeof input !== "object") {
    if (typeof input === "string" && policy.includes("email") && input.includes("@")) {
      return maskEmail(input);
    }
    return input;
  }

  const obj = input as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (policy.includes(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = redactByPolicy(value, policy);
  }
  return output;
};
