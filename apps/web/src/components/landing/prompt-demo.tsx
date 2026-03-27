import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, SparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Provider mini-icons for inline display ──

function SlackInline() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[1.1em] inline-block align-middle -mt-0.5">
      <path
        d="M6.527 14.514a1.636 1.636 0 1 1-1.636-1.636h1.636v1.636Zm.818 0a1.636 1.636 0 1 1 3.273 0v4.09a1.636 1.636 0 1 1-3.273 0v-4.09Z"
        fill="#E01E5A"
      />
      <path
        d="M9.482 6.527a1.636 1.636 0 1 1 1.636-1.636v1.636H9.482Zm0 .818a1.636 1.636 0 0 1 0 3.273H5.39a1.636 1.636 0 1 1 0-3.273h4.091Z"
        fill="#36C5F0"
      />
      <path
        d="M17.468 9.482a1.636 1.636 0 1 1 1.636 1.636h-1.636V9.482Zm-.818 0a1.636 1.636 0 0 1-3.273 0V5.39a1.636 1.636 0 1 1 3.273 0v4.091Z"
        fill="#2EB67D"
      />
      <path
        d="M14.514 17.468a1.636 1.636 0 1 1-1.636 1.636v-1.636h1.636Zm0-.818a1.636 1.636 0 0 1 0-3.273h4.09a1.636 1.636 0 0 1 0 3.273h-4.09Z"
        fill="#ECB22E"
      />
    </svg>
  );
}

function StripeInline() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[1.1em] inline-block align-middle -mt-0.5">
      <rect width="24" height="24" rx="4" fill="#635BFF" />
      <path
        d="M11.2 9.65c0-.68.56-.94 1.49-.94.97 0 2.2.3 3.17.82V6.66a8.5 8.5 0 0 0-3.17-.6c-2.6 0-4.32 1.35-4.32 3.62 0 3.53 4.86 2.97 4.86 4.49 0 .8-.7 1.06-1.67 1.06-1.44 0-2.84-.6-3.82-1.4v2.93a8.84 8.84 0 0 0 3.82.87c2.66 0 4.49-1.32 4.49-3.61-.01-3.81-4.85-3.13-4.85-4.47Z"
        fill="#fff"
      />
    </svg>
  );
}

function GitHubInline() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-[1.1em] inline-block align-middle -mt-0.5"
    >
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10Z" />
    </svg>
  );
}

function NotionInline() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-[1.1em] inline-block align-middle -mt-0.5"
    >
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.08 2.18c-.42-.326-.98-.7-2.055-.607L3.01 2.7c-.467.047-.56.28-.374.466l1.823 1.042Zm.793 3.358v13.886c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.166V6.63c0-.606-.234-.933-.748-.886l-15.177.886c-.56.047-.747.327-.747.933Z" />
    </svg>
  );
}

function GmailInline() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[1.1em] inline-block align-middle -mt-0.5">
      <path
        d="M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Z"
        fill="#E8E8E8"
      />
      <path d="M2 6l10 7 10-7" stroke="#EA4335" strokeWidth="1.5" fill="none" />
      <path d="M2 6v12a2 2 0 0 0 2 2h1V8.5L2 6Z" fill="#4285F4" />
      <path d="M22 6v12a2 2 0 0 1-2 2h-1V8.5L22 6Z" fill="#34A853" />
      <path d="M5 20h14V8.5L12 13 5 8.5V20Z" fill="#F5F5F5" />
      <path d="M2 6l3 2.5V4H4a2 2 0 0 0-2 2Z" fill="#C5221F" />
      <path d="M22 6l-3 2.5V4h1a2 2 0 0 1 2 2Z" fill="#FBBC04" />
    </svg>
  );
}

// ── Provider name → icon mapping ──

const PROVIDER_ICONS: Record<string, () => ReactNode> = {
  stripe: StripeInline,
  slack: SlackInline,
  github: GitHubInline,
  notion: NotionInline,
  gmail: GmailInline,
  email: GmailInline,
};

function renderTextWithIcons(text: string): ReactNode[] {
  const providerPattern = /\b(Stripe|Slack|GitHub|Notion|Gmail|email)\b/gi;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = providerPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const name = match[1]!.toLowerCase();
    const IconComponent = PROVIDER_ICONS[name];
    if (IconComponent) {
      parts.push(
        <span key={match.index} className="inline-flex items-baseline gap-1">
          <IconComponent />
          <span className="font-medium">{match[1]}</span>
        </span>,
      );
    } else {
      parts.push(match[1]);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

// ── Examples ──

// Each example has explicit pause points — character indices where the typist
// pauses to think. This gives much more natural rhythm than heuristics.
//                                                        ↓ pause indices (after this char)
const EXAMPLES = [
  {
    // "Send me a Slack message | whenever | a Stripe refund over $100 happens"
    //  0                    22  23      31  32
    prompt: "Send me a Slack message whenever a Stripe refund over $100 happens",
    pauses: [22, 31] as number[],
  },
  {
    // "Every Monday morning, | email me a summary | of last week's GitHub issues"
    //  0                  20  21                39  40
    prompt: "Every Monday morning, email me a summary of last week's GitHub issues",
    pauses: [20, 39] as number[],
  },
  {
    // "When someone sends a support email, | create a Notion page | and ping the team on Slack"
    //  0                                35  36                  56  57
    prompt: "When someone sends a support email, create a Notion page and ping the team on Slack",
    pauses: [35, 56] as number[],
  },
  {
    // "Every day at 5pm, | check Stripe for failed payments | and send me a report"
    //  0              17  18                              49  50
    prompt: "Every day at 5pm, check Stripe for failed payments and send me a report",
    pauses: [17, 49] as number[],
  },
];

const CHAR_SPEED = 8; // ms per character — very fast burst typing
const PAUSE_AT_BREAK = 600; // ms pause at marked breakpoints
const PAUSE_AFTER_TYPE = 2800;
const PAUSE_BETWEEN = 400;

type Phase = "typing" | "showing" | "pausing" | "clearing";

function useTypingDemo() {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const example = EXAMPLES[exampleIndex]!;
  const displayedText = example.prompt.slice(0, charIndex);

  const pause = useCallback(() => setIsPaused(true), []);
  const resume = useCallback(() => setIsPaused(false), []);

  useEffect(() => {
    if (isPaused) return;
    if (phase === "typing") {
      if (charIndex < example.prompt.length) {
        const isPausePoint = example.pauses.includes(charIndex);
        const delay = isPausePoint ? PAUSE_AT_BREAK : CHAR_SPEED;
        timerRef.current = setTimeout(() => setCharIndex((c) => c + 1), delay);
      } else {
        timerRef.current = setTimeout(() => setPhase("showing"), 200);
      }
    } else if (phase === "showing") {
      timerRef.current = setTimeout(() => setPhase("pausing"), PAUSE_AFTER_TYPE);
    } else if (phase === "pausing") {
      timerRef.current = setTimeout(() => setPhase("clearing"), PAUSE_BETWEEN);
    } else if (phase === "clearing") {
      setCharIndex(0);
      setExampleIndex((i) => (i + 1) % EXAMPLES.length);
      setPhase("typing");
    }
    return () => clearTimeout(timerRef.current);
  }, [phase, charIndex, example.prompt.length, isPaused]);

  return { displayedText, phase, example, pause, resume, exampleIndex };
}

// ── Main component ──

export function PromptDemo({ onSubmit }: { onSubmit: (prompt: string) => void }) {
  const { displayedText, pause, resume } = useTypingDemo();
  const [mode, setMode] = useState<"demo" | "input">("demo");
  const [userInput, setUserInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleFocus = () => {
    pause();
    setMode("input");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleBlur = () => {
    if (!userInput.trim()) {
      setMode("demo");
      resume();
    }
  };

  const handleSubmit = () => {
    const text = userInput.trim() || displayedText;
    if (text) onSubmit(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* App-like card wrapper */}
      <div className="relative group/prompt">
        {/* Glow */}
        <div
          className={cn(
            "absolute -inset-1.5 rounded-[22px] bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 opacity-0 blur-xl transition-opacity duration-500",
            mode === "input" ? "opacity-100" : "group-hover/prompt:opacity-50",
          )}
        />

        <div
          className={cn(
            "relative rounded-2xl border bg-card shadow-lg ring-1 ring-foreground/[0.06] overflow-hidden transition-all duration-300",
            mode === "input" && "ring-2 ring-primary/25 shadow-xl",
          )}
        >
          {/* App-like header bar */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-foreground/[0.04] bg-muted/30">
            <SparklesIcon className="size-3.5 text-primary" />
            <span className="text-xs font-medium text-muted-foreground">New automation</span>
          </div>

          {/* Input area — fixed height for 2 lines to prevent layout shift */}
          {mode === "demo" ? (
            <button
              type="button"
              onClick={handleFocus}
              className="w-full text-left px-5 py-4 pb-12 h-[120px] cursor-text"
            >
              <span className="text-[15px] text-muted-foreground/50 leading-[1.6]">
                {displayedText ? renderTextWithIcons(displayedText) : null}
                {/* Cursor + pill as one non-breaking unit */}
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap align-middle ml-0.5">
                  <span className="landing-cursor" />
                  <span className="rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-[11px] font-semibold tracking-wide landing-pill-shimmer">
                    Type your automation
                  </span>
                </span>
              </span>
            </button>
          ) : (
            <textarea
              ref={inputRef}
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you want to automate..."
              className="w-full bg-transparent px-5 py-4 pb-12 h-[120px] text-[15px] text-foreground placeholder:text-muted-foreground/50 outline-none resize-none leading-[1.6]"
            />
          )}

          {/* Bottom bar */}
          <div className="absolute bottom-3 right-3 flex items-center gap-2.5">
            <span className="text-[11px] text-muted-foreground/40 hidden sm:inline font-medium">
              Enter to start
            </span>
            <button
              type="button"
              onClick={handleSubmit}
              className="inline-flex items-center justify-center size-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-200 active:scale-[0.92] shadow-sm"
            >
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
