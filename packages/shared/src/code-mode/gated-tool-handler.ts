import { DECISION_OUTCOME, type DecisionOutcome } from "../domain.js";

export type GatingDecision = {
  outcome: DecisionOutcome;
  reason?: string;
};

export class CodeModeGatingError extends Error {
  readonly toolName: string;
  readonly decision: GatingDecision;

  constructor(toolName: string, decision: GatingDecision) {
    super(
      decision.outcome === DECISION_OUTCOME.pending
        ? `Tool ${toolName} requires approval before execution.`
        : `Tool ${toolName} was blocked: ${decision.reason ?? "Denied by policy."}`,
    );
    this.name = "CodeModeGatingError";
    this.toolName = toolName;
    this.decision = decision;
  }
}

const toSafeRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

export const createGatedToolHandler = (params: {
  preApprovedTools: Set<string>;
  gatingFn: (toolName: string, input: Record<string, unknown>) => Promise<GatingDecision>;
  executeFn: (toolName: string, input: Record<string, unknown>) => Promise<unknown>;
  onUnexpectedTool?: (toolName: string) => void;
}): ((toolName: string, args: Record<string, unknown>) => Promise<unknown>) => {
  return async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
    const normalizedArgs = toSafeRecord(args);

    if (params.preApprovedTools.has(toolName)) {
      return params.executeFn(toolName, normalizedArgs);
    }

    if (params.onUnexpectedTool) {
      params.onUnexpectedTool(toolName);
    }

    const decision = await params.gatingFn(toolName, normalizedArgs);
    if (decision.outcome !== DECISION_OUTCOME.approve) {
      throw new CodeModeGatingError(toolName, decision);
    }

    params.preApprovedTools.add(toolName);
    return params.executeFn(toolName, normalizedArgs);
  };
};
