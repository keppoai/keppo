import { Outlet, createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root";

function DocsPendingState() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="h-10 w-72 animate-pulse rounded-full bg-foreground/10" />
      <div className="mt-4 h-4 w-full max-w-3xl animate-pulse rounded-full bg-muted-foreground/15" />
      <div className="mt-2 h-4 w-full max-w-2xl animate-pulse rounded-full bg-muted-foreground/10" />
    </div>
  );
}

export const docsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/docs",
  pendingComponent: DocsPendingState,
  component: DocsRouteOutlet,
  head: () => ({
    meta: [
      {
        title: "Keppo Docs",
      },
      {
        name: "description",
        content: "Public Keppo documentation for operators, self-hosters, and contributors.",
      },
    ],
  }),
});

function DocsRouteOutlet() {
  return <Outlet />;
}
