import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useNavigate } from "@tanstack/react-router";
import {
  parseAutomationClarificationAnswersPayload,
  parseAutomationClarificationQuestionsPayload,
  summarizeAutomationClarifications,
  type AutomationClarificationAnswer,
  type AutomationClarificationQuestion,
} from "@keppo/shared/ai_generation";
import type { CanonicalProviderId } from "@keppo/shared/provider-ids";
import { parseProviderId } from "@keppo/shared/providers/boundaries/error-boundary";
import { isJsonRecord, parseJsonValue } from "@keppo/shared/providers/boundaries/json";
import { resolveProviderAutomationTriggerDefinition } from "../../../../../packages/shared/src/providers/automation-trigger-registry.js";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ExternalLinkIcon,
  Loader2Icon,
  OrbitIcon,
  RotateCcwIcon,
  SparklesIcon,
  UnplugIcon,
} from "lucide-react";
import { ApiError } from "@/lib/api-errors";
import { normalizeMermaidContent, validateMermaidContent } from "@/lib/automation-mermaid";
import { MermaidDiagram } from "@/components/automations/automation-description-content";
import { AutomationBuilderQuestionsStep } from "@/components/automations/automation-builder-questions-step";
import { useIntegrations } from "@/hooks/use-integrations";
import { useRouteParams } from "@/hooks/use-route-params";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import {
  generateAutomationPrompt,
  generateAutomationQuestions,
} from "@/lib/server-functions/internal-api";
import { getRuntimeBetterAuthCookieHeader } from "@/lib/better-auth-cookie";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { humanizeCron } from "@/lib/cron-humanizer";
import {
  formatAiCreditAmount,
  getAutomationPathSegment,
  getAutomationModelClassMeta,
  getNetworkAccessMeta,
} from "@/lib/automations-view-model";
import { getProviderMeta } from "@/components/integrations/provider-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";

type AutomationPromptBoxProps = {
  workspaceId: string;
  onCreated?: (automation: { id: string; slug: string } | null) => void;
  variant?: "hero" | "compact";
  collapseByDefault?: boolean;
};

type TriggerType = "schedule" | "event" | "manual";
type BuilderStep = "brief" | "questions" | "draft" | "providers" | "settings";
type Confidence = "required" | "recommended";
type AiModelProvider = "openai" | "anthropic";
type NetworkAccessMode = "mcp_only" | "mcp_and_web";
type GenerationPhase = "questions" | "draft" | null;
type BuilderAnswerValue = string | string[];
type StatusTone = "muted" | "warning" | "error";

type ProviderRecommendation = {
  provider: string;
  reason: string;
  confidence: Confidence;
};

type GenerationBilling = {
  stage: "questions" | "draft";
  charged_credits: number;
  charged_budget_usd?: number;
  remaining_credits?: number;
  summary: string;
};

type GeneratedConfig = {
  name: string;
  prompt: string;
  description: string;
  mermaid_content: string;
  trigger_type: TriggerType;
  schedule_cron?: string;
  event_provider?: string;
  event_type?: string;
  provider_recommendations: ProviderRecommendation[];
  credit_balance: {
    allowance_remaining: number;
    purchased_remaining: number;
    total_available: number;
    bundled_runtime_enabled: boolean;
  };
  billing: GenerationBilling | null;
};

type BuilderSettings = {
  model_class: "auto" | "frontier" | "balanced" | "value";
  ai_model_provider: AiModelProvider;
  ai_model_name: string;
  network_access: NetworkAccessMode;
};

type CreatedAutomation = {
  id: string;
  slug: string;
};

type PersistedDraft = {
  version: 2;
  inputValue: string;
  step: BuilderStep;
  questions: AutomationClarificationQuestion[];
  answers: AutomationClarificationAnswer[];
  currentQuestionIndex: number;
  questionBilling: GenerationBilling | null;
  config: GeneratedConfig | null;
  settings: BuilderSettings;
  skippedProviders: string[];
};

const EXAMPLE_PROMPTS = [
  "Every morning at 9AM, summarize new GitHub issues and email me the blockers.",
  "When Stripe refunds are requested, route them to Slack with the customer context.",
  "Check stale pull requests every afternoon and remind the right reviewers.",
  "Watch for new GitHub bugs and open a matching Notion page with triage notes.",
  "Each Friday, assemble a short approvals digest for the operations team.",
];

const AI_MODELS: Record<AiModelProvider, string[]> = {
  openai: ["gpt-5.4", "gpt-5.2"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4"],
};

const MODEL_CLASS_COMPATIBILITY = {
  auto: { provider: "openai", model: "gpt-5.4", runner: "chatgpt_codex" },
  frontier: { provider: "openai", model: "gpt-5.4", runner: "chatgpt_codex" },
  balanced: { provider: "openai", model: "gpt-5.4", runner: "chatgpt_codex" },
  value: { provider: "openai", model: "gpt-5.2", runner: "chatgpt_codex" },
} as const;

const DEFAULT_SETTINGS: BuilderSettings = {
  model_class: "auto",
  ai_model_provider: "openai",
  ai_model_name: AI_MODELS.openai[0] ?? "gpt-5.4",
  network_access: "mcp_only",
};

const PERSISTED_DRAFT_VERSION = 2 as const;
const STEP_ORDER: BuilderStep[] = ["brief", "questions", "draft", "providers", "settings"];
const STEP_LABEL_SET = new Set<string>(STEP_ORDER);
const STEP_LABELS: Record<BuilderStep, string> = {
  brief: "brief",
  questions: "questions",
  draft: "draft",
  providers: "providers",
  settings: "settings",
};

const transitionProps = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.18 },
} as const;

const storageKey = (workspaceId: string) => `keppo:automation-builder:${workspaceId}`;

const isBuilderStep = (value: unknown): value is BuilderStep => {
  return typeof value === "string" && STEP_LABEL_SET.has(value);
};

export const normalizePersistedBuilderStep = (value: unknown): BuilderStep => {
  if (value === "ready") {
    return "settings";
  }
  return isBuilderStep(value) ? value : "brief";
};

const resolveShortcutModifier = (): "Cmd" | "Ctrl" | null => {
  if (typeof navigator === "undefined") {
    return null;
  }
  const platform = [navigator.userAgent, navigator.platform]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return platform.includes("mac") ? "Cmd" : "Ctrl";
};

const parseGenerationBilling = (value: unknown): GenerationBilling | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const stage =
    record.stage === "draft" ? "draft" : record.stage === "questions" ? "questions" : null;
  const chargedCredits = typeof record.charged_credits === "number" ? record.charged_credits : null;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!stage || chargedCredits === null || summary.length === 0) {
    return null;
  }
  return {
    stage,
    charged_credits: chargedCredits,
    ...(typeof record.charged_budget_usd === "number"
      ? { charged_budget_usd: record.charged_budget_usd }
      : {}),
    ...(typeof record.remaining_credits === "number"
      ? { remaining_credits: record.remaining_credits }
      : {}),
    summary,
  };
};

export const parseGeneratedConfig = (value: unknown): GeneratedConfig | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== undefined && record.ok !== true) {
    return null;
  }
  const creditBalance =
    record.credit_balance && typeof record.credit_balance === "object"
      ? (record.credit_balance as Record<string, unknown>)
      : null;
  if (!creditBalance) {
    return null;
  }
  const recommendations = Array.isArray(record.provider_recommendations)
    ? record.provider_recommendations
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const row = entry as Record<string, unknown>;
          const provider =
            typeof row.provider === "string" ? row.provider.trim().toLowerCase() : "";
          const reason = typeof row.reason === "string" ? row.reason.trim() : "";
          const confidence =
            row.confidence === "required" || row.confidence === "recommended"
              ? row.confidence
              : "recommended";
          if (!provider || !reason) {
            return null;
          }
          return { provider, reason, confidence };
        })
        .filter((entry): entry is ProviderRecommendation => entry !== null)
    : [];
  return {
    name: typeof record.name === "string" ? record.name : "",
    prompt: typeof record.prompt === "string" ? record.prompt : "",
    description: typeof record.description === "string" ? record.description : "",
    mermaid_content: typeof record.mermaid_content === "string" ? record.mermaid_content : "",
    trigger_type:
      record.trigger_type === "schedule" || record.trigger_type === "event"
        ? record.trigger_type
        : "manual",
    ...(typeof record.schedule_cron === "string" ? { schedule_cron: record.schedule_cron } : {}),
    ...(typeof record.event_provider === "string" ? { event_provider: record.event_provider } : {}),
    ...(typeof record.event_type === "string" ? { event_type: record.event_type } : {}),
    provider_recommendations: recommendations,
    credit_balance: {
      allowance_remaining:
        typeof creditBalance.allowance_remaining === "number"
          ? creditBalance.allowance_remaining
          : 0,
      purchased_remaining:
        typeof creditBalance.purchased_remaining === "number"
          ? creditBalance.purchased_remaining
          : 0,
      total_available:
        typeof creditBalance.total_available === "number" ? creditBalance.total_available : 0,
      bundled_runtime_enabled: creditBalance.bundled_runtime_enabled === true,
    },
    billing: parseGenerationBilling(record.billing),
  };
};

const parseGeneratedQuestions = (
  value: unknown,
): { questions: AutomationClarificationQuestion[]; billing: GenerationBilling | null } | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true) {
    return null;
  }
  try {
    return {
      questions: parseAutomationClarificationQuestionsPayload(record.questions ?? []),
      billing: parseGenerationBilling(record.billing),
    };
  } catch {
    return null;
  }
};

const parseCreateResult = (
  value: unknown,
): { automation: CreatedAutomation; warning: string | null } | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const automationValue = record.automation;
  if (!automationValue || typeof automationValue !== "object") {
    return null;
  }
  const automationRecord = automationValue as Record<string, unknown>;
  const id = typeof automationRecord.id === "string" ? automationRecord.id : "";
  const slug = typeof automationRecord.slug === "string" ? automationRecord.slug : "";
  if (!id || !slug) {
    return null;
  }
  return {
    automation: { id, slug },
    warning: typeof record.warning === "string" ? record.warning : null,
  };
};

const getStatusToneClasses = (tone: StatusTone): string => {
  if (tone === "error") {
    return "text-destructive";
  }
  if (tone === "warning") {
    return "text-amber-700 dark:text-amber-400";
  }
  return "text-muted-foreground";
};

const findFirstIncompleteRequiredQuestionIndex = (
  questions: AutomationClarificationQuestion[],
  answers: Record<string, BuilderAnswerValue>,
): number => {
  return questions.findIndex((question) => {
    return question.required && !isQuestionAnswered(question, answers[question.id]);
  });
};

const toBuilderGenerationError = (caught: unknown): UserFacingError => {
  if (caught instanceof ApiError) {
    const payload =
      caught.payload && typeof caught.payload === "object" && !Array.isArray(caught.payload)
        ? (caught.payload as Record<string, unknown>)
        : null;
    const status = typeof payload?.status === "string" ? payload.status : null;
    const retryAfterMs =
      typeof payload?.retry_after_ms === "number" && Number.isFinite(payload.retry_after_ms)
        ? payload.retry_after_ms
        : null;

    if (caught.status === 402 || status === "ai_credit_limit_reached") {
      return toUserFacingError(caught, {
        fallback: "You have no automation generation credits left right now.",
      });
    }

    if (status === "credit_deduction_failed") {
      return toUserFacingError(
        new Error("Keppo could not reserve an AI generation credit for this draft."),
        {
          fallback: "Keppo could not reserve an AI generation credit for this draft.",
        },
      );
    }

    if (status === "generation_failed") {
      return toUserFacingError(new Error("Keppo could not generate this automation draft."), {
        fallback: "Keppo could not generate this automation draft.",
      });
    }

    if (caught.status === 429 || status === "rate_limited") {
      const retryAfterSeconds =
        retryAfterMs === null ? null : Math.max(1, Math.ceil(retryAfterMs / 1000));
      const retryCopy =
        retryAfterSeconds === null
          ? "Wait a moment, then try again."
          : `Wait about ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}, then try again.`;
      return toUserFacingError(new Error(`You're generating questions too quickly. ${retryCopy}`), {
        fallback: `You're generating questions too quickly. ${retryCopy}`,
      });
    }
  }

  return toUserFacingError(caught, { fallback: "Prompt generation failed." });
};

const answersToMap = (
  answers: AutomationClarificationAnswer[],
): Record<string, BuilderAnswerValue> => {
  return Object.fromEntries(answers.map((answer) => [answer.question_id, answer.value]));
};

const answerMapToEntries = (
  answerMap: Record<string, BuilderAnswerValue>,
  questions: AutomationClarificationQuestion[],
): AutomationClarificationAnswer[] => {
  try {
    return parseAutomationClarificationAnswersPayload(answerMap, questions);
  } catch {
    return [];
  }
};

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

const getTriggerSummary = (config: GeneratedConfig): string => {
  if (config.trigger_type === "schedule" && config.schedule_cron) {
    return humanizeCron(config.schedule_cron);
  }
  if (config.trigger_type === "event" && config.event_provider && config.event_type) {
    const trigger = resolveProviderAutomationTriggerDefinition(
      config.event_provider,
      config.event_type,
    );
    if (trigger) {
      return `On ${getProviderMeta(config.event_provider).label} ${trigger.display.label.toLowerCase()}`;
    }
    return `On ${config.event_provider} ${config.event_type}`;
  }
  return "Manual run";
};

const getSlugPreview = (value: string): string => {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "automation"
  );
};

const loadPersistedDraft = (workspaceId: string): PersistedDraft | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(storageKey(workspaceId));
    if (!raw) {
      return null;
    }
    const parsed = parseJsonValue(raw);
    if (!isJsonRecord(parsed) || parsed.version !== PERSISTED_DRAFT_VERSION) {
      return null;
    }
    const questions = parseAutomationClarificationQuestionsPayload(parsed.questions ?? []);
    const answers = parseAutomationClarificationAnswersPayload(parsed.answers ?? [], questions);
    const settings = isJsonRecord(parsed.settings) ? parsed.settings : DEFAULT_SETTINGS;
    const parsedStep = normalizePersistedBuilderStep(parsed.step);
    const config = parseGeneratedConfig(parsed.config);
    const safeStep =
      config || parsedStep === "questions" || parsedStep === "brief"
        ? parsedStep
        : questions.length > 0
          ? "questions"
          : "brief";

    return {
      version: PERSISTED_DRAFT_VERSION,
      inputValue: typeof parsed.inputValue === "string" ? parsed.inputValue : "",
      step: safeStep,
      questions,
      answers,
      currentQuestionIndex:
        typeof parsed.currentQuestionIndex === "number" &&
        Number.isFinite(parsed.currentQuestionIndex)
          ? Math.min(Math.max(parsed.currentQuestionIndex, 0), Math.max(questions.length - 1, 0))
          : 0,
      questionBilling: parseGenerationBilling(parsed.questionBilling),
      config,
      settings: {
        model_class:
          settings.model_class === "frontier" ||
          settings.model_class === "balanced" ||
          settings.model_class === "value"
            ? settings.model_class
            : DEFAULT_SETTINGS.model_class,
        ai_model_provider:
          settings.ai_model_provider === "anthropic"
            ? "anthropic"
            : DEFAULT_SETTINGS.ai_model_provider,
        ai_model_name:
          typeof settings.ai_model_name === "string" && settings.ai_model_name.length > 0
            ? settings.ai_model_name
            : DEFAULT_SETTINGS.ai_model_name,
        network_access: settings.network_access === "mcp_and_web" ? "mcp_and_web" : "mcp_only",
      },
      skippedProviders: Array.isArray(parsed.skippedProviders)
        ? parsed.skippedProviders.filter((value): value is string => typeof value === "string")
        : [],
    };
  } catch {
    return null;
  }
};

const persistDraft = (workspaceId: string, draft: PersistedDraft | null) => {
  if (typeof window === "undefined") {
    return;
  }
  if (!draft) {
    window.sessionStorage.removeItem(storageKey(workspaceId));
    return;
  }
  window.sessionStorage.setItem(storageKey(workspaceId), JSON.stringify(draft));
};

const stepIndex = (step: BuilderStep): number => STEP_ORDER.indexOf(step);

const toCanonicalProvider = (provider: string): CanonicalProviderId | null => {
  try {
    return parseProviderId(provider);
  } catch {
    return null;
  }
};

function StepBadge({
  label,
  active,
  complete,
}: {
  label: string;
  active: boolean;
  complete: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active && "border-primary bg-primary/10 text-primary",
        complete && "border-primary/30 bg-primary/5 text-primary",
        !active && !complete && "text-muted-foreground",
      )}
    >
      {label}
    </div>
  );
}

function ProviderRecommendationCard({
  provider,
  reason,
  confidence,
  connected,
  enabled,
  skipped,
  busy,
  onConnect,
  onOpen,
  onToggleSkip,
}: {
  provider: string;
  reason: string;
  confidence: Confidence;
  connected: boolean;
  enabled: boolean;
  skipped: boolean;
  busy: boolean;
  onConnect: () => void;
  onOpen: () => void;
  onToggleSkip: () => void;
}) {
  const meta = getProviderMeta(provider);
  const Icon = meta.icon;
  const requirementLabel = confidence === "required" ? "Live data" : "Optional context";
  const providerState = connected
    ? enabled
      ? "Connected and ready for runs."
      : "Connected, but this workspace still needs the provider enabled."
    : skipped
      ? confidence === "required"
        ? `Finish setup now, then connect ${meta.label} before this automation needs live provider context.`
        : "Skipped for now. You can connect later if you want richer context."
      : confidence === "required"
        ? `Connect ${meta.label} now for live provider context, or finish setup without it and add it later.`
        : `Connect ${meta.label} now for richer context, or keep moving and wire it up later.`;
  return (
    <div
      className="rounded-2xl border border-primary/15 bg-card p-5 shadow-xs"
      data-testid={`automation-builder-provider-${provider}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-2xl",
              meta.color,
            )}
          >
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold">{meta.label}</p>
              <Badge
                variant="outline"
                className="border-primary/20 bg-background/80 text-foreground"
              >
                {requirementLabel}
              </Badge>
              {connected ? (
                <Badge variant={enabled ? "outline" : "secondary"}>
                  {enabled ? "Connected in workspace" : "Connected but disabled"}
                </Badge>
              ) : null}
              {skipped ? <Badge variant="outline">Skipped for now</Badge> : null}
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">{reason}</p>
            <p className="mt-2 text-sm text-muted-foreground">{providerState}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {connected ? (
            <Button type="button" variant="outline" size="sm" onClick={onOpen}>
              <ExternalLinkIcon className="mr-1 size-4" />
              Open
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={onConnect} disabled={busy}>
              {busy ? (
                <Loader2Icon className="mr-1 size-4 animate-spin" />
              ) : (
                <OrbitIcon className="mr-1 size-4" />
              )}
              Connect
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onToggleSkip}>
            {skipped ? (
              <RotateCcwIcon className="mr-1 size-4" />
            ) : (
              <UnplugIcon className="mr-1 size-4" />
            )}
            {skipped ? "Bring it back" : "Decide later"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AutomationPromptBox({
  workspaceId,
  onCreated,
  variant = "compact",
  collapseByDefault = false,
}: AutomationPromptBoxProps) {
  const runtime = useDashboardRuntime();
  const navigate = useNavigate();
  const { buildOrgPath, buildWorkspacePath } = useRouteParams();
  const reduceMotion = useReducedMotion();
  const { integrations, providerCatalog, connectProvider } = useIntegrations();
  const createAutomationMutation = useMutation(
    makeFunctionReference<"mutation">("automations:createAutomation"),
  );
  const initialDraft = useMemo(() => loadPersistedDraft(workspaceId), [workspaceId]);
  const [inputValue, setInputValue] = useState(initialDraft?.inputValue ?? "");
  const [step, setStep] = useState<BuilderStep>(
    initialDraft?.step ?? ((initialDraft?.questions.length ?? 0) > 0 ? "questions" : "brief"),
  );
  const [questions, setQuestions] = useState<AutomationClarificationQuestion[]>(
    initialDraft?.questions ?? [],
  );
  const [answers, setAnswers] = useState<Record<string, BuilderAnswerValue>>(
    answersToMap(initialDraft?.answers ?? []),
  );
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(
    initialDraft?.currentQuestionIndex ?? 0,
  );
  const [questionBilling, setQuestionBilling] = useState<GenerationBilling | null>(
    initialDraft?.questionBilling ?? null,
  );
  const [config, setConfig] = useState<GeneratedConfig | null>(initialDraft?.config ?? null);
  const [settings, setSettings] = useState<BuilderSettings>(
    initialDraft?.settings ?? DEFAULT_SETTINGS,
  );
  const [skippedProviders, setSkippedProviders] = useState<string[]>(
    initialDraft?.skippedProviders ?? [],
  );
  const [exampleIndex, setExampleIndex] = useState(0);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isCompactExpanded, setIsCompactExpanded] = useState(
    variant === "hero" || !collapseByDefault,
  );
  const [generationPhase, setGenerationPhase] = useState<GenerationPhase>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<StatusTone>("muted");
  const [error, setError] = useState<UserFacingError | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [shortcutModifier, setShortcutModifier] = useState<"Cmd" | "Ctrl" | null>(null);
  const [debouncedInputValue, setDebouncedInputValue] = useState(initialDraft?.inputValue ?? "");
  const successTimeoutRef = useRef<number | null>(null);
  const generationRequestIdRef = useRef(0);

  const answerEntries = useMemo(() => answerMapToEntries(answers, questions), [answers, questions]);
  const answeredClarifications = useMemo(
    () => summarizeAutomationClarifications(questions, answerEntries),
    [answerEntries, questions],
  );
  const usesBundledQuestionBilling =
    questionBilling?.remaining_credits !== undefined ||
    config?.credit_balance.bundled_runtime_enabled === true;
  const currentQuestion = questions[currentQuestionIndex] ?? null;
  const questionStates = useMemo(
    () =>
      questions.map((question, index) => ({
        id: question.id,
        answered: isQuestionAnswered(question, answers[question.id]),
        active: index === currentQuestionIndex,
      })),
    [answers, currentQuestionIndex, questions],
  );
  const hasBuilderState =
    inputValue.trim().length > 0 ||
    questions.length > 0 ||
    config !== null ||
    generationPhase !== null;
  const showStepProgress =
    questions.length > 0 || config !== null || generationPhase !== null || isSuccess;

  useEffect(() => {
    setShortcutModifier(resolveShortcutModifier());
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => {
        setDebouncedInputValue(inputValue);
      },
      inputValue.trim().length === 0 ? 0 : 350,
    );
    return () => window.clearTimeout(timeout);
  }, [inputValue]);

  useEffect(() => {
    if (
      debouncedInputValue.trim().length === 0 &&
      questions.length === 0 &&
      !config &&
      skippedProviders.length === 0
    ) {
      persistDraft(workspaceId, null);
      return;
    }
    persistDraft(workspaceId, {
      version: PERSISTED_DRAFT_VERSION,
      inputValue: debouncedInputValue,
      step,
      questions,
      answers: answerEntries,
      currentQuestionIndex,
      questionBilling,
      config,
      settings,
      skippedProviders,
    });
  }, [
    answerEntries,
    config,
    currentQuestionIndex,
    debouncedInputValue,
    questionBilling,
    questions,
    settings,
    skippedProviders,
    step,
    workspaceId,
  ]);

  useEffect(() => {
    if (questions.length === 0 && step === "questions" && generationPhase === null) {
      setStep("brief");
    }
  }, [generationPhase, questions.length, step]);

  useEffect(() => {
    if (config || questions.length > 0 || generationPhase || isInputFocused || variant === "hero") {
      return;
    }
    const timer = window.setInterval(() => {
      setExampleIndex((current) => (current + 1) % EXAMPLE_PROMPTS.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [config, generationPhase, isInputFocused, questions.length, variant]);

  useEffect(() => {
    if (variant === "hero" || !collapseByDefault) {
      setIsCompactExpanded(true);
      return;
    }
    if (hasBuilderState || isInputFocused) {
      setIsCompactExpanded(true);
    }
  }, [collapseByDefault, hasBuilderState, isInputFocused, variant]);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current !== null) {
        window.clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const providerStates = useMemo(() => {
    const integrationByProvider = new Map(
      integrations.map((integration) => [integration.provider, integration]),
    );
    const workspaceEnabled = new Set(
      providerCatalog
        .map((entry) => entry.provider)
        .filter((provider) => integrationByProvider.get(provider)?.connected === true),
    );
    return {
      integrationByProvider,
      workspaceEnabled,
    };
  }, [integrations, providerCatalog]);

  const recommendedProviders = useMemo(() => {
    if (!config) {
      return [];
    }
    const supportedProviders = new Set(providerCatalog.map((entry) => entry.provider));
    return config.provider_recommendations.filter((entry) =>
      supportedProviders.has(entry.provider as CanonicalProviderId),
    );
  }, [config, providerCatalog]);

  const hasActiveProviderNeeds = recommendedProviders.some(
    (entry) => !skippedProviders.includes(entry.provider),
  );
  const hasConnectedRecommendedProvider = recommendedProviders.some(
    (entry) =>
      providerStates.integrationByProvider.get(entry.provider as CanonicalProviderId)?.connected ===
      true,
  );

  const resetBuilder = useCallback(() => {
    generationRequestIdRef.current += 1;
    setInputValue("");
    setStep("brief");
    setQuestions([]);
    setAnswers({});
    setCurrentQuestionIndex(0);
    setQuestionBilling(null);
    setConfig(null);
    setSkippedProviders([]);
    setGenerationPhase(null);
    setIsGenerating(false);
    setStatusMessage(null);
    setStatusTone("muted");
    setError(null);
    setIsCreating(false);
    setIsSuccess(false);
    persistDraft(workspaceId, null);
  }, [workspaceId]);

  const runDraftGeneration = useCallback(
    async (
      promptBrief: string,
      clarificationQuestions: AutomationClarificationQuestion[],
      clarificationAnswers: Record<string, BuilderAnswerValue>,
      requestId: number,
    ) => {
      setGenerationPhase("draft");
      try {
        const response = await generateAutomationPrompt({
          workspace_id: workspaceId,
          user_description: promptBrief,
          clarification_questions: clarificationQuestions,
          clarification_answers: answerMapToEntries(clarificationAnswers, clarificationQuestions),
          betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
        });
        const parsed = parseGeneratedConfig(response);
        if (!parsed) {
          throw new Error("Prompt generation returned an invalid payload.");
        }
        if (generationRequestIdRef.current !== requestId) {
          return;
        }
        setConfig(parsed);
        setStep("draft");
        setError(null);
        setStatusMessage(null);
        setStatusTone("muted");
      } catch (caught) {
        if (generationRequestIdRef.current !== requestId) {
          return;
        }
        setStatusMessage(null);
        setStatusTone("muted");
        setError(toBuilderGenerationError(caught));
      } finally {
        if (generationRequestIdRef.current === requestId) {
          setGenerationPhase(null);
        }
      }
    },
    [runtime.authClient, workspaceId],
  );

  const handleBriefSubmit = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setError(null);
      setStatusMessage("Describe the automation you want before continuing.");
      setStatusTone("error");
      return;
    }
    setError(null);
    setStatusMessage(null);
    setStatusTone("muted");
    setIsSuccess(false);
    setConfig(null);
    setQuestions([]);
    setAnswers({});
    setCurrentQuestionIndex(0);
    setQuestionBilling(null);
    setSkippedProviders([]);
    setGenerationPhase("questions");
    const requestId = ++generationRequestIdRef.current;
    try {
      const response = await generateAutomationQuestions({
        workspace_id: workspaceId,
        user_description: trimmed,
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      const parsed = parseGeneratedQuestions(response);
      if (!parsed) {
        throw new Error("Question generation returned an invalid payload.");
      }
      if (generationRequestIdRef.current !== requestId) {
        return;
      }
      setQuestions(parsed.questions);
      setAnswers({});
      setCurrentQuestionIndex(0);
      setQuestionBilling(parsed.billing);
      setError(null);
      if (parsed.questions.length === 0) {
        setStatusMessage("No clarifying questions were needed. Drafting the automation now.");
        setStatusTone("warning");
        await runDraftGeneration(trimmed, [], {}, requestId);
        return;
      }
      setGenerationPhase(null);
      setStep("questions");
    } catch (caught) {
      if (generationRequestIdRef.current !== requestId) {
        return;
      }
      setGenerationPhase(null);
      setError(toBuilderGenerationError(caught));
    }
  }, [inputValue, runDraftGeneration, runtime.authClient, workspaceId]);

  const handleQuestionContinue = useCallback(() => {
    if (!currentQuestion) {
      return;
    }
    if (!isQuestionAnswered(currentQuestion, answers[currentQuestion.id])) {
      setStatusMessage("Answer this required question before continuing.");
      setStatusTone("error");
      return;
    }
    if (currentQuestionIndex < questions.length - 1) {
      setStatusMessage(null);
      setStatusTone("muted");
      setCurrentQuestionIndex((current) => Math.min(current + 1, questions.length - 1));
      return;
    }
    const firstIncompleteRequiredQuestionIndex = findFirstIncompleteRequiredQuestionIndex(
      questions,
      answers,
    );
    if (firstIncompleteRequiredQuestionIndex >= 0) {
      setCurrentQuestionIndex(firstIncompleteRequiredQuestionIndex);
      setStatusMessage("Answer every required question before generating the draft.");
      setStatusTone("error");
      return;
    }
    setStatusMessage(null);
    setStatusTone("muted");
    const requestId = ++generationRequestIdRef.current;
    void runDraftGeneration(inputValue.trim(), questions, answers, requestId);
  }, [answers, currentQuestion, currentQuestionIndex, inputValue, questions, runDraftGeneration]);

  const cancelGeneration = useCallback(() => {
    generationRequestIdRef.current += 1;
    setGenerationPhase(null);
    setIsGenerating(false);
    setStatusMessage("Generation canceled.");
    setStatusTone("muted");
  }, []);

  const handleCreate = useCallback(async () => {
    if (!config) {
      return;
    }
    setError(null);
    setStatusMessage(null);
    setStatusTone("muted");
    setIsCreating(true);
    try {
      const normalizedMermaidContent = normalizeMermaidContent(config.mermaid_content);
      const mermaidError = await validateMermaidContent(normalizedMermaidContent);
      if (mermaidError) {
        setStep("draft");
        setStatusMessage(`Workflow diagram needs a quick fix: ${mermaidError}`);
        setStatusTone("error");
        return;
      }
      const generatedProviderTrigger =
        config.trigger_type === "event" && config.event_provider && config.event_type
          ? resolveProviderAutomationTriggerDefinition(config.event_provider, config.event_type)
          : null;
      const result = await createAutomationMutation({
        workspace_id: workspaceId,
        name: config.name,
        description: config.description,
        mermaid_content: normalizedMermaidContent,
        trigger_type: config.trigger_type,
        ...(config.trigger_type === "schedule" && config.schedule_cron
          ? { schedule_cron: config.schedule_cron }
          : {}),
        ...(config.trigger_type === "event"
          ? generatedProviderTrigger
            ? {
                provider_trigger: {
                  ...generatedProviderTrigger.buildDefaultTrigger(),
                  provider_id: config.event_provider ?? "",
                  trigger_key: generatedProviderTrigger.key,
                },
              }
            : {
                event_provider: config.event_provider ?? "",
                event_type: config.event_type ?? "",
              }
          : {}),
        model_class: settings.model_class,
        runner_type: MODEL_CLASS_COMPATIBILITY[settings.model_class].runner,
        ai_model_provider: MODEL_CLASS_COMPATIBILITY[settings.model_class].provider,
        ai_model_name: MODEL_CLASS_COMPATIBILITY[settings.model_class].model,
        prompt: config.prompt,
        network_access: settings.network_access,
      });
      const parsed = parseCreateResult(result);
      if (!parsed) {
        throw new Error("Automation creation returned an invalid payload.");
      }
      setIsSuccess(true);
      setStatusMessage(parsed.warning);
      setStatusTone(parsed.warning ? "warning" : "muted");
      persistDraft(workspaceId, null);
      successTimeoutRef.current = window.setTimeout(
        () => {
          onCreated?.(parsed.automation);
          void navigate({
            to: buildWorkspacePath(`/automations/${getAutomationPathSegment(parsed.automation)}`),
          });
        },
        reduceMotion ? 120 : 900,
      );
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "Failed to create automation." }));
    } finally {
      setIsCreating(false);
    }
  }, [
    buildWorkspacePath,
    config,
    createAutomationMutation,
    navigate,
    onCreated,
    reduceMotion,
    settings,
    workspaceId,
  ]);

  const handleProviderConnect = useCallback(
    async (provider: string) => {
      const canonicalProvider = toCanonicalProvider(provider);
      if (!canonicalProvider) {
        return;
      }
      setConnectingProvider(provider);
      try {
        await connectProvider(canonicalProvider);
        setSkippedProviders((current) => current.filter((entry) => entry !== provider));
      } finally {
        setConnectingProvider(null);
      }
    },
    [connectProvider],
  );

  const nextReviewStep = useCallback(() => {
    setStep((current) => {
      if (current === "draft") {
        return "providers";
      }
      if (current === "providers") {
        return "settings";
      }
      return current;
    });
  }, []);

  const previousReviewStep = useCallback(() => {
    if (step === "settings") {
      setStep("providers");
      return;
    }
    if (step === "providers") {
      setStep("draft");
      return;
    }
    if (step === "draft") {
      setStep(questions.length > 0 ? "questions" : "brief");
    }
  }, [questions.length, step]);

  const canContinueFromProviders =
    !hasActiveProviderNeeds ||
    recommendedProviders.every((entry) => {
      if (skippedProviders.includes(entry.provider)) {
        return true;
      }
      return true;
    });

  const showCompactLauncher =
    variant === "compact" &&
    collapseByDefault &&
    !isCompactExpanded &&
    !hasBuilderState &&
    !isSuccess &&
    inputValue.trim().length === 0;

  const shellClassName =
    variant === "hero"
      ? "border-primary/20 bg-linear-to-br from-primary/8 via-card to-secondary/10"
      : "border-dashed border-border/70 bg-background/70";

  return (
    <Card
      className={cn(
        "relative overflow-hidden border shadow-sm",
        variant === "hero" && "gap-4",
        shellClassName,
      )}
      data-testid="automation-builder"
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 bg-linear-to-b to-transparent",
          variant === "hero" ? "h-28 from-primary/8" : "h-16 from-primary/4",
        )}
      />
      <CardHeader
        className={cn(
          "relative gap-3",
          variant === "hero" && "gap-2 pb-1",
          variant === "compact" && "pb-3",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <div
              className={cn(
                "mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em]",
                variant === "hero" ? "text-primary" : "text-muted-foreground",
              )}
            >
              <SparklesIcon className="size-4" />
              {variant === "hero" ? "Automation builder" : "Quick Draft"}
            </div>
            <CardTitle className={cn("text-balance", variant === "hero" ? "text-3xl" : "text-lg")}>
              {variant === "hero"
                ? "What should your next automation do?"
                : "Describe the next automation"}
            </CardTitle>
            <CardDescription
              className={cn(
                "max-w-2xl text-pretty",
                variant === "hero" && "leading-relaxed",
                variant === "compact" && "text-sm",
              )}
            >
              {variant === "hero"
                ? "Start with a short prompt. Keppo asks only the missing questions, drafts the workflow, then lets you review providers and runtime settings."
                : "Begin with the outcome. Keppo will ask a few short clarifying questions before it drafts the automation for review."}
            </CardDescription>
          </div>
          {hasBuilderState ? (
            <Button type="button" variant="ghost" size="sm" onClick={resetBuilder}>
              <RotateCcwIcon className="mr-1 size-4" />
              Clear builder
            </Button>
          ) : null}
        </div>

        {showStepProgress ? (
          <div className="flex flex-wrap gap-2">
            {STEP_ORDER.map((entry, index) => (
              <StepBadge
                key={entry}
                label={`${index + 1}. ${STEP_LABELS[entry]}`}
                active={step === entry}
                complete={stepIndex(step) > index || isSuccess}
              />
            ))}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className={cn("relative", variant !== "hero" && "pt-0")}>
        <AnimatePresence mode="wait">
          {isSuccess && config ? (
            <motion.div
              key="success"
              {...transitionProps}
              className="rounded-2xl border border-primary/20 bg-primary/5 p-6"
            >
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <motion.div
                  {...(!reduceMotion ? { animate: { scale: [0.92, 1.04, 1] } } : {})}
                  transition={{ duration: 0.45 }}
                  className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground"
                >
                  <CheckCircle2Icon className="size-7" />
                </motion.div>
                <div>
                  <p className="text-lg font-semibold">Automation created</p>
                  <p className="text-sm text-muted-foreground">
                    Routing into <span className="font-medium text-foreground">{config.name}</span>.
                  </p>
                  {statusMessage ? (
                    <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
                      {statusMessage}
                    </p>
                  ) : null}
                </div>
              </div>
            </motion.div>
          ) : generationPhase === "questions" ? (
            <motion.div
              key="generating-questions"
              {...transitionProps}
              className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]"
            >
              <div className="rounded-2xl border bg-background/70 p-5">
                <div className="flex items-center gap-3">
                  <Loader2Icon className="size-5 animate-spin text-primary" />
                  <div>
                    <p className="font-medium">Choosing the shortest useful questionnaire</p>
                    <p className="text-sm text-muted-foreground">
                      Keppo is deciding which details are still missing before it drafts the
                      automation.
                    </p>
                  </div>
                </div>
                <div className="mt-6 space-y-3">
                  <div className="h-4 w-2/5 rounded-full bg-muted" />
                  <div className="h-18 rounded-2xl bg-muted/80" />
                  <div className="h-18 rounded-2xl bg-muted/70" />
                  <div className="h-18 rounded-2xl bg-muted/60" />
                </div>
              </div>
              <div className="rounded-2xl border bg-background/60 p-5">
                <p className="text-sm font-medium">
                  {usesBundledQuestionBilling
                    ? "Credits update automatically"
                    : "This stage is free"}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {usesBundledQuestionBilling
                    ? "In hosted mode, Keppo updates your remaining bundled credits automatically based on the AI work used for questions and drafts."
                    : "Clarifying questions do not deduct a credit. Keppo charges only when it generates the final automation draft."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={cancelGeneration}
                >
                  Cancel
                </Button>
              </div>
            </motion.div>
          ) : generationPhase === "draft" ? (
            <motion.div
              key="generating-draft"
              {...transitionProps}
              className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]"
            >
              <div className="rounded-2xl border bg-background/70 p-5">
                <div className="flex items-center gap-3">
                  <Loader2Icon className="size-5 animate-spin text-primary" />
                  <div>
                    <p className="font-medium">Generating the automation draft</p>
                    <p className="text-sm text-muted-foreground">
                      Keppo is combining your brief and answers into the final workflow draft.
                    </p>
                  </div>
                </div>
                <div className="mt-6 space-y-3">
                  <div className="h-4 w-3/5 rounded-full bg-muted" />
                  <div className="h-20 rounded-2xl bg-muted/80" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="h-24 rounded-2xl bg-muted/70" />
                    <div className="h-24 rounded-2xl bg-muted/60" />
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border bg-background/60 p-5">
                <p className="text-sm font-medium">Clarification summary</p>
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Brief</dt>
                    <dd className="font-medium text-foreground">{inputValue.trim()}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Answers shaping the draft</dt>
                    <dd className="mt-2 space-y-2">
                      {answeredClarifications.length > 0 ? (
                        answeredClarifications.map((entry) => (
                          <div key={entry.question_id} className="rounded-xl border bg-card p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              {entry.label}
                            </p>
                            <p className="mt-1 font-medium">{entry.answer}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-muted-foreground">
                          No extra clarifications were needed.
                        </p>
                      )}
                    </dd>
                  </div>
                </dl>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={cancelGeneration}
                >
                  Cancel
                </Button>
              </div>
            </motion.div>
          ) : !config && step === "brief" ? (
            <motion.div key="brief" {...transitionProps} className="space-y-3">
              {showCompactLauncher ? (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-foreground">
                        Draft another automation quickly
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Start from the outcome. Keppo will ask a few short questions before drafting
                        anything.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsCompactExpanded(true)}
                    >
                      <SparklesIcon className="mr-2 size-4" />
                      Open quick draft
                    </Button>
                  </div>
                </div>
              ) : null}
              <div
                className={cn(
                  "rounded-2xl border bg-background/80 p-4",
                  variant === "compact" && "bg-transparent p-0",
                  showCompactLauncher && "hidden",
                )}
              >
                <Label
                  htmlFor={`automation-builder-input-${variant}`}
                  className="text-sm font-medium"
                >
                  {variant === "hero" ? "Describe the automation goal" : "Automation outcome"}
                </Label>
                <Textarea
                  id={`automation-builder-input-${variant}`}
                  value={inputValue}
                  onChange={(event) => setInputValue(event.currentTarget.value)}
                  placeholder={EXAMPLE_PROMPTS[exampleIndex]}
                  className={cn(
                    "mt-3 min-h-32 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0",
                    variant === "hero" && "min-h-36 text-base",
                    variant === "compact" && "min-h-24 text-sm",
                  )}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void handleBriefSubmit();
                    }
                  }}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => setIsInputFocused(false)}
                />
                <div
                  className={cn(
                    "flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between",
                    variant === "hero" ? "border-t" : "border-t border-dashed",
                  )}
                >
                  <p className="text-xs text-muted-foreground">
                    {variant === "hero" ? (
                      shortcutModifier ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span>Use</span>
                          <KbdGroup>
                            <Kbd>{shortcutModifier}</Kbd>
                            <span>+</span>
                            <Kbd>Enter</Kbd>
                          </KbdGroup>
                          <span>to continue.</span>
                        </span>
                      ) : null
                    ) : (
                      <>Keep it short. Keppo asks follow-up questions only when it needs them.</>
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    {variant === "compact" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setIsCompactExpanded(false)}
                      >
                        Close
                      </Button>
                    ) : null}
                    <Button type="button" onClick={() => void handleBriefSubmit()}>
                      <SparklesIcon className="mr-2 size-4" />
                      Continue
                    </Button>
                  </div>
                </div>
              </div>
              {error ? <UserFacingErrorView error={error} variant="compact" /> : null}
              {error && inputValue.trim().length > 0 ? (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleBriefSubmit()}
                  >
                    Retry question generation
                  </Button>
                </div>
              ) : null}
              {statusMessage ? (
                <p className={cn("text-sm", getStatusToneClasses(statusTone))} role="alert">
                  {statusMessage}
                </p>
              ) : null}
              <div className={cn("flex flex-wrap gap-2", variant === "compact" && "hidden")}>
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-left text-xs transition-colors hover:border-primary/40 hover:text-foreground",
                      variant === "hero"
                        ? "bg-background/80 text-foreground/80"
                        : "text-muted-foreground",
                    )}
                    onClick={() => setInputValue(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : step === "questions" && currentQuestion ? (
            <motion.div
              key="questions"
              {...transitionProps}
              className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]"
            >
              <AutomationBuilderQuestionsStep
                question={currentQuestion}
                questionIndex={currentQuestionIndex}
                questionCount={questions.length}
                currentValue={answers[currentQuestion.id]}
                inlineMessage={statusMessage}
                inlineMessageTone={statusTone}
                onAnswerChange={(value) => {
                  setStatusMessage(null);
                  setStatusTone("muted");
                  if (config !== null) {
                    setConfig(null);
                  }
                  setAnswers((current) => ({
                    ...current,
                    [currentQuestion.id]: value,
                  }));
                }}
                onBack={() => {
                  setStatusMessage(null);
                  setStatusTone("muted");
                  if (currentQuestionIndex === 0) {
                    setStep("brief");
                    return;
                  }
                  setCurrentQuestionIndex((current) => Math.max(current - 1, 0));
                }}
                onContinue={handleQuestionContinue}
                onJumpToQuestion={(index) => setCurrentQuestionIndex(index)}
                questionStates={questionStates}
              />

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-2xl border bg-background/60 p-5">
                  <p className="text-sm font-medium">Builder brief</p>
                  <p className="mt-2 text-sm text-muted-foreground">{inputValue.trim()}</p>
                </div>

                <div className="rounded-2xl border bg-background/60 p-5">
                  <p className="text-sm font-medium">Credit policy</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {questionBilling?.summary ??
                      (usesBundledQuestionBilling
                        ? "Keppo updates your bundled AI credit balance automatically while it generates questions and drafts."
                        : "Clarifying questions are free. Keppo charges only when it generates the final automation draft.")}
                  </p>
                </div>

                <div
                  className="rounded-2xl border bg-background/60 p-5"
                  data-testid="automation-builder-answer-summary"
                >
                  <p className="text-sm font-medium">Answer summary</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Answered details stay pinned here while the current question remains in focus.
                  </p>
                  <div className="mt-4 space-y-3">
                    {questions
                      .filter((question, index) => {
                        const hasAnswer = answeredClarifications.some(
                          (entry) => entry.question_id === question.id,
                        );
                        return hasAnswer || index === currentQuestionIndex;
                      })
                      .map((question) => {
                        const summary = answeredClarifications.find(
                          (entry) => entry.question_id === question.id,
                        );
                        const isCurrentQuestion = question.id === currentQuestion?.id;
                        return (
                          <div
                            key={question.id}
                            className={cn(
                              "rounded-xl border bg-card p-3",
                              isCurrentQuestion && "border-primary/30 bg-primary/5",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                {question.label}
                              </p>
                              {isCurrentQuestion ? (
                                <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
                                  Current
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 font-medium text-foreground">
                              {summary?.answer ?? "Waiting for answer"}
                            </p>
                          </div>
                        );
                      })}
                    {questions.length > currentQuestionIndex + 1 ? (
                      <div className="rounded-xl border border-dashed bg-background p-3 text-sm text-muted-foreground">
                        {questions.length - currentQuestionIndex - 1} more{" "}
                        {questions.length - currentQuestionIndex - 1 === 1
                          ? "question is"
                          : "questions are"}{" "}
                        still ahead.
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : config ? (
            <motion.div
              key={step}
              {...transitionProps}
              className={cn(
                "grid gap-4",
                step === "providers"
                  ? "lg:grid-cols-[1.35fr_0.65fr]"
                  : "lg:grid-cols-[1.15fr_0.85fr]",
              )}
            >
              <div className="space-y-4">
                {step === "draft" ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border bg-background/70 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">Drafted workflow</p>
                          <p className="text-sm text-muted-foreground">
                            Review the answers that shaped this automation, then edit the draft
                            before moving into provider setup.
                          </p>
                        </div>
                        <Badge variant="outline" data-testid="automation-builder-trigger-summary">
                          {getTriggerSummary(config)}
                        </Badge>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border bg-card p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Brief
                          </p>
                          <p className="mt-1 text-sm font-medium">{inputValue.trim()}</p>
                        </div>
                        <div className="rounded-xl border bg-card p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Credit policy
                          </p>
                          <p className="mt-1 text-sm font-medium">
                            {config.billing?.summary ??
                              "Keppo updated your bundled AI credit balance after the draft completed."}
                          </p>
                        </div>
                      </div>

                      <div
                        className="mt-4 rounded-2xl border bg-card p-4"
                        data-testid="automation-builder-clarification-summary"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">Clarification summary</p>
                            <p className="text-sm text-muted-foreground">
                              These answers shaped the draft before provider and runtime review.
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {answeredClarifications.length > 0 ? (
                            answeredClarifications.map((entry) => (
                              <div
                                key={entry.question_id}
                                className="rounded-xl border bg-background p-3"
                              >
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                  {entry.label}
                                </p>
                                <p className="mt-1 font-medium">{entry.answer}</p>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-xl border bg-background p-3 text-sm text-muted-foreground">
                              No follow-up questions were needed for this automation.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 space-y-4">
                        <div>
                          <Label htmlFor="automation-builder-name">Automation name</Label>
                          <Input
                            id="automation-builder-name"
                            value={config.name}
                            onChange={(event) => {
                              const { value } = event.currentTarget;
                              setConfig((current) =>
                                current
                                  ? {
                                      ...current,
                                      name: value,
                                    }
                                  : current,
                              );
                            }}
                            className="mt-2"
                          />
                        </div>
                        <div>
                          <Label htmlFor="automation-builder-description">Description</Label>
                          <Textarea
                            id="automation-builder-description"
                            value={config.description}
                            onChange={(event) => {
                              const { value } = event.currentTarget;
                              setConfig((current) =>
                                current
                                  ? {
                                      ...current,
                                      description: value,
                                    }
                                  : current,
                              );
                            }}
                            className="mt-2 min-h-24"
                          />
                        </div>
                        <div>
                          <Label htmlFor="automation-builder-prompt">Automation prompt</Label>
                          <Textarea
                            id="automation-builder-prompt"
                            value={config.prompt}
                            onChange={(event) => {
                              const { value } = event.currentTarget;
                              setConfig((current) =>
                                current
                                  ? {
                                      ...current,
                                      prompt: value,
                                    }
                                  : current,
                              );
                            }}
                            className="mt-2 min-h-44 font-mono text-[13px]"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {step === "providers" ? (
                  <div className="space-y-4">
                    <div className="max-w-2xl space-y-2">
                      <p className="text-lg font-semibold">
                        Choose provider access for this automation
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Connect the systems this automation should read from now, or finish setup
                        without them and add live provider context later.
                      </p>
                    </div>
                    {recommendedProviders.length > 0 ? (
                      recommendedProviders.map((recommendation) => {
                        const integration = providerStates.integrationByProvider.get(
                          recommendation.provider as CanonicalProviderId,
                        );
                        return (
                          <ProviderRecommendationCard
                            key={recommendation.provider}
                            provider={recommendation.provider}
                            reason={recommendation.reason}
                            confidence={recommendation.confidence}
                            connected={integration?.connected === true}
                            enabled={providerStates.workspaceEnabled.has(
                              recommendation.provider as CanonicalProviderId,
                            )}
                            skipped={skippedProviders.includes(recommendation.provider)}
                            busy={connectingProvider === recommendation.provider}
                            onConnect={() => void handleProviderConnect(recommendation.provider)}
                            onOpen={() =>
                              void navigate({
                                to: buildWorkspacePath(`/integrations/${recommendation.provider}`),
                              })
                            }
                            onToggleSkip={() =>
                              setSkippedProviders((current) =>
                                current.includes(recommendation.provider)
                                  ? current.filter((entry) => entry !== recommendation.provider)
                                  : [...current, recommendation.provider],
                              )
                            }
                          />
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border bg-background/70 p-5">
                        <p className="font-medium">No provider setup inferred</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          This automation looks self-contained. You can continue straight to runtime
                          settings.
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}

                {step === "settings" ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border bg-background/70 p-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="builder-model-class">Model</Label>
                          <NativeSelect
                            id="builder-model-class"
                            value={settings.model_class}
                            onChange={(event) => {
                              const nextClass =
                                event.currentTarget.value === "frontier" ||
                                event.currentTarget.value === "balanced" ||
                                event.currentTarget.value === "value"
                                  ? event.currentTarget.value
                                  : "auto";
                              const compatibility = MODEL_CLASS_COMPATIBILITY[nextClass];
                              setSettings({
                                ...settings,
                                model_class: nextClass,
                                ai_model_provider: compatibility.provider,
                                ai_model_name: compatibility.model,
                              });
                            }}
                            className="mt-2 w-full"
                          >
                            <option value="auto">Auto</option>
                            <option value="frontier">Frontier</option>
                            <option value="balanced">Balanced</option>
                            <option value="value">Value</option>
                          </NativeSelect>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {getAutomationModelClassMeta(settings.model_class).description}
                          </p>
                        </div>
                        <div>
                          <div className="rounded-2xl border p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <Label htmlFor="builder-network-access">Enable web access</Label>
                                <p className="text-xs text-muted-foreground">
                                  {getNetworkAccessMeta(settings.network_access).description}
                                </p>
                              </div>
                              <Switch
                                id="builder-network-access"
                                checked={settings.network_access === "mcp_and_web"}
                                onCheckedChange={(checked) =>
                                  setSettings({
                                    ...settings,
                                    network_access: checked ? "mcp_and_web" : "mcp_only",
                                  })
                                }
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border bg-background/70 p-5">
                      <p className="font-medium">Ready to create</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        The builder will save the first config version and route you into the
                        automation detail page.
                      </p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border bg-card p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Trigger
                          </p>
                          <p className="mt-1 font-medium">{getTriggerSummary(config)}</p>
                        </div>
                        <div className="rounded-xl border bg-card p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Runtime
                          </p>
                          <p className="mt-1 font-medium">
                            {getAutomationModelClassMeta(settings.model_class).label}
                          </p>
                        </div>
                      </div>
                      {recommendedProviders.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {recommendedProviders.map((entry) => (
                            <Badge key={entry.provider} variant="outline">
                              {entry.provider}
                              {skippedProviders.includes(entry.provider) ? " skipped" : ""}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {step !== "questions" ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={previousReviewStep}
                      disabled={step === "brief" || isCreating}
                    >
                      <ChevronLeftIcon className="mr-1 size-4" />
                      Back
                    </Button>
                    {step === "settings" ? (
                      <Button
                        type="button"
                        onClick={() => void handleCreate()}
                        disabled={isCreating}
                      >
                        {isCreating ? (
                          <Loader2Icon className="mr-2 size-4 animate-spin" />
                        ) : (
                          <CheckCircle2Icon className="mr-2 size-4" />
                        )}
                        Create automation
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant={step === "providers" ? "outline" : "default"}
                        onClick={nextReviewStep}
                        disabled={step === "providers" && !canContinueFromProviders}
                      >
                        {step === "providers" && !hasConnectedRecommendedProvider
                          ? "Continue without these providers"
                          : "Continue"}
                        <ArrowRightIcon className="ml-2 size-4" />
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border bg-background/60 p-5">
                  <p className="text-sm font-medium">Builder summary</p>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Prompt credits left</dt>
                      <dd className="font-medium">
                        {formatAiCreditAmount(config.credit_balance.total_available)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Automation slug preview</dt>
                      <dd className="font-mono text-xs text-foreground">
                        {getSlugPreview(config.name)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Trigger</dt>
                      <dd className="font-medium">{getTriggerSummary(config)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Prompt intent</dt>
                      <dd className="text-muted-foreground">{inputValue.trim()}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Questionnaire billing</dt>
                      <dd className="text-muted-foreground">
                        {config.billing?.summary ??
                          questionBilling?.summary ??
                          (usesBundledQuestionBilling
                            ? "Keppo updates your bundled AI credit balance automatically while drafting."
                            : "Clarifying questions are free. Keppo charges only when it generates the final automation draft.")}
                      </dd>
                    </div>
                  </dl>
                </div>

                {step !== "draft" ? (
                  <div className="rounded-2xl border bg-background/60 p-5">
                    <p className="text-sm font-medium">Clarifications</p>
                    <div className="mt-4 space-y-3">
                      {answeredClarifications.length > 0 ? (
                        answeredClarifications.map((entry) => (
                          <div key={entry.question_id} className="rounded-xl border bg-card p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              {entry.label}
                            </p>
                            <p className="mt-1 font-medium">{entry.answer}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No follow-up questions were needed for this automation.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}

                {config.mermaid_content ? (
                  <div className="rounded-2xl border bg-background/60 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">Workflow diagram</p>
                      <span className="text-xs text-muted-foreground">Generated Mermaid</span>
                    </div>
                    <div className="mt-3" data-testid="automation-builder-diagram">
                      <MermaidDiagram chart={config.mermaid_content} />
                    </div>
                  </div>
                ) : null}

                {step !== "providers" ? (
                  <div className="rounded-2xl border bg-background/60 p-5">
                    <p className="text-sm font-medium">Manual fallback</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Need CEL predicates, a different runner profile, or tighter manual control?
                      The advanced manual dialog on the automations page stays available for that
                      path.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-muted/20 p-5">
                    <p className="text-sm font-medium">Automation summary</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      The next step confirms runtime settings. You can create this automation
                      without a provider connection, but it will not inspect live provider data
                      until you connect that integration.
                    </p>
                    <dl className="mt-4 space-y-3 text-sm">
                      <div>
                        <dt className="text-muted-foreground">Automation slug preview</dt>
                        <dd className="font-mono text-xs text-foreground">
                          {getSlugPreview(config.name)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Trigger</dt>
                        <dd className="font-medium">{getTriggerSummary(config)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Automation brief</dt>
                        <dd className="text-muted-foreground">{inputValue.trim()}</dd>
                      </div>
                    </dl>
                  </div>
                )}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {!isSuccess && error ? (
          <UserFacingErrorView error={error} variant="compact" className="mt-4" />
        ) : null}
        {!isSuccess && statusMessage ? (
          step !== "questions" ? (
            <p className={cn("mt-4 text-sm", getStatusToneClasses(statusTone))} role="alert">
              {statusMessage}
            </p>
          ) : null
        ) : null}
      </CardContent>
    </Card>
  );
}
