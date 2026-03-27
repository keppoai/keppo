import { createServerFn } from "@tanstack/react-start";
import { createRoute } from "@tanstack/react-router";
import { DocsArticlePage } from "@/components/docs/docs-article-page";
import { docsRoute } from "./docs";

export type DocsArticleLoaderData = {
  page: {
    path: string;
    url: string;
    title: string;
    description?: string;
  };
  html: string;
  toc: Array<{
    title: string;
    url: string;
    depth: number;
  }>;
};

const loadDocsArticle = createServerFn({
  method: "GET",
})
  .inputValidator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }): Promise<DocsArticleLoaderData> => {
    const { resolveDocsArticle } = await import("@/lib/docs/article.server");
    return resolveDocsArticle(slugs);
  });

const buildDocsArticleHead = (loaderData: DocsArticleLoaderData | undefined) => {
  return {
    meta: [
      {
        title: loaderData?.page.title ? `${loaderData.page.title} | Keppo Docs` : "Keppo Docs",
      },
      ...(loaderData?.page.description
        ? [
            {
              name: "description",
              content: loaderData.page.description,
            },
          ]
        : []),
    ],
  };
};

export const docsArticleRoute = createRoute({
  getParentRoute: () => docsRoute,
  path: "$section",
  loader: async ({ params }) => {
    return loadDocsArticle({
      data: [params.section],
    });
  },
  head: ({ loaderData }) => {
    return buildDocsArticleHead(loaderData as DocsArticleLoaderData | undefined);
  },
  component: DocsSectionArticlePage,
});

function DocsSectionArticlePage() {
  const data = docsArticleRoute.useLoaderData() as DocsArticleLoaderData;
  return <DocsArticlePage data={data} />;
}

export { buildDocsArticleHead, loadDocsArticle };
