import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { RefreshCwIcon, WandSparklesIcon } from "lucide-react";
import { Controller, FormProvider, useForm, useWatch, type Control } from "react-hook-form";
import { computeAutomationPromptHash, isAutomationMermaidStale } from "@keppo/shared/automations";
import { ApiError } from "@/lib/api-errors";
import { useAuth } from "@/hooks/use-auth";
import { useRouteParams } from "@/hooks/use-route-params";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { generateAutomationPrompt } from "@/lib/server-functions/internal-api";
import { getRuntimeBetterAuthCookieHeader } from "@/lib/better-auth-cookie";
import { AutomationExecutionModeCallout } from "@/components/automations/automation-execution-mode-callout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  normalizeMermaidContent,
  splitAutomationDescription,
  validateMermaidContent,
} from "@/lib/automation-mermaid";
import { parseProviderCatalogPayload } from "@/lib/boundary-contracts";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { HelpText } from "@/components/ui/help-text";
import {
  getAutomationModelClassMeta,
  getNetworkAccessMeta,
  parseAiCreditBalance,
  resolveAutomationExecutionState,
  type Automation,
  type AutomationConfigVersion,
} from "@/lib/automations-view-model";
import { getProviderMeta } from "@/components/integrations/provider-icons";
import {
  automationFormSchema,
  buildAutomationConfigInput,
  getDefaultAutomationFormValues,
  getProviderTriggerFormDefaults,
  parseModelClass,
  parseNetworkAccess,
  parseTriggerType,
  type AutomationFormValues,
} from "./automation-form-schema";
import { CronScheduleBuilder } from "./cron-schedule-builder";
import { ProviderTriggerFields } from "./provider-trigger-fields";

type AutomationConfigEditorProps = {
  automation: Automation;
  config: AutomationConfigVersion;
  triggerCelEnabled: boolean;
  onSaved: () => void;
};

function MermaidStalenessNotice({
  control,
  mermaidPromptHash,
  onRegenerate,
  isRegenerating,
}: {
  control: Control<AutomationFormValues>;
  mermaidPromptHash: string | null;
  onRegenerate: () => void;
  isRegenerating: boolean;
}) {
  const prompt = useWatch({ control, name: "prompt" });
  const mermaidContent = useWatch({ control, name: "mermaid_content" });
  const mermaidIsStale = isAutomationMermaidStale({
    prompt,
    mermaidContent,
    mermaidPromptHash,
  });

  if (!mermaidIsStale) {
    return null;
  }

  return (
    <Alert variant="warning" className="mb-3">
      <AlertTitle>Prompt changed since this diagram was generated</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          Regenerate the Mermaid diagram so the visual workflow stays aligned with the current
          prompt.
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRegenerate}
          disabled={isRegenerating}
        >
          <RefreshCwIcon className="mr-2 size-4" />
          {isRegenerating ? "Regenerating..." : "Regenerate diagram"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

const parseGenerationPayload = (
  value: unknown,
): {
  prompt: string;
  description: string;
  mermaid_content: string;
  totalAvailable: number;
} | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true) {
    return null;
  }
  const creditBalance = record.credit_balance;
  if (!creditBalance || typeof creditBalance !== "object") {
    return null;
  }
  const cb = creditBalance as Record<string, unknown>;
  return {
    prompt: typeof record.prompt === "string" ? record.prompt : "",
    description: typeof record.description === "string" ? record.description : "",
    mermaid_content: typeof record.mermaid_content === "string" ? record.mermaid_content : "",
    totalAvailable: typeof cb.total_available === "number" ? cb.total_available : 0,
  };
};

export function AutomationConfigEditor({
  automation,
  config,
  triggerCelEnabled,
  onSaved,
}: AutomationConfigEditorProps) {
  const { getOrgId } = useAuth();
  const { buildOrgPath } = useRouteParams();
  const { selectedWorkspaceIntegrations } = useWorkspace();
  const orgId = getOrgId();

  const [error, setError] = useState<UserFacingError | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegeneratingMermaid, setIsRegeneratingMermaid] = useState(false);
  const [creditPreview, setCreditPreview] = useState<number | null>(null);
  const [editorMermaidPromptHash, setEditorMermaidPromptHash] = useState<string | null>(
    automation.mermaid_prompt_hash,
  );

  const providerCatalogRaw = useQuery(
    makeFunctionReference<"query">("integrations:providerCatalog"),
    automation.workspace_id ? {} : "skip",
  );
  const creditBalanceRaw = useQuery(
    makeFunctionReference<"query">("ai_credits:getAiCreditBalance"),
    orgId ? { org_id: orgId } : "skip",
  );
  const orgAiKeys = useQuery(
    makeFunctionReference<"query">("org_ai_keys:listOrgAiKeys"),
    orgId ? { org_id: orgId } : "skip",
  );

  const updateAutomationMetaMutation = useMutation(
    makeFunctionReference<"mutation">("automations:updateAutomationMeta"),
  );
  const updateAutomationConfigMutation = useMutation(
    makeFunctionReference<"mutation">("automations:updateAutomationConfig"),
  );
  const initialMeta = useMemo(
    () => splitAutomationDescription(automation.description, automation.mermaid_content),
    [automation.description, automation.mermaid_content],
  );

  const form = useForm<AutomationFormValues>({
    resolver: zodResolver(automationFormSchema),
    defaultValues: getDefaultAutomationFormValues({
      name: automation.name,
      description: initialMeta.description,
      mermaid_content: initialMeta.mermaidContent ?? "",
      trigger_type: config.trigger_type,
      schedule_cron: config.schedule_cron ?? "0 9 * * *",
      ...getProviderTriggerFormDefaults({
        providerId: config.provider_trigger?.provider_id ?? config.event_provider,
        triggerKey: config.provider_trigger?.trigger_key ?? config.event_type,
        filter:
          config.provider_trigger?.filter ??
          (config.event_predicate ? { predicate: config.event_predicate } : {}),
      }),
      model_class: config.model_class,
      runner_type: config.runner_type,
      ai_model_provider: config.ai_model_provider,
      ai_model_name: config.ai_model_name,
      prompt: config.prompt,
      network_access: config.network_access,
    }),
  });
  const triggerType = form.watch("trigger_type");
  const modelClass = form.watch("model_class");
  const networkAccess = form.watch("network_access");
  const executionProviderByModelClass = {
    auto: "openai",
    frontier: "openai",
    balanced: "openai",
    value: "openai",
  } as const;
  const executionProvider = executionProviderByModelClass[modelClass];
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = form;

  useEffect(() => {
    reset(
      getDefaultAutomationFormValues({
        name: automation.name,
        description: initialMeta.description,
        mermaid_content: initialMeta.mermaidContent ?? "",
        trigger_type: config.trigger_type,
        schedule_cron: config.schedule_cron ?? "0 9 * * *",
        ...getProviderTriggerFormDefaults({
          providerId: config.provider_trigger?.provider_id ?? config.event_provider,
          triggerKey: config.provider_trigger?.trigger_key ?? config.event_type,
          filter:
            config.provider_trigger?.filter ??
            (config.event_predicate ? { predicate: config.event_predicate } : {}),
        }),
        model_class: config.model_class,
        runner_type: config.runner_type,
        ai_model_provider: config.ai_model_provider,
        ai_model_name: config.ai_model_name,
        prompt: config.prompt,
        network_access: config.network_access,
        change_summary: "",
        generation_description: "",
      }),
    );
    setCreditPreview(null);
    setEditorMermaidPromptHash(automation.mermaid_prompt_hash);
  }, [
    automation.mermaid_prompt_hash,
    automation.name,
    config,
    initialMeta.description,
    initialMeta.mermaidContent,
    reset,
  ]);

  const providerCatalog = useMemo(
    () => parseProviderCatalogPayload(providerCatalogRaw ?? []),
    [providerCatalogRaw],
  );
  const availableTools = useMemo(() => {
    const enabledProviderSet = new Set(
      selectedWorkspaceIntegrations.filter((item) => item.enabled).map((item) => item.provider),
    );
    return providerCatalog.filter((entry) => enabledProviderSet.has(entry.provider));
  }, [providerCatalog, selectedWorkspaceIntegrations]);
  const availableTriggerProviderIds = useMemo(() => {
    return [...new Set(availableTools.map((entry) => entry.provider))];
  }, [availableTools]);

  const creditBalance = useMemo(() => parseAiCreditBalance(creditBalanceRaw), [creditBalanceRaw]);
  const executionState = useMemo(
    () =>
      resolveAutomationExecutionState({
        provider: executionProvider,
        creditBalance,
        orgAiKeys: Array.isArray(orgAiKeys) ? orgAiKeys : [],
      }),
    [executionProvider, creditBalance, orgAiKeys],
  );
  const executionStatePending = creditBalanceRaw === undefined || orgAiKeys === undefined;
  const handleGenerate = async () => {
    setError(null);
    const generationDescription = (getValues("generation_description") ?? "").trim();
    if (!generationDescription) {
      setError(
        toUserFacingError(new Error("Enter a prompt brief before generating."), {
          fallback: "Enter a prompt brief before generating.",
        }),
      );
      form.setError("generation_description", {
        type: "manual",
        message: "Enter a prompt brief before generating.",
      });
      return;
    }
    form.clearErrors("generation_description");
    setIsGenerating(true);
    try {
      const response = await generateAutomationPrompt({
        workspace_id: automation.workspace_id,
        user_description: generationDescription,
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      const parsed = parseGenerationPayload(response);
      if (!parsed) {
        throw new Error("Prompt generation returned invalid data.");
      }
      setValue("prompt", parsed.prompt, {
        shouldDirty: true,
        shouldValidate: true,
      });
      if (!getValues("description").trim()) {
        setValue("description", parsed.description, { shouldDirty: true });
      }
      if (!getValues("mermaid_content").trim()) {
        setValue("mermaid_content", parsed.mermaid_content, { shouldDirty: true });
        setEditorMermaidPromptHash(computeAutomationPromptHash(parsed.prompt));
      }
      setCreditPreview(parsed.totalAvailable);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 402) {
        setError(
          toUserFacingError(caught, {
            fallback: "AI credit limit reached.",
          }),
        );
      } else {
        setError(toUserFacingError(caught, { fallback: "Prompt generation failed." }));
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateMermaid = async () => {
    setError(null);
    const prompt = (getValues("prompt") ?? "").trim();
    if (!prompt) {
      setError(
        toUserFacingError(
          new Error("Enter the automation prompt before regenerating the diagram."),
          {
            fallback: "Enter the automation prompt before regenerating the diagram.",
          },
        ),
      );
      return;
    }
    setIsRegeneratingMermaid(true);
    try {
      const response = await generateAutomationPrompt({
        workspace_id: automation.workspace_id,
        user_description: prompt,
        generation_mode: "mermaid_only",
        automation_context: {
          automation_id: automation.id,
          name: getValues("name"),
          description: getValues("description"),
          mermaid_content: getValues("mermaid_content"),
          trigger_type: getValues("trigger_type"),
          schedule_cron: getValues("schedule_cron") || null,
          event_provider: getValues("provider_trigger_provider_id") || null,
          event_type: getValues("provider_trigger_key") || null,
          model_class: getValues("model_class"),
          ai_model_provider: getValues("ai_model_provider"),
          ai_model_name: getValues("ai_model_name"),
          network_access: getValues("network_access"),
          prompt,
        },
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      const record =
        response && typeof response === "object" && !Array.isArray(response)
          ? (response as Record<string, unknown>)
          : null;
      const nextMermaid =
        typeof record?.mermaid_content === "string" ? record.mermaid_content.trim() : "";
      if (!nextMermaid) {
        throw new Error("Mermaid regeneration returned invalid data.");
      }
      const normalizedMermaid = normalizeMermaidContent(nextMermaid);
      const mermaidError = await validateMermaidContent(normalizedMermaid);
      if (mermaidError) {
        form.setError("mermaid_content", {
          type: "manual",
          message: mermaidError,
        });
        throw new Error(mermaidError);
      }
      form.clearErrors("mermaid_content");
      setValue("mermaid_content", normalizedMermaid, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setEditorMermaidPromptHash(computeAutomationPromptHash(prompt));
    } catch (caught) {
      setError(
        toUserFacingError(caught, { fallback: "Failed to regenerate the workflow diagram." }),
      );
    } finally {
      setIsRegeneratingMermaid(false);
    }
  };

  const handleSave = handleSubmit(async (values) => {
    setError(null);
    try {
      const normalizedMermaidContent = normalizeMermaidContent(values.mermaid_content);
      const mermaidError = await validateMermaidContent(normalizedMermaidContent);
      if (mermaidError) {
        form.setError("mermaid_content", {
          type: "manual",
          message: mermaidError,
        });
        return;
      }
      if (
        values.name.trim() !== automation.name.trim() ||
        values.description.trim() !== initialMeta.description ||
        normalizedMermaidContent !== (initialMeta.mermaidContent ?? "")
      ) {
        await updateAutomationMetaMutation({
          automation_id: automation.id,
          name: values.name,
          description: values.description,
          mermaid_content: normalizedMermaidContent,
          prompt: values.prompt,
        });
      }

      await updateAutomationConfigMutation({
        automation_id: automation.id,
        change_summary: values.change_summary?.trim() || undefined,
        ...buildAutomationConfigInput(values, { triggerCelEnabled }),
      });

      onSaved();
    } catch (caught) {
      setError(
        toUserFacingError(caught, {
          fallback: "Failed to save configuration.",
        }),
      );
    }
  });

  return (
    <FormProvider {...form}>
      <form className="space-y-4" onSubmit={handleSave}>
        <Card>
          <CardHeader>
            <CardTitle>Automation Metadata</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="space-y-1">
              <Label htmlFor="automation-meta-name">Name</Label>
              <Input id="automation-meta-name" {...register("name")} />
              {errors.name ? (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="automation-meta-description">Description</Label>
              <Textarea
                id="automation-meta-description"
                className="min-h-20"
                {...register("description")}
              />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label htmlFor="automation-meta-mermaid">Workflow diagram</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRegenerateMermaid()}
                  disabled={isRegeneratingMermaid}
                >
                  <RefreshCwIcon className="mr-2 size-4" />
                  {isRegeneratingMermaid ? "Regenerating..." : "Regenerate diagram"}
                </Button>
              </div>
              <MermaidStalenessNotice
                control={control}
                mermaidPromptHash={editorMermaidPromptHash}
                onRegenerate={() => void handleRegenerateMermaid()}
                isRegenerating={isRegeneratingMermaid}
              />
              <Textarea
                id="automation-meta-mermaid"
                className="min-h-40 font-mono text-xs"
                placeholder={"flowchart TD\n    Trigger --> Fetch\n    Fetch --> Summarize"}
                {...register("mermaid_content", {
                  onBlur: async (event) => {
                    const normalized = normalizeMermaidContent(event.target.value);
                    if (normalized !== event.target.value) {
                      setValue("mermaid_content", normalized, { shouldDirty: true });
                    }
                    const message = await validateMermaidContent(normalized);
                    if (message) {
                      form.setError("mermaid_content", {
                        type: "manual",
                        message,
                      });
                    } else {
                      form.clearErrors("mermaid_content");
                      setEditorMermaidPromptHash(
                        normalized ? computeAutomationPromptHash(getValues("prompt")) : null,
                      );
                    }
                  },
                })}
              />
              <HelpText>
                Optional Mermaid source rendered on the detail page. Keep prose in Description and
                store only diagram syntax here.
              </HelpText>
              {errors.mermaid_content ? (
                <p className="text-xs text-destructive">{errors.mermaid_content.message}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trigger</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="config-trigger-type">Trigger type</Label>
              <Controller
                control={control}
                name="trigger_type"
                render={({ field }) => (
                  <NativeSelect
                    id="config-trigger-type"
                    value={field.value}
                    onChange={(event) =>
                      field.onChange(parseTriggerType(event.currentTarget.value))
                    }
                  >
                    <option value="schedule">Schedule</option>
                    <option value="event">Event</option>
                    <option value="manual">Manual</option>
                  </NativeSelect>
                )}
              />
            </div>

            {triggerType === "schedule" ? (
              <div className="space-y-1 md:col-span-2">
                <Controller
                  control={control}
                  name="schedule_cron"
                  render={({ field }) => (
                    <CronScheduleBuilder
                      id="config-schedule"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                    />
                  )}
                />
                {errors.schedule_cron ? (
                  <p className="text-xs text-destructive">{errors.schedule_cron.message}</p>
                ) : null}
              </div>
            ) : null}
            {triggerType === "event" ? (
              <>
                <ProviderTriggerFields
                  availableProviderIds={availableTriggerProviderIds}
                  migrationState={config.provider_trigger_migration_state}
                />
              </>
            ) : null}
            {triggerType === "manual" ? (
              <p className="text-muted-foreground text-xs md:col-span-2">
                Manual runs are started on demand from the Automation page.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="config-model-class">Model class</Label>
              <Controller
                control={control}
                name="model_class"
                render={({ field }) => (
                  <NativeSelect
                    id="config-model-class"
                    value={field.value}
                    onChange={(event) => field.onChange(parseModelClass(event.currentTarget.value))}
                  >
                    <option value="auto">Auto</option>
                    <option value="frontier">Frontier</option>
                    <option value="balanced">Balanced</option>
                    <option value="value">Value</option>
                  </NativeSelect>
                )}
              />
              <HelpText>{getAutomationModelClassMeta(modelClass).description}</HelpText>
            </div>

            <div className="space-y-1 md:col-span-2">
              {executionStatePending ? null : (
                <AutomationExecutionModeCallout
                  provider={executionProvider}
                  state={executionState}
                  billingPath={buildOrgPath("/settings/billing")}
                  settingsPath={buildOrgPath("/settings")}
                  showUpgradeAction={creditBalance?.bundled_runtime_enabled !== true}
                />
              )}
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="config-generate-description">Generate with AI</Label>
              <Textarea
                id="config-generate-description"
                className="min-h-20"
                placeholder="Describe what this automation should do"
                {...register("generation_description")}
              />
              <HelpText>
                Describe the operator goal in plain language to refresh the prompt draft without
                rewriting the full configuration by hand.
              </HelpText>
              {errors.generation_description ? (
                <p className="text-xs text-destructive">{errors.generation_description.message}</p>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <p className="text-muted-foreground text-xs">
                  Credits: {creditPreview ?? creditBalance?.total_available ?? "-"} available
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void handleGenerate();
                  }}
                  disabled={isGenerating}
                >
                  <WandSparklesIcon className="mr-1.5 size-4" />
                  {isGenerating ? "Generating..." : "Generate with AI"}
                </Button>
              </div>
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="config-prompt">Prompt</Label>
              <Textarea
                id="config-prompt"
                className="min-h-44 font-mono text-xs"
                {...register("prompt")}
              />
              <HelpText>
                Keep the prompt explicit about scope, tools, expected output, and escalation
                boundaries.
              </HelpText>
              {errors.prompt ? (
                <p className="text-xs text-destructive">{errors.prompt.message}</p>
              ) : null}
            </div>

            <details className="md:col-span-2 rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">Available tools</summary>
              {availableTools.length === 0 ? (
                <p className="text-muted-foreground mt-2 text-sm">No connected integrations.</p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {availableTools.map((tool) => (
                    <li key={tool.provider}>
                      {getProviderMeta(tool.provider).label}{" "}
                      <span className="text-muted-foreground">({tool.provider})</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>

            <div className="space-y-1 md:col-span-2">
              <div className="flex items-start justify-between gap-3 rounded-2xl border p-4">
                <div className="space-y-1">
                  <Label htmlFor="config-network-access">Enable web access</Label>
                  <HelpText>{getNetworkAccessMeta(networkAccess).description}</HelpText>
                </div>
                <Controller
                  control={control}
                  name="network_access"
                  render={({ field }) => (
                    <Switch
                      id="config-network-access"
                      checked={field.value === "mcp_and_web"}
                      onCheckedChange={(checked) =>
                        field.onChange(parseNetworkAccess(checked ? "mcp_and_web" : "mcp_only"))
                      }
                    />
                  )}
                />
              </div>
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="config-change-summary">Change summary (optional)</Label>
              <Input
                id="config-change-summary"
                placeholder="Updated model and prompt for reliability"
                {...register("change_summary")}
              />
            </div>
          </CardContent>
        </Card>

        {error ? <UserFacingErrorView error={error} /> : null}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save Changes"}
        </Button>
      </form>
    </FormProvider>
  );
}
