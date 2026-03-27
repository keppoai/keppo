import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { MenuIcon } from "lucide-react";
import {
  docsNavigation,
  docsTopLinks,
  isDocsUrlActive,
  type DocsNavigationNode,
} from "@/lib/docs/layout";
import { KeppoMark } from "@/components/landing/keppo-logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { DocsSearchDialog } from "@/components/docs/docs-search-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

function DocsNavTree({
  nodes,
  pathname,
  onNavigate,
}: {
  nodes: DocsNavigationNode[];
  pathname: string;
  onNavigate: (() => void) | undefined;
}) {
  return (
    <div className="space-y-2">
      {nodes.map((node) => {
        if (node.type === "page") {
          const active = isDocsUrlActive(node.url, pathname);

          return (
            <Link
              key={node.url}
              to={node.url}
              onClick={onNavigate}
              className={`block rounded-2xl px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-primary/10 font-semibold text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-primary/5 hover:text-foreground"
              }`}
            >
              {node.title}
            </Link>
          );
        }

        const active = node.url ? isDocsUrlActive(node.url, pathname) : false;

        return (
          <div key={`${node.title}-${node.url ?? "group"}`} className="space-y-2">
            {node.url ? (
              <Link
                to={node.url}
                onClick={onNavigate}
                className={`block rounded-2xl px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-card font-semibold text-foreground shadow-sm"
                    : "text-foreground hover:bg-background/80"
                }`}
              >
                {node.title}
              </Link>
            ) : (
              <div className="px-3 py-2 text-sm font-semibold text-foreground">{node.title}</div>
            )}
            <div className="space-y-1 border-l border-border/70 pl-3">
              <DocsNavTree nodes={node.children} pathname={pathname} onNavigate={onNavigate} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DocsSidebarContent({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: (() => void) | undefined;
}) {
  return (
    <div className="space-y-6">
      {docsNavigation.map((section) => (
        <section key={section.title} className="space-y-3">
          {section.url ? (
            <Link
              to={section.url}
              onClick={onNavigate}
              className={`block rounded-2xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors ${
                isDocsUrlActive(section.url, pathname)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-primary/5 hover:text-foreground"
              }`}
            >
              {section.title}
            </Link>
          ) : (
            <div className="px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {section.title}
            </div>
          )}
          <DocsNavTree nodes={section.children} pathname={pathname} onNavigate={onNavigate} />
        </section>
      ))}
    </div>
  );
}

export function DocsLayout({
  children,
  showSidebar = true,
}: {
  children: React.ReactNode;
  showSidebar?: boolean;
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const isSearchShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!isSearchShortcut) {
        return;
      }

      event.preventDefault();
      setSearchOpen((previous) => !previous);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    setSearchOpen(false);
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[24rem] bg-[radial-gradient(circle_at_top,_color-mix(in_oklab,var(--primary)_16%,transparent),transparent_62%)]" />
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="shrink-0 transition-opacity hover:opacity-80">
            <KeppoMark className="size-7" />
          </Link>

          {showSidebar ? (
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger
                render={<Button variant="outline" size="icon-sm" className="lg:hidden" />}
              >
                <MenuIcon className="size-4" />
                <span className="sr-only">Open docs navigation</span>
              </SheetTrigger>
              <SheetContent side="left" className="w-[88vw] max-w-sm border-r border-border/70 p-0">
                <SheetHeader className="border-b border-border/70">
                  <SheetTitle>Keppo Docs</SheetTitle>
                  <SheetDescription>
                    Guides for operators, self-hosters, and contributors.
                  </SheetDescription>
                </SheetHeader>
                <div className="overflow-y-auto p-4">
                  <DocsSidebarContent
                    pathname={pathname}
                    onNavigate={() => {
                      setMobileNavOpen(false);
                    }}
                  />
                </div>
              </SheetContent>
            </Sheet>
          ) : null}

          <Link
            to="/docs"
            className="inline-flex items-center rounded-full border border-border/70 bg-card/80 px-4 py-2 shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/5"
          >
            <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
              Docs
            </span>
          </Link>

          <nav className="ml-3 hidden items-center gap-1 lg:flex">
            {docsTopLinks.map((link) => {
              const active = !link.external && isDocsUrlActive(link.url, pathname);

              return link.external ? (
                <a
                  key={link.title}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-primary/5 hover:text-foreground"
                >
                  {link.title}
                </a>
              ) : (
                <Link
                  key={link.title}
                  to={link.url}
                  className={`rounded-full px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-primary/10 font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-primary/5 hover:text-foreground"
                  }`}
                >
                  {link.title}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full border-border/70 bg-background/80"
              onClick={() => {
                setSearchOpen(true);
              }}
            >
              Search docs
              <span className="rounded-full border border-border/80 bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Cmd/Ctrl K
              </span>
            </Button>
            <ThemeToggle />
            <Button size="sm" className="rounded-full" render={<Link to="/login" />}>
              Get started
            </Button>
          </div>
        </div>
      </header>

      <div
        className={`mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:px-8 ${
          showSidebar ? "lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)]" : ""
        }`}
      >
        {showSidebar ? (
          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-[28px] border border-border/70 bg-card/82 p-4 shadow-sm backdrop-blur">
              <DocsSidebarContent pathname={pathname} onNavigate={undefined} />
            </div>
          </aside>
        ) : null}

        <main className="relative min-w-0 w-full">{children}</main>
      </div>

      <DocsSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
