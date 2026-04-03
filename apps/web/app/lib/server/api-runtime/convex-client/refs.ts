import { makeFunctionReference, type FunctionReference } from "convex/server";
import { api, internal } from "../../../../../../../convex/_generated/api";
import type { ApiDedupeScope, ApiDedupeStatus, ClientType } from "@keppo/shared/domain";

export type { ApiDedupeScope, ApiDedupeStatus, ClientType };

/**
 * Widen an internal FunctionReference to be callable via ConvexHttpClient
 * (which is authenticated with an admin key). This preserves the full
 * argument / return types while relaxing the visibility constraint.
 */
type AdminRef<T> =
  T extends FunctionReference<
    infer Type,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    infer _Visibility,
    infer Args,
    infer Return,
    infer ComponentPath
  >
    ? FunctionReference<Type, "public", Args, Return, ComponentPath>
    : T;

function adminRef<T>(ref: T): AdminRef<T> {
  return ref as AdminRef<T>;
}

/**
 * Typed Convex function references derived from the generated API.
 *
 * Using `api.*` / `internal.*` instead of `makeFunctionReference` ensures
 * that argument and return types are checked at compile time and cannot
 * drift from the actual Convex function signatures.
 *
 * The `adminRef` wrapper widens internal references so they are accepted
 * by `ConvexHttpClient` (which authenticates via admin key and can call
 * internal functions at runtime).
 */
export const refs = {
  authenticateCredential: adminRef(internal.mcp.authenticateCredential),
  markCredentialUsed: adminRef(internal.mcp.markCredentialUsed),
  getRunBySession: adminRef(internal.mcp.getRunBySession),
  createRun: adminRef(internal.mcp.createRun),
  touchRun: adminRef(internal.mcp.touchRun),
  closeRunBySession: adminRef(internal.mcp.closeRunBySession),
  executeToolCall: adminRef(internal.mcp_node.executeToolCall),
  executeCustomToolCall: adminRef(internal.custom_mcp_node.executeCustomToolCall),
  listToolCatalog: adminRef(internal.mcp_node.listToolCatalog),
  listToolCatalogForWorkspace: adminRef(internal.mcp_node.listToolCatalogForWorkspace),
  seedToolIndex: api.code_mode.seedToolIndex,
  searchTools: api.code_mode.searchTools,
  getWorkspaceCodeModeContext: adminRef(internal.mcp.getWorkspaceCodeModeContext),
  getWorkspaceById: api.workspaces.getById,
  getWorkspaceCredentialStatus: api.workspaces.getCredentialStatus,
  probeConvexHealth: api.health.probeConvex,
  checkCronHealth: api.cron_heartbeats.checkCronHealth,
  scheduledMaintenanceSweepWithHeartbeat: adminRef(
    internal.cron_heartbeats.scheduledMaintenanceSweepWithHeartbeat,
  ),
  scheduledMaintenanceSweepManual: adminRef(
    internal.cron_heartbeats.scheduledMaintenanceSweepManual,
  ),
  getFeatureFlagValue: api.feature_flags.getFeatureFlagValue,
  listAllFeatureFlags: adminRef(internal.feature_flags.listAllFlags),
  listRecentAuditErrors: adminRef(internal.audit.listRecentErrors),
  listPendingDeadLetters: adminRef(internal.dead_letter.listPending),
  enqueueDeadLetter: adminRef(internal.dead_letter.enqueue),
  replayDeadLetter: adminRef(internal.dead_letter.replay),
  abandonDeadLetter: adminRef(internal.dead_letter.abandon),
  runMaintenanceTick: adminRef(internal.mcp_node.runMaintenanceTick),
  upsertManagedOAuthConnectState: adminRef(internal.integrations.upsertManagedOAuthConnectState),
  getManagedOAuthConnectState: adminRef(internal.integrations.getManagedOAuthConnectState),
  deleteManagedOAuthConnectState: adminRef(internal.integrations.deleteManagedOAuthConnectState),
  upsertOAuthProviderForOrg: adminRef(internal.integrations.upsertOAuthProviderForOrg),
  recordProviderWebhook: adminRef(internal.integrations.recordProviderWebhook),
  ingestProviderEvent: adminRef(internal.automation_triggers.ingestProviderEvent),
  matchAndQueueAutomationTriggers: adminRef(
    internal.automation_triggers.matchAndQueueAutomationTriggers,
  ),
  getAutomationRunDispatchContext: adminRef(
    internal.automation_runs.getAutomationRunDispatchContext,
  ),
  claimAutomationRunDispatchContext: adminRef(
    internal.automation_runs.claimAutomationRunDispatchContext,
  ),
  issueAutomationWorkspaceCredential: adminRef(
    internal.workspaces.issueAutomationWorkspaceCredential,
  ),
  updateAutomationRunStatus: adminRef(internal.automation_runs.updateAutomationRunStatus),
  appendAutomationRunLog: adminRef(internal.automation_runs.appendAutomationRunLog),
  appendAutomationRunLogBatch: adminRef(internal.automation_runs.appendAutomationRunLogBatch),
  storeAutomationRunSessionTrace: adminRef(
    makeFunctionReference<"action">("automation_runs:storeAutomationRunSessionTrace"),
  ),
  getOrgAiKey: adminRef(internal.org_ai_keys.getOrgAiKey),
  upsertOpenAiOauthKey: adminRef(internal.org_ai_keys.upsertOpenAiOauthKey),
  upsertBundledOrgAiKey: adminRef(internal.org_ai_keys.upsertBundledOrgAiKey),
  deactivateBundledOrgAiKeys: adminRef(internal.org_ai_keys.deactivateBundledOrgAiKeys),
  getAiCreditBalance: adminRef(internal.ai_credits.getAiCreditBalanceForOrgInternal),
  deductAiCredit: adminRef(internal.ai_credits.deductAiCredit),
  addPurchasedCredits: adminRef(internal.ai_credits.addPurchasedCredits),
  addPurchasedAutomationRuns: adminRef(internal.automation_run_topups.addPurchasedAutomationRuns),
  claimApiDedupeKey: adminRef(internal.api_dedupe.claimApiDedupeKey),
  getApiDedupeKey: adminRef(internal.api_dedupe.getApiDedupeKey),
  setApiDedupePayload: adminRef(internal.api_dedupe.setApiDedupePayload),
  completeApiDedupeKey: adminRef(internal.api_dedupe.completeApiDedupeKey),
  releaseApiDedupeKey: adminRef(internal.api_dedupe.releaseApiDedupeKey),
  checkRateLimit: adminRef(internal.rate_limits.checkRateLimit),
  summarizeRateLimitHealth: api.rate_limits.summarizeForHealth,
  createAuditEvent: adminRef(internal.mcp.createAuditEvent),
  listApprovedActionDispatches: adminRef(internal.mcp.listApprovedActionDispatches),
  executeApprovedAction: adminRef(internal.mcp_node.executeApprovedAction),
  scheduleApprovedAction: adminRef(internal.mcp_dispatch.scheduleApprovedAction),
  getBillingUsageForOrg: adminRef(internal.billing.getUsageForOrg),
  upsertSubscriptionForOrg: adminRef(internal.billing.upsertSubscriptionForOrg),
  downgradeOrgToFree: adminRef(internal.billing.downgradeOrgToFree),
  setSubscriptionStatusByCustomer: adminRef(internal.billing.setSubscriptionStatusByCustomer),
  setSubscriptionStatusByStripeSubscription: adminRef(
    internal.billing.setSubscriptionStatusByStripeSubscription,
  ),
  getSubscriptionByStripeCustomer: adminRef(internal.billing.getSubscriptionByStripeCustomer),
  getSubscriptionByStripeSubscription: adminRef(
    internal.billing.getSubscriptionByStripeSubscription,
  ),
  getSubscriptionForOrg: adminRef(internal.billing.getSubscriptionForOrg),
  convertActiveInvitePromo: adminRef(internal.invite_codes.convertActiveInvitePromo),
  emitNotificationForOrg: adminRef(internal.notifications.emitNotificationForOrg),
  registerEndpointForOrgMember: adminRef(internal.notifications.registerEndpointForOrgMember),
  getDeliveryEvent: adminRef(internal.notifications.getDeliveryEvent),
  markNotificationEventSent: adminRef(internal.notifications.markEventSent),
  markNotificationEventFailed: adminRef(internal.notifications.markEventFailed),
  disableNotificationEndpoint: adminRef(internal.notifications.disableEndpoint),
  createInviteInternal: adminRef(internal.invites.createInviteInternal),
  acceptInviteInternal: adminRef(internal.invites.acceptInviteInternal),
  cleanupExpiredInvites: adminRef(internal.invites.cleanupExpiredInvites),
  storeInviteToken: api.e2e.storeInviteToken,
  resolveApiSessionFromToken: adminRef(internal.auth.resolveApiSessionFromToken),
};
