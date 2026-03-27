import type { TOCItemType } from "fumadocs-core/toc";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { getDocsBreadcrumbs, getDocsNeighbors } from "@/lib/docs/layout";

export type DocsShellPage = {
  path: string;
  url: string;
  lastModified?: string | null;
};

export function DocsShell({
  page,
  title,
  description,
  toc,
  children,
}: {
  page: DocsShellPage;
  title: string;
  description?: string;
  toc?: TOCItemType[];
  children: React.ReactNode;
}) {
  const githubUrl = `https://github.com/keppoai/keppo/blob/main/apps/web/content/docs/${page.path}`;
  const lastModified =
    typeof page.lastModified === "string" && page.lastModified.length > 0
      ? new Date(page.lastModified)
      : null;
  const hasValidLastModified = lastModified !== null && Number.isFinite(lastModified.getTime());
  const breadcrumbs = getDocsBreadcrumbs(page.url);
  const neighbors = getDocsNeighbors(page.url);

  return (
    <div className="grid w-full items-start gap-8 xl:grid-cols-[minmax(0,1fr)_15rem]">
      <article
        data-testid="docs-article-shell"
        className="w-full min-w-0 rounded-[32px] border border-border/70 bg-card/88 p-6 shadow-sm sm:p-8 lg:p-10"
      >
        <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-sm">
          {breadcrumbs.map((item, index) => (
            <div key={item.url} className="flex items-center gap-2">
              {index > 0 ? <span className="text-muted-foreground">/</span> : null}
              {index === breadcrumbs.length - 1 ? (
                <span className="font-semibold text-foreground">{item.title}</span>
              ) : (
                <Link
                  to={item.url}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.title}
                </Link>
              )}
            </div>
          ))}
        </nav>

        <h1 className="text-4xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? (
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">{description}</p>
        ) : null}

        <div className="prose mt-10 max-w-none prose-headings:tracking-tight prose-headings:text-foreground prose-p:max-w-3xl prose-p:text-foreground/90 prose-li:max-w-3xl prose-strong:text-foreground prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-sm prose-pre:max-w-none prose-pre:rounded-[1.5rem] prose-pre:border prose-pre:border-border/70 prose-pre:bg-card prose-a:text-primary">
          {children}
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {hasValidLastModified ? (
            <span>
              Last updated{" "}
              {lastModified.toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          ) : null}
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
          >
            View source
          </a>
        </div>

        {neighbors.previous || neighbors.next ? (
          <div className="mt-10 grid gap-4 border-t border-border/70 pt-6 md:grid-cols-2">
            {neighbors.previous ? (
              <Link
                to={neighbors.previous.url}
                className="rounded-[24px] border border-border/70 bg-background/80 p-4 transition-colors hover:border-primary/25 hover:bg-primary/5"
              >
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  <ArrowLeftIcon className="size-3.5" />
                  Previous
                </div>
                <div className="mt-3 text-lg font-semibold text-foreground">
                  {neighbors.previous.title}
                </div>
              </Link>
            ) : (
              <div />
            )}

            {neighbors.next ? (
              <Link
                to={neighbors.next.url}
                className="rounded-[24px] border border-border/70 bg-background/80 p-4 text-left transition-colors hover:border-primary/25 hover:bg-primary/5"
              >
                <div className="flex items-center justify-end gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Next
                  <ArrowRightIcon className="size-3.5" />
                </div>
                <div className="mt-3 text-lg font-semibold text-foreground">
                  {neighbors.next.title}
                </div>
              </Link>
            ) : null}
          </div>
        ) : null}
      </article>

      {toc && toc.length > 0 ? (
        <aside className="hidden xl:block">
          <div className="sticky top-24 rounded-[28px] border border-border/70 bg-card/82 p-5 shadow-sm">
            <p className="text-xs font-semibold tracking-[0.1em] text-muted-foreground">
              On this page
            </p>
            <div className="mt-3 space-y-1">
              <DocsToc items={toc} />
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function DocsToc({ items }: { items: TOCItemType[] }) {
  return (
    <>
      {items.map((item) => (
        <div key={item.url} className="space-y-2">
          <a
            href={item.url}
            className={`block rounded-xl px-3 py-2 text-sm transition-colors hover:bg-primary/5 hover:text-foreground ${
              item.depth <= 2 ? "font-medium text-foreground" : "text-muted-foreground"
            }`}
            style={{ paddingLeft: `${item.depth * 12}px` }}
          >
            {item.title}
          </a>
        </div>
      ))}
    </>
  );
}
