import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { renderDashboardHook } from "@/test/render-dashboard";
import { useRules } from "./use-rules";

describe("useRules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips rules query and avoids workspace-scoped mutations without a workspace", async () => {
    const createCelRuleMutation = vi.fn(async () => undefined);
    const testCelRuleMutation = vi.fn(async () => true);
    const createPolicyMutation = vi.fn(async () => undefined);
    const runtime = createFakeDashboardRuntime({
      mutationHandlers: {
        "rules:createCelRule": createCelRuleMutation,
        "rules:testCelRule": testCelRuleMutation,
        "rules:createPolicy": createPolicyMutation,
      },
    });

    const { result } = renderDashboardHook(() => useRules(""), {
      runtime,
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.rules).toEqual([]);
    expect(result.current.policies).toEqual([]);

    await act(async () => {
      await result.current.createCelRule({
        name: "deny all",
        expression: "true",
        effect: "deny",
      });
      await result.current.createPolicy({ text: "always escalate" });
      expect(await result.current.testCelRule("true", { foo: "bar" })).toBe(false);
      await result.current.setAutoApproval("google.sendEmail", true);
      await result.current.setWorkspacePolicyMode("rules_first");
    });

    expect(createCelRuleMutation).not.toHaveBeenCalled();
    expect(createPolicyMutation).not.toHaveBeenCalled();
    expect(testCelRuleMutation).not.toHaveBeenCalled();
    expect(runtime.useQuery).toHaveBeenCalledWith(expect.anything(), "skip");
  });

  it("normalizes payloads and forwards canonical mutation arguments", async () => {
    const createCelRuleMutation = vi.fn(async () => undefined);
    const updateCelRuleMutation = vi.fn(async () => undefined);
    const deleteCelRuleMutation = vi.fn(async () => undefined);
    const testCelRuleMutation = vi.fn(async () => true);
    const createPolicyMutation = vi.fn(async () => undefined);
    const updatePolicyMutation = vi.fn(async () => undefined);
    const setAutoApprovalMutation = vi.fn(async () => undefined);
    const setWorkspacePolicyModeMutation = vi.fn(async () => undefined);
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "rules:getWorkspaceRules": () => ({
          workspace: {
            id: "ws_1",
            org_id: "org_1",
            slug: "workspace-1",
            name: "Workspace 1",
            status: "active",
            policy_mode: "rules_plus_agent",
            default_action_behavior: "require_approval",
            code_mode_enabled: false,
            created_at: "2026-03-08T00:00:00.000Z",
          },
          rules: [
            {
              id: "rule_1",
              workspace_id: "ws_1",
              name: "Rule 1",
              description: "",
              expression: "true",
              effect: "approve",
              enabled: true,
              created_by: "user_1",
              created_at: "2026-03-08T00:00:00.000Z",
            },
          ],
          policies: [
            {
              id: "policy_1",
              workspace_id: "ws_1",
              text: "Escalate all",
              enabled: true,
              created_by: "user_1",
              created_at: "2026-03-08T00:00:00.000Z",
            },
          ],
          auto_approvals: [
            {
              id: "auto_1",
              workspace_id: "ws_1",
              tool_name: "gmail.sendEmail",
              enabled: true,
              created_by: "user_1",
              created_at: "2026-03-08T00:00:00.000Z",
            },
          ],
          matches: [
            {
              id: "match_1",
              action_id: "action_1",
              cel_rule_id: "rule_1",
              effect: "approve",
              expression_snapshot: "true",
              context_snapshot: {},
              created_at: "2026-03-08T00:00:00.000Z",
            },
          ],
          decisions: [
            {
              id: "decision_1",
              action_id: "action_1",
              policies_evaluated: ["policy_1"],
              result: "approve",
              explanation: "Safe",
              confidence: 0.9,
              created_at: "2026-03-08T00:00:00.000Z",
            },
          ],
        }),
      },
      mutationHandlers: {
        "rules:createCelRule": createCelRuleMutation,
        "rules:updateCelRule": updateCelRuleMutation,
        "rules:deleteCelRule": deleteCelRuleMutation,
        "rules:testCelRule": testCelRuleMutation,
        "rules:createPolicy": createPolicyMutation,
        "rules:updatePolicy": updatePolicyMutation,
        "rules:setAutoApproval": setAutoApprovalMutation,
        "workspaces:setWorkspacePolicyMode": setWorkspacePolicyModeMutation,
      },
    });

    const { result } = renderDashboardHook(() => useRules("ws_1"), {
      runtime,
    });

    expect(result.current.policyMode).toBe("rules_plus_agent");
    expect(result.current.rules).toMatchObject([{ id: "rule_1", enabled: true }]);
    expect(result.current.policies).toMatchObject([{ id: "policy_1", enabled: true }]);
    expect(result.current.autoApprovals).toMatchObject([{ id: "auto_1", enabled: true }]);
    expect(result.current.celRuleMatches).toMatchObject([{ id: "match_1" }]);
    expect(result.current.policyDecisions).toMatchObject([{ id: "decision_1" }]);

    await act(async () => {
      await result.current.createCelRule({
        name: "Allow trusted refunds",
        expression: "request.amount < 100",
        effect: "approve",
      });
      await result.current.updateCelRule("rule_1", { enabled: false });
      await result.current.deleteCelRule("rule_1");
      await result.current.testCelRule("request.amount < 100", { request: { amount: 50 } });
      await result.current.createPolicy({ text: "Escalate VIP requests" });
      await result.current.setPolicyEnabled("policy_1", false);
      await result.current.updatePolicy("policy_1", { text: "Escalate all", enabled: true });
      await result.current.setAutoApproval("github.createIssue", true);
      await result.current.setWorkspacePolicyMode("rules_first");
    });

    expect(createCelRuleMutation).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      name: "Allow trusted refunds",
      description: "",
      expression: "request.amount < 100",
      effect: "approve",
      enabled: true,
    });
    expect(updateCelRuleMutation).toHaveBeenCalledWith({ ruleId: "rule_1", enabled: false });
    expect(deleteCelRuleMutation).toHaveBeenCalledWith({ ruleId: "rule_1" });
    expect(testCelRuleMutation).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      expression: "request.amount < 100",
      context: { request: { amount: 50 } },
    });
    expect(createPolicyMutation).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      text: "Escalate VIP requests",
    });
    expect(updatePolicyMutation).toHaveBeenNthCalledWith(1, {
      policyId: "policy_1",
      enabled: false,
    });
    expect(updatePolicyMutation).toHaveBeenNthCalledWith(2, {
      policyId: "policy_1",
      text: "Escalate all",
      enabled: true,
    });
    expect(setAutoApprovalMutation).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      tool_name: "github.createIssue",
      enabled: true,
    });
    expect(setWorkspacePolicyModeMutation).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      policy_mode: "rules_first",
    });
  });
});
