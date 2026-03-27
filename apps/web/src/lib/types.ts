import type {
  BoundaryIntegrationDetail as SharedIntegrationDetail,
  BoundaryProviderCatalogEntry as SharedProviderCatalogEntry,
  BoundaryWorkspaceIntegration as SharedWorkspaceIntegration,
  ConvexAction as SharedAction,
  ConvexAuditEvent as SharedAuditEvent,
  ConvexNullableActionDetail as SharedActionDetail,
  ConvexWorkspaceContext as SharedWorkspace,
} from "@keppo/shared/providers/boundaries/types";

export type Workspace = SharedWorkspace & { slug: string };

export type Role = "owner" | "admin" | "approver" | "viewer";

export type Action = SharedAction;
export type ActionStatus = Action["status"];

export type AuthSession = {
  authenticated: boolean;
  user?: {
    id?: string;
    email?: string;
    [key: string]: unknown;
  };
  reason?: string;
  organizationId?: string;
  orgSlug?: string;
  role?: Role;
  organization_id?: string;
  [key: string]: unknown;
};

export type ProviderCatalogEntry = SharedProviderCatalogEntry;

export type IntegrationDetail = SharedIntegrationDetail;

export type WorkspaceIntegration = SharedWorkspaceIntegration;

export type CelRule = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  expression: string;
  effect: "approve" | "deny";
  enabled: boolean;
  created_by: string;
  created_at: string;
};

export type Policy = {
  id: string;
  workspace_id: string;
  text: string;
  enabled: boolean;
  created_by: string;
  created_at: string;
};

export type CelRuleMatch = {
  id: string;
  action_id: string;
  cel_rule_id: string;
  effect: "approve" | "deny";
  expression_snapshot: string;
  context_snapshot: Record<string, unknown>;
  created_at: string;
};

export type PolicyDecision = {
  id: string;
  action_id: string;
  policies_evaluated: string[];
  result: "approve" | "deny" | "escalate";
  explanation: string;
  confidence: number | null;
  created_at: string;
};

export type Approval = {
  id: string;
  action_id: string;
  decider_type: string;
  decision: string;
  reason: string;
  rule_id: string | null;
  confidence: number | null;
  created_at: string;
};

export type ActionDetailResponse = NonNullable<SharedActionDetail>;

export type AuditEvent = SharedAuditEvent;
