import { resolveProviderAutomationTriggerDefinition } from "../../../../../packages/shared/src/providers/automation-trigger-registry.js";
import type { AutomationContextSnapshot } from "@keppo/shared/ai_generation";
import {
  getAutomationModelClassMeta,
  getNetworkAccessMeta,
  type Automation,
  type AutomationConfigVersion,
} from "@/lib/automations-view-model";
import { humanizeCron } from "@/lib/cron-humanizer";
import { getProviderMeta } from "@/components/integrations/provider-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AutomationEditDraft = AutomationContextSnapshot;
type AutomationEditDiffRow = {
  label: string;
  before: string;
  after: string;
  stacked?: boolean;
};
type AutomationEditDiffSection = {
  key: string;
  title: string;
  rows: AutomationEditDiffRow[];
};

const formatTrigger = (draft: {
  trigger_type: "schedule" | "event" | "manual";
  schedule_cron?: string | null;
  event_provider?: string | null;
  event_type?: string | null;
}): string => {
  if (draft.trigger_type === "schedule" && draft.schedule_cron) {
    return humanizeCron(draft.schedule_cron);
  }
  if (draft.trigger_type === "event" && draft.event_provider && draft.event_type) {
    const trigger = resolveProviderAutomationTriggerDefinition(
      draft.event_provider,
      draft.event_type,
    );
    if (trigger) {
      return `${getProviderMeta(draft.event_provider).label} ${trigger.display.label}`;
    }
    return `${draft.event_provider} ${draft.event_type}`;
  }
  return "Manual run";
};

const stringify = (value: string): string => value.trim() || "(empty)";

const resolveConfigTriggerSnapshot = (config: AutomationConfigVersion) => ({
  trigger_type: config.trigger_type,
  schedule_cron: config.schedule_cron,
  event_provider: config.provider_trigger?.provider_id ?? config.event_provider,
  event_type: config.provider_trigger?.trigger_key ?? config.event_type,
});

export const buildAutomationEditDiffSections = (
  automation: Automation,
  config: AutomationConfigVersion,
  draft: AutomationEditDraft,
): AutomationEditDiffSection[] =>
  [
    {
      key: "workflow",
      title: "Workflow",
      rows: [
        { label: "Name", before: stringify(automation.name), after: stringify(draft.name) },
        {
          label: "Description",
          before: stringify(automation.description),
          after: stringify(draft.description),
        },
      ],
    },
    {
      key: "trigger",
      title: "Trigger",
      rows: [
        {
          label: "Trigger",
          before: formatTrigger(resolveConfigTriggerSnapshot(config)),
          after: formatTrigger(draft),
        },
      ],
    },
    {
      key: "runtime",
      title: "Runtime",
      rows: [
        {
          label: "Model",
          before: getAutomationModelClassMeta(config.model_class).label,
          after: getAutomationModelClassMeta(draft.model_class).label,
        },
        {
          label: "Network access",
          before: getNetworkAccessMeta(config.network_access).label,
          after: getNetworkAccessMeta(draft.network_access).label,
        },
      ],
    },
    {
      key: "instructions",
      title: "AI instructions",
      rows: [
        {
          label: "Prompt",
          before: stringify(config.prompt),
          after: stringify(draft.prompt),
          stacked: true,
        },
      ],
    },
    {
      key: "diagram",
      title: "Diagram",
      rows: [
        {
          label: "Diagram source",
          before: stringify(automation.mermaid_content ?? ""),
          after: stringify(draft.mermaid_content),
          stacked: true,
        },
      ],
    },
  ]
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => row.before !== row.after),
    }))
    .filter((section) => section.rows.length > 0);

export function AutomationEditDiff({
  automation,
  config,
  draft,
}: {
  automation: Automation;
  config: AutomationConfigVersion;
  draft: AutomationEditDraft;
}) {
  const sections = buildAutomationEditDiffSections(automation, config, draft);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review changes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes were drafted.</p>
        ) : (
          sections.map((section) => (
            <div key={section.key} className="space-y-3 rounded-xl border p-4">
              <div className="flex items-center gap-2">
                <p className="font-medium">{section.title}</p>
                <Badge variant="secondary">{section.rows.length} changed</Badge>
              </div>
              {section.rows.map((row) => (
                <div
                  key={row.label}
                  className={`grid gap-3 ${row.stacked ? "grid-cols-1" : "lg:grid-cols-2"}`}
                >
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Current {row.label}
                    </p>
                    <pre className="bg-muted overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
                      {row.before}
                    </pre>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Drafted {row.label}
                    </p>
                    <pre className="bg-primary/5 overflow-auto rounded-lg border border-primary/15 p-3 text-xs whitespace-pre-wrap">
                      {row.after}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
