import {
  AUTOMATION_RUN_STATUSES,
  AUTOMATION_RUN_STATUS,
  RUN_STATUS,
  assertNever,
  type AutomationRunStatus,
  type RunStatus,
} from "./domain_constants";

type AutomationRunStatusSource = {
  status: RunStatus;
  metadata?: Record<string, unknown> | null;
  error_message?: string | null;
};

const automationRunStatusSet = new Set<AutomationRunStatus>(AUTOMATION_RUN_STATUSES);

export const normalizeAutomationRunStatus = (
  run: AutomationRunStatusSource,
): AutomationRunStatus => {
  if (run.status === RUN_STATUS.timedOut) {
    return AUTOMATION_RUN_STATUS.timedOut;
  }
  const metadataStatus = run.metadata?.automation_run_status;
  if (
    typeof metadataStatus === "string" &&
    automationRunStatusSet.has(metadataStatus as AutomationRunStatus)
  ) {
    return metadataStatus as AutomationRunStatus;
  }

  switch (run.status) {
    case RUN_STATUS.active:
      return AUTOMATION_RUN_STATUS.running;
    case RUN_STATUS.ended:
      if (run.error_message && run.error_message.trim().length > 0) {
        return AUTOMATION_RUN_STATUS.failed;
      }
      return AUTOMATION_RUN_STATUS.succeeded;
    default:
      return assertNever(run.status, "automation run status");
  }
};

export const toRunStatus = (status: AutomationRunStatus): RunStatus => {
  switch (status) {
    case AUTOMATION_RUN_STATUS.pending:
    case AUTOMATION_RUN_STATUS.running:
      return RUN_STATUS.active;
    case AUTOMATION_RUN_STATUS.succeeded:
    case AUTOMATION_RUN_STATUS.failed:
    case AUTOMATION_RUN_STATUS.cancelled:
      return RUN_STATUS.ended;
    case AUTOMATION_RUN_STATUS.timedOut:
      return RUN_STATUS.timedOut;
    default:
      return assertNever(status, "automation run lifecycle status");
  }
};
