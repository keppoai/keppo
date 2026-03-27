import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/health")({
  component: HealthRoute,
});

function HealthRoute() {
  return (
    <section className="mx-auto flex min-h-[50vh] max-w-3xl items-center justify-center px-6 py-16">
      <div className="w-full rounded-[28px] border border-border bg-card p-8 shadow-[var(--shadow-lg)]">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
          Runtime check
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Web shell is healthy</h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
          The unified TanStack Start application is serving the browser shell directly from
          <code> apps/web</code>.
        </p>
      </div>
    </section>
  );
}
