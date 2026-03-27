import { createRoute } from "@tanstack/react-router";
import { DocsArticlePage } from "@/components/docs/docs-article-page";
import { docsRoute } from "./docs";
import { buildDocsArticleHead, loadDocsArticle, type DocsArticleLoaderData } from "./docs.$";

export const docsNestedArticleRoute = createRoute({
  getParentRoute: () => docsRoute,
  path: "$section/$category/$page",
  loader: async ({ params }) => {
    return loadDocsArticle({
      data: [params.section, params.category, params.page],
    });
  },
  head: ({ loaderData }) => {
    return buildDocsArticleHead(loaderData as DocsArticleLoaderData | undefined);
  },
  component: DocsNestedArticleRouteComponent,
});

function DocsNestedArticleRouteComponent() {
  const data = docsNestedArticleRoute.useLoaderData() as DocsArticleLoaderData;
  return <DocsArticlePage data={data} />;
}
