import { AudienceCard } from "./audience-card";
import { DocsSectionHero } from "./docs-section-hero";
import { ReleaseCard } from "./release-card";
import {
  docsAudienceSummaries,
  featuredDocsPages,
  releaseHighlights,
} from "@/lib/docs/source-static";

export function DocsHome() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
      <DocsSectionHero
        eyebrow="Keppo documentation"
        title="Public docs for operators, self-hosters, and contributors."
        description="Keppo’s public docs live in the same web app as the product so help flows, search, release notes, and setup guidance stay close to the runtime they describe."
      >
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/docs/user-guide/getting-started"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            Start with the user guide
          </a>
          <a
            href="/docs/self-hosted/quickstart"
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/88 px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-primary/25 hover:bg-primary/5"
          >
            Self-hosted quickstart
          </a>
          <span className="text-sm text-muted-foreground">
            Search stays in the top bar when you want to jump deeper.
          </span>
        </div>
      </DocsSectionHero>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {docsAudienceSummaries.map((audience, index) => (
          <AudienceCard
            key={audience.audience}
            {...audience}
            emphasis={index === 0 ? "primary" : "default"}
          />
        ))}
      </section>

      <section className="rounded-[28px] border border-border/70 bg-card/82 p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">
              Recommended next reads
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              Move from orientation to action
            </h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            These paths answer the first product, setup, and contributor questions without forcing
            you to scan the full tree.
          </p>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {featuredDocsPages.slice(0, 3).map((page) => (
            <a
              key={page.url}
              href={page.url}
              className="rounded-[22px] border border-border/70 bg-background/88 p-4 transition-colors hover:border-primary/25 hover:bg-primary/5"
            >
              <p className="font-semibold">{page.title}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{page.description}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-border/70 bg-card/85 p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">
              Releases
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">What changed recently</h2>
          </div>
          <a
            href="/docs/user-guide/releases"
            className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            Browse release notes
          </a>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {releaseHighlights.map((release) => (
            <ReleaseCard key={release.version} {...release} />
          ))}
        </div>
      </section>
    </div>
  );
}
