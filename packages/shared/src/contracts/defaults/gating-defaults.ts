import { DECISION_OUTCOME } from "../../domain.js";
import type { GatingEngine } from "../gating.js";

export const defaultGatingEngine: GatingEngine = {
  shouldGateTool(tool) {
    return tool.requires_approval;
  },
  evaluateGating(input) {
    return {
      outcome: input.tool.requires_approval ? DECISION_OUTCOME.pending : DECISION_OUTCOME.approve,
      decision_reason: input.tool.requires_approval
        ? "OSS default gating requires manual approval for tools marked as requiring approval."
        : "OSS default gating auto-approved this tool.",
      trace: {
        matched_cel_rules: [],
        tool_auto_approve: !input.tool.requires_approval,
        policy_result: null,
      },
      context_snapshot: {
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
      },
    };
  },
};
