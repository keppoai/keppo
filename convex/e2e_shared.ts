import { evaluate, parse } from "cel-js";
import { components } from "./_generated/api";
import { nowIso } from "./_auth";
import { auditActionIdField } from "./audit_shared";
import type { Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type {
  ActionRiskLevel,
  AuditActorType,
  AuditEventType,
  DefaultActionBehavior as DomainDefaultActionBehavior,
} from "./domain_constants";

export type RiskLevel = ActionRiskLevel;
export type DefaultActionBehavior = DomainDefaultActionBehavior;

const isLoopbackConvexUrl = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
};

export const isLocalOrTestE2ERuntime = (): boolean => {
  const explicitRuntimeSignal = (process.env.KEPPO_E2E_RUNTIME_SIGNAL ?? "").trim().toLowerCase();
  if (explicitRuntimeSignal === "local" || explicitRuntimeSignal === "test") {
    return true;
  }
  const mode = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (mode === "development" || mode === "test") {
    return true;
  }
  const deployment = (process.env.CONVEX_DEPLOYMENT ?? "").trim().toLowerCase();
  if (deployment.startsWith("local:")) {
    return true;
  }
  return (
    isLoopbackConvexUrl(process.env.CONVEX_SITE_URL) ||
    isLoopbackConvexUrl(process.env.CONVEX_CLOUD_URL) ||
    isLoopbackConvexUrl(process.env.CONVEX_URL) ||
    isLoopbackConvexUrl(process.env.CONVEX_SELF_HOSTED_URL)
  );
};

export const requireE2EIdentity = async (_ctx: MutationCtx | QueryCtx): Promise<void> => {
  if (process.env.KEPPO_E2E_MODE !== "true") {
    throw new Error("E2E_DISABLED: Set KEPPO_E2E_MODE=true to enable e2e helpers.");
  }
  if (isLocalOrTestE2ERuntime()) {
    return;
  }
  throw new Error(
    "E2E_DISABLED: E2E helpers require a local/test Convex runtime in addition to KEPPO_E2E_MODE=true.",
  );
};

export const evaluateCel = (expression: string, context: Record<string, unknown>): boolean => {
  const parsed = parse(expression);
  if (!parsed.isSuccess) {
    throw new Error(parsed.errors?.[0] ?? "Invalid CEL expression");
  }

  const normalizedContext = {
    ...context,
    now: {
      getHours: () => new Date(String(context.now ?? nowIso())).getUTCHours(),
      iso: context.now,
    },
  };

  return Boolean(evaluate(parsed.cst, normalizedContext));
};

export const classifyAction = (
  toolName: string,
): {
  actionType: string;
  riskLevel: RiskLevel;
} => {
  if (toolName.includes("refund")) {
    return { actionType: "refund", riskLevel: "high" };
  }
  if (toolName.includes("send") || toolName.includes("post")) {
    return { actionType: "send_email", riskLevel: "medium" };
  }
  return { actionType: "write", riskLevel: "low" };
};

export const insertAudit = async (
  ctx: MutationCtx,
  orgId: string,
  actorType: AuditActorType,
  actorId: string,
  eventType: AuditEventType,
  payload: Record<string, unknown>,
): Promise<void> => {
  await ctx.db.insert("audit_events", {
    id: `audit_${Math.random().toString(16).slice(2, 12)}`,
    org_id: orgId,
    ...auditActionIdField(payload),
    actor_type: actorType,
    actor_id: actorId,
    event_type: eventType,
    payload,
    created_at: nowIso(),
  });
};

const escapeRegex = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const matchesNamespaceString = (value: string, namespace: string): boolean => {
  if (value === namespace) {
    return true;
  }
  const pattern = new RegExp(`(^|[^a-zA-Z0-9])${escapeRegex(namespace)}([^a-zA-Z0-9]|$)`);
  return pattern.test(value);
};

export const rowContainsNamespace = (value: unknown, namespace: string): boolean => {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return matchesNamespaceString(value, namespace);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => rowContainsNamespace(entry, namespace));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      rowContainsNamespace(entry, namespace),
    );
  }
  return false;
};

/** Every `defineTable` name in `convex/schema.ts` (dependency-ish delete order). */
export const e2eResetTables = [
  "provider_metrics",
  "audit_events",
  "abuse_flags",
  "org_suspensions",
  "credential_auth_failures",
  "credential_usage_observations",
  "policy_decisions",
  "policies",
  "tool_auto_approvals",
  "cel_rule_matches",
  "cel_rules",
  "approvals",
  "actions",
  "tool_calls",
  "automation_run_logs",
  "automation_runs",
  "automation_trigger_events",
  "automation_config_versions",
  "automations",
  "org_ai_keys",
  "ai_credit_purchases",
  "ai_credits",
  "automation_run_topup_purchases",
  "automation_run_topups",
  "integration_credentials",
  "api_dedupe_keys",
  "rate_limits",
  "integration_accounts",
  "integrations",
  "workspace_integrations",
  "custom_mcp_tools",
  "workspace_custom_servers",
  "custom_mcp_servers",
  "invites",
  "e2e_invite_tokens",
  "code_mode_tool_index",
  "feature_flags",
  "cron_heartbeats",
  "dead_letter_queue",
  "dogfood_orgs",
  "workspace_credentials",
  "workspaces",
  "sensitive_blobs",
  "notification_events",
  "notification_endpoints",
  "poll_trackers",
  "retention_policies",
  "invite_code_redemptions",
  "invite_codes",
  "usage_meters",
  "subscriptions",
] as const satisfies readonly TableNames[];

export type E2EResetTable = (typeof e2eResetTables)[number];

export const e2eResetAuthModels = [
  "session",
  "account",
  "verification",
  "member",
  "invitation",
  "organization",
  "user",
  "jwks",
  "rateLimit",
  "ratelimit",
] as const;

export type E2EResetAuthModel = (typeof e2eResetAuthModels)[number];

type _MissingFromE2eReset = Exclude<TableNames, E2EResetTable>;
type _ExtraInE2eReset = Exclude<E2EResetTable, TableNames>;
const _e2eResetTablesMatchSchema: [_MissingFromE2eReset, _ExtraInE2eReset] extends [never, never]
  ? true
  : false = true;

// Namespace reset scans whole tables for namespace markers. Keep pages small enough
// that a single mutation stays comfortably under Convex's 1s local budget.
const E2E_RESET_PAGE_SIZE = 100;

export const buildResetState = (params: {
  done: boolean;
  tableIndex: number;
  cursor: string | null;
  deleted: number;
}) => ({
  done: params.done,
  tableIndex: params.tableIndex,
  cursor: params.cursor,
  deleted: params.deleted,
});

export const queryResetPage = async (
  ctx: MutationCtx,
  table: E2EResetTable,
  cursor: string | null,
): Promise<{
  page: Array<{ _id: Id<E2EResetTable> } & Record<string, unknown>>;
  continueCursor: string;
  isDone: boolean;
}> => {
  const result = await ctx.db.query(table).paginate({
    numItems: E2E_RESET_PAGE_SIZE,
    cursor,
  });
  return {
    page: result.page as Array<{ _id: Id<E2EResetTable> } & Record<string, unknown>>,
    continueCursor: result.continueCursor,
    isDone: result.isDone,
  };
};

export const takeResetBatch = async (
  ctx: MutationCtx,
  table: E2EResetTable,
): Promise<Array<{ _id: Id<E2EResetTable> } & Record<string, unknown>>> => {
  const rows = await ctx.db.query(table).take(E2E_RESET_PAGE_SIZE);
  return rows as Array<{ _id: Id<E2EResetTable> } & Record<string, unknown>>;
};

export const storageIdsForResetRow = (
  table: E2EResetTable,
  row: { _id: Id<E2EResetTable> } & Record<string, unknown>,
): Id<"_storage">[] => {
  if (table !== "automation_runs") {
    return [];
  }
  const storageId = row.log_storage_id;
  return typeof storageId === "string" ? [storageId as Id<"_storage">] : [];
};

const E2E_AUTH_RESET_PAGE_SIZE = 250;

export const queryAuthResetPage = async (
  ctx: MutationCtx,
  model: E2EResetAuthModel,
  cursor: string | null,
): Promise<{
  page: Array<{ _id: string } & Record<string, unknown>>;
  continueCursor: string;
  isDone: boolean;
}> => {
  const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model,
    paginationOpts: {
      numItems: E2E_AUTH_RESET_PAGE_SIZE,
      cursor,
    },
  })) as {
    page: Array<{ _id: string } & Record<string, unknown>>;
    continueCursor: string;
    isDone: boolean;
  };
  return {
    page: result.page,
    continueCursor: result.continueCursor,
    isDone: result.isDone,
  };
};

export const deleteAuthResetRow = async (
  ctx: MutationCtx,
  model: E2EResetAuthModel,
  rowId: string,
): Promise<void> => {
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
    input: {
      model,
      where: [{ field: "_id", value: rowId }],
    },
  });
};
