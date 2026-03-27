import { describe, expect, it } from "vitest";
import { evaluateGating, shouldGateTool } from "./gating.js";
import { toolMap } from "./tooling.js";
import type { Workspace } from "./types.js";

const workspace: Workspace = {
  id: "workspace_demo",
  org_id: "org_demo",
  name: "demo",
  status: "active",
  policy_mode: "rules_plus_agent",
  default_action_behavior: "require_approval",
  code_mode_enabled: true,
  created_at: new Date().toISOString(),
};

describe("evaluateGating", () => {
  it("lets CEL deny rules override auto-approval for approval-required tools", () => {
    const tool = toolMap.get("stripe.issueRefund");
    expect(tool).toBeTruthy();

    const result = evaluateGating({
      workspace,
      tool: tool!,
      payloadPreview: { amount: 100 },
      celRules: [
        {
          id: "rule1",
          workspace_id: workspace.id,
          name: "deny refunds",
          description: "",
          expression: 'tool.name == "stripe.issueRefund"',
          effect: "deny",
          enabled: true,
          created_by: "usr_demo",
          created_at: new Date().toISOString(),
        },
      ],
      autoApprovals: [
        {
          id: "aa1",
          workspace_id: workspace.id,
          tool_name: "stripe.issueRefund",
          enabled: true,
          created_by: "usr_demo",
          created_at: new Date().toISOString(),
        },
      ],
      policies: [],
      now: new Date().toISOString(),
    });

    expect(result.outcome).toBe("deny");
    expect(result.decider_type).toBe("cel_rule");
    expect(result.decision_reason).toContain("deny refunds");
    expect(result.trace.matched_cel_rules).toHaveLength(1);
  });

  it("leaves non-gated tools out of the approval pipeline", () => {
    const tool = toolMap.get("gmail.listUnread");
    expect(tool).toBeTruthy();
    expect(shouldGateTool(tool!)).toBe(false);

    const result = evaluateGating({
      workspace,
      tool: tool!,
      payloadPreview: { limit: 1 },
      celRules: [],
      autoApprovals: [],
      policies: [],
      now: new Date().toISOString(),
    });

    expect(result.outcome).toBe("pending");
    expect(result.trace.tool_auto_approve).toBe(false);
  });

  it("denies in rules_plus_agent when policy finds external recipients", () => {
    const tool = toolMap.get("gmail.sendEmail");
    expect(tool).toBeTruthy();

    const result = evaluateGating({
      workspace,
      tool: tool!,
      payloadPreview: {
        recipients: ["employee@corp.com", "attacker@gmail.com"],
        subject: "hello",
      },
      celRules: [],
      autoApprovals: [],
      policies: [
        {
          id: "policy1",
          workspace_id: workspace.id,
          text: "Never email people outside our corp.com domain",
          enabled: true,
          created_by: "usr_demo",
          created_at: new Date().toISOString(),
        },
      ],
      now: new Date().toISOString(),
    });

    expect(result.outcome).toBe("deny");
    expect(result.decider_type).toBe("policy_agent");
    expect(result.policy_decision?.result).toBe("deny");
  });

  it("auto-approves when a CEL approve rule matches in rules-first mode", () => {
    const tool = toolMap.get("gmail.sendEmail");
    expect(tool).toBeTruthy();

    const result = evaluateGating({
      workspace: {
        ...workspace,
        policy_mode: "rules_first" as const,
      },
      tool: tool!,
      payloadPreview: {
        to: ["customer@example.com"],
        subject: "hello",
      },
      celRules: [
        {
          id: "rule2",
          workspace_id: workspace.id,
          name: "approve gmail",
          description: "",
          expression: 'tool.name == "gmail.sendEmail"',
          effect: "approve",
          enabled: true,
          created_by: "usr_demo",
          created_at: new Date().toISOString(),
        },
      ],
      autoApprovals: [],
      policies: [],
      now: new Date().toISOString(),
    });

    expect(result.outcome).toBe("approve");
    expect(result.decider_type).toBe("cel_rule");
    expect(result.decision_reason).toContain("approve gmail");
    expect(result.trace.matched_cel_rules[0]?.effect).toBe("approve");
  });
});
