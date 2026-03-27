import { createLazyRoute } from "@tanstack/react-router";
import { DocsHome } from "@/components/docs/docs-home";
import { DocsLayout } from "@/components/docs/docs-layout";
import { docsRoute } from "./docs";

export const docsRouteLazy = createLazyRoute(docsRoute.id)({
  component: DocsHomePage,
});

function DocsHomePage() {
  return (
    <DocsLayout showSidebar={false}>
      <DocsHome />
    </DocsLayout>
  );
}

export { DocsHomePage };
