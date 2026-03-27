import { createRoute } from "@tanstack/react-router";
import { DocsArticlePage } from "@/components/docs/docs-article-page";
import { docsRoute } from "./docs";
import { buildDocsArticleHead, loadDocsArticle, type DocsArticleLoaderData } from "./docs.$";

export const docsSectionPageRoute = createRoute({
  getParentRoute: () => docsRoute,
  path: "$section/$page",
  loader: async ({ params }) => {
    return loadDocsArticle({
      data: [params.section, params.page],
    });
  },
  head: ({ loaderData }) => {
    return buildDocsArticleHead(loaderData as DocsArticleLoaderData | undefined);
  },
  component: DocsSectionPageComponent,
});

function DocsSectionPageComponent() {
  const data = docsSectionPageRoute.useLoaderData() as DocsArticleLoaderData;
  return <DocsArticlePage data={data} />;
}
