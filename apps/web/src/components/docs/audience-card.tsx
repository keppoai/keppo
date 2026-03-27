import { ArrowRightIcon } from "lucide-react";

export function AudienceCard({
  title,
  description,
  href,
  highlights,
  emphasis = "default",
}: {
  title: string;
  description: string;
  href: string;
  highlights: string[];
  emphasis?: "default" | "primary";
}) {
  const isPrimary = emphasis === "primary";

  return (
    <a
      href={href}
      className={`group flex h-full flex-col rounded-[28px] border p-6 transition-all hover:-translate-y-0.5 hover:shadow-md ${
        isPrimary
          ? "border-primary/25 bg-linear-to-br from-primary/11 via-card to-card shadow-md hover:border-primary/35 hover:bg-linear-to-br hover:from-primary/14 hover:via-card hover:to-card"
          : "border-border/70 bg-card/80 shadow-sm hover:border-primary/25 hover:bg-primary/4"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">
              Audience
            </p>
            {isPrimary ? (
              <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
                Start here
              </span>
            ) : null}
          </div>
          <h3 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h3>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <div
          className={`rounded-full p-2 text-primary transition-transform group-hover:translate-x-0.5 ${
            isPrimary
              ? "border border-primary/25 bg-primary/12"
              : "border border-primary/18 bg-background/88"
          }`}
        >
          <ArrowRightIcon className="size-4" />
        </div>
      </div>

      <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
        {highlights.map((highlight) => (
          <li key={highlight} className="flex items-start gap-2">
            <span className="mt-1 size-1.5 rounded-full bg-secondary" />
            <span>{highlight}</span>
          </li>
        ))}
      </ul>
    </a>
  );
}
