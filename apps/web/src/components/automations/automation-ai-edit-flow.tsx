import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  parseAutomationClarificationAnswersPayload,
  parseAutomationClarificationQuestionsPayload,
  type AutomationClarificationAnswer,
  type AutomationClarificationQuestion,
  type AutomationContextSnapshot,
} from "@keppo/shared/ai_generation";
import { SparklesIcon } from "lucide-react";
import { ApiError } from "@/lib/api-errors";
import {
  generateAutomationPrompt,
  generateAutomationQuestions,
} from "@/lib/server-functions/internal-api";
import { getRuntimeBetterAuthCookieHeader } from "@/lib/better-auth-cookie";
import { normalizeMermaidContent, validateMermaidContent } from "@/lib/automation-mermaid";
import {
  getRunnerTypeForModelProvider,
  type Automation,
  type AutomationConfigVersion,
} from "@/lib/automations-view-model";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import { resolveProviderAutomationTriggerDefinition } from "../../../../../packages/shared/src/providers/automation-trigger-registry.js";
import { AutomationBuilderQuestionsStep } from "@/components/automations/automation-builder-questions-step";
import {
  AutomationEditDiff,
  buildAutomationEditDiffSections,
} from "@/components/automations/automation-edit-diff";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";

type BuilderAnswerValue = string | string[];

type Draft = AutomationContextSnapshot;

const parseDraft = (value: unknown, currentContext: AutomationContextSnapshot): Draft | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true) {
    return null;
  }
  const prompt = typeof record.prompt === "string" ? record.prompt : "";
  const description = typeof record.description === "string" ? record.description : "";
  const mermaidContent = typeof record.mermaid_content === "string" ? record.mermaid_content : "";
  const name = typeof record.name === "string" ? record.name : "";
  const modelClass =
    record.model_class === "auto" ||
    record.model_class === "frontier" ||
    record.model_class === "balanced" ||
    record.model_class === "value"
      ? record.model_class
      : currentContext.model_class;
  const aiModelProvider = record.ai_model_provider === "anthropic" ? "anthropic" : "openai";
  const aiModelName = typeof record.ai_model_name === "string" ? record.ai_model_name : "";
  const networkAccess = record.network_access === "mcp_and_web" ? "mcp_and_web" : "mcp_only";
  if (!prompt || !name || !aiModelName) {
    return null;
  }
  return {
    name,
    description,
    mermaid_content: mermaidContent,
    trigger_type:
      record.trigger_type === "schedule" || record.trigger_type === "event"
        ? record.trigger_type
        : "manual",
    schedule_cron: typeof record.schedule_cron === "string" ? record.schedule_cron : null,
    event_provider: typeof record.event_provider === "string" ? record.event_provider : null,
    event_type: typeof record.event_type === "string" ? record.event_type : null,
    model_class: modelClass,
    ai_model_provider: aiModelProvider,
    ai_model_name: aiModelName,
    network_access: networkAccess,
    prompt,
  };
};

const currentContextFromAutomation = (
  automation: Automation,
  config: AutomationConfigVersion,
): AutomationContextSnapshot => ({
  automation_id: automation.id,
  name: automation.name,
  description: automation.description,
  mermaid_content: automation.mermaid_content ?? "",
  trigger_type: config.trigger_type,
  schedule_cron: config.schedule_cron,
  event_provider: config.provider_trigger?.provider_id ?? config.event_provider,
  event_type: config.provider_trigger?.trigger_key ?? config.event_type,
  model_class: config.model_class,
  ai_model_provider: config.ai_model_provider,
  ai_model_name: config.ai_model_name,
  network_access: config.network_access,
  prompt: config.prompt,
});

const isQuestionAnswered = (
  question: AutomationClarificationQuestion,
  value: BuilderAnswerValue | undefined,
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

const answersToPayload = (
  questions: AutomationClarificationQuestion[],
  answerMap: Record<string, BuilderAnswerValue>,
): AutomationClarificationAnswer[] => {
  try {
    return parseAutomationClarificationAnswersPayload(answerMap, questions);
  } catch {
    return [];
  }
};

export function AutomationAiEditFlow({
  automation,
  config,
  onApplied,
}: {
  automation: Automation;
  config: AutomationConfigVersion;
  onApplied: () => void;
}) {
  const applyDraftMutation = useMutation(
    makeFunctionReference<"mutation">("automations:applyAutomationDraft"),
  );
  const [brief, setBrief] = useState("");
  const [questions, setQuestions] = useState<AutomationClarificationQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, BuilderAnswerValue>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);

  const currentContext = useMemo(
    () => currentContextFromAutomation(automation, config),
    [automation, config],
  );
  const currentQuestion = questions[currentQuestionIndex] ?? null;
  const hasQuestionFlow = questions.length > 0;
  const draftSections = useMemo(
    () => (draft ? buildAutomationEditDiffSections(automation, config, draft) : []),
    [automation, config, draft],
  );
  const hasDraftChanges = draftSections.length > 0;

  const startQuestions = async () => {
    const trimmedBrief = brief.trim();
    if (!trimmedBrief) {
      setError(
        toUserFacingError(new Error("Describe the change you want first."), {
          fallback: "Describe the change you want first.",
        }),
      );
      return;
    }
    setError(null);
    setDraft(null);
    setIsGeneratingQuestions(true);
    try {
      const result = await generateAutomationQuestions({
        workspace_id: automation.workspace_id,
        user_description: trimmedBrief,
        automation_context: currentContext,
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      const record =
        result && typeof result === "object" && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : null;
      const nextQuestions = parseAutomationClarificationQuestionsPayload(record?.questions ?? []);
      setQuestions(nextQuestions);
      setAnswers({});
      setCurrentQuestionIndex(0);
      if (nextQuestions.length === 0) {
        setIsGeneratingQuestions(false);
        await generateDraft(trimmedBrief, []);
      }
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "Failed to generate edit questions." }));
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  const generateDraft = async (
    trimmedBrief: string,
    nextQuestions: AutomationClarificationQuestion[] = questions,
    nextAnswers: Record<string, BuilderAnswerValue> = answers,
  ) => {
    setError(null);
    setIsGeneratingDraft(true);
    try {
      const result = await generateAutomationPrompt({
        workspace_id: automation.workspace_id,
        user_description: trimmedBrief,
        generation_mode: "edit",
        automation_context: currentContext,
        clarification_questions: nextQuestions,
        clarification_answers: answersToPayload(nextQuestions, nextAnswers),
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      const parsed = parseDraft(result, currentContext);
      if (!parsed) {
        throw new Error("Edit draft generation returned invalid data.");
      }
      setDraft(parsed);
    } catch (caught) {
      setError(
        toUserFacingError(caught, {
          fallback:
            caught instanceof ApiError && caught.status === 402
              ? "AI credit limit reached."
              : "Failed to generate the edit draft.",
        }),
      );
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const applyDraft = async () => {
    if (!draft) {
      return;
    }
    setError(null);
    setIsApplying(true);
    try {
      const normalizedMermaid = normalizeMermaidContent(draft.mermaid_content);
      const mermaidError = await validateMermaidContent(normalizedMermaid);
      if (mermaidError) {
        throw new Error(mermaidError);
      }
      const resolvedTrigger =
        draft.trigger_type === "event" && draft.event_provider && draft.event_type
          ? resolveProviderAutomationTriggerDefinition(draft.event_provider, draft.event_type)
          : null;
      const preservedProviderTrigger =
        draft.trigger_type === "event" &&
        config.provider_trigger &&
        config.provider_trigger.provider_id === draft.event_provider &&
        config.provider_trigger.trigger_key === draft.event_type
          ? config.provider_trigger
          : null;
      await applyDraftMutation({
        automation_id: automation.id,
        name: draft.name,
        description: draft.description,
        mermaid_content: normalizedMermaid,
        trigger_type: draft.trigger_type,
        ...(draft.trigger_type === "schedule" && draft.schedule_cron
          ? { schedule_cron: draft.schedule_cron }
          : {}),
        ...(draft.trigger_type === "event"
          ? preservedProviderTrigger
            ? {
                provider_trigger: preservedProviderTrigger,
              }
            : resolvedTrigger
              ? {
                  provider_trigger: {
                    ...resolvedTrigger.buildDefaultTrigger(),
                    provider_id: draft.event_provider ?? "",
                    trigger_key: resolvedTrigger.key,
                  },
                }
              : {
                  event_provider: draft.event_provider ?? "",
                  event_type: draft.event_type ?? "",
                }
          : {}),
        runner_type: getRunnerTypeForModelProvider(draft.ai_model_provider),
        model_class: draft.model_class,
        ai_model_provider: draft.ai_model_provider,
        ai_model_name: draft.ai_model_name,
        prompt: draft.prompt,
        network_access: draft.network_access,
        change_summary: `AI edit: ${brief.trim().slice(0, 200)}`,
      });
      setBrief("");
      setQuestions([]);
      setAnswers({});
      setCurrentQuestionIndex(0);
      setDraft(null);
      onApplied();
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "Failed to apply the AI edit." }));
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Card className="border-primary/20 bg-linear-to-br from-primary/6 via-background to-background">
      <CardHeader>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-primary">
          <SparklesIcon className="size-4" />
          Edit with AI
        </div>
        <CardTitle>Describe the change</CardTitle>
        <CardDescription>
          Keppo uses the current automation as context, asks only the missing questions, then shows
          a reviewed diff before anything is saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <UserFacingErrorView error={error} variant="compact" /> : null}

        {!draft ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="automation-ai-edit-brief">Requested change</Label>
              <Textarea
                id="automation-ai-edit-brief"
                value={brief}
                onChange={(event) => setBrief(event.currentTarget.value)}
                disabled={hasQuestionFlow}
                placeholder="Example: Change this automation so it runs every weekday at 9 AM and sends the summary to Slack instead of email."
                className="min-h-24"
              />
              {hasQuestionFlow ? (
                <p className="text-xs text-muted-foreground">
                  Questions below were generated from the current brief. Use Edit request to update
                  the brief and regenerate them.
                </p>
              ) : null}
            </div>

            {questions.length > 0 && currentQuestion ? (
              <AutomationBuilderQuestionsStep
                question={currentQuestion}
                questionIndex={currentQuestionIndex}
                questionCount={questions.length}
                currentValue={answers[currentQuestion.id]}
                inlineMessage={null}
                inlineMessageTone="muted"
                onAnswerChange={(value) =>
                  setAnswers((current) => ({
                    ...current,
                    [currentQuestion.id]: value,
                  }))
                }
                onBack={() => {
                  if (currentQuestionIndex === 0) {
                    setQuestions([]);
                    return;
                  }
                  setCurrentQuestionIndex((current) => Math.max(0, current - 1));
                }}
                onContinue={() => {
                  if (!isQuestionAnswered(currentQuestion, answers[currentQuestion.id])) {
                    setError(
                      toUserFacingError(
                        new Error("Answer this required question before continuing."),
                        {
                          fallback: "Answer this required question before continuing.",
                        },
                      ),
                    );
                    return;
                  }
                  setError(null);
                  if (currentQuestionIndex < questions.length - 1) {
                    setCurrentQuestionIndex((current) => current + 1);
                    return;
                  }
                  void generateDraft(brief.trim());
                }}
                onJumpToQuestion={(index) => setCurrentQuestionIndex(index)}
                questionStates={questions.map((question) => ({
                  id: question.id,
                  answered: isQuestionAnswered(question, answers[question.id]),
                  active: question.id === currentQuestion.id,
                }))}
              />
            ) : null}

            {!questions.length ? (
              <Alert>
                <AlertTitle>Current automation stays in context</AlertTitle>
                <AlertDescription>
                  Name, trigger, prompt, runtime settings, and diagram are all available to the AI
                  edit pass. Unchanged fields should stay as-is.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => void startQuestions()}
                disabled={isGeneratingQuestions || isGeneratingDraft}
              >
                {isGeneratingQuestions
                  ? "Generating questions..."
                  : isGeneratingDraft
                    ? "Generating draft..."
                    : questions.length > 0
                      ? "Regenerate questions"
                      : "Continue"}
              </Button>
              {questions.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void generateDraft(brief.trim())}
                  disabled={isGeneratingDraft}
                >
                  {isGeneratingDraft ? "Generating draft..." : "Skip to draft"}
                </Button>
              ) : null}
              {hasQuestionFlow ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setQuestions([]);
                    setAnswers({});
                    setCurrentQuestionIndex(0);
                    setError(null);
                  }}
                >
                  Edit request
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <AutomationEditDiff automation={automation} config={config} draft={draft} />
            {!hasDraftChanges ? (
              <Alert>
                <AlertTitle>No config changes to apply</AlertTitle>
                <AlertDescription>
                  This draft matches the current automation, so applying it would only create an
                  empty version entry.
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => void applyDraft()}
                disabled={isApplying || !hasDraftChanges}
              >
                {isApplying ? "Applying..." : "Apply draft"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                Back
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
