import { docsPageTreeData } from "@/lib/docs/source-static";

export type DocsNavPage = {
  type: "page";
  title: string;
  url: string;
  file: string;
};

export type DocsNavFolder = {
  type: "folder";
  title: string;
  url?: string;
  root: boolean;
  children: DocsNavigationNode[];
};

export type DocsNavigationNode = DocsNavPage | DocsNavFolder;

export type DocsBreadcrumbItem = {
  title: string;
  url: string;
};

type DocsPageTreeNode = (typeof docsPageTreeData.children)[number];

const docsRootCrumb: DocsBreadcrumbItem = {
  title: "Docs",
  url: "/docs",
};

const normalizeDocsUrl = (url: string): string => {
  if (url.length > 1 && url.endsWith("/")) {
    return url.slice(0, -1);
  }

  return url;
};

const mapDocsNode = (node: DocsPageTreeNode): DocsNavigationNode => {
  if (node.type === "page") {
    return {
      type: "page",
      title: node.name,
      url: node.url,
      file: node.$ref.file,
    };
  }

  return {
    type: "folder",
    title: node.name,
    root: node.root === true,
    children: node.children.map((child) => mapDocsNode(child as DocsPageTreeNode)),
    ...(node.index?.url ? { url: node.index.url } : {}),
  };
};

export const docsNavigation = docsPageTreeData.children.map((node) =>
  mapDocsNode(node as DocsPageTreeNode),
) as DocsNavFolder[];

type DocsFlatPage = DocsNavPage & {
  trail: DocsBreadcrumbItem[];
  section: string;
};

const docsFlatPages: DocsFlatPage[] = [];

const collectDocsPages = (
  node: DocsNavigationNode,
  trail: DocsBreadcrumbItem[],
  section: string,
): void => {
  if (node.type === "page") {
    docsFlatPages.push({
      ...node,
      trail,
      section,
    });
    return;
  }

  const nextTrail =
    node.url && normalizeDocsUrl(node.url) !== normalizeDocsUrl("/docs")
      ? [...trail, { title: node.title, url: node.url }]
      : trail;

  if (node.url) {
    docsFlatPages.push({
      type: "page",
      title: node.title,
      url: node.url,
      file: "",
      trail,
      section,
    });
  }

  node.children.forEach((child) => {
    collectDocsPages(child, nextTrail, section);
  });
};

docsNavigation.forEach((section) => {
  collectDocsPages(section, [docsRootCrumb], section.title);
});

type DocsTopLink = {
  title: string;
  url: string;
  external?: true;
};

export const docsTopLinks: DocsTopLink[] = [
  {
    title: "Overview",
    url: "/docs",
  },
  ...docsNavigation.map((section) => ({
    title: section.title,
    url: section.url ?? "/docs",
  })),
  {
    title: "GitHub",
    url: "https://github.com/keppoai/keppo",
    external: true as const,
  },
];

export const isDocsUrlActive = (url: string, pathname: string): boolean => {
  const current = normalizeDocsUrl(pathname);
  const candidate = normalizeDocsUrl(url);

  return current === candidate || current.startsWith(`${candidate}/`);
};

export const getDocsPage = (url: string): DocsFlatPage | null => {
  const current = normalizeDocsUrl(url);
  return docsFlatPages.find((page) => normalizeDocsUrl(page.url) === current) ?? null;
};

export const getDocsBreadcrumbs = (url: string): DocsBreadcrumbItem[] => {
  const page = getDocsPage(url);

  if (!page) {
    return [docsRootCrumb];
  }

  return [...page.trail, { title: page.title, url: page.url }];
};

export const getDocsNeighbors = (
  url: string,
): {
  previous: DocsFlatPage | null;
  next: DocsFlatPage | null;
} => {
  const current = normalizeDocsUrl(url);
  const index = docsFlatPages.findIndex((page) => normalizeDocsUrl(page.url) === current);

  if (index === -1) {
    return {
      previous: null,
      next: null,
    };
  }

  return {
    previous: docsFlatPages[index - 1] ?? null,
    next: docsFlatPages[index + 1] ?? null,
  };
};

export const getDocsSearchTagLabel = (tag: string | null | undefined): string => {
  switch (tag) {
    case "user-guide":
      return "User Guide";
    case "self-hosted":
      return "Self-Hosted";
    case "contributors":
      return "Contributors";
    default:
      return "Docs";
  }
};
