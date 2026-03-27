import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckIcon, ClipboardIcon } from "lucide-react";
import { List, type ListImperativeAPI, type RowComponentProps } from "react-window";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import {
  mergeRunLogLines,
  parseAutomationRunLogs,
  parseColdArchiveLines,
  type AutomationRunLogLine,
} from "@/lib/automations-view-model";
import { type UserFacingError, toUserFacingError } from "@/lib/user-facing-errors";

type LogViewerProps = {
  automationRunId: string;
};

const LOG_VIEWER_HEIGHT = 420;
const LOG_ROW_HEIGHT = 24;

function LogLineRow({
  ariaAttributes,
  index,
  style,
  lines,
}: RowComponentProps<{ lines: AutomationRunLogLine[] }>) {
  const line = lines[index];
  if (!line) {
    return null;
  }

  return (
    <div
      {...ariaAttributes}
      style={style}
      className={
        line.level === "stderr"
          ? "px-3 text-red-300"
          : line.level === "system"
            ? "px-3 text-blue-300"
            : "px-3 text-zinc-100"
      }
    >
      <span className="text-zinc-500">[{line.level}]</span>{" "}
      <span className="whitespace-pre">{line.content}</span>
    </div>
  );
}

export function LogViewer({ automationRunId }: LogViewerProps) {
  const [afterSeq, setAfterSeq] = useState<number | undefined>(undefined);
  const [hotLines, setHotLines] = useState<AutomationRunLogLine[]>([]);
  const [coldLines, setColdLines] = useState<AutomationRunLogLine[]>([]);
  const [coldLoadError, setColdLoadError] = useState<UserFacingError | null>(null);
  const [isScrollLocked, setIsScrollLocked] = useState(false);
  const [resolvedMode, setResolvedMode] = useState<"hot" | "cold" | "expired" | null>(null);
  const listRef = useRef<ListImperativeAPI | null>(null);

  const logsRaw = useQuery(
    makeFunctionReference<"query">("automation_runs:getAutomationRunLogs"),
    automationRunId
      ? {
          automation_run_id: automationRunId,
          ...(afterSeq !== undefined ? { after_seq: afterSeq } : {}),
        }
      : "skip",
  );

  const logsPayload = useMemo(
    () => (logsRaw === undefined ? null : parseAutomationRunLogs(logsRaw)),
    [logsRaw],
  );

  useEffect(() => {
    setAfterSeq(undefined);
    setHotLines([]);
    setColdLines([]);
    setColdLoadError(null);
    setIsScrollLocked(false);
    setResolvedMode(null);
  }, [automationRunId]);

  useEffect(() => {
    if (!logsPayload) {
      return;
    }
    setResolvedMode(logsPayload.mode);
  }, [logsPayload]);

  useEffect(() => {
    if (!logsPayload || logsPayload.mode !== "hot") {
      return;
    }
    if (logsPayload.lines.length === 0) {
      return;
    }

    setHotLines((previous) => mergeRunLogLines(previous, logsPayload.lines));

    const lastLine = logsPayload.lines[logsPayload.lines.length - 1];
    if (lastLine) {
      setAfterSeq(lastLine.seq);
    }
  }, [logsPayload]);

  useEffect(() => {
    if (!logsPayload || logsPayload.mode !== "cold") {
      return;
    }
    let cancelled = false;
    setColdLoadError(null);
    void parseColdArchiveLines(logsPayload.storage_url)
      .then((lines) => {
        if (cancelled) {
          return;
        }
        setColdLines(lines);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setColdLoadError(
          toUserFacingError(error, {
            fallback: "Failed to read archived logs.",
          }),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [logsPayload]);

  const activeMode = logsPayload?.mode ?? resolvedMode;
  const renderedLines = activeMode === "cold" ? coldLines : hotLines;

  useEffect(() => {
    if (isScrollLocked) {
      return;
    }
    if (!listRef.current || renderedLines.length === 0) {
      return;
    }
    listRef.current.scrollToRow({
      align: "end",
      behavior: "instant",
      index: renderedLines.length - 1,
    });
  }, [coldLines, hotLines, isScrollLocked, renderedLines.length]);

  const reducedMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = renderedLines.map((line) => `[${line.level}] ${line.content}`).join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{activeMode ?? "loading"}</Badge>
          {activeMode === "hot" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsScrollLocked((previous) => !previous);
              }}
            >
              {isScrollLocked ? "Resume auto-scroll" : "Scroll lock"}
            </Button>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void handleCopy();
          }}
          disabled={renderedLines.length === 0}
          className="relative min-w-[100px] overflow-hidden"
        >
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span
                key="copied"
                className="flex items-center gap-1.5 text-[var(--success)]"
                initial={reducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                {...(reducedMotion ? {} : { exit: { opacity: 0 } })}
                transition={{ duration: 0.1 }}
              >
                <CheckIcon className="size-3.5" />
                Copied!
              </motion.span>
            ) : (
              <motion.span
                key="copy"
                className="flex items-center gap-1.5"
                initial={reducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                {...(reducedMotion ? {} : { exit: { opacity: 0 } })}
                transition={{ duration: 0.1 }}
              >
                <ClipboardIcon className="size-3.5" />
                Copy log
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </div>

      {activeMode === "expired" ? (
        <p className="text-muted-foreground text-sm">Logs have expired for this run.</p>
      ) : null}

      {coldLoadError ? <UserFacingErrorView error={coldLoadError} variant="compact" /> : null}

      <div className="overflow-hidden rounded-md border">
        {renderedLines.length === 0 ? (
          <div className="bg-zinc-950 px-3 py-3 font-mono text-xs text-zinc-400">No logs yet.</div>
        ) : (
          <List
            listRef={listRef}
            rowComponent={LogLineRow}
            rowCount={renderedLines.length}
            rowHeight={LOG_ROW_HEIGHT}
            rowProps={{ lines: renderedLines }}
            defaultHeight={LOG_VIEWER_HEIGHT}
            overscanCount={12}
            className="bg-zinc-950 font-mono text-xs"
            style={{ height: LOG_VIEWER_HEIGHT }}
          />
        )}
      </div>
    </div>
  );
}
