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
  showUpgradeAction: boolean;
};

export function AutomationExecutionModeCallout({
  provider,
  state,
  billingPath,
  settingsPath,
  showUpgradeAction,
}: AutomationExecutionModeCalloutProps) {
  const providerLabel = getAiModelProviderLabel(provider);
  const modeMeta = getAutomationExecutionModeMeta(state.mode);

  if (state.can_run) {
    return (
      <Alert variant="default">
        <AlertTitle>{modeMeta.label}</AlertTitle>
        <AlertDescription>
          {state.mode === "bundled"
            ? `${providerLabel} runs use bundled runtime credits while this org has paid bundled credits available.`
            : `${providerLabel} runs use an active org-managed provider API key.`}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="warning">
      <AlertTitle>Setup needed to run automations</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          {showUpgradeAction
            ? `This automation cannot run yet. To enable execution, either upgrade your plan or add a ${providerLabel} API key.`
            : `This automation cannot run yet. Add a ${providerLabel} API key to enable execution.`}
        </p>
        <div className="flex flex-wrap gap-3">
          {showUpgradeAction ? (
            <Link
              to={billingPath}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Upgrade plan
            </Link>
          ) : null}
          <Link
            to={settingsPath}
            search={{ tab: "ai" }}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Add API key
          </Link>
        </div>
      </AlertDescription>
    </Alert>
  );
}
