import {
  AlertCircleIcon,
  BrainIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  Code2Icon,
  InfoIcon,
  Settings2Icon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { RunEvent, RunEventAutomationConfigEntry } from "@/lib/automations-view-model";

type RunChatBubbleProps = {
  event: RunEvent;
  isLatest?: boolean;
};

const formatTimestamp = (ts: string): string => {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
};

const EXECUTE_CODE_SUMMARY_FALLBACK = "Executed code";
const EXECUTE_CODE_TOKEN_PATTERN =
  /\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[\s\S])*?`|\b(?:async|await|break|case|catch|class|const|continue|default|else|export|extends|false|finally|for|from|function|if|import|let|new|null|return|switch|this|throw|true|try|undefined|var|while)\b|\b\d+(?:\.\d+)?\b/gs;

type CodeTokenKind = "plain" | "comment" | "string" | "keyword" | "number";

type CodeToken = {
  kind: CodeTokenKind;
  text: string;
};

const classifyCodeToken = (value: string): CodeTokenKind => {
  if (value.startsWith("//") || value.startsWith("/*")) {
    return "comment";
  }
  if (value.startsWith('"') || value.startsWith("'") || value.startsWith("`")) {
    return "string";
  }
  if (/^\d/u.test(value)) {
    return "number";
  }
  return "keyword";
};

const tokenizeJavaScriptCode = (code: string): CodeToken[] => {
  const tokens: CodeToken[] = [];
  let cursor = 0;

  for (const match of code.matchAll(EXECUTE_CODE_TOKEN_PATTERN)) {
    const value = match[0];
    if (typeof value !== "string") {
      continue;
    }
    const start = match.index ?? cursor;
    if (start > cursor) {
      tokens.push({ kind: "plain", text: code.slice(cursor, start) });
    }
    tokens.push({
      kind: classifyCodeToken(value),
      text: value,
    });
    cursor = start + value.length;
  }

  if (cursor < code.length) {
    tokens.push({ kind: "plain", text: code.slice(cursor) });
  }

  return tokens;
};

const countCodeLines = (code: string): number => code.split(/\r?\n/u).length;

const getExecuteCodePayload = (
  event: Extract<RunEvent, { type: "tool_call" }>,
): { summary: string; code: string | null } | null => {
  if (event.toolName !== "execute_code") {
    return null;
  }
  const description =
    typeof event.args?.description === "string" ? event.args.description.trim() : "";
  const code = typeof event.args?.code === "string" ? event.args.code : "";
  return {
    summary: description || EXECUTE_CODE_SUMMARY_FALLBACK,
    code: code.length > 0 ? code : null,
  };
};

const summarizeJsonNode = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `Array(${value.length})`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length === 0 ? "{}" : `{${keys.length} keys}`;
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
};

const JsonTree = ({ data, label }: { data: unknown; label?: string }) => {
  return (
    <div className="run-json-tree bg-muted/35 mt-2 overflow-auto rounded-lg px-2.5 py-2">
      <JsonTreeNode
        data={data}
        depth={0}
        path={label ?? "root"}
        {...(label !== undefined ? { label } : {})}
      />
    </div>
  );
};

const JsonTreeNode = ({
  data,
  depth,
  label,
  path,
}: {
  data: unknown;
  depth: number;
  label?: string;
  path: string;
}) => {
  const isArray = Array.isArray(data);
  const isObject = Boolean(data) && typeof data === "object" && !isArray;
  const entries = isArray
    ? data.map((value, index) => [String(index), value] as const)
    : isObject
      ? Object.entries(data as Record<string, unknown>)
      : [];
  const expandable = entries.length > 0;
  const defaultOpen = depth < 3 && entries.length <= 4;

  if (!expandable) {
    return (
      <div className="run-json-tree__row">
        {label ? <span className="run-json-tree__key">{label}</span> : null}
        <span className="run-json-tree__value">{summarizeJsonNode(data)}</span>
      </div>
    );
  }

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <div className="run-json-tree__row">
        <CollapsibleTrigger className="run-json-tree__toggle">
          <ChevronRightIcon className="run-json-tree__chevron size-3" />
          {label ? <span className="run-json-tree__key">{label}</span> : null}
          <span className="run-json-tree__value">
            {isArray ? `[${entries.length}]` : `{${entries.length}}`}
          </span>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="data-[state=closed]:hidden data-[state=open]:block">
        <div className="run-json-tree__children">
          {entries.map(([entryKey, entryValue]) => (
            <JsonTreeNode
              key={`${path}.${entryKey}`}
              data={entryValue}
              depth={depth + 1}
              path={`${path}.${entryKey}`}
              {...(!isArray ? { label: entryKey } : {})}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const SectionLabel = ({ children }: { children: string }) => (
  <div className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
    {children}
  </div>
);

const HighlightedCodeBlock = ({ code }: { code: string }) => {
  const tokens = tokenizeJavaScriptCode(code);

  return (
    <pre className="run-code-block mt-3 overflow-auto rounded-xl px-3 py-3 text-xs">
      <code>
        {tokens.map((token, index) => (
          <span
            key={`${index}-${token.kind}-${token.text.length}`}
            className={token.kind === "plain" ? undefined : `run-code-token--${token.kind}`}
          >
            {token.text}
          </span>
        ))}
      </code>
    </pre>
  );
};

const ToolCallResultSection = ({ event }: { event: Extract<RunEvent, { type: "tool_call" }> }) => {
  if (event.result !== undefined) {
    return (
      <div>
        <SectionLabel>Result</SectionLabel>
        {event.resultFormat === "json" || typeof event.result !== "string" ? (
          <JsonTree data={event.result} />
        ) : (
          <pre className="bg-muted/35 mt-2 overflow-auto rounded-lg px-2.5 py-2 font-mono text-xs whitespace-pre-wrap">
            {event.resultText ?? String(event.result)}
          </pre>
        )}
      </div>
    );
  }

  if (event.awaitingResult) {
    return <p className="text-muted-foreground text-sm">Waiting for structured tool result…</p>;
  }

  return null;
};

const DebugDetails = ({ event }: { event: RunEvent }) => {
  return (
    <Collapsible className="mt-3 border-t border-black/8 pt-2 dark:border-white/8">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px] font-medium">
        <ChevronRightIcon className="run-collapsible-chevron size-3" />
        Raw lines
        <span className="text-[10px]">({event.debugLines.length})</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=closed]:hidden data-[state=open]:block">
        <div className="mt-2 space-y-2">
          <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            <dt>Seq</dt>
            <dd className="font-mono">
              {event.seq}
              {event.lastSeq !== event.seq ? ` - ${event.lastSeq}` : ""}
            </dd>
            <dt>Time</dt>
            <dd className="font-mono">
              {event.timestamp}
              {event.lastTimestamp !== event.timestamp ? ` -> ${event.lastTimestamp}` : ""}
            </dd>
          </dl>
          <div className="bg-muted/30 space-y-1 rounded-lg px-2 py-1.5 font-mono text-[11px]">
            {event.debugLines.map((line) => (
              <div
                key={`${line.seq}-${line.level}`}
                className="grid grid-cols-[auto_auto_1fr] gap-x-2"
              >
                <span className="text-muted-foreground">{line.seq}</span>
                <span className="text-muted-foreground">[{line.level}]</span>
                <span className="whitespace-pre-wrap break-words">{line.content}</span>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const BubbleFrame = ({
  icon,
  title,
  event,
  className,
  titleClassName,
  meta,
  children,
  isLatest,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  event: RunEvent;
  className?: string;
  titleClassName?: string;
  meta?: ReactNode;
  children: ReactNode;
  isLatest: boolean | undefined;
  compact?: boolean;
}) => {
  return (
    <article
      className={cn(
        "max-w-[min(100%,52rem)] rounded-2xl border border-black/8 bg-card shadow-sm dark:border-white/8",
        compact ? "px-4 py-2.5" : "px-4 py-3",
        isLatest && "ring-primary/18 border-primary/20 ring-2",
        className,
      )}
    >
      <div className="mb-3 flex items-start gap-2">
        <div className="mt-0.5">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("text-sm font-semibold", titleClassName)}>{title}</span>
            {isLatest ? (
              <Badge className="bg-amber-500 text-[10px] text-white hover:bg-amber-500">
                Latest
              </Badge>
            ) : null}
            {meta}
          </div>
          {!compact || isLatest ? (
            <div className="text-muted-foreground mt-0.5 text-[11px]">
              {formatTimestamp(event.timestamp)}
            </div>
          ) : null}
        </div>
      </div>
      {children}
      <DebugDetails event={event} />
    </article>
  );
};

const renderConfigValue = (entry: RunEventAutomationConfigEntry) => {
  if (typeof entry.value === "string") {
    return <span className="font-mono text-xs">{entry.valueText}</span>;
  }
  return <JsonTree data={entry.value} label={entry.label} />;
};

const SystemBubble = ({
  event,
  isLatest,
}: {
  event: Extract<RunEvent, { type: "system" }>;
  isLatest?: boolean;
}) => {
  const outcome = event.outcome;
  const isOutcome = outcome !== undefined;
  return (
    <BubbleFrame
      event={event}
      isLatest={isLatest}
      compact
      icon={
        isOutcome ? (
          outcome.success ? (
            <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircleIcon className="size-4 text-destructive" />
          )
        ) : (
          <InfoIcon className="text-muted-foreground size-4" />
        )
      }
      title={isOutcome ? "Automation Outcome" : "System"}
      className={
        isOutcome
          ? outcome.success
            ? "bg-card border-l-4 border-l-emerald-400/75"
            : "bg-card border-l-4 border-l-destructive/60"
          : "bg-card"
      }
      titleClassName={
        isOutcome
          ? outcome.success
            ? "text-emerald-900 dark:text-emerald-100"
            : "text-destructive"
          : "text-muted-foreground"
      }
      meta={
        isOutcome ? (
          <>
            <Badge variant={outcome.success ? "default" : "destructive"} className="text-[10px]">
              {outcome.success ? "Success" : "Failure"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {outcome.source === "fallback_missing" ? "Fallback" : "Agent"}
            </Badge>
          </>
        ) : undefined
      }
    >
      <div className="space-y-2">
        {isOutcome ? (
          <p className="text-sm leading-6">{outcome.summary}</p>
        ) : (
          event.messages.map((message, index) => (
            <p key={`${event.seq}-${index}`} className="text-sm leading-6">
              {message}
            </p>
          ))
        )}
      </div>
    </BubbleFrame>
  );
};

const AutomationConfigBubble = ({
  event,
  isLatest,
}: {
  event: Extract<RunEvent, { type: "automation_config" }>;
  isLatest?: boolean;
}) => (
  <BubbleFrame
    event={event}
    isLatest={isLatest}
    compact
    icon={<Settings2Icon className="size-4 text-amber-600 dark:text-amber-400" />}
    title="Runtime Config"
    className="border-l-4 border-l-amber-400/70"
  >
    <div className="space-y-3">
      {event.entries.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {event.entries.map((entry) => (
            <div
              key={`${event.seq}-${entry.key}-${entry.valueText}`}
              className="bg-muted/35 rounded-lg px-3 py-2"
            >
              <SectionLabel>{entry.label}</SectionLabel>
              <div className="mt-1 break-words">{renderConfigValue(entry)}</div>
            </div>
          ))}
        </div>
      ) : null}
      {event.config ? <JsonTree data={event.config} label="Config" /> : null}
    </div>
  </BubbleFrame>
);

const ThinkingBubble = ({
  event,
  isLatest,
}: {
  event: Extract<RunEvent, { type: "thinking" }>;
  isLatest?: boolean;
}) => (
  <BubbleFrame
    event={event}
    isLatest={isLatest}
    compact
    icon={<BrainIcon className="size-4 text-sky-600 dark:text-sky-400" />}
    title="Thinking"
    className="border-l-4 border-l-sky-400/75"
    titleClassName="text-sky-900 dark:text-sky-100"
    meta={
      event.fragments.length > 1 ? (
        <span className="text-muted-foreground text-[11px]">{event.fragments.length} blocks</span>
      ) : null
    }
  >
    <div className="space-y-3">
      {event.fragments.map((fragment, index) => (
        <p key={`${event.seq}-${index}`} className="text-sm leading-6 whitespace-pre-wrap">
          {fragment}
        </p>
      ))}
    </div>
  </BubbleFrame>
);

const ToolCallBubble = ({
  event,
  isLatest,
}: {
  event: Extract<RunEvent, { type: "tool_call" }>;
  isLatest?: boolean;
}) => {
  const isError = event.status === "error";
  const tone = isError
    ? "border-l-4 border-l-destructive/80"
    : "border-l-4 border-l-emerald-400/75";

  return (
    <BubbleFrame
      event={event}
      isLatest={isLatest}
      icon={<WrenchIcon className="size-4 text-emerald-700 dark:text-emerald-400" />}
      title={event.toolName || "Tool"}
      className={tone}
      meta={
        <>
          {event.durationMs !== undefined ? (
            <Badge variant="outline" className="text-[10px]">
              {event.durationMs}ms
            </Badge>
          ) : null}
          {event.status ? (
            <Badge variant={isError ? "destructive" : "default"} className="text-[10px] capitalize">
              {event.status}
            </Badge>
          ) : null}
        </>
      }
    >
      <div className="space-y-3">
        {event.args ? (
          <div>
            <SectionLabel>Arguments</SectionLabel>
            <JsonTree data={event.args} />
          </div>
        ) : null}
        <ToolCallResultSection event={event} />
      </div>
    </BubbleFrame>
  );
};

const ExecuteCodeBubble = ({
  event,
  isLatest,
}: {
  event: Extract<RunEvent, { type: "tool_call" }>;
  isLatest?: boolean;
}) => {
  const payload = getExecuteCodePayload(event);
  if (!payload) {
    return null;
  }

  const isError = event.status === "error";
  const codeLineCount = payload.code ? countCodeLines(payload.code) : 0;
  const [isCodeOpen, setIsCodeOpen] = useState(false);

  return (
    <BubbleFrame
      event={event}
      isLatest={isLatest}
      icon={<Code2Icon className="size-4 text-primary" />}
      title="Execute code"
      className={isError ? "border-l-4 border-l-destructive/80" : "border-l-4 border-l-primary/75"}
      titleClassName={isError ? "text-destructive" : "text-foreground"}
      meta={
        <>
          {event.durationMs !== undefined ? (
            <Badge variant="outline" className="text-[10px]">
              {event.durationMs}ms
            </Badge>
          ) : null}
          {event.status ? (
            <Badge variant={isError ? "destructive" : "default"} className="text-[10px] capitalize">
              {event.status}
            </Badge>
          ) : null}
        </>
      }
    >
      <div className="space-y-3">
        <div className="bg-muted/28 rounded-xl px-3 py-2.5">
          <SectionLabel>Summary</SectionLabel>
          <p className="mt-1 text-sm leading-6">{payload.summary}</p>
        </div>

        <Collapsible
          open={isCodeOpen}
          onOpenChange={setIsCodeOpen}
          className="rounded-xl border border-black/8 bg-muted/18 px-3 py-2.5 dark:border-white/8"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <SectionLabel>Code</SectionLabel>
              <p className="text-muted-foreground mt-1 text-xs">
                {payload.code
                  ? `${codeLineCount} line${codeLineCount === 1 ? "" : "s"} of JavaScript`
                  : "Code was not captured for this run."}
              </p>
            </div>

            {payload.code ? (
              <CollapsibleTrigger className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium">
                <ChevronRightIcon className="run-collapsible-chevron size-3" />
                {isCodeOpen ? "Hide code" : "Show code"}
              </CollapsibleTrigger>
            ) : null}
          </div>

          {payload.code ? (
            <CollapsibleContent className="data-[state=closed]:hidden data-[state=open]:block">
              <HighlightedCodeBlock code={payload.code} />
            </CollapsibleContent>
          ) : null}
        </Collapsible>

        <ToolCallResultSection event={event} />
      </div>
    </BubbleFrame>
  );
};

const OutputBubble = ({
  event,
  isLatest,
}: {
  event: Extract<RunEvent, { type: "output" }>;
  isLatest?: boolean;
}) => (
  <BubbleFrame
    event={event}
    isLatest={isLatest}
    icon={<TerminalIcon className="size-4 text-primary" />}
    title="Output"
    className="border-l-4 border-l-primary/70"
  >
    <div className="space-y-3">
      {event.format === "json" || event.parsed !== undefined ? (
        <JsonTree data={event.parsed ?? event.text} />
      ) : (
        <pre className="font-mono text-xs leading-6 whitespace-pre-wrap">{event.text}</pre>
      )}
    </div>
  </BubbleFrame>
);

const ErrorBubble = ({
  event,
  isLatest,
}: {
  event: Extract<RunEvent, { type: "error" }>;
  isLatest?: boolean;
}) => (
  <BubbleFrame
    event={event}
    isLatest={isLatest}
    icon={<AlertCircleIcon className="text-destructive size-4" />}
    title="Error"
    className="border-l-4 border-l-destructive/80"
    titleClassName="text-destructive"
    meta={
      event.code ? (
        <Badge variant="destructive" className="text-[10px]">
          {event.code}
        </Badge>
      ) : null
    }
  >
    <p className="text-sm leading-6 whitespace-pre-wrap">{event.message}</p>
  </BubbleFrame>
);

const RawBubble = ({ event }: { event: Extract<RunEvent, { type: "raw" }> }) => (
  <article className="rounded-2xl border border-black/8 bg-black/[0.04] px-4 py-3 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
    <div className="mb-2 flex items-center gap-2">
      <TerminalIcon className="text-muted-foreground size-4" />
      <span className="text-muted-foreground text-sm font-medium">Raw log</span>
      <Badge variant="outline" className="text-[10px]">
        {event.level}
      </Badge>
    </div>
    <pre className="font-mono text-xs leading-6 whitespace-pre-wrap">{event.content}</pre>
    <DebugDetails event={event} />
  </article>
);

export function RunChatBubble({ event, isLatest = false }: RunChatBubbleProps) {
  switch (event.type) {
    case "system":
      return <SystemBubble event={event} isLatest={isLatest} />;
    case "automation_config":
      return <AutomationConfigBubble event={event} isLatest={isLatest} />;
    case "thinking":
      return <ThinkingBubble event={event} isLatest={isLatest} />;
    case "tool_call":
      if (event.toolName === "execute_code") {
        return <ExecuteCodeBubble event={event} isLatest={isLatest} />;
      }
      return <ToolCallBubble event={event} isLatest={isLatest} />;
    case "output":
      return <OutputBubble event={event} isLatest={isLatest} />;
    case "error":
      return <ErrorBubble event={event} isLatest={isLatest} />;
    case "raw":
      return <RawBubble event={event} />;
  }
}
