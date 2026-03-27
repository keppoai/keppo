import { ArrowRightIcon } from "lucide-react";

export function ReleaseCard({
  version,
  date,
  summary,
  href,
}: {
  version: string;
  date: string;
  summary: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="group flex h-full flex-col rounded-[24px] border border-border/70 bg-background/88 p-5 shadow-sm transition-all hover:border-primary/25 hover:bg-primary/4 hover:shadow-md"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">{date}</p>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold tracking-tight">{version}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{summary}</p>
        </div>
        <ArrowRightIcon className="mt-0.5 size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
      </div>
    </a>
  );
}
