import { type FormEvent, useCallback, useState } from "react";
import { makeFunctionReference } from "convex/server";
import { parseWorkspaceRulesPayload } from "@/lib/boundary-contracts";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import type { CelRule, CelRuleMatch, Policy, PolicyDecision, Workspace } from "@/lib/types";

type CreateCelRuleInput = {
  name: string;
  description?: string;
  expression: string;
  effect: "approve" | "deny";
};

type CreatePolicyInput = {
  text: string;
};

type AutoApproval = {
  id: string;
  workspace_id: string;
  tool_name: string;
  enabled: boolean;
  created_by: string;
  created_at: string;
};

export function useRules(workspaceId: string) {
  const runtime = useDashboardRuntime();
  const rulesData = runtime.useQuery(
    makeFunctionReference<"query">("rules:getWorkspaceRules"),
    workspaceId ? { workspaceId } : "skip",
  );
  const parsedRulesData = rulesData === undefined ? null : parseWorkspaceRulesPayload(rulesData);
  const createCelRuleMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("rules:createCelRule"),
  );
  const updateCelRuleMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("rules:updateCelRule"),
  );
  const deleteCelRuleMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("rules:deleteCelRule"),
  );
  const testCelRuleMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("rules:testCelRule"),
  );
  const createPolicyMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("rules:createPolicy"),
  );
  const updatePolicyMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("rules:updatePolicy"),
  );
  const setAutoApprovalMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("rules:setAutoApproval"),
  );
  const setWorkspacePolicyModeMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("workspaces:setWorkspacePolicyMode"),
  );

  const rules: CelRule[] = parsedRulesData?.rules ?? [];
  const policies: Policy[] = parsedRulesData?.policies ?? [];
  const autoApprovals: AutoApproval[] = parsedRulesData?.auto_approvals ?? [];
  const policyMode: Workspace["policy_mode"] =
    parsedRulesData?.workspace.policy_mode ?? "manual_only";
  const celRuleMatches: CelRuleMatch[] = parsedRulesData?.matches ?? [];
  const policyDecisions: PolicyDecision[] = parsedRulesData?.decisions ?? [];

  const createCelRule = useCallback(
    async (input: CreateCelRuleInput): Promise<void> => {
      if (!workspaceId) return;
      await createCelRuleMutation({
        workspaceId,
        name: input.name,
        description: input.description ?? "",
        expression: input.expression,
        effect: input.effect,
        enabled: true,
      });
    },
    [workspaceId, createCelRuleMutation],
  );

  const setCelRuleEnabled = useCallback(
    async (ruleId: string, enabled: boolean): Promise<void> => {
      await updateCelRuleMutation({
        ruleId,
        enabled,
      });
    },
    [updateCelRuleMutation],
  );

  const updateCelRule = useCallback(
    async (
      ruleId: string,
      patch: Partial<Pick<CelRule, "name" | "description" | "expression" | "effect" | "enabled">>,
    ): Promise<void> => {
      await updateCelRuleMutation({
        ruleId,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.expression !== undefined ? { expression: patch.expression } : {}),
        ...(patch.effect !== undefined ? { effect: patch.effect } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      });
    },
    [updateCelRuleMutation],
  );

  const deleteCelRule = useCallback(
    async (ruleId: string): Promise<void> => {
      await deleteCelRuleMutation({ ruleId });
    },
    [deleteCelRuleMutation],
  );

  const testCelRule = useCallback(
    async (expression: string, context: Record<string, unknown>): Promise<boolean> => {
      if (!workspaceId) return false;
      return await testCelRuleMutation({
        workspaceId,
        expression,
        context,
      });
    },
    [workspaceId, testCelRuleMutation],
  );

  const createPolicy = useCallback(
    async (input: CreatePolicyInput): Promise<void> => {
      if (!workspaceId) return;
      await createPolicyMutation({
        workspaceId,
        text: input.text,
      });
    },
    [workspaceId, createPolicyMutation],
  );

  const setPolicyEnabled = useCallback(
    async (policyId: string, enabled: boolean): Promise<void> => {
      await updatePolicyMutation({
        policyId,
        enabled,
      });
    },
    [updatePolicyMutation],
  );

  const updatePolicy = useCallback(
    async (policyId: string, patch: Partial<Pick<Policy, "text" | "enabled">>): Promise<void> => {
      await updatePolicyMutation({
        policyId,
        ...(patch.text !== undefined ? { text: patch.text } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      });
    },
    [updatePolicyMutation],
  );

  const setWorkspacePolicyMode = useCallback(
    async (mode: Workspace["policy_mode"]): Promise<void> => {
      if (!workspaceId) return;
      await setWorkspacePolicyModeMutation({
        workspaceId,
        policy_mode: mode,
      });
    },
    [workspaceId, setWorkspacePolicyModeMutation],
  );

  const addCelRule = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      await createCelRule({
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
        expression: String(form.get("expression") ?? ""),
        effect: String(form.get("effect") ?? "deny") === "approve" ? "approve" : "deny",
      });
      formElement.reset();
    },
    [createCelRule],
  );

  const addPolicy = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      await createPolicy({ text: String(form.get("text") ?? "") });
      formElement.reset();
    },
    [createPolicy],
  );

  const setAutoApproval = useCallback(
    async (toolName: string, enabled: boolean): Promise<void> => {
      if (!workspaceId) return;
      await setAutoApprovalMutation({
        workspaceId,
        tool_name: toolName,
        enabled,
      });
    },
    [workspaceId, setAutoApprovalMutation],
  );

  const isLoading = Boolean(workspaceId) && rulesData === undefined;

  return {
    isLoading,
    rules,
    policies,
    autoApprovals,
    policyMode,
    celRuleMatches,
    policyDecisions,
    createCelRule,
    setCelRuleEnabled,
    updateCelRule,
    deleteCelRule,
    testCelRule,
    addCelRule,
    createPolicy,
    setPolicyEnabled,
    updatePolicy,
    addPolicy,
    setAutoApproval,
    setWorkspacePolicyMode,
  };
}
