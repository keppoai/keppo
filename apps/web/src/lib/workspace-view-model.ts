import type { Workspace } from "@/lib/types";

type BadgeVariant = "default" | "secondary" | "outline";

type PolicyModeMeta = {
  label: string;
  shortLabel: string;
  description: string;
  badgeVariant: BadgeVariant;
};

type DefaultActionBehaviorMeta = {
  label: string;
  description: string;
};

const POLICY_MODE_META: Record<Workspace["policy_mode"], PolicyModeMeta> = {
  manual_only: {
    label: "Manual review only",
    shortLabel: "Manual review",
    description: "Every action stops for a person before it can continue.",
    badgeVariant: "outline",
  },
  rules_first: {
    label: "Rules guide decisions",
    shortLabel: "Rules guided",
    description: "Rules evaluate first, but unmatched work still waits for a person.",
    badgeVariant: "secondary",
  },
  rules_plus_agent: {
    label: "Rules and policy agent",
    shortLabel: "Rules + policy",
    description: "Rules and the policy agent can move approved work forward automatically.",
    badgeVariant: "default",
  },
};

const DEFAULT_ACTION_BEHAVIOR_META: Record<
  Workspace["default_action_behavior"],
  DefaultActionBehaviorMeta
> = {
  require_approval: {
    label: "Require approval",
    description: "Safe default for a new workspace. Nothing proceeds without a human review.",
  },
  allow_if_rule_matches: {
    label: "Allow when a rule matches",
    description: "Matched rules can proceed, and everything else still pauses for review.",
  },
  auto_approve_all: {
    label: "Auto-approve all",
    description: "Use only when you trust every incoming action without review.",
  },
};

export function getWorkspacePolicyModeMeta(mode: Workspace["policy_mode"]): PolicyModeMeta {
  return POLICY_MODE_META[mode];
}

export function getDefaultActionBehaviorMeta(
  behavior: Workspace["default_action_behavior"],
): DefaultActionBehaviorMeta {
  return DEFAULT_ACTION_BEHAVIOR_META[behavior];
}

export function formatWorkspaceStatus(status: string): string {
  const normalized = status.trim().replace(/[_-]+/g, " ");
  if (!normalized) {
    return "Unknown";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
