import { DocsLayout } from "@/components/docs/docs-layout";
import { DocsShell } from "@/components/docs/docs-shell";
import type { DocsArticleLoaderData } from "@/routes/docs.$";

export function DocsArticlePage({ data }: { data: DocsArticleLoaderData }) {
  return (
    <DocsLayout>
      <DocsShell
        page={data.page}
        title={data.page.title}
        toc={data.toc}
        {...(data.page.description ? { description: data.page.description } : {})}
      >
        <div dangerouslySetInnerHTML={{ __html: data.html }} />
      </DocsShell>
    </DocsLayout>
  );
}
