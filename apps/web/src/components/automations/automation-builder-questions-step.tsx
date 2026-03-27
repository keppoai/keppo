import { useEffect, useRef } from "react";
import type { AutomationClarificationQuestion } from "@keppo/shared/ai_generation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRightIcon, CheckIcon, ChevronLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

type QuestionAnswerValue = string | string[];

type AutomationBuilderQuestionsStepProps = {
  question: AutomationClarificationQuestion;
  questionIndex: number;
  questionCount: number;
  currentValue: QuestionAnswerValue | undefined;
  inlineMessage: string | null;
  inlineMessageTone: "muted" | "warning" | "error";
  onAnswerChange: (value: QuestionAnswerValue) => void;
  onBack: () => void;
  onContinue: () => void;
  onJumpToQuestion: (index: number) => void;
  questionStates: Array<{
    id: string;
    answered: boolean;
    active: boolean;
  }>;
};

const transitionProps = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.18 },
} as const;

const isContinueAllowed = (
  question: AutomationClarificationQuestion,
  value: QuestionAnswerValue | undefined,
): boolean => {
  if (!question.required) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return false;
};

export function AutomationBuilderQuestionsStep({
  question,
  questionIndex,
  questionCount,
  currentValue,
  inlineMessage,
  inlineMessageTone,
  onAnswerChange,
  onBack,
  onContinue,
  onJumpToQuestion,
  questionStates,
}: AutomationBuilderQuestionsStepProps) {
  const reduceMotion = useReducedMotion();
  const canContinue = isContinueAllowed(question, currentValue);
  const answeredCount = questionStates.filter((entry) => entry.answered).length;
  const progressPercentage = Math.round((answeredCount / Math.max(questionCount, 1)) * 100);
  const shortcutRange = `1-${Math.min(question.options.length, 9)}`;
  const optionSelectionRole = question.input_type === "radio" ? "radio" : "checkbox";
  const optionsContainerRole =
    question.input_type === "text"
      ? null
      : question.input_type === "radio"
        ? "radiogroup"
        : "group";
  const answerRef = useRef(currentValue);
  const continueRef = useRef(onContinue);
  const answerChangeRef = useRef(onAnswerChange);

  useEffect(() => {
    answerRef.current = currentValue;
  }, [currentValue]);

  useEffect(() => {
    continueRef.current = onContinue;
  }, [onContinue]);

  useEffect(() => {
    answerChangeRef.current = onAnswerChange;
  }, [onAnswerChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (question.input_type !== "text" && /^[1-9]$/.test(event.key)) {
        const optionIndex = Number(event.key) - 1;
        const option = question.options[optionIndex];
        if (!option) {
          return;
        }
        event.preventDefault();
        if (question.input_type === "radio") {
          answerChangeRef.current(option.value);
          return;
        }
        const current = Array.isArray(answerRef.current) ? answerRef.current : [];
        answerChangeRef.current(
          current.includes(option.value)
            ? current.filter((entry) => entry !== option.value)
            : [...current, option.value],
        );
        return;
      }

      if (event.key === "Enter") {
        const target = event.target;
        const targetElement = target instanceof HTMLElement ? target : null;
        if (
          targetElement?.closest(
            'button, a, select, option, textarea, [role="button"], [role="radio"], [role="checkbox"]',
          )
        ) {
          return;
        }
        if (canContinue) {
          event.preventDefault();
          continueRef.current();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canContinue, question]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-background/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
              Clarifications
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Answer the missing details, then Keppo will draft the automation.
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">
              Question {questionIndex + 1} of {questionCount}
            </p>
            <p className="text-xs text-muted-foreground">{progressPercentage}% complete</p>
          </div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {questionStates.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              className={cn(
                "flex size-9 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                entry.active && "border-primary bg-primary text-primary-foreground",
                !entry.active &&
                  entry.answered &&
                  "border-primary/25 bg-primary/5 text-primary hover:border-primary/40",
                !entry.active &&
                  !entry.answered &&
                  "border-border bg-background text-muted-foreground hover:border-primary/30",
              )}
              onClick={() => onJumpToQuestion(index)}
              aria-label={`Go to question ${index + 1}`}
            >
              {entry.answered && !entry.active ? <CheckIcon className="size-4" /> : index + 1}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={question.id}
          {...(reduceMotion ? { transition: { duration: 0 } } : transitionProps)}
          className="rounded-[2rem] border bg-background/85 p-6 shadow-sm"
        >
          <div className="max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
              Builder question
            </p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
              {question.label}
            </h3>
            {question.description ? (
              <p className="mt-3 text-base leading-7 text-muted-foreground">
                {question.description}
              </p>
            ) : null}
          </div>

          <div
            className="mt-8 space-y-3"
            {...(optionsContainerRole
              ? {
                  role: optionsContainerRole,
                  "aria-label": question.label,
                }
              : {})}
          >
            {question.input_type === "text" ? (
              <div className="max-w-xl">
                <Input
                  value={typeof currentValue === "string" ? currentValue : ""}
                  placeholder={question.placeholder ?? "Type a short answer"}
                  onChange={(event) => onAnswerChange(event.currentTarget.value)}
                  className="h-12 rounded-2xl border-border/70 bg-background px-4 text-base"
                  autoFocus
                />
              </div>
            ) : (
              question.options.map((option, index) => {
                const checked =
                  question.input_type === "radio"
                    ? currentValue === option.value
                    : Array.isArray(currentValue) && currentValue.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      "flex w-full items-start justify-between gap-4 rounded-2xl border px-4 py-4 text-left transition-colors",
                      checked
                        ? "border-primary bg-primary/6 text-foreground"
                        : "border-border/70 bg-background hover:border-primary/35 hover:bg-primary/4",
                    )}
                    onClick={() => {
                      if (question.input_type === "radio") {
                        onAnswerChange(option.value);
                        return;
                      }
                      const current = Array.isArray(currentValue) ? currentValue : [];
                      onAnswerChange(
                        current.includes(option.value)
                          ? current.filter((entry) => entry !== option.value)
                          : [...current, option.value],
                      );
                    }}
                    role={optionSelectionRole}
                    aria-checked={checked}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-muted-foreground",
                          )}
                        >
                          {index + 1}
                        </span>
                        <span className="text-base font-medium">{option.label}</span>
                      </div>
                      {option.description ? (
                        <p className="mt-2 pl-10 text-sm text-muted-foreground">
                          {option.description}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {checked ? <CheckIcon className="size-3.5" /> : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {inlineMessage ? (
            <p
              className={cn(
                "mt-6 text-sm",
                inlineMessageTone === "error" && "text-destructive",
                inlineMessageTone === "warning" && "text-amber-700 dark:text-amber-400",
                inlineMessageTone === "muted" && "text-muted-foreground",
              )}
              role="alert"
            >
              {inlineMessage}
            </p>
          ) : null}

          <div className="mt-8 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span>Keyboard:</span>
                {question.input_type !== "text" ? (
                  <>
                    <KbdGroup>
                      <Kbd>{shortcutRange}</Kbd>
                    </KbdGroup>
                    <span>select</span>
                    <span className="text-muted-foreground/60">·</span>
                  </>
                ) : null}
                <KbdGroup>
                  <Kbd>Enter</Kbd>
                </KbdGroup>
                <span>continue</span>
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={onBack}>
                <ChevronLeftIcon className="mr-1 size-4" />
                {questionIndex === 0 ? "Edit brief" : "Back"}
              </Button>
              <Button type="button" onClick={onContinue} disabled={!canContinue}>
                <ArrowRightIcon className="mr-2 size-4" />
                {questionIndex === questionCount - 1 ? "Generate draft" : "Continue"}
              </Button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
