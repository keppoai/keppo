import {
  ClientOnly,
  HeadContent,
  Scripts,
  createRootRoute,
  Outlet,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ThemeProvider } from "next-themes";
import { AppLayout } from "@/components/layout/app-layout";
import { LandingPage } from "@/components/landing/landing-page";
import { ErrorBoundary } from "@/components/error-boundary";
import { NotFound } from "@/components/not-found";
import { AuthProvider } from "@/components/layout/app-layout";
import { DashboardRuntimeProvider, defaultDashboardRuntime } from "@/lib/dashboard-runtime";
import {
  getRootDocumentSessionAttributes,
  resolveSessionHintForRender,
} from "@/lib/ssr-session-hint";
import { initPostHog } from "@/posthog";
import appCss from "../styles.css?url";

let posthogInitialized = false;

declare global {
  interface Window {
    __KEPPO_E2E_METADATA__?: unknown;
    __KEPPO_E2E_ROUTER__?: {
      navigate: (options: { href: string }) => Promise<void> | void;
    };
  }
}

export const rootRoute = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Keppo",
      },
      {
        name: "description",
        content: "Keppo dashboard running inside the unified TanStack Start app.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/png",
        href: "/keppo-logo.png",
      },
      {
        rel: "apple-touch-icon",
        href: "/keppo-logo.png",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
    ],
  }),
  notFoundComponent: NotFound,
  component: RootComponent,
  shellComponent: RootDocument,
});

function RootComponent() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isDocsPath = pathname === "/docs" || pathname.startsWith("/docs/");

  if (pathname === "/") {
    return <LandingPageHydrationBoundary />;
  }

  return (
    <ClientOnly fallback={isDocsPath ? <DocsShellFallback /> : <RootShellFallback />}>
      <BrowserAppShell />
    </ClientOnly>
  );
}

function LandingPageHydrationBoundary() {
  const [hydrated, setHydrated] = useState(false);
  const [hasSSRSession] = useState(() => resolveSessionHintForRender());

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated) {
    if (hasSSRSession) {
      return <RootShellFallback />;
    }
    return (
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <LandingPage />
      </ThemeProvider>
    );
  }

  return <BrowserAppShell />;
}

function BrowserAppShell() {
  const router = useRouter();
  useEffect(() => {
    if (!posthogInitialized) {
      initPostHog();
      posthogInitialized = true;
    }
  }, []);

  useEffect(() => {
    if (window.__KEPPO_E2E_METADATA__ === undefined) {
      return;
    }
    window.__KEPPO_E2E_ROUTER__ = {
      navigate: ({ href }) =>
        router.navigate({
          href,
        }),
    };
    return () => {
      if (window.__KEPPO_E2E_ROUTER__?.navigate) {
        delete window.__KEPPO_E2E_ROUTER__;
      }
    };
  }, [router]);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <DashboardRuntimeProvider runtime={defaultDashboardRuntime}>
        <ConvexBetterAuthProvider
          client={defaultDashboardRuntime.convexClient}
          authClient={defaultDashboardRuntime.authClient}
        >
          <AuthProvider>
            <AppLayout>
              <ErrorBoundary boundary="layout">
                <Outlet />
              </ErrorBoundary>
            </AppLayout>
          </AuthProvider>
        </ConvexBetterAuthProvider>
      </DashboardRuntimeProvider>
    </ThemeProvider>
  );
}

function DocsShellFallback() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="h-5 w-28 animate-pulse rounded-full bg-primary/15" />
          <div className="h-9 w-44 animate-pulse rounded-full bg-muted" />
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:px-8">
        <aside className="hidden rounded-[28px] border border-border/70 bg-card/80 p-5 shadow-sm lg:block">
          <div className="space-y-3">
            <div className="h-4 w-24 animate-pulse rounded-full bg-muted-foreground/15" />
            <div className="h-10 animate-pulse rounded-2xl bg-primary/8" />
            <div className="h-10 animate-pulse rounded-2xl bg-muted/75" />
            <div className="h-10 animate-pulse rounded-2xl bg-muted/60" />
          </div>
        </aside>

        <main className="space-y-6">
          <section className="rounded-[32px] border border-border/70 bg-card/85 p-6 shadow-sm sm:p-8">
            <div className="h-3 w-28 animate-pulse rounded-full bg-primary/20" />
            <div className="mt-4 h-10 max-w-xl animate-pulse rounded-full bg-foreground/10" />
            <div className="mt-4 h-4 max-w-3xl animate-pulse rounded-full bg-muted-foreground/15" />
            <div className="mt-2 h-4 max-w-2xl animate-pulse rounded-full bg-muted-foreground/10" />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="h-52 animate-pulse rounded-[28px] border border-border/70 bg-card/75" />
            <div className="h-52 animate-pulse rounded-[28px] border border-border/70 bg-card/75" />
          </section>
        </main>
      </div>
    </div>
  );
}

function RootShellFallback() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="flex min-h-svh">
        <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col">
          <div className="border-b border-sidebar-border p-4">
            <div className="rounded-xl border border-sidebar-border/80 bg-background/70 p-3 shadow-sm">
              <div className="h-3 w-20 animate-pulse rounded-full bg-muted-foreground/20" />
              <div className="mt-3 h-10 animate-pulse rounded-lg bg-sidebar-accent/70" />
            </div>
          </div>

          <div className="flex-1 space-y-6 p-3">
            <div className="space-y-2">
              <ShellNavItem active />
              <ShellNavItem />
            </div>

            <div className="space-y-2">
              <div className="px-2 pb-1 pt-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Workspace
              </div>
              <ShellNavItem />
              <ShellNavItem />
              <ShellNavItem />
              <ShellNavItem />
              <ShellNavItem compact />
            </div>

            <div className="rounded-2xl border border-sidebar-border/80 bg-background/55 p-4">
              <div className="h-3 w-28 animate-pulse rounded-full bg-muted-foreground/20" />
              <div className="mt-3 space-y-2">
                <div className="h-9 animate-pulse rounded-xl bg-muted/80" />
                <div className="h-9 animate-pulse rounded-xl bg-muted/65" />
                <div className="h-9 animate-pulse rounded-xl bg-muted/50" />
              </div>
            </div>
          </div>

          <div className="border-t border-sidebar-border p-4">
            <div className="flex items-center gap-3 rounded-xl border border-sidebar-border/80 bg-background/70 p-3">
              <div className="size-9 animate-pulse rounded-full bg-muted/80" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-24 animate-pulse rounded-full bg-muted-foreground/20" />
                <div className="h-3 w-32 animate-pulse rounded-full bg-muted-foreground/15" />
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-h-svh min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
            <div className="size-8 animate-pulse rounded-md bg-muted md:hidden" />
            <div className="hidden h-8 w-8 animate-pulse rounded-md bg-muted md:block" />
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="h-3 w-20 animate-pulse rounded-full bg-muted-foreground/20" />
              <div className="size-1 rounded-full bg-muted-foreground/30" />
              <div className="h-3 w-28 animate-pulse rounded-full bg-muted-foreground/15" />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="hidden h-8 w-24 animate-pulse rounded-md bg-muted sm:block" />
              <div className="hidden h-8 w-24 animate-pulse rounded-md bg-muted sm:block" />
              <div className="size-8 animate-pulse rounded-full bg-muted" />
              <div className="size-8 animate-pulse rounded-full bg-muted" />
            </div>
          </header>

          <div className="flex-1 p-4 sm:p-6 lg:p-8">
            <div className="mx-auto max-w-[1200px] space-y-6">
              <section className="rounded-[28px] border border-border/80 bg-card/80 p-6 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="h-3 w-28 animate-pulse rounded-full bg-primary/20" />
                    <div className="h-8 w-72 max-w-full animate-pulse rounded-full bg-foreground/10" />
                    <div className="h-4 w-[28rem] max-w-full animate-pulse rounded-full bg-muted-foreground/15" />
                  </div>
                  <div className="h-8 w-32 animate-pulse rounded-full border border-primary/15 bg-primary/8" />
                </div>

                <div className="mt-6 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
                  <div className="rounded-[24px] border border-border/70 bg-background/75 p-5">
                    <div className="h-4 w-40 animate-pulse rounded-full bg-muted-foreground/20" />
                    <div className="mt-4 h-16 animate-pulse rounded-2xl bg-muted/80" />
                    <div className="mt-4 h-28 animate-pulse rounded-3xl bg-linear-to-r from-primary/10 via-muted to-secondary/10" />
                  </div>
                  <div className="rounded-[24px] border border-border/70 bg-background/75 p-5">
                    <div className="h-4 w-32 animate-pulse rounded-full bg-muted-foreground/20" />
                    <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-2/5 rounded-full bg-primary/45" />
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <div className="h-7 w-24 animate-pulse rounded-full bg-muted/85" />
                      <div className="h-7 w-28 animate-pulse rounded-full bg-muted/70" />
                      <div className="h-7 w-20 animate-pulse rounded-full bg-muted/55" />
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-3">
                <ShellCard />
                <ShellCard />
                <ShellCard />
              </section>

              <section className="rounded-[28px] border border-border/80 bg-card/80 p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-2">
                    <div className="h-4 w-36 animate-pulse rounded-full bg-foreground/10" />
                    <div className="h-3 w-56 animate-pulse rounded-full bg-muted-foreground/15" />
                  </div>
                  <div className="h-9 w-36 animate-pulse rounded-xl bg-muted/80" />
                </div>
                <div className="mt-5 space-y-3">
                  <ShellTableRow />
                  <ShellTableRow />
                  <ShellTableRow />
                  <ShellTableRow short />
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function ShellNavItem({
  active = false,
  compact = false,
}: {
  active?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-3 ${
        compact ? "h-9" : "h-10"
      } ${active ? "bg-sidebar-accent shadow-sm" : "bg-transparent"}`}
    >
      <div className="size-4 animate-pulse rounded-sm bg-muted-foreground/20" />
      <div
        className={`h-3 animate-pulse rounded-full bg-muted-foreground/20 ${
          compact ? "w-24" : "w-32"
        }`}
      />
      {active ? <div className="ml-auto h-5 w-8 rounded-full bg-secondary/20" /> : null}
    </div>
  );
}

function ShellCard() {
  return (
    <div className="rounded-[24px] border border-border/75 bg-card/75 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="h-4 w-28 animate-pulse rounded-full bg-foreground/10" />
          <div className="h-3 w-20 animate-pulse rounded-full bg-muted-foreground/15" />
        </div>
        <div className="size-10 animate-pulse rounded-2xl bg-primary/10" />
      </div>
      <div className="mt-6 h-8 w-20 animate-pulse rounded-full bg-foreground/10" />
      <div className="mt-3 h-3 w-32 animate-pulse rounded-full bg-muted-foreground/15" />
    </div>
  );
}

function ShellTableRow({ short = false }: { short?: boolean }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
      <div className="size-9 animate-pulse rounded-xl bg-muted/85" />
      <div className="min-w-0 flex-1 space-y-2">
        <div
          className={`h-3 animate-pulse rounded-full bg-foreground/10 ${
            short ? "w-32" : "w-56 max-w-full"
          }`}
        />
        <div
          className={`h-3 animate-pulse rounded-full bg-muted-foreground/15 ${
            short ? "w-24" : "w-72 max-w-full"
          }`}
        />
      </div>
      <div className="h-7 w-20 animate-pulse rounded-full bg-muted/80" />
    </div>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning {...getRootDocumentSessionAttributes()}>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
