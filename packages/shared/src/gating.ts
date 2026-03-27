import { evaluateCel } from "./cel.js";
import { evaluatePolicyAutomation } from "./policy.js";
import {
  APPROVAL_DECIDER_TYPE,
  DEFAULT_ACTION_BEHAVIOR,
  DECISION_OUTCOME,
  POLICY_MODE,
  POLICY_DECISION_RESULT,
  RULE_EFFECT,
  assertNever,
  type ApprovalDeciderType,
  type DecisionOutcome,
  type PolicyDecisionResult,
  type RuleEffect,
} from "./domain.js";
import type { ActionContext, CelRule, Policy, ToolAutoApproval, Workspace } from "./types.js";
import type { ToolDefinition } from "./tooling.js";

export interface GatingInput {
  workspace: Workspace;
  tool: ToolDefinition;
  payloadPreview: Record<string, unknown>;
  celRules: CelRule[];
  autoApprovals: ToolAutoApproval[];
  policies: Policy[];
  now: string;
}

export interface GatingDecision {
  outcome: DecisionOutcome;
  decider_type?: ApprovalDeciderType;
  decision_reason: string;
  matched_rule_id?: string;
  policy_decision?: {
    result: PolicyDecisionResult;
    explanation: string;
    confidence: number;
  };
  trace: {
    matched_cel_rules: Array<{
      id: string;
      name: string;
      effect: RuleEffect;
      expression: string;
    }>;
    tool_auto_approve: boolean;
    policy_result: PolicyDecisionResult | null;
  };
  context_snapshot: ActionContext;
}

export const shouldGateTool = (tool: ToolDefinition): boolean =>
  tool.capability === "write" && tool.requires_approval;

const buildContext = (input: GatingInput): ActionContext => ({
  tool: {
    name: input.tool.name,
    capability: input.tool.capability,
    risk_level: input.tool.risk_level,
  },
  action: {
    type: input.tool.action_type,
    preview: input.payloadPreview,
  },
  workspace: {
    id: input.workspace.id,
    name: input.workspace.name,
    policy_mode: input.workspace.policy_mode,
    default_action_behavior: input.workspace.default_action_behavior,
  },
  now: input.now,
});

export const evaluateGating = (input: GatingInput): GatingDecision => {
  const context = buildContext(input);
  const enabledRules = input.celRules.filter((rule) => rule.enabled);
  const matched: Array<{
    id: string;
    name: string;
    effect: RuleEffect;
    expression: string;
  }> = [];

  for (const rule of enabledRules.filter((candidate) => candidate.effect === RULE_EFFECT.deny)) {
    if (evaluateCel(rule.expression, context as unknown as Record<string, unknown>)) {
      matched.push({
        id: rule.id,
        name: rule.name,
        effect: rule.effect,
        expression: rule.expression,
      });
      return {
        outcome: DECISION_OUTCOME.deny,
        decider_type: APPROVAL_DECIDER_TYPE.celRule,
        matched_rule_id: rule.id,
        decision_reason: `Rejected by CEL deny rule: ${rule.name}`,
        trace: {
          matched_cel_rules: matched,
          tool_auto_approve: false,
          policy_result: null,
        },
        context_snapshot: context,
      };
    }
  }

  for (const rule of enabledRules.filter((candidate) => candidate.effect === RULE_EFFECT.approve)) {
    if (evaluateCel(rule.expression, context as unknown as Record<string, unknown>)) {
      matched.push({
        id: rule.id,
        name: rule.name,
        effect: rule.effect,
        expression: rule.expression,
      });
      return {
        outcome: DECISION_OUTCOME.approve,
        decider_type: APPROVAL_DECIDER_TYPE.celRule,
        matched_rule_id: rule.id,
        decision_reason: `Approved by CEL rule: ${rule.name}`,
        trace: {
          matched_cel_rules: matched,
          tool_auto_approve: false,
          policy_result: null,
        },
        context_snapshot: context,
      };
    }
  }

  const autoApproved = input.autoApprovals.some(
    (entry) => entry.enabled && entry.tool_name === input.tool.name,
  );
  if (autoApproved) {
    return {
      outcome: DECISION_OUTCOME.approve,
      decider_type: APPROVAL_DECIDER_TYPE.toolAutoApprove,
      decision_reason: `Tool ${input.tool.name} is auto-approved for this workspace.`,
      trace: {
        matched_cel_rules: matched,
        tool_auto_approve: true,
        policy_result: null,
      },
      context_snapshot: context,
    };
  }

  if (input.workspace.default_action_behavior === DEFAULT_ACTION_BEHAVIOR.autoApproveAll) {
    return {
      outcome: DECISION_OUTCOME.approve,
      decider_type: APPROVAL_DECIDER_TYPE.defaultAutoApprove,
      decision_reason: "Workspace default action behavior is auto_approve_all.",
      trace: {
        matched_cel_rules: matched,
        tool_auto_approve: false,
        policy_result: null,
      },
      context_snapshot: context,
    };
  }

  const activePolicies = input.policies.filter((entry) => entry.enabled).map((entry) => entry.text);
  if (activePolicies.length > 0 && input.workspace.policy_mode !== POLICY_MODE.manualOnly) {
    const policyResult = evaluatePolicyAutomation(
      activePolicies,
      input.tool.action_type,
      input.payloadPreview,
    );

    switch (input.workspace.policy_mode) {
      case POLICY_MODE.rulesPlusAgent:
        if (policyResult.result === POLICY_DECISION_RESULT.approve) {
          return {
            outcome: DECISION_OUTCOME.approve,
            decider_type: APPROVAL_DECIDER_TYPE.policyAgent,
            decision_reason: policyResult.explanation,
            policy_decision: policyResult,
            trace: {
              matched_cel_rules: matched,
              tool_auto_approve: false,
              policy_result: policyResult.result,
            },
            context_snapshot: context,
          };
        }
        if (policyResult.result === POLICY_DECISION_RESULT.deny) {
          return {
            outcome: DECISION_OUTCOME.deny,
            decider_type: APPROVAL_DECIDER_TYPE.policyAgent,
            decision_reason: policyResult.explanation,
            policy_decision: policyResult,
            trace: {
              matched_cel_rules: matched,
              tool_auto_approve: false,
              policy_result: policyResult.result,
            },
            context_snapshot: context,
          };
        }
        return {
          outcome: DECISION_OUTCOME.pending,
          decider_type: APPROVAL_DECIDER_TYPE.human,
          decision_reason: policyResult.explanation,
          policy_decision: policyResult,
          trace: {
            matched_cel_rules: matched,
            tool_auto_approve: false,
            policy_result: policyResult.result,
          },
          context_snapshot: context,
        };
      case POLICY_MODE.rulesFirst:
        return {
          outcome: DECISION_OUTCOME.pending,
          decider_type: APPROVAL_DECIDER_TYPE.human,
          decision_reason: `Policy advisory: ${policyResult.explanation}`,
          policy_decision: policyResult,
          trace: {
            matched_cel_rules: matched,
            tool_auto_approve: false,
            policy_result: policyResult.result,
          },
          context_snapshot: context,
        };
      default:
        return assertNever(input.workspace.policy_mode, "workspace policy mode");
    }
  }

  return {
    outcome: DECISION_OUTCOME.pending,
    decider_type: APPROVAL_DECIDER_TYPE.human,
    decision_reason: "No auto-approve rule matched. Manual approval is required.",
    trace: {
      matched_cel_rules: matched,
      tool_auto_approve: false,
      policy_result: null,
    },
    context_snapshot: context,
  };
};
