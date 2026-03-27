/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_EMAIL_PASSWORD?: string;
  readonly VITE_POSTHOG_API_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "fumadocs-mdx:collections/server" {
  import type { ReactNode } from "react";
  import type { Source, SourceConfig } from "fumadocs-core/source";
  import type { TOCItemType } from "fumadocs-core/toc";

  type DocsFrontmatter = {
    title?: string;
    description?: string;
    audience?: "user-guide" | "self-hosted" | "contributors";
    summary?: string;
    releaseDate?: string;
    tagline?: string;
  };

  type DocsPageData = DocsFrontmatter & {
    body: (props: { components?: Record<string, unknown> }) => ReactNode;
    toc: TOCItemType[];
    structuredData: unknown;
    _exports: Record<string, unknown>;
  };

  type DocsMetaData = {
    icon?: string;
    title?: string;
    root?: boolean;
    pages?: string[];
    defaultOpen?: boolean;
    collapsible?: boolean;
    description?: string;
  };

  export const docs: {
    toFumadocsSource: () => Source<{
      pageData: DocsPageData;
      metaData: DocsMetaData;
    }>;
  };
}

declare module "fumadocs-mdx:collections/browser" {
  import type { ReactNode } from "react";
  import type { TOCItemType } from "fumadocs-core/toc";

  type BrowserContentModule = {
    default: (props: { components?: Record<string, unknown> }) => ReactNode;
    frontmatter: {
      title: string;
      description?: string;
    };
    toc: TOCItemType[];
  };

  type ClientLoader<Props> = {
    useContent: (path: string, props: Props) => ReactNode;
  };

  const browserCollections: {
    docs: {
      createClientLoader: <Props>(options: {
        component: (module: BrowserContentModule, props: Props) => ReactNode;
      }) => ClientLoader<Props>;
    };
  };

  export default browserCollections;
}
