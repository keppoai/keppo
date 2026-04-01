import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { ChevronDownIcon, WandSparklesIcon } from "lucide-react";
import { ApiError } from "@/lib/api-errors";
import { useAuth } from "@/hooks/use-auth";
import { useRouteParams } from "@/hooks/use-route-params";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { generateAutomationPrompt } from "@/lib/server-functions/internal-api";
import { getRuntimeBetterAuthCookieHeader } from "@/lib/better-auth-cookie";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseProviderCatalogPayload } from "@/lib/boundary-contracts";
import { normalizeMermaidContent, validateMermaidContent } from "@/lib/automation-mermaid";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { HelpText } from "@/components/ui/help-text";
import { TierLimitBanner } from "@/components/ui/tier-limit-banner";
import {
  getAutomationModelClassMeta,
  getNetworkAccessMeta,
  parseAiCreditBalance,
} from "@/lib/automations-view-model";
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
import { parseTierLimitError, type TierLimitError } from "@/lib/convex-errors";
import { getProviderMeta } from "@/components/integrations/provider-icons";

type CreateAutomationDialogProps = {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (automation: { id: string; slug: string } | null) => void;
  triggerCelEnabled: boolean;
};

type GenerationPayload = {
  prompt: string;
  description: string;
  mermaid_content: string;
  trigger_type: "schedule" | "event" | "manual";
  schedule_cron?: string;
  event_provider?: string;
  event_type?: string;
  credit_balance: {
    allowance_remaining: number;
    purchased_remaining: number;
    total_available: number;
  };
};

const parseGenerationPayload = (value: unknown): GenerationPayload | null => {
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
    trigger_type:
      record.trigger_type === "schedule" || record.trigger_type === "event"
        ? record.trigger_type
        : "manual",
    ...(typeof record.schedule_cron === "string" ? { schedule_cron: record.schedule_cron } : {}),
    ...(typeof record.event_provider === "string" ? { event_provider: record.event_provider } : {}),
    ...(typeof record.event_type === "string" ? { event_type: record.event_type } : {}),
    credit_balance: {
      allowance_remaining: typeof cb.allowance_remaining === "number" ? cb.allowance_remaining : 0,
      purchased_remaining: typeof cb.purchased_remaining === "number" ? cb.purchased_remaining : 0,
      total_available: typeof cb.total_available === "number" ? cb.total_available : 0,
    },
  };
};

export function CreateAutomationDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
  triggerCelEnabled,
}: CreateAutomationDialogProps) {
  const runtime = useDashboardRuntime();
  const { getOrgId } = useAuth();
  const { buildOrgPath } = useRouteParams();
  const { selectedWorkspaceIntegrations } = useWorkspace();
  const orgId = getOrgId();
  const [error, setError] = useState<UserFacingError | null>(null);
  const [tierLimitError, setTierLimitError] = useState<TierLimitError | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [creditPreview, setCreditPreview] = useState<number | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const createAutomationMutation = useMutation(
    makeFunctionReference<"mutation">("automations:createAutomation"),
  );
  const providerCatalogRaw = useQuery(
    makeFunctionReference<"query">("integrations:providerCatalog"),
    workspaceId ? {} : "skip",
  );
  const aiCreditBalanceRaw = useQuery(
    makeFunctionReference<"query">("ai_credits:getAiCreditBalance"),
    orgId ? { org_id: orgId } : "skip",
  );
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

  const aiCreditBalance = useMemo(() => {
    return parseAiCreditBalance(aiCreditBalanceRaw);
  }, [aiCreditBalanceRaw]);

  const form = useForm<AutomationFormValues>({
    resolver: zodResolver(automationFormSchema),
    defaultValues: getDefaultAutomationFormValues(),
  });
  const triggerType = form.watch("trigger_type");
  const modelClass = form.watch("model_class");
  const networkAccess = form.watch("network_access");
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = form;

  const handleGenerate = async () => {
    if (!workspaceId) {
      return;
    }
    const generationDescription = (getValues("generation_description") ?? "").trim();
    if (!generationDescription) {
      setError(
        toUserFacingError(new Error("Enter a short description before generating."), {
          fallback: "Enter a short description before generating.",
        }),
      );
      form.setError("generation_description", {
        type: "manual",
        message: "Enter a short description before generating.",
      });
      return;
    }
    setError(null);
    form.clearErrors("generation_description");
    setIsGenerating(true);
    try {
      const response = await generateAutomationPrompt({
        workspace_id: workspaceId,
        user_description: generationDescription,
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      const parsed = parseGenerationPayload(response);
      if (!parsed) {
        throw new Error("Prompt generation returned an invalid payload.");
      }
      setValue("prompt", parsed.prompt, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setValue("trigger_type", parsed.trigger_type, { shouldDirty: true });
      if (parsed.trigger_type === "schedule" && parsed.schedule_cron) {
        setValue("schedule_cron", parsed.schedule_cron, { shouldDirty: true });
      }
      if (parsed.trigger_type === "event") {
        const providerDefaults = getProviderTriggerFormDefaults({
          providerId: parsed.event_provider ?? "",
          triggerKey: parsed.event_type ?? "",
        });
        setValue("provider_trigger_provider_id", providerDefaults.provider_trigger_provider_id, {
          shouldDirty: true,
        });
        setValue("provider_trigger_key", providerDefaults.provider_trigger_key, {
          shouldDirty: true,
        });
        setValue("provider_trigger_filter", providerDefaults.provider_trigger_filter, {
          shouldDirty: true,
        });
      }
      if (!getValues("description").trim()) {
        setValue("description", parsed.description, { shouldDirty: true });
      }
      if (!getValues("mermaid_content").trim()) {
        setValue("mermaid_content", parsed.mermaid_content, { shouldDirty: true });
      }
      setCreditPreview(parsed.credit_balance.total_available);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 402) {
        setError(
          toUserFacingError(caught, {
            fallback: "AI credit limit reached. Add credits or wait for your next allowance reset.",
          }),
        );
      } else {
        setError(toUserFacingError(caught, { fallback: "Prompt generation failed." }));
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreate = handleSubmit(async (values) => {
    setError(null);
    setTierLimitError(null);
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
      const result = await createAutomationMutation({
        workspace_id: workspaceId,
        name: values.name,
        description: values.description,
        mermaid_content: normalizedMermaidContent || undefined,
        ...buildAutomationConfigInput(values, { triggerCelEnabled }),
      });

      if (result.warning) {
        setError(
          toUserFacingError(new Error(result.warning), {
            fallback: result.warning,
          }),
        );
      } else {
        onOpenChange(false);
        reset(getDefaultAutomationFormValues());
        setCreditPreview(null);
        setAdvancedOpen(false);
      }
      onCreated(
        result.automation &&
          typeof result.automation.id === "string" &&
          typeof result.automation.slug === "string"
          ? { id: result.automation.id, slug: result.automation.slug }
          : null,
      );
    } catch (caught) {
      const limit = parseTierLimitError(caught);
      if (limit) {
        setTierLimitError(limit);
        return;
      }
      setError(toUserFacingError(caught, { fallback: "Failed to create automation." }));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Create Automation Manually</DialogTitle>
          <DialogDescription>
            Describe the workflow first, then review the draft and only open advanced settings when
            the automation needs them.
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={handleCreate}>
            {tierLimitError ? (
              <TierLimitBanner
                limit={tierLimitError}
                billingPath={buildOrgPath("/settings/billing")}
              />
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>1. Draft the workflow</CardTitle>
                <p className="text-muted-foreground text-sm">
                  Start with the job to be done in plain language. Keppo drafts the prompt,
                  description, and workflow diagram first, then you can refine the operator-facing
                  details underneath.
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <div className="space-y-3 rounded-2xl border border-dashed border-primary/25 bg-primary/4 p-4 md:col-span-2">
                  <div className="space-y-1">
                    <Label
                      htmlFor="generation-description"
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="flex items-center gap-2">
                        <span>Workflow summary</span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          Recommended first step
                        </span>
                      </span>
                    </Label>
                    <HelpText>
                      Describe the real task in plain language. Keppo drafts the Prompt field below,
                      plus Description and Workflow diagram when those fields are still empty.
                    </HelpText>
                  </div>
                  <Textarea
                    id="generation-description"
                    placeholder="Describe the workflow you want this automation to run"
                    className="min-h-20 bg-background"
                    {...register("generation_description")}
                  />
                  {errors.generation_description ? (
                    <p className="text-destructive text-xs">
                      {errors.generation_description.message}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-muted-foreground text-xs">
                      Credits: {creditPreview ?? aiCreditBalance?.total_available ?? "-"} available
                    </p>
                    <Button
                      type="button"
                      variant="default"
                      onClick={() => {
                        void handleGenerate();
                      }}
                      disabled={isGenerating}
                    >
                      <WandSparklesIcon className="mr-1.5 size-4" />
                      {isGenerating ? "Generating..." : "Draft Prompt with AI"}
                    </Button>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Operator-facing details
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    These are safe to refine after the prompt draft looks right.
                  </p>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label
                    htmlFor="automation-name"
                    className="flex items-center justify-between gap-3"
                  >
                    <span>Name</span>
                    <span aria-hidden="true" className="text-muted-foreground text-xs font-normal">
                      Required
                    </span>
                  </Label>
                  <Input
                    id="automation-name"
                    placeholder="Morning issue triage"
                    {...register("name")}
                  />
                  <HelpText>
                    Operators will see this in the automation list, approval links, and run history.
                  </HelpText>
                  {errors.name ? (
                    <p className="text-destructive text-xs">{errors.name.message}</p>
                  ) : null}
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label
                    htmlFor="automation-description"
                    className="flex items-center justify-between gap-3"
                  >
                    <span>Description</span>
                    <span aria-hidden="true" className="text-muted-foreground text-xs font-normal">
                      Optional
                    </span>
                  </Label>
                  <Textarea
                    id="automation-description"
                    className="min-h-20"
                    {...register("description")}
                  />
                  <HelpText>
                    Add operator-facing context here. If you skip it, AI prompt generation can
                    backfill a first draft.
                  </HelpText>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label
                    htmlFor="automation-mermaid-content"
                    className="flex items-center justify-between gap-3"
                  >
                    <span>Workflow diagram</span>
                    <span aria-hidden="true" className="text-muted-foreground text-xs font-normal">
                      Optional
                    </span>
                  </Label>
                  <Textarea
                    id="automation-mermaid-content"
                    className="min-h-36 font-mono text-xs"
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
                        }
                      },
                    })}
                  />
                  <HelpText>
                    Store Mermaid syntax separately so the detail page can render the workflow as a
                    diagram instead of showing raw fenced text.
                  </HelpText>
                  {errors.mermaid_content ? (
                    <p className="text-destructive text-xs">{errors.mermaid_content.message}</p>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>2. Trigger</CardTitle>
                <p className="text-muted-foreground text-sm">
                  Choose what starts the automation. Event triggers react to provider activity,
                  while schedule and manual remain available when you need them.
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="trigger-type">Trigger Type</Label>
                  <Controller
                    control={control}
                    name="trigger_type"
                    render={({ field }) => (
                      <NativeSelect
                        id="trigger-type"
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
                          id="schedule-cron"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                        />
                      )}
                    />
                    {errors.schedule_cron ? (
                      <p className="text-destructive text-xs">{errors.schedule_cron.message}</p>
                    ) : null}
                  </div>
                ) : null}
                {triggerType === "event" ? (
                  <>
                    <ProviderTriggerFields availableProviderIds={availableTriggerProviderIds} />
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
                <CardTitle>3. Runner and Prompt</CardTitle>
                <p className="text-muted-foreground text-sm">
                  Keep the prompt explicit, then expand advanced settings only if you need to tune
                  models, auth, or network reach.
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1 md:col-span-2">
                  <Label
                    htmlFor="automation-prompt"
                    className="flex items-center justify-between gap-3"
                  >
                    <span>Prompt</span>
                    <span aria-hidden="true" className="text-muted-foreground text-xs font-normal">
                      Required
                    </span>
                  </Label>
                  <Textarea
                    id="automation-prompt"
                    className="min-h-36 font-mono text-xs"
                    {...register("prompt")}
                  />
                  <HelpText>
                    This is the automation&apos;s working instruction set. Review AI-generated
                    drafts before saving.
                  </HelpText>
                  {errors.prompt ? (
                    <p className="text-destructive text-xs">{errors.prompt.message}</p>
                  ) : null}
                </div>
                <div className="md:col-span-2">
                  <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Advanced Settings</p>
                        <p className="text-muted-foreground text-xs">
                          Optional model and network controls for expert tuning.
                        </p>
                      </div>
                      <ChevronDownIcon
                        className={`size-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                      />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="grid gap-3 pt-3 md:grid-cols-2">
                      <div className="space-y-1 md:col-span-2">
                        <Label htmlFor="model-class">Model</Label>
                        <Controller
                          control={control}
                          name="model_class"
                          render={({ field }) => (
                            <NativeSelect
                              id="model-class"
                              value={field.value}
                              onChange={(event) =>
                                field.onChange(parseModelClass(event.currentTarget.value))
                              }
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
                        <div className="flex items-start justify-between gap-3 rounded-2xl border p-4">
                          <div className="space-y-1">
                            <Label htmlFor="network-access">Enable web access</Label>
                            <HelpText>{getNetworkAccessMeta(networkAccess).description}</HelpText>
                          </div>
                          <Controller
                            control={control}
                            name="network_access"
                            render={({ field }) => (
                              <Switch
                                id="network-access"
                                checked={field.value === "mcp_and_web"}
                                onCheckedChange={(checked) =>
                                  field.onChange(
                                    parseNetworkAccess(checked ? "mcp_and_web" : "mcp_only"),
                                  )
                                }
                              />
                            )}
                          />
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Available Tools</CardTitle>
              </CardHeader>
              <CardContent>
                {availableTools.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No connected integrations yet.</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {availableTools.map((tool) => (
                      <li key={tool.provider}>
                        <span className="font-medium">{getProviderMeta(tool.provider).label}</span>
                        <span className="text-muted-foreground"> ({tool.provider})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {error ? <UserFacingErrorView error={error} /> : null}

            <DialogFooter>
              <Button type="submit" disabled={isSubmitting || !workspaceId}>
                {isSubmitting ? "Creating..." : "Create Automation"}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
