import type { ReactNode } from "react";
import { CANONICAL_PROVIDER_IDS } from "@keppo/shared/provider-ids";

type DocsPage = {
  path: string;
  slugs: string[];
  url: string;
  data: {
    title: string;
    description?: string;
    body: (props: { components?: Record<string, unknown> }) => ReactNode;
    toc: Array<{
      title: string;
      url: string;
      depth: number;
    }>;
    structuredData: {
      headings: Array<{
        id: string;
        content: string;
      }>;
      contents: Array<{
        heading?: string;
        content: string;
      }>;
    };
    _exports: Record<string, unknown>;
  };
};

type TreeNode =
  | {
      type: "page";
      name: ReactNode;
      url: string;
      $ref?: {
        file: string;
      };
    }
  | {
      type: "folder";
      name: ReactNode;
      root?: boolean;
      index?: {
        type: "page";
        name: ReactNode;
        url: string;
        $ref?: {
          file: string;
        };
      };
      children: TreeNode[];
      $ref?: {
        metaFile?: string;
      };
    };

const docsPages: DocsPage[] = [
  {
    path: "user-guide/index.mdx",
    slugs: ["user-guide"],
    url: "/docs/user-guide",
    data: {
      title: "User Guide",
      description: "Set up workspaces, connect providers, and ship approval-first automations.",
      body: emptyMdx,
      toc: [],
      structuredData: { headings: [], contents: [] },
      _exports: {},
    },
  },
  {
    path: "user-guide/getting-started.mdx",
    slugs: ["user-guide", "getting-started"],
    url: "/docs/user-guide/getting-started",
    data: {
      title: "Getting Started",
      description: "The shortest path from an empty account to an approved automation run.",
      body: emptyMdx,
      toc: [],
      structuredData: { headings: [], contents: [] },
      _exports: {},
    },
  },
  {
    path: "user-guide/automations/building-automations.mdx",
    slugs: ["user-guide", "automations", "building-automations"],
    url: "/docs/user-guide/automations/building-automations",
    data: {
      title: "Building Automations",
      description: "How to move from a plain-English goal to a production-ready automation.",
      body: emptyMdx,
      toc: [],
      structuredData: { headings: [], contents: [] },
      _exports: {},
    },
  },
  {
    path: "self-hosted/index.mdx",
    slugs: ["self-hosted"],
    url: "/docs/self-hosted",
    data: {
      title: "Self-Hosted",
      description: "Run Keppo yourself with the env, deployment, and recovery details that matter.",
      body: emptyMdx,
      toc: [],
      structuredData: { headings: [], contents: [] },
      _exports: {},
    },
  },
  {
    path: "contributors/index.mdx",
    slugs: ["contributors"],
    url: "/docs/contributors",
    data: {
      title: "Contributors",
      description: "Understand local development, architecture, testing, and runtime guardrails.",
      body: emptyMdx,
      toc: [],
      structuredData: { headings: [], contents: [] },
      _exports: {},
    },
  },
];

const docsPageMap = new Map(docsPages.map((page) => [page.slugs.join("/"), page]));

const requirePage = (slugs: string[]): DocsPage => {
  const page = docsPageMap.get(slugs.join("/"));
  if (!page) {
    throw new Error(`Missing docs test fixture for ${slugs.join("/")}.`);
  }

  return page;
};

const pageItem = (page: DocsPage) => ({
  type: "page" as const,
  name: page.data.title,
  url: page.url,
  $ref: {
    file: page.path,
  },
});

const docsTree = {
  name: "Docs",
  children: [
    {
      type: "folder" as const,
      name: "User Guide",
      root: true,
      index: pageItem(requirePage(["user-guide"])),
      children: [
        pageItem(requirePage(["user-guide", "getting-started"])),
        {
          type: "folder" as const,
          name: "Automations",
          children: [pageItem(requirePage(["user-guide", "automations", "building-automations"]))],
        },
      ],
    },
    {
      type: "folder" as const,
      name: "Self-Hosted",
      root: true,
      index: pageItem(requirePage(["self-hosted"])),
      children: [],
    },
    {
      type: "folder" as const,
      name: "Contributors",
      root: true,
      index: pageItem(requirePage(["contributors"])),
      children: [],
    },
  ] satisfies TreeNode[],
};

const serializedDocsTree = {
  $fumadocs_loader: "page-tree" as const,
  data: docsTree,
};

const getPageBySlugs = (slugs: string[] | undefined): DocsPage | undefined => {
  if (!slugs) {
    return undefined;
  }

  return docsPageMap.get(slugs.map((slug) => decodeURIComponent(slug)).join("/"));
};

function emptyMdx(_props: { components?: Record<string, unknown> }): null {
  return null;
}

export const source: typeof import("./source").source = {
  pageTree: docsTree,
  getPageTree: () => docsTree,
  getPage: (slugs: string[] | undefined, _language?: string) => getPageBySlugs(slugs),
  getPages: () => docsPages,
  getLanguages: () => [],
  getPageByHref: (href: string, _options?: { language?: string; dir?: string }) => {
    const page = docsPages.find((candidate) => candidate.url === href);
    return page ? { page } : undefined;
  },
  resolveHref: (href: string) => href,
  getNodePage: (node: { $ref?: { file?: string } }, _language?: string) =>
    docsPages.find((page) => page.path === node.$ref?.file),
  getNodeMeta: () => undefined,
  generateParams: () => [],
  serializePageTree: async () => serializedDocsTree,
};

export const browserDocs = {
  createClientLoader<T>(options: {
    component: (
      content: {
        default: (props: { components?: Record<string, unknown> }) => ReactNode;
        frontmatter: {
          title: string;
          description?: string;
        };
        toc: never[];
      },
      props: T,
    ) => ReactNode;
  }) {
    return {
      useContent(path: string, props: T) {
        const page =
          docsPages.find((candidate) => candidate.path === path) ?? requirePage(["user-guide"]);
        return options.component(
          {
            default: emptyMdx,
            frontmatter: page.data,
            toc: [],
          },
          props,
        );
      },
    };
  },
};

export type DocsAudience = "user-guide" | "self-hosted" | "contributors";

const [googleProviderId] = CANONICAL_PROVIDER_IDS;

export const providerMatrixEntries = [
  {
    provider: googleProviderId,
    title: "Google",
    description: "Google Workspace and Gmail operator workflows.",
    bestFor: "Inbox triage and drafting",
    auth: "OAuth",
    capabilities: ["Read inbox", "Draft replies"],
  },
] as const;

export const docsAudienceSummaries = [
  {
    audience: "user-guide" as const,
    title: "User Guide",
    href: "/docs/user-guide",
    description:
      "Set up workspaces, connect providers, build automations, and keep approvals sane.",
    highlights: ["Quickstart for operators", "Integrations and billing", "Release notes"],
  },
  {
    audience: "self-hosted" as const,
    title: "Self-Hosted",
    href: "/docs/self-hosted",
    description:
      "Run Keppo yourself with the right env, deployment topology, provider setup, and recovery playbooks.",
    highlights: ["Install and env guide", "Deployment choices", "Troubleshooting checklist"],
  },
  {
    audience: "contributors" as const,
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

export const featuredDocsPages = [
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
