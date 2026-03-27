import type { ReactNode } from "react";

export function DocsSectionHero({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-[32px] border border-border/70 bg-linear-to-br from-card via-card to-primary/6 p-6 shadow-sm sm:p-8">
      <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-primary/45 to-transparent" />
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">{eyebrow}</p>
      <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        {title}
      </h1>
      <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">{description}</p>
      {children ? <div className="mt-6">{children}</div> : null}
    </section>
  );
}
