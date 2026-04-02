export type WorkspaceReadinessSnapshot = {
  has_connected_integration: boolean;
  has_enabled_workspace_integration: boolean;
  has_ai_key: boolean;
  ai_access_mode?: "bundled" | "self_managed";
  has_automation: boolean;
  has_first_action: boolean;
};

export type WorkspaceReadinessStep = {
  id: "connect-provider" | "configure-ai-key" | "create-automation" | "run-first-automation";
  label: string;
  description: string;
  completed: boolean;
  href: string;
};

const EMPTY_READINESS: WorkspaceReadinessSnapshot = {
  has_connected_integration: false,
  has_enabled_workspace_integration: false,
  has_ai_key: false,
  ai_access_mode: "self_managed",
  has_automation: false,
  has_first_action: false,
};

export function resolveWorkspaceReadiness(
  value: WorkspaceReadinessSnapshot | null | undefined,
): WorkspaceReadinessSnapshot {
  return value ?? EMPTY_READINESS;
}

export function buildWorkspaceReadinessSteps(
  value: WorkspaceReadinessSnapshot | null | undefined,
): WorkspaceReadinessStep[] {
  const readiness = resolveWorkspaceReadiness(value);

  return [
    {
      id: "connect-provider",
      label: "Connect a provider",
      description:
        "Connect and enable one real provider so this workspace can use live data instead of placeholders.",
      completed: readiness.has_connected_integration && readiness.has_enabled_workspace_integration,
      href: "/integrations",
    },
    {
      id: "configure-ai-key",
      label: "Confirm AI access",
      description:
        readiness.ai_access_mode === "bundled"
          ? "Generated automations stay blocked until the organization has bundled runtime access."
          : "Generated automations stay blocked until the organization has an active self-managed AI key.",
      completed: readiness.has_ai_key,
      href: "/settings",
    },
    {
      id: "create-automation",
      label: "Create your first automation",
      description: "Draft one focused automation target so the workspace can do useful work.",
      completed: readiness.has_automation,
      href: "/automations",
    },
    {
      id: "run-first-automation",
      label: "Run your first automation",
      description: "Trigger one real workflow to prove approvals, runs, and logs are wired.",
      completed: readiness.has_first_action,
      href: "/automations",
    },
  ];
}
