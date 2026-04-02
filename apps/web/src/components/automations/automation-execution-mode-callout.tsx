import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  getAiModelProviderLabel,
  getAutomationExecutionModeMeta,
  type AiModelProvider,
  type AutomationExecutionState,
} from "@/lib/automations-view-model";

type AutomationExecutionModeCalloutProps = {
  provider: AiModelProvider;
  state: AutomationExecutionState;
  billingPath: string;
  settingsPath: string;
};

export function AutomationExecutionModeCallout({
  provider,
  state,
  billingPath,
  settingsPath,
}: AutomationExecutionModeCalloutProps) {
  const providerLabel = getAiModelProviderLabel(provider);
  const modeMeta = getAutomationExecutionModeMeta(state.mode);

  if (state.can_run) {
    return (
      <Alert variant="default">
        <AlertTitle>{modeMeta.label}</AlertTitle>
        <AlertDescription>
          {state.mode === "bundled"
            ? `${providerLabel} runs use bundled AI credits while this org has credits available.`
            : `${providerLabel} runs use an active org-managed provider API key.`}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="warning">
      <AlertTitle>
        {state.mode === "bundled"
          ? "AI credits needed to run automations"
          : "Setup needed to run automations"}
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          {state.mode === "bundled"
            ? "This automation cannot run yet. Purchase more AI credits in Billing or upgrade to a higher plan to restore bundled runtime."
            : `This automation cannot run yet. Add a ${providerLabel} API key to enable execution.`}
        </p>
        <div className="flex flex-wrap gap-3">
          {state.mode === "bundled" ? (
            <Link
              to={billingPath}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Open Billing
            </Link>
          ) : (
            <Link
              to={settingsPath}
              search={{ tab: "ai" }}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Open AI Configuration
            </Link>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
