import { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  GitBranchPlusIcon,
  Maximize2Icon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import {
  normalizeMermaidContent,
  parseDescriptionBlocks,
  splitAutomationDescription,
} from "@/lib/automation-mermaid";
import { cn } from "@/lib/utils";

type AutomationDescriptionContentProps = {
  description: string;
  mermaidContent?: string | null;
  className?: string;
  hideDiagram?: boolean;
};

type MarkdownSegment =
  | { type: "heading"; level: number; content: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "paragraph"; content: string };

let mermaidConfigured = false;

function configureMermaid(
  mermaid: typeof import("mermaid").default,
  theme: "default" | "dark",
): void {
  const isDark = theme === "dark";

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: "Plus Jakarta Sans Variable, system-ui, sans-serif",
    flowchart: {
      curve: "basis",
      padding: 16,
      htmlLabels: true,
    },
    themeVariables: isDark
      ? {
          background: "transparent",
          primaryColor: "#1c3129",
          primaryBorderColor: "#5fad82",
          primaryTextColor: "#dddad5",
          lineColor: "#5fad82",
          secondaryColor: "#243a30",
          tertiaryColor: "#1f3a2e",
          mainBkg: "#1c3129",
          nodeBorder: "#5fad82",
          clusterBkg: "#162620",
          edgeLabelBackground: "#1c2520",
          textColor: "#dddad5",
          titleColor: "#dddad5",
          nodeTextColor: "#dddad5",
          fontSize: "14px",
        }
      : {
          background: "transparent",
          primaryColor: "#e6f0eb",
          primaryBorderColor: "#4d8b68",
          primaryTextColor: "#1e3327",
          lineColor: "#6b9e82",
          secondaryColor: "#dceae2",
          tertiaryColor: "#d0e3d8",
          mainBkg: "#e6f0eb",
          nodeBorder: "#4d8b68",
          clusterBkg: "#f0f7f3",
          edgeLabelBackground: "#f6f9f7",
          textColor: "#1e3327",
          titleColor: "#1e3327",
          nodeTextColor: "#1e3327",
          fontSize: "14px",
        },
  });
  mermaidConfigured = true;
}

function normalizeInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .trim();
}

function parseMarkdownSegments(markdown: string): MarkdownSegment[] {
  const chunks = markdown
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.map((chunk) => {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const heading = lines[0]?.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const hashes = heading[1] ?? "#";
      return {
        type: "heading",
        level: hashes.length,
        content: normalizeInlineMarkdown(heading[2] ?? ""),
      };
    }

    const unorderedItems = lines
      .map((line) => line.match(/^[-*]\s+(.*)$/)?.[1] ?? null)
      .filter((line): line is string => line !== null);
    if (unorderedItems.length === lines.length) {
      return {
        type: "unordered-list",
        items: unorderedItems.map((item) => normalizeInlineMarkdown(item)),
      };
    }

    const orderedItems = lines
      .map((line) => line.match(/^\d+\.\s+(.*)$/)?.[1] ?? null)
      .filter((line): line is string => line !== null);
    if (orderedItems.length === lines.length) {
      return {
        type: "ordered-list",
        items: orderedItems.map((item) => normalizeInlineMarkdown(item)),
      };
    }

    return {
      type: "paragraph",
      content: normalizeInlineMarkdown(lines.join(" ")),
    };
  });
}

export function getAutomationDescriptionPreview(
  description: string,
  mermaidContent?: string | null,
): string {
  const parts = splitAutomationDescription(description, mermaidContent);
  const blocks = parseDescriptionBlocks(parts.description);
  const text = blocks
    .filter((block) => block.type === "markdown")
    .flatMap((block) =>
      parseMarkdownSegments(block.content).flatMap((segment) => {
        if (segment.type === "paragraph" || segment.type === "heading") {
          return [segment.content];
        }
        return segment.items;
      }),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > 0) {
    return text;
  }

  return parts.mermaidContent ? "Includes a workflow diagram" : "No description";
}

const diagramSvgClasses =
  "[&_svg]:h-auto [&_svg]:max-w-full [&_rect]:[rx:10px] [&_rect]:[ry:10px] [&_.edgePath_path]:[stroke-width:1.5px]";

function DiagramLightbox({ svg, onClose }: { svg: string; onClose: () => void }) {
  const [zoom, setZoom] = useState<number | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fitZoomRef = useRef(1);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Calculate zoom-to-fit on mount
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const svgEl = content.querySelector("svg");
    if (!svgEl) {
      fitZoomRef.current = 1;
      setZoom(1);
      return;
    }

    const svgWidth = svgEl.width.baseVal.value || svgEl.getBoundingClientRect().width;
    const svgHeight = svgEl.height.baseVal.value || svgEl.getBoundingClientRect().height;

    if (svgWidth <= 0 || svgHeight <= 0) {
      fitZoomRef.current = 1;
      setZoom(1);
      return;
    }

    const padding = 80;
    const availWidth = container.clientWidth - padding * 2;
    const availHeight = container.clientHeight - padding * 2;
    const fit = Math.min(availWidth / svgWidth, availHeight / svgHeight, 3);

    fitZoomRef.current = fit;
    setZoom(fit);
  }, [svg]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((prev) => Math.max(0.25, Math.min(5, (prev ?? 1) * factor)));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-xl border bg-background/90 p-1 shadow-md backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setZoom((z) => Math.min(5, (z ?? 1) * 1.25))}
          title="Zoom in"
        >
          <ZoomInIcon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setZoom((z) => Math.max(0.25, (z ?? 1) * 0.8))}
          title="Zoom out"
        >
          <ZoomOutIcon className="size-4" />
        </Button>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            setZoom(fitZoomRef.current);
            setPan({ x: 0, y: 0 });
          }}
          title="Reset view"
        >
          <RotateCcwIcon className="size-4" />
        </Button>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border bg-background/90 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
        {zoom !== null ? `${Math.round(zoom * 100)}%` : "Fitting..."}
      </div>

      <div
        ref={containerRef}
        className="h-full w-full cursor-grab select-none overflow-hidden active:cursor-grabbing"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          isDraggingRef.current = true;
          dragStartRef.current = {
            x: e.clientX - pan.x,
            y: e.clientY - pan.y,
          };
        }}
        onMouseMove={(e) => {
          if (!isDraggingRef.current) return;
          setPan({
            x: e.clientX - dragStartRef.current.x,
            y: e.clientY - dragStartRef.current.y,
          });
        }}
        onMouseUp={() => {
          isDraggingRef.current = false;
        }}
        onMouseLeave={() => {
          isDraggingRef.current = false;
        }}
      >
        <div
          className="flex h-full w-full items-center justify-center transition-opacity duration-150"
          style={{
            transform:
              zoom !== null ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` : undefined,
            transformOrigin: "center center",
            opacity: zoom !== null ? 1 : 0,
          }}
        >
          <div
            ref={contentRef}
            className="[&_svg]:h-auto [&_svg]:max-w-none [&_rect]:[rx:10px] [&_rect]:[ry:10px] [&_.edgePath_path]:[stroke-width:1.5px]"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    </div>
  );
}

export function MermaidDiagram({ chart }: { chart: string }) {
  const diagramId = useId().replace(/:/g, "-");
  const [source, setSource] = useState(chart);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    setSource(chart);
  }, [chart]);

  const normalizedSource = normalizeMermaidContent(source);

  useEffect(() => {
    let cancelled = false;

    async function renderChart(): Promise<void> {
      if (!normalizedSource.trim()) {
        setSvg(null);
        setError(null);
        return;
      }

      try {
        const isDark = document.documentElement.classList.contains("dark");
        const mermaid = (await import("mermaid")).default;
        configureMermaid(mermaid, isDark ? "dark" : "default");
        const { svg: rendered } = await mermaid.render(
          `automation-diagram-${diagramId}`,
          normalizedSource,
        );
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setSvg(null);
          setError(caught instanceof Error ? caught.message : "Unable to render diagram.");
        }
      }
    }

    void renderChart();

    return () => {
      cancelled = true;
    };
  }, [diagramId, normalizedSource]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [copied]);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(normalizedSource);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (error) {
    return (
      <div className="space-y-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangleIcon className="size-4" />
              Diagram unavailable
            </div>
            <p className="mt-2 text-destructive/80">{error}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
              {copied ? (
                <CheckIcon className="mr-1.5 size-4" />
              ) : (
                <CopyIcon className="mr-1.5 size-4" />
              )}
              {copied ? "Copied" : "Copy Mermaid"}
            </Button>
            {source !== chart ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setSource(chart)}>
                Reset
              </Button>
            ) : null}
          </div>
        </div>
        <Collapsible open={showSource} onOpenChange={setShowSource}>
          <CollapsibleTrigger className="inline-flex items-center text-sm font-medium text-destructive">
            <ChevronDownIcon
              className={cn("mr-1.5 size-4 transition-transform", showSource ? "rotate-180" : "")}
            />
            {showSource ? "Hide Mermaid source" : "Show Mermaid source"}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <p className="mb-2 text-xs text-destructive/80">
              Edit the Mermaid below to recover the diagram preview.
            </p>
            <Textarea
              value={source}
              onChange={(event) => setSource(event.currentTarget.value)}
              className="min-h-40 resize-y bg-background font-mono text-xs"
            />
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
        Rendering diagram...
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3 rounded-2xl border bg-card p-3 shadow-sm">
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setLightboxOpen(true)}
            title="Expand diagram"
          >
            <Maximize2Icon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void handleCopy()}
            title={copied ? "Copied" : "Copy Mermaid source"}
          >
            {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          </Button>
        </div>
        <div className="cursor-pointer overflow-x-auto" onClick={() => setLightboxOpen(true)}>
          <div className={diagramSvgClasses} dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </div>
      {lightboxOpen ? <DiagramLightbox svg={svg} onClose={() => setLightboxOpen(false)} /> : null}
    </>
  );
}

function DiagramBlock({ chart }: { chart: string }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Workflow Diagram</h3>
        <p className="text-xs leading-5 text-muted-foreground">
          Mermaid source is rendered directly here so operators can scan the workflow without
          reading raw syntax.
        </p>
      </div>
      <MermaidDiagram chart={chart} />
    </div>
  );
}

function MarkdownBlock({ content }: { content: string }) {
  const segments = parseMarkdownSegments(content);

  return (
    <div className="space-y-3 text-sm leading-6 text-foreground">
      {segments.map((segment, index) => {
        if (segment.type === "heading") {
          const HeadingTag = segment.level <= 2 ? "h3" : "h4";
          return (
            <HeadingTag
              key={`${segment.type}-${index}`}
              className={cn(
                "font-semibold tracking-tight text-foreground",
                segment.level <= 2 ? "text-base" : "text-sm",
              )}
            >
              {segment.content}
            </HeadingTag>
          );
        }

        if (segment.type === "unordered-list") {
          return (
            <ul key={`${segment.type}-${index}`} className="space-y-2 pl-5 text-muted-foreground">
              {segment.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`} className="list-disc">
                  {item}
                </li>
              ))}
            </ul>
          );
        }

        if (segment.type === "ordered-list") {
          return (
            <ol key={`${segment.type}-${index}`} className="space-y-2 pl-5 text-muted-foreground">
              {segment.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`} className="list-decimal">
                  {item}
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={`${segment.type}-${index}`} className="whitespace-pre-wrap text-muted-foreground">
            {segment.content}
          </p>
        );
      })}
    </div>
  );
}

export function AutomationDescriptionContent({
  description,
  mermaidContent,
  className,
  hideDiagram,
}: AutomationDescriptionContentProps) {
  const parts = splitAutomationDescription(description, mermaidContent);
  const blocks = parseDescriptionBlocks(parts.description);
  const hasDescriptionBlocks = blocks.length > 0;
  const hasDiagram = Boolean(parts.mermaidContent);

  if (!hasDescriptionBlocks && !hasDiagram) {
    return <p className={cn("text-sm text-muted-foreground", className)}>No description</p>;
  }

  return (
    <div className={cn("space-y-4", className)}>
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <pre
              key={`code-${index}`}
              className="overflow-x-auto rounded-2xl border bg-muted/50 p-4 font-mono text-xs leading-6 text-muted-foreground"
            >
              <code>{block.content}</code>
            </pre>
          );
        }

        return <MarkdownBlock key={`markdown-${index}`} content={block.content} />;
      })}
      {hasDiagram && !hideDiagram ? <DiagramBlock chart={parts.mermaidContent ?? ""} /> : null}
    </div>
  );
}

export function AutomationDescriptionPreview({
  description,
  mermaidContent,
}: {
  description: string;
  mermaidContent?: string | null;
}) {
  const preview = getAutomationDescriptionPreview(description, mermaidContent);
  const hasDiagram = Boolean(
    splitAutomationDescription(description, mermaidContent).mermaidContent,
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="max-w-[48ch] truncate text-xs text-muted-foreground">{preview}</p>
      {hasDiagram ? (
        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
          <GitBranchPlusIcon className="size-3" />
          Workflow diagram
        </span>
      ) : null}
    </div>
  );
}
