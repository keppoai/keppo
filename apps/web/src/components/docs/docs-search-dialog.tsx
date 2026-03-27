import { useEffect, useMemo, useState } from "react";
import { BookOpenTextIcon, CompassIcon, SearchIcon } from "lucide-react";
import { docsAudienceSummaries, featuredDocsPages } from "@/lib/docs/source-static";
import { getDocsSearchTagLabel } from "@/lib/docs/layout";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

type DocsSearchResult = {
  id: string;
  url: string;
  content: string;
  breadcrumbs?: string[];
  type: "page" | "heading" | "text";
};

const isDocsSearchResult = (value: unknown): value is DocsSearchResult => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const breadcrumbs = candidate["breadcrumbs"];
  return (
    typeof candidate["id"] === "string" &&
    typeof candidate["url"] === "string" &&
    typeof candidate["content"] === "string" &&
    (candidate["type"] === "page" ||
      candidate["type"] === "heading" ||
      candidate["type"] === "text") &&
    (breadcrumbs === undefined ||
      (Array.isArray(breadcrumbs) && breadcrumbs.every((item) => typeof item === "string")))
  );
};

const parseDocsSearchResults = (value: unknown): DocsSearchResult[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isDocsSearchResult);
};

const stripMarkdown = (value: string): string => {
  return value
    .replace(/<mark>/g, "")
    .replace(/<\/mark>/g, "")
    .replace(/`/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/[*_#>-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

const shortcutLabel =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "Cmd K"
    : "Ctrl K";

export function DocsSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) {
    return null;
  }

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocsSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      setLoading(false);
      setResults([]);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setLoading(true);

      try {
        const url = new URL("/api/search", window.location.origin);
        url.searchParams.set("query", trimmedQuery);
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const payload = parseDocsSearchResults(await response.json());

        if (!cancelled) {
          setResults(payload);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [open, query]);

  const resultGroups = useMemo(() => {
    const grouped = new Map<string, DocsSearchResult[]>();

    results.forEach((result) => {
      const key = result.url.split("/")[2] ?? "docs";
      const existing = grouped.get(key) ?? [];
      existing.push(result);
      grouped.set(key, existing);
    });

    return Array.from(grouped.entries());
  }, [results]);

  const openHref = (href: string): void => {
    onOpenChange(false);
    window.requestAnimationFrame(() => {
      window.location.assign(href);
    });
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search docs"
      description="Search public Keppo documentation"
      className="max-w-2xl"
    >
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search guides, setup notes, release notes, and contributor docs..."
        />
        <CommandList>
          {query.trim().length === 0 ? (
            <>
              <CommandGroup heading="Featured Paths">
                {featuredDocsPages.map((page) => (
                  <CommandItem
                    key={page.url}
                    value={page.title}
                    onSelect={() => openHref(page.url)}
                  >
                    <BookOpenTextIcon className="size-4" />
                    <div className="min-w-0">
                      <div className="font-medium">{page.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{page.description}</div>
                    </div>
                    <CommandShortcut>{shortcutLabel}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Audiences">
                {docsAudienceSummaries.map((audience) => (
                  <CommandItem
                    key={audience.href}
                    value={audience.title}
                    onSelect={() => openHref(audience.href)}
                  >
                    <CompassIcon className="size-4" />
                    <div className="min-w-0">
                      <div className="font-medium">{audience.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {audience.description}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : (
            <>
              <CommandEmpty>
                {loading ? "Searching docs..." : "No matching docs found."}
              </CommandEmpty>
              {resultGroups.map(([tag, items]) => (
                <CommandGroup key={tag} heading={getDocsSearchTagLabel(tag)}>
                  {items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`${item.url} ${stripMarkdown(item.content)}`}
                      onSelect={() => openHref(item.url)}
                    >
                      <SearchIcon className="size-4" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/80">
                          {(item.breadcrumbs ?? []).join(" / ") || getDocsSearchTagLabel(tag)}
                        </div>
                        <div className="mt-1 line-clamp-2 text-sm text-foreground">
                          {stripMarkdown(item.content)}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
