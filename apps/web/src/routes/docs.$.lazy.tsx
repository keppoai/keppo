import { createLazyRoute } from "@tanstack/react-router";
import { docsArticleRoute, type DocsArticleLoaderData } from "./docs.$";
import { DocsArticlePage as DocsArticleContent } from "@/components/docs/docs-article-page";

export const docsArticleRouteLazy = createLazyRoute(docsArticleRoute.id)({
  component: DocsArticleRouteComponent,
});

function DocsArticleRouteComponent() {
  const data = docsArticleRoute.useLoaderData() as DocsArticleLoaderData;
  return <DocsArticleContent data={data} />;
}
