import { useEffect, useMemo, useRef } from "react";
import { Controller, useFormContext } from "react-hook-form";
import {
  getProviderAutomationTriggers,
  resolveProviderAutomationTriggerDefinition,
} from "../../../../../packages/shared/src/providers/automation-trigger-registry.js";
import { AlertTriangleIcon, MailIcon, RadioTowerIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpText } from "@/components/ui/help-text";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { getProviderMeta } from "@/components/integrations/provider-icons";
import type { AutomationFormValues } from "./automation-form-schema";
import { getProviderTriggerFormDefaults } from "./automation-form-schema";

type ProviderTriggerFieldsProps = {
  availableProviderIds: string[];
  migrationState?: {
    status: "native" | "legacy_passthrough" | "migration_required";
    message: string;
    legacy_event_provider: string | null;
    legacy_event_type: string | null;
    legacy_event_predicate: string | null;
  } | null;
};

const toFieldErrorMessage = (value: unknown): string | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  return typeof (value as { message?: unknown }).message === "string"
    ? ((value as { message: string }).message ?? null)
    : null;
};

const describeDeliveryMode = (mode: "webhook" | "polling") => {
  return mode === "webhook" ? "Near real-time" : "Periodic check";
};

export function ProviderTriggerFields({
  availableProviderIds,
  migrationState,
}: ProviderTriggerFieldsProps) {
  const {
    control,
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<AutomationFormValues>();

  const providerId = watch("provider_trigger_provider_id");
  const triggerKey = watch("provider_trigger_key");
  const providerOptions = useMemo(
    () =>
      [...new Set([providerId, ...availableProviderIds])]
        .filter((candidate) => candidate.length > 0)
        .filter((candidate) => {
          return getProviderAutomationTriggers(candidate) !== null;
        }),
    [availableProviderIds, providerId],
  );
  const triggerOptions = useMemo(() => {
    const facet = getProviderAutomationTriggers(providerId);
    if (!facet) {
      return [];
    }
    return Object.values(facet.triggers);
  }, [providerId]);
  const selectedTrigger = useMemo(
    () => resolveProviderAutomationTriggerDefinition(providerId, triggerKey),
    [providerId, triggerKey],
  );
  const hasAppliedInitialProviderDefaults = useRef(false);

  useEffect(() => {
    if (hasAppliedInitialProviderDefaults.current || providerId || providerOptions.length === 0) {
      return;
    }
    hasAppliedInitialProviderDefaults.current = true;
    const nextProviderId = providerOptions[0] ?? "";
    const defaults = getProviderTriggerFormDefaults({
      providerId: nextProviderId,
      triggerKey:
        Object.keys(getProviderAutomationTriggers(nextProviderId)?.triggers ?? {})[0] ?? "",
    });
    setValue("provider_trigger_provider_id", defaults.provider_trigger_provider_id, {
      shouldDirty: false,
    });
    setValue("provider_trigger_key", defaults.provider_trigger_key, {
      shouldDirty: false,
    });
    setValue("provider_trigger_filter", defaults.provider_trigger_filter, {
      shouldDirty: false,
    });
  }, [providerId, providerOptions, setValue]);

  useEffect(() => {
    if (!providerId || triggerKey || triggerOptions.length === 0) {
      return;
    }
    const defaults = getProviderTriggerFormDefaults({
      providerId,
      triggerKey: triggerOptions[0]?.key ?? "",
    });
    setValue("provider_trigger_key", defaults.provider_trigger_key, {
      shouldDirty: false,
    });
    setValue("provider_trigger_filter", defaults.provider_trigger_filter, {
      shouldDirty: false,
    });
  }, [providerId, setValue, triggerKey, triggerOptions]);

  return (
    <div className="space-y-4 md:col-span-2">
      {migrationState && migrationState.status !== "native" ? (
        <Alert variant="warning">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>Legacy event trigger needs migration</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{migrationState.message}</p>
            {migrationState.legacy_event_provider && migrationState.legacy_event_type ? (
              <p className="text-xs">
                Previously configured as{" "}
                <code>
                  {migrationState.legacy_event_provider}.{migrationState.legacy_event_type}
                </code>
                .
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {providerOptions.length === 0 ? (
        <Alert>
          <MailIcon className="size-4" />
          <AlertTitle>No trigger-capable integrations are enabled</AlertTitle>
          <AlertDescription>
            Connect and enable a supported integration for this workspace to create provider-based
            automation triggers.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="provider-trigger-provider">Provider</Label>
          <Controller
            control={control}
            name="provider_trigger_provider_id"
            render={({ field }) => (
              <NativeSelect
                id="provider-trigger-provider"
                value={field.value}
                onChange={(event) => {
                  const nextProviderId = event.currentTarget.value;
                  const nextTriggerKey =
                    Object.keys(getProviderAutomationTriggers(nextProviderId)?.triggers ?? {})[0] ??
                    "";
                  const defaults = getProviderTriggerFormDefaults({
                    providerId: nextProviderId,
                    triggerKey: nextTriggerKey,
                  });
                  field.onChange(nextProviderId);
                  setValue("provider_trigger_key", defaults.provider_trigger_key, {
                    shouldDirty: true,
                  });
                  setValue("provider_trigger_filter", defaults.provider_trigger_filter, {
                    shouldDirty: true,
                  });
                }}
              >
                <option value="">Choose a provider</option>
                {providerOptions.map((option) => (
                  <option key={option} value={option}>
                    {getProviderMeta(option).label}
                  </option>
                ))}
              </NativeSelect>
            )}
          />
          <HelpText>Uses integrations already enabled for this workspace.</HelpText>
          {toFieldErrorMessage(errors.provider_trigger_provider_id) ? (
            <p className="text-destructive text-xs">
              {toFieldErrorMessage(errors.provider_trigger_provider_id)}
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <Label htmlFor="provider-trigger-key">Provider event</Label>
          <Controller
            control={control}
            name="provider_trigger_key"
            render={({ field }) => (
              <NativeSelect
                id="provider-trigger-key"
                value={field.value}
                onChange={(event) => {
                  const nextTriggerKey = event.currentTarget.value;
                  const defaults = getProviderTriggerFormDefaults({
                    providerId,
                    triggerKey: nextTriggerKey,
                  });
                  field.onChange(nextTriggerKey);
                  setValue("provider_trigger_filter", defaults.provider_trigger_filter, {
                    shouldDirty: true,
                  });
                }}
                disabled={!providerId}
              >
                <option value="">Choose a trigger</option>
                {triggerOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.display.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          />
          <HelpText>Provider filters stay aligned with incoming event data.</HelpText>
          {toFieldErrorMessage(errors.provider_trigger_key) ? (
            <p className="text-destructive text-xs">
              {toFieldErrorMessage(errors.provider_trigger_key)}
            </p>
          ) : null}
        </div>
      </div>

      {selectedTrigger ? (
        <div className="rounded-2xl border border-border/80 bg-muted/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <RadioTowerIcon className="size-4 text-muted-foreground" />
                <p className="font-medium">{selectedTrigger.display.label}</p>
              </div>
              <p className="text-sm text-muted-foreground">{selectedTrigger.display.description}</p>
              {selectedTrigger.filterUi.description ? (
                <HelpText>{selectedTrigger.filterUi.description}</HelpText>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="text-xs">
                {describeDeliveryMode(selectedTrigger.defaultDeliveryMode)}
              </Badge>
              {selectedTrigger.fallbackDeliveryMode ? (
                <Badge variant="outline" className="text-xs">
                  {`Falls back to ${describeDeliveryMode(selectedTrigger.fallbackDeliveryMode).toLowerCase()}`}
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {selectedTrigger.filterUi.fields.map((field) => {
              const fieldPath = `provider_trigger_filter.${field.key}` as const;
              const fieldError =
                errors.provider_trigger_filter &&
                typeof errors.provider_trigger_filter === "object" &&
                field.key in errors.provider_trigger_filter
                  ? toFieldErrorMessage(
                      (errors.provider_trigger_filter as Record<string, unknown>)[field.key],
                    )
                  : null;

              if (field.type === "boolean") {
                return (
                  <div
                    key={field.key}
                    className="flex items-start gap-3 rounded-xl border bg-background px-4 py-3 md:col-span-2"
                  >
                    <Controller
                      control={control}
                      name={fieldPath}
                      render={({ field: checkboxField }) => (
                        <Checkbox
                          checked={checkboxField.value === true}
                          onCheckedChange={(checked) => checkboxField.onChange(checked === true)}
                          aria-label={field.label}
                        />
                      )}
                    />
                    <div className="space-y-1">
                      <Label className="text-sm">{field.label}</Label>
                      {field.description ? <HelpText>{field.description}</HelpText> : null}
                      {fieldError ? <p className="text-destructive text-xs">{fieldError}</p> : null}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={field.key}
                  className={field.type === "csv" ? "space-y-1 md:col-span-2" : "space-y-1"}
                >
                  <Label htmlFor={`provider-trigger-filter-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`provider-trigger-filter-${field.key}`}
                    type={field.type === "email" ? "email" : "text"}
                    placeholder={field.placeholder}
                    {...register(fieldPath)}
                  />
                  {field.description ? <HelpText>{field.description}</HelpText> : null}
                  {fieldError ? <p className="text-destructive text-xs">{fieldError}</p> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
