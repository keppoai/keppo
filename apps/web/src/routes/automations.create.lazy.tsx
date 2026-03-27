import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { createLazyRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { automationCreateRoute } from "./automations.create";
import { CronScheduleBuilder } from "@/components/automations/cron-schedule-builder";
import { ProviderTriggerFields } from "@/components/automations/provider-trigger-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpText } from "@/components/ui/help-text";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import { TierLimitBanner } from "@/components/ui/tier-limit-banner";
import { useAuth } from "@/hooks/use-auth";
import { useFeatureAccess } from "@/hooks/use-feature-flags";
import { useRouteParams } from "@/hooks/use-route-params";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { parseProviderCatalogPayload } from "@/lib/boundary-contracts";
import { parseTierLimitError, type TierLimitError } from "@/lib/convex-errors";
import { normalizeMermaidContent, validateMermaidContent } from "@/lib/automation-mermaid";
import {
  getAutomationPathSegment,
  getModelProviderForRunner,
  getNetworkAccessMeta,
  getRunnerTypeForModelProvider,
} from "@/lib/automations-view-model";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import {
  AI_MODELS,
  automationFormSchema,
  buildAutomationConfigInput,
  getDefaultAutomationFormValues,
  getDefaultModelForProvider,
  parseAiModelProvider,
  parseRunnerType,
  parseTriggerType,
  type AutomationFormValues,
} from "@/components/automations/automation-form-schema";
import { getProviderMeta } from "@/components/integrations/provider-icons";

export const automationCreateRouteLazy = createLazyRoute(automationCreateRoute.id)({
  component: CreateAutomationPage,
});

type CreateStep = 1 | 2 | 3;

function CreateAutomationPage() {
  const navigate = useNavigate();
  const { canManage } = useAuth();
  const { buildOrgPath, buildWorkspacePath } = useRouteParams();
  const { selectedWorkspaceId, selectedWorkspaceIntegrations } = useWorkspace();
  const triggerCelEnabled = useFeatureAccess("trigger_cel");
  const [step, setStep] = useState<CreateStep>(1);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [tierLimitError, setTierLimitError] = useState<TierLimitError | null>(null);

  const createAutomationMutation = useMutation(
    makeFunctionReference<"mutation">("automations:createAutomation"),
  );
  const providerCatalogRaw = useQuery(
    makeFunctionReference<"query">("integrations:providerCatalog"),
    selectedWorkspaceId ? {} : "skip",
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
  const form = useForm<AutomationFormValues>({
    resolver: zodResolver(automationFormSchema),
    defaultValues: getDefaultAutomationFormValues({
      trigger_type: "manual",
    }),
  });
  const triggerType = form.watch("trigger_type");
  const aiModelProvider = form.watch("ai_model_provider");
  const networkAccess = form.watch("network_access");
  const {
    control,
    formState: { errors, isSubmitting },
    getValues,
    handleSubmit,
    register,
    setValue,
    trigger,
  } = form;

  const validateStep = async (currentStep: CreateStep): Promise<boolean> => {
    if (currentStep === 1) {
      return await trigger(["name", "description", "mermaid_content"]);
    }
    if (currentStep === 2) {
      if (getValues("trigger_type") === "event") {
        return await trigger([
          "trigger_type",
          "provider_trigger_provider_id",
          "provider_trigger_key",
          "provider_trigger_filter",
        ]);
      }
      if (getValues("trigger_type") === "schedule") {
        return await trigger(["trigger_type", "schedule_cron"]);
      }
      return await trigger(["trigger_type"]);
    }
    return await trigger([
      "runner_type",
      "ai_model_provider",
      "ai_model_name",
      "prompt",
      "network_access",
    ]);
  };

  const handleCreate = handleSubmit(async (values) => {
    setError(null);
    setTierLimitError(null);
    if (!selectedWorkspaceId) {
      setError(
        toUserFacingError(new Error("automation.workspace_required"), {
          fallback: "Select a workspace before creating an automation.",
        }),
      );
      return;
    }
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
        workspace_id: selectedWorkspaceId,
        name: values.name,
        description: values.description,
        mermaid_content: normalizedMermaidContent || undefined,
        ...buildAutomationConfigInput(values, { triggerCelEnabled }),
      });
      const created = result.automation;
      if (!created || typeof created.id !== "string" || typeof created.slug !== "string") {
        throw new Error("Automation creation returned an invalid payload.");
      }
      await navigate({
        to: buildWorkspacePath(`/automations/${getAutomationPathSegment(created)}`),
      });
    } catch (caught) {
      const limit = parseTierLimitError(caught);
      if (limit) {
        setTierLimitError(limit);
        return;
      }
      setError(toUserFacingError(caught, { fallback: "Failed to create automation." }));
    }
  });

  const summaryItems = [
    { id: 1, label: "Basics" },
    { id: 2, label: "Trigger" },
    { id: 3, label: "Runner + Prompt" },
  ] as const;

  if (!canManage()) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>You do not have access to create automations.</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Automation authoring is limited to workspace owners and admins. You can still review
              existing automations from the workspace list.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void navigate({ to: buildWorkspacePath("/automations") });
              }}
            >
              Back to automations
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Create manually</h1>
        <p className="max-w-3xl text-muted-foreground">
          Configure the automation step by step when you want full control over the trigger, runner,
          prompt, and network settings without using AI generation.
        </p>
      </div>
      {tierLimitError ? (
        <TierLimitBanner limit={tierLimitError} billingPath={buildOrgPath("/settings/billing")} />
      ) : null}
      {error ? <UserFacingErrorView error={error} /> : null}

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Setup progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summaryItems.map((item) => (
              <div
                key={item.id}
                className={
                  item.id === step
                    ? "rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3"
                    : "rounded-2xl border px-4 py-3"
                }
              >
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Step {item.id}
                </p>
                <p className="mt-1 font-medium">{item.label}</p>
              </div>
            ))}
            <div className="rounded-2xl border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              Connected tools available:{" "}
              <span className="font-medium text-foreground">{availableTools.length}</span>
            </div>
          </CardContent>
        </Card>

        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={handleCreate}>
            {step === 1 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Step 1: Name and description</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="manual-automation-name">Name</Label>
                    <Input
                      id="manual-automation-name"
                      placeholder="Inbox blocker summary"
                      {...register("name")}
                    />
                    <HelpText>
                      Operators will see this in the automations list, run history, and approval
                      links.
                    </HelpText>
                    {errors.name ? (
                      <p className="text-xs text-destructive">{errors.name.message}</p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="manual-automation-description">Description</Label>
                    <Textarea
                      id="manual-automation-description"
                      className="min-h-28"
                      placeholder="Explain what this automation watches and what outcome operators should expect."
                      {...register("description")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="manual-automation-mermaid"
                      className="flex items-center justify-between gap-3"
                    >
                      <span>Workflow diagram</span>
                      <span
                        aria-hidden="true"
                        className="text-xs font-normal text-muted-foreground"
                      >
                        Optional
                      </span>
                    </Label>
                    <Textarea
                      id="manual-automation-mermaid"
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
                      Store Mermaid syntax separately so the detail page can render the workflow as
                      a diagram instead of showing raw fenced text.
                    </HelpText>
                    {errors.mermaid_content ? (
                      <p className="text-xs text-destructive">{errors.mermaid_content.message}</p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {step === 2 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Step 2: Trigger configuration</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="manual-trigger-type">Trigger type</Label>
                    <Controller
                      control={control}
                      name="trigger_type"
                      render={({ field }) => (
                        <NativeSelect
                          id="manual-trigger-type"
                          value={field.value}
                          onChange={(event) =>
                            field.onChange(parseTriggerType(event.currentTarget.value))
                          }
                        >
                          <option value="manual">Manual</option>
                          <option value="schedule">Schedule</option>
                          <option value="event">Event</option>
                        </NativeSelect>
                      )}
                    />
                  </div>
                  {triggerType === "schedule" ? (
                    <div className="space-y-2 md:col-span-2">
                      <Controller
                        control={control}
                        name="schedule_cron"
                        render={({ field }) => (
                          <CronScheduleBuilder
                            id="manual-schedule-cron"
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
                    <div className="md:col-span-2">
                      <ProviderTriggerFields availableProviderIds={availableTriggerProviderIds} />
                    </div>
                  ) : null}
                  {triggerType === "manual" ? (
                    <Alert className="md:col-span-2">
                      <AlertTitle>Manual runs are started on demand.</AlertTitle>
                      <AlertDescription>
                        Use this when operators should trigger the automation explicitly instead of
                        waiting for a schedule or provider event.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {step === 3 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Step 3: Runner, prompt, and access</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="manual-runner-type">Runner</Label>
                    <Controller
                      control={control}
                      name="runner_type"
                      render={({ field }) => (
                        <NativeSelect
                          id="manual-runner-type"
                          value={field.value}
                          onChange={(event) => {
                            const nextRunner = parseRunnerType(event.currentTarget.value);
                            const nextProvider = getModelProviderForRunner(nextRunner);
                            field.onChange(nextRunner);
                            setValue("ai_model_provider", nextProvider, { shouldDirty: true });
                            setValue("ai_model_name", getDefaultModelForProvider(nextProvider), {
                              shouldDirty: true,
                            });
                          }}
                        >
                          <option value="chatgpt_codex">ChatGPT Codex</option>
                          <option value="claude_code">Claude Code</option>
                        </NativeSelect>
                      )}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="manual-model-provider">Model provider</Label>
                    <Controller
                      control={control}
                      name="ai_model_provider"
                      render={({ field }) => (
                        <NativeSelect
                          id="manual-model-provider"
                          value={field.value}
                          onChange={(event) => {
                            const nextProvider = parseAiModelProvider(event.currentTarget.value);
                            field.onChange(nextProvider);
                            setValue("runner_type", getRunnerTypeForModelProvider(nextProvider), {
                              shouldDirty: true,
                            });
                            setValue("ai_model_name", getDefaultModelForProvider(nextProvider), {
                              shouldDirty: true,
                            });
                          }}
                        >
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                        </NativeSelect>
                      )}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="manual-model-name">Model</Label>
                    <Controller
                      control={control}
                      name="ai_model_name"
                      render={({ field }) => (
                        <NativeSelect
                          id="manual-model-name"
                          value={field.value}
                          onChange={(event) => field.onChange(event.currentTarget.value)}
                        >
                          {AI_MODELS[aiModelProvider].map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </NativeSelect>
                      )}
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="manual-prompt">Prompt</Label>
                    <Textarea
                      id="manual-prompt"
                      className="min-h-44 font-mono text-xs"
                      placeholder="Check the workspace inbox, summarize key changes, and flag blockers that need human review."
                      {...register("prompt")}
                    />
                    {errors.prompt ? (
                      <p className="text-xs text-destructive">{errors.prompt.message}</p>
                    ) : null}
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <div className="flex items-start justify-between gap-3 rounded-2xl border p-4">
                      <div className="space-y-1">
                        <Label htmlFor="manual-network-access">Enable web access</Label>
                        <p className="text-sm text-muted-foreground">
                          {getNetworkAccessMeta(networkAccess).description}
                        </p>
                      </div>
                      <Controller
                        control={control}
                        name="network_access"
                        render={({ field }) => (
                          <Switch
                            id="manual-network-access"
                            checked={field.value === "mcp_and_web"}
                            onCheckedChange={(checked) =>
                              field.onChange(checked ? "mcp_and_web" : "mcp_only")
                            }
                          />
                        )}
                      />
                    </div>
                  </div>

                  <details className="rounded-2xl border p-4 md:col-span-2">
                    <summary className="cursor-pointer text-sm font-medium">
                      Connected tools
                    </summary>
                    {availableTools.length === 0 ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        No integrations are currently enabled in this workspace.
                      </p>
                    ) : (
                      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                        {availableTools.map((tool) => (
                          <li
                            key={tool.provider}
                            className="rounded-xl border bg-muted/20 px-3 py-2 text-sm"
                          >
                            {getProviderMeta(tool.provider).label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                </CardContent>
              </Card>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              {step > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep((current) => (current - 1) as CreateStep)}
                >
                  <ChevronLeftIcon className="mr-1.5 size-4" />
                  Back
                </Button>
              ) : (
                <div aria-hidden="true" className="h-10" />
              )}
              {step < 3 ? (
                <Button
                  type="button"
                  onClick={async () => {
                    const valid = await validateStep(step);
                    if (valid) {
                      setStep((current) => (current < 3 ? ((current + 1) as CreateStep) : current));
                    }
                  }}
                >
                  Continue
                  <ChevronRightIcon className="ml-1.5 size-4" />
                </Button>
              ) : (
                <Button type="submit" disabled={isSubmitting || !selectedWorkspaceId}>
                  {isSubmitting ? "Creating..." : "Create automation"}
                </Button>
              )}
            </div>
          </form>
        </FormProvider>
      </div>
    </div>
  );
}
