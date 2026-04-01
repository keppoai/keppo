import { useMemo } from "react";
import { resolveProviderAutomationTriggerDefinition } from "../../../../../packages/shared/src/providers/automation-trigger-registry.js";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAutomationModelClassMeta,
  getAutomationTriggerLabel,
  getNetworkAccessMeta,
  getProviderTriggerSubscriptionSummary,
  type AutomationConfigVersion,
} from "@/lib/automations-view-model";

const FIELD_LABELS: Partial<Record<keyof AutomationConfigVersion, string>> = {
  trigger_type: "Trigger type",
  schedule_cron: "Schedule",
  provider_trigger: "Provider trigger",
  provider_trigger_migration_state: "Trigger migration",
  model_class: "Model",
  network_access: "Network access",
  prompt: "Prompt",
  change_summary: "Change summary",
};

const stringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
};

const formatProviderTriggerFilter = (
  value: AutomationConfigVersion["provider_trigger"],
): string => {
  if (!value) {
    return "";
  }
  const definition = resolveProviderAutomationTriggerDefinition(
    value.provider_id,
    value.trigger_key,
  );
  if (!definition) {
    return stringify(value.filter);
  }
  const filter = value.filter ?? {};
  return definition.filterUi.fields
    .map((field) => {
      const rawValue = filter[field.key];
      if (
        rawValue === null ||
        rawValue === undefined ||
        rawValue === "" ||
        (Array.isArray(rawValue) && rawValue.length === 0)
      ) {
        return null;
      }
      const formattedValue =
        field.type === "boolean"
          ? rawValue === true
            ? "Yes"
            : "No"
          : Array.isArray(rawValue)
            ? rawValue.join(", ")
            : String(rawValue);
      return `${field.label}: ${formattedValue}`;
    })
    .filter((entry): entry is string => entry !== null)
    .join("\n");
};

const formatFieldValue = (field: keyof AutomationConfigVersion, value: unknown): string => {
  if (field === "provider_trigger" && value && typeof value === "object" && !Array.isArray(value)) {
    const config = {
      trigger_type: "event",
      provider_trigger: value,
      schedule_cron: null,
      provider_trigger_migration_state: null,
      event_provider: null,
      event_type: null,
      event_predicate: null,
      model_class: "auto",
      runner_type: "chatgpt_codex",
      ai_model_provider: "openai",
      ai_model_name: "",
      prompt: "",
      network_access: "mcp_only",
      created_by: "",
      created_at: "",
      change_summary: null,
      automation_id: "",
      id: "",
      version_number: 0,
    } as AutomationConfigVersion;
    return [
      getAutomationTriggerLabel(config),
      getProviderTriggerSubscriptionSummary(config),
      formatProviderTriggerFilter(config.provider_trigger),
    ]
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .join("\n");
  }
  if (field === "provider_trigger_migration_state") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return "";
    }
    const migration = value as AutomationConfigVersion["provider_trigger_migration_state"];
    if (!migration) {
      return "";
    }
    return [migration.status, migration.message]
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .join("\n");
  }
  if (
    field === "model_class" &&
    (value === "auto" || value === "frontier" || value === "balanced" || value === "value")
  ) {
    return getAutomationModelClassMeta(value).label;
  }
  if (field === "network_access" && (value === "mcp_only" || value === "mcp_and_web")) {
    return getNetworkAccessMeta(value).label;
  }
  return stringify(value);
};

type ConfigDiffProps = {
  current: AutomationConfigVersion | null;
  compareTo: AutomationConfigVersion | null;
};

export function ConfigDiff({ current, compareTo }: ConfigDiffProps) {
  const rows = useMemo(() => {
    if (!current || !compareTo) {
      return [] as Array<{
        field: keyof AutomationConfigVersion;
        from: string;
        to: string;
        changed: boolean;
      }>;
    }

    const fields: Array<keyof AutomationConfigVersion> = [
      "trigger_type",
      "schedule_cron",
      "provider_trigger",
      "provider_trigger_migration_state",
      "model_class",
      "network_access",
      "prompt",
      "change_summary",
    ];

    return fields.map((field) => {
      const from = formatFieldValue(field, compareTo[field]);
      const to = formatFieldValue(field, current[field]);
      return {
        field,
        from,
        to,
        changed: from !== to,
      };
    });
  }, [compareTo, current]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Config Diff</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Select two versions to compare.</p>
        ) : (
          rows.map((row) => (
            <div key={row.field} className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-2">
                <code className="text-xs">{FIELD_LABELS[row.field] ?? row.field}</code>
                {row.changed ? (
                  <Badge variant="secondary" className="text-xs">
                    changed
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    same
                  </Badge>
                )}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <pre className="bg-muted overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
                  {row.from || "(empty)"}
                </pre>
                <pre className="bg-muted overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
                  {row.to || "(empty)"}
                </pre>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
