import { getProviderDescription, getProviderDisplayName } from "@keppo/shared/providers-ui";
import { CANONICAL_PROVIDER_IDS, type CanonicalProviderId } from "@keppo/shared/provider-ids";

export type DocsAudience = "user-guide" | "self-hosted" | "contributors";

export type PublicDocsPageSummary = {
  title: string;
  description: string;
  url: string;
};

export type ProviderMatrixEntry = {
  provider: CanonicalProviderId;
  title: string;
  description: string;
  bestFor: string;
  auth: "OAuth" | "Custom";
  capabilities: string[];
};

const [
  googleProviderId,
  stripeProviderId,
  slackProviderId,
  githubProviderId,
  notionProviderId,
  redditProviderId,
  xProviderId,
  linkedinProviderId,
  customProviderId,
] = CANONICAL_PROVIDER_IDS;

const providerCapabilityMap: Record<CanonicalProviderId, ProviderMatrixEntry> = {
  [googleProviderId]: {
    provider: googleProviderId,
    title: getProviderDisplayName(googleProviderId),
    description: getProviderDescription(googleProviderId),
    bestFor: "Gmail triage, notifications, and drafting outbound replies with approval.",
    auth: "OAuth",
    capabilities: ["Read inbox", "Draft and send mail", "Automation triggers"],
  },
  [stripeProviderId]: {
    provider: stripeProviderId,
    title: getProviderDisplayName(stripeProviderId),
    description: getProviderDescription(stripeProviderId),
    bestFor: "Refunds, subscription follow-up, and billing investigations.",
    auth: "OAuth",
    capabilities: ["Read customers", "Issue refunds", "Handle webhooks"],
  },
  [slackProviderId]: {
    provider: slackProviderId,
    title: getProviderDisplayName(slackProviderId),
    description: getProviderDescription(slackProviderId),
    bestFor: "Operational alerts and internal team coordination.",
    auth: "OAuth",
    capabilities: ["Read channels", "Post updates", "Approval notifications"],
  },
  [githubProviderId]: {
    provider: githubProviderId,
    title: getProviderDisplayName(githubProviderId),
    description: getProviderDescription(githubProviderId),
    bestFor: "PR triage, issue handling, and CI follow-up.",
    auth: "OAuth",
    capabilities: ["Read repos", "Comment on issues", "Trigger workflows"],
  },
  [notionProviderId]: {
    provider: notionProviderId,
    title: getProviderDisplayName(notionProviderId),
    description: getProviderDescription(notionProviderId),
    bestFor: "Knowledge capture and structured handoff pages.",
    auth: "OAuth",
    capabilities: ["Read pages", "Create pages", "Update structured content"],
  },
  [redditProviderId]: {
    provider: redditProviderId,
    title: getProviderDisplayName(redditProviderId),
    description: getProviderDescription(redditProviderId),
    bestFor: "Community monitoring and moderation workflows.",
    auth: "OAuth",
    capabilities: ["Search posts", "Reply or post", "Moderation actions"],
  },
  [xProviderId]: {
    provider: xProviderId,
    title: getProviderDisplayName(xProviderId),
    description: getProviderDescription(xProviderId),
    bestFor: "Monitoring mentions and preparing outbound social responses.",
    auth: "OAuth",
    capabilities: ["Search posts", "Publish posts", "Draft response flows"],
  },
  [linkedinProviderId]: {
    provider: linkedinProviderId,
    title: getProviderDisplayName(linkedinProviderId),
    description: getProviderDescription(linkedinProviderId),
    bestFor: "Approved LinkedIn community, marketing, recruiting, and sales API workflows.",
    auth: "OAuth",
    capabilities: ["Read approved APIs", "Run approved writes", "Keep one provider boundary"],
  },
  [customProviderId]: {
    provider: customProviderId,
    title: getProviderDisplayName(customProviderId),
    description: getProviderDescription(customProviderId),
    bestFor: "Internal tools, private APIs, and bespoke operational actions.",
    auth: "Custom",
    capabilities: ["Read APIs", "Write via approved actions", "Bring your own contract"],
  },
};

export const providerMatrixEntries = CANONICAL_PROVIDER_IDS.map((providerId) => {
  return providerCapabilityMap[providerId];
});

export const docsAudienceSummaries: Array<{
  audience: DocsAudience;
  title: string;
  href: string;
  description: string;
  highlights: string[];
}> = [
  {
    audience: "user-guide",
    title: "User Guide",
    href: "/docs/user-guide",
    description:
      "Set up workspaces, connect providers, build automations, and keep approvals sane.",
    highlights: ["Quickstart for operators", "Integrations and billing", "Release notes"],
  },
  {
    audience: "self-hosted",
    title: "Self-Hosted",
    href: "/docs/self-hosted",
    description:
      "Run Keppo yourself with the right env, deployment topology, provider setup, and recovery playbooks.",
    highlights: ["Install and env guide", "Deployment choices", "Troubleshooting checklist"],
  },
  {
    audience: "contributors",
    title: "Contributors",
    href: "/docs/contributors",
    description:
      "Understand the app/runtime boundaries, local dev loop, testing expectations, and safety rails.",
    highlights: ["Architecture overview", "Testing strategy", "Security and runtime rules"],
  },
];

export const releaseHighlights = [
  {
    version: "0.1.0",
    date: "March 2026",
    href: "/docs/user-guide/releases/0.1.0",
    summary:
      "Unified TanStack Start runtime, approval-first automations, public docs, and the first self-hosted operator pass.",
  },
];

export const featuredDocsPages: PublicDocsPageSummary[] = [
  {
    title: "Getting Started",
    description: "The shortest path from signup to your first approved automation run.",
    url: "/docs/user-guide/getting-started",
  },
  {
    title: "Building Automations",
    description: "How drafts, approvals, provider setup, and runs fit together in Keppo.",
    url: "/docs/user-guide/automations/building-automations",
  },
  {
    title: "Self-Hosted Deployment",
    description: "What to provision, which env vars matter, and how the runtime pieces connect.",
    url: "/docs/self-hosted/deployment",
  },
  {
    title: "Contributors: Local Development",
    description: "Repo commands, runtime seams, and verification expectations before a PR.",
    url: "/docs/contributors/local-development",
  },
];

const page = (name: string, url: string, file: string) => ({
  type: "page" as const,
  name,
  url,
  $ref: {
    file,
  },
});

type DocsPageTreeNode =
  | ReturnType<typeof page>
  | {
      type: "folder";
      name: string;
      children: DocsPageTreeNode[];
      root?: true;
      index?: ReturnType<typeof page>;
    };

const folder = (
  name: string,
  children: DocsPageTreeNode[],
  options: {
    root?: boolean;
    index?: ReturnType<typeof page>;
  } = {},
): DocsPageTreeNode => ({
  type: "folder" as const,
  name,
  children,
  ...(options.root ? { root: true } : {}),
  ...(options.index ? { index: options.index } : {}),
});

const userGuideIndex = page("User Guide", "/docs/user-guide", "user-guide/index.mdx");
const selfHostedIndex = page("Self-Hosted", "/docs/self-hosted", "self-hosted/index.mdx");
const contributorsIndex = page("Contributors", "/docs/contributors", "contributors/index.mdx");

export const docsPageTreeData = {
  name: "Keppo Docs",
  children: [
    folder(
      "User Guide",
      [
        page(
          "Getting Started",
          "/docs/user-guide/getting-started",
          "user-guide/getting-started.mdx",
        ),
        page("Workspaces", "/docs/user-guide/workspaces", "user-guide/workspaces.mdx"),
        folder(
          "Integrations",
          [
            page(
              "Google",
              "/docs/user-guide/integrations/google",
              "user-guide/integrations/google.mdx",
            ),
            page(
              "GitHub",
              "/docs/user-guide/integrations/github",
              "user-guide/integrations/github.mdx",
            ),
            page(
              "Stripe",
              "/docs/user-guide/integrations/stripe",
              "user-guide/integrations/stripe.mdx",
            ),
            page(
              "LinkedIn",
              "/docs/user-guide/integrations/linkedin",
              "user-guide/integrations/linkedin.mdx",
            ),
            page(
              "Custom Servers",
              "/docs/user-guide/integrations/custom-servers",
              "user-guide/integrations/custom-servers.mdx",
            ),
          ],
          {
            index: page(
              "Integrations",
              "/docs/user-guide/integrations",
              "user-guide/integrations/index.mdx",
            ),
          },
        ),
        folder(
          "Automations",
          [
            page(
              "Building Automations",
              "/docs/user-guide/automations/building-automations",
              "user-guide/automations/building-automations.mdx",
            ),
          ],
          {
            index: page(
              "Automations",
              "/docs/user-guide/automations",
              "user-guide/automations/index.mdx",
            ),
          },
        ),
        page(
          "Approvals and Rules",
          "/docs/user-guide/approvals-and-rules",
          "user-guide/approvals-and-rules.mdx",
        ),
        page("Notifications", "/docs/user-guide/notifications", "user-guide/notifications.mdx"),
        page("Billing", "/docs/user-guide/billing", "user-guide/billing.mdx"),
        folder(
          "Releases",
          [page("0.1.0", "/docs/user-guide/releases/0.1.0", "user-guide/releases/0.1.0.mdx")],
          {
            index: page("Releases", "/docs/user-guide/releases", "user-guide/releases/index.mdx"),
          },
        ),
      ],
      {
        root: true,
        index: userGuideIndex,
      },
    ),
    folder(
      "Self-Hosted",
      [
        page("Quickstart", "/docs/self-hosted/quickstart", "self-hosted/quickstart.mdx"),
        page("Deployment", "/docs/self-hosted/deployment", "self-hosted/deployment.mdx"),
        page("Providers", "/docs/self-hosted/providers", "self-hosted/providers.mdx"),
        page(
          "Troubleshooting",
          "/docs/self-hosted/troubleshooting",
          "self-hosted/troubleshooting.mdx",
        ),
      ],
      {
        root: true,
        index: selfHostedIndex,
      },
    ),
    folder(
      "Contributors",
      [
        page(
          "Local Development",
          "/docs/contributors/local-development",
          "contributors/local-development.mdx",
        ),
        page("Architecture", "/docs/contributors/architecture", "contributors/architecture.mdx"),
        page("Testing", "/docs/contributors/testing", "contributors/testing.mdx"),
        page(
          "Providers and Integrations",
          "/docs/contributors/providers-and-integrations",
          "contributors/providers-and-integrations.mdx",
        ),
        page(
          "Security and Runtime",
          "/docs/contributors/security-and-runtime",
          "contributors/security-and-runtime.mdx",
        ),
      ],
      {
        root: true,
        index: contributorsIndex,
      },
    ),
  ],
};
