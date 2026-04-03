import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { RunChatBubble } from "@/components/automations/run-chat-bubble";
import {
  mergeRunLogLines,
  parseColdArchiveLines,
  parseAutomationRunLogs,
  toRunEvents,
  type AutomationRunLogLine,
} from "@/lib/automations-view-model";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";

type RunChatViewerProps = {
  automationRunId: string;
};

export function RunChatViewer({ automationRunId }: RunChatViewerProps) {
  const [afterSeq, setAfterSeq] = useState<number | undefined>(undefined);
  const [hotLines, setHotLines] = useState<AutomationRunLogLine[]>([]);
  const [coldLines, setColdLines] = useState<AutomationRunLogLine[]>([]);
  const [coldLoadError, setColdLoadError] = useState<UserFacingError | null>(null);
  const [isScrollLocked, setIsScrollLocked] = useState(false);
  const [resolvedMode, setResolvedMode] = useState<"hot" | "cold" | "expired" | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
        setColdLoadError(toUserFacingError(error, { fallback: "Failed to read archived logs." }));
      });
    return () => {
      cancelled = true;
    };
  }, [logsPayload]);

  useEffect(() => {
    if (isScrollLocked) {
      return;
    }
    if (!containerRef.current) {
      return;
    }
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [hotLines, coldLines, isScrollLocked]);

  const activeMode = logsPayload?.mode ?? resolvedMode;
  const renderedLines = activeMode === "cold" ? coldLines : hotLines;
  const deferredLines = useDeferredValue(renderedLines);
  const events = useMemo(() => toRunEvents(deferredLines), [deferredLines]);
  const eventCounts = useMemo(
    () =>
      events.reduce(
        (acc, event) => {
          acc.total += 1;
          acc[event.type] += 1;
          return acc;
        },
        {
          total: 0,
          system: 0,
          automation_config: 0,
          thinking: 0,
          tool_call: 0,
          output: 0,
          error: 0,
          raw: 0,
        },
      ),
    [events],
  );

  if (activeMode === "expired") {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground text-sm">Logs have expired for this run.</p>
      </div>
    );
  }

  if (coldLoadError) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-xl">
          <UserFacingErrorView error={coldLoadError} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{eventCounts.total} grouped events</Badge>
            {eventCounts.tool_call > 0 ? (
              <Badge variant="secondary">{eventCounts.tool_call} tool step(s)</Badge>
            ) : null}
            {eventCounts.error > 0 ? (
              <Badge variant="destructive">{eventCounts.error} error</Badge>
            ) : null}
            {eventCounts.thinking > 0 ? (
              <Badge variant="outline">{eventCounts.thinking} reasoning block(s)</Badge>
            ) : null}
          </div>
          {activeMode === "hot" ? (
            <Button variant="ghost" size="sm" onClick={() => setIsScrollLocked((prev) => !prev)}>
              {isScrollLocked ? "Resume auto-scroll" : "Scroll lock"}
            </Button>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Thinking cards show model narration. Search tools and execute code each get dedicated
          cards with collapsed details, while other tool, output, and error cards show the rest of
          the run evidence.
        </p>
      </div>

      <div ref={containerRef} className="flex-1 space-y-2 overflow-auto px-4 pb-6">
        {events.length === 0 ? (
          <div className="flex h-full items-center justify-center py-12">
            <div className="text-muted-foreground flex flex-col items-center gap-2">
              <div className="bg-muted size-2 animate-pulse rounded-full" />
              <p className="text-sm">Waiting for logs...</p>
            </div>
          </div>
        ) : (
          events.map((event, index) => (
            <RunChatBubble
              key={event.seq}
              event={event}
              isLatest={activeMode === "hot" && index === events.length - 1}
            />
          ))
        )}
      </div>
    </div>
  );
}
