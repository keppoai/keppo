import { notFound } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { docsMdxComponents } from "@/components/docs/docs-mdx-components";
import { source } from "@/lib/docs/source";
import type { DocsArticleLoaderData } from "@/routes/docs.$";

const serializeTocTitle = (title: ReactNode): string => {
  if (typeof title === "string") {
    return title;
  }

  if (typeof title === "number") {
    return title.toString();
  }

  return renderToStaticMarkup(<>{title}</>)
    .replace(/<[^>]+>/g, "")
    .trim();
};

export const resolveDocsArticle = (slugs: string[]): DocsArticleLoaderData => {
  const page = source.getPage(slugs);

  if (!page) {
    throw notFound();
  }

  const pageData = page.data;
  const Content = pageData.body;

  return {
    page: {
      path: page.path,
      url: page.url,
      title: pageData.title ?? "Untitled page",
      ...(pageData.description ? { description: pageData.description } : {}),
    },
    html: renderToStaticMarkup(<Content components={docsMdxComponents} />),
    toc: pageData.toc.map((item) => ({
      title: serializeTocTitle(item.title),
      url: item.url,
      depth: item.depth,
    })),
  };
};
