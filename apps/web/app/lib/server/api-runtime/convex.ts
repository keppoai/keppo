import { ConvexHttpClient } from "convex/browser";
import {
  classifyErrorCode,
  CONVEX_CONFLICT,
  CONVEX_TIMEOUT,
  CONVEX_UNAVAILABLE,
  NETWORK_TIMEOUT,
  type KeppoErrorCode,
} from "@keppo/shared/error-codes";
import { type KnownFeatureFlag } from "@keppo/shared/feature-flags";
import {
  convexManagedOAuthConnectStatePayloadSchema,
  convexManagedOAuthConnectStateSchema,
  convexApprovedActionDispatchListSchema,
  convexExecuteApprovedActionResultSchema,
  convexIngestProviderEventPayloadSchema,
  convexIngestProviderEventResultSchema,
  convexRecordProviderWebhookPayloadSchema,
  convexRecordProviderWebhookResultSchema,
  convexUpsertOAuthProviderPayloadSchema,
} from "@keppo/shared/providers/boundaries/convex-schemas";
import {
  convexExecuteToolCallPayloadSchema,
  convexRunMaintenanceTickPayloadSchema,
  workerMaintenanceTickResultSchema,
} from "@keppo/shared/providers/boundaries/api-schemas";
import { parseConvexPayload } from "@keppo/shared/providers/boundaries/error-boundary";
import { jsonRecordSchema } from "@keppo/shared/providers/boundaries/common";
import type {
  ProviderMetricName,
  ProviderMetricOutcome,
} from "@keppo/shared/providers/boundaries/types";
import {
  resolveLocalAdminKey,
  setClientAdminAuth,
  toUsableAdminKey,
} from "@keppo/shared/convex-admin";
import type { CanonicalProviderId } from "@keppo/shared/provider-ids";
import type { ToolSearchResult } from "@keppo/shared/code-mode/tool-search-types";
import {
  NOTIFICATION_DELIVERY_STATUS,
  type DeadLetterStatus,
  type SubscriptionStatus,
  type SubscriptionTier,
  type UserRole,
} from "@keppo/shared/domain";
import type { NotificationEventId } from "@keppo/shared/notifications";
import type {
  AiKeyMode,
  AiModelProvider,
  AutomationRunEventType,
  AutomationRunLogLevel,
} from "@keppo/shared/automations";
import {
  addPurchasedCredits as addPurchasedCreditsImpl,
  addPurchasedAutomationRuns as addPurchasedAutomationRunsImpl,
  appendAutomationRunLog as appendAutomationRunLogImpl,
  deactivateBundledOrgAiKeys as deactivateBundledOrgAiKeysImpl,
  deductAiCredit as deductAiCreditImpl,
  getAutomationRunDispatchContext as getAutomationRunDispatchContextImpl,
  getAiCreditBalance as getAiCreditBalanceImpl,
  getOrgAiKey as getOrgAiKeyImpl,
  ingestProviderEvent as ingestProviderEventImpl,
  matchAndQueueAutomationTriggers as matchAndQueueAutomationTriggersImpl,
  upsertBundledOrgAiKey as upsertBundledOrgAiKeyImpl,
  upsertOpenAiOauthKey as upsertOpenAiOauthKeyImpl,
  updateAutomationRunStatus as updateAutomationRunStatusImpl,
  type AutomationRunDispatchContext,
  type AutomationRunStatus,
  type AiCreditsBalance,
  type OrgAiKey,
  type PurchasedAutomationRunTopup,
  type PurchasedCredits,
} from "./convex-client/automation-ai.js";
import {
  claimApiDedupeKey as claimApiDedupeKeyImpl,
  completeApiDedupeKey as completeApiDedupeKeyImpl,
  convertActiveInvitePromo as convertActiveInvitePromoImpl,
  downgradeOrgToFree as downgradeOrgToFreeImpl,
  getApiDedupeKey as getApiDedupeKeyImpl,
  getBillingUsageForOrg as getBillingUsageForOrgImpl,
  getSubscriptionByStripeCustomer as getSubscriptionByStripeCustomerImpl,
  getSubscriptionByStripeSubscription as getSubscriptionByStripeSubscriptionImpl,
  getSubscriptionForOrg as getSubscriptionForOrgImpl,
  releaseApiDedupeKey as releaseApiDedupeKeyImpl,
  setApiDedupePayload as setApiDedupePayloadImpl,
  setSubscriptionStatusByCustomer as setSubscriptionStatusByCustomerImpl,
  setSubscriptionStatusByStripeSubscription as setSubscriptionStatusByStripeSubscriptionImpl,
  upsertSubscriptionForOrg as upsertSubscriptionForOrgImpl,
  type ApiDedupeRecord,
  type BillingUsage,
  type OrgSubscription,
} from "./convex-client/billing-dedupe.js";
import {
  acceptInviteInternal as acceptInviteInternalImpl,
  cleanupExpiredInvites as cleanupExpiredInvitesImpl,
  createAuditEvent as createAuditEventImpl,
  createInviteInternal as createInviteInternalImpl,
  disableNotificationEndpoint as disableNotificationEndpointImpl,
  emitNotificationForOrg as emitNotificationForOrgImpl,
  getNotificationDeliveryEvent as getNotificationDeliveryEventImpl,
  markNotificationEventFailed as markNotificationEventFailedImpl,
  markNotificationEventSent as markNotificationEventSentImpl,
  recordProviderMetric as recordProviderMetricImpl,
  registerPushEndpointForUser as registerPushEndpointForUserImpl,
  resolveApiSessionFromToken as resolveApiSessionFromTokenImpl,
  storeInviteToken as storeInviteTokenImpl,
  type CreateAuditEventParams,
  type NotificationDeliveryEvent,
} from "./convex-client/notifications-invites.js";
import {
  refs,
  type ApiDedupeScope,
  type ApiDedupeStatus,
  type ClientType,
} from "./convex-client/refs.js";
import { getEnv } from "./env.js";
import type {
  ApprovedActionDispatch,
  ApprovedActionScheduleResult,
  ConvexHealthProbe,
  CronHealthRow,
  DeadLetterEntry,
  CredentialAuthResult,
  ExecuteApprovedActionResult,
  FeatureFlagRecord,
  AuditErrorRecord,
  MaintenanceTickResult,
  RateLimitHealthSummary,
  ScheduledMaintenanceSweepResult,
  WorkspaceCodeModeContext,
} from "./convex-client/types.js";

type WorkspaceRecord = {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  status: string;
  policy_mode: string;
  default_action_behavior: string;
  code_mode_enabled: boolean;
  created_at: string;
} | null;

type WorkspaceCredentialStatus = {
  has_active_credential: boolean;
  last_rotated_at: string | null;
};

const CONVEX_READ_TIMEOUT_MS = 5_000;
const CONVEX_WRITE_TIMEOUT_MS = 10_000;
const CONVEX_ACTION_TIMEOUT_MS = 30_000;
const CONVEX_MAINTENANCE_SWEEP_TIMEOUT_MS = 120_000;
const FIRE_AND_FORGET_DEAD_LETTER_SOURCE = "fire_and_forget" as const;

type ConvexCallOptions = {
  timeoutMs: number;
  retries: number;
  label: string;
};

type FireAndForgetDlqClient = {
  enqueueDeadLetter: (params: {
    sourceTable: typeof FIRE_AND_FORGET_DEAD_LETTER_SOURCE;
    sourceId: string;
    failureReason: string;
    errorCode?: KeppoErrorCode;
    payload?: Record<string, unknown>;
  }) => Promise<unknown>;
};

type FireAndForgetLogger = {
  warn: (message: string, metadata?: Record<string, unknown>) => void;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const describeConvexReference = (reference: unknown): string => {
  if (typeof reference === "string" && reference.length > 0) {
    return reference;
  }
  if (typeof reference === "function" && reference.name.length > 0) {
    return reference.name;
  }
  if (reference && typeof reference === "object") {
    const candidate = reference as {
      functionName?: unknown;
      name?: unknown;
      _name?: unknown;
      constructor?: { name?: unknown };
    };
    for (const value of [candidate.functionName, candidate.name, candidate._name]) {
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
    const constructorName = candidate.constructor?.name;
    if (typeof constructorName === "string" && constructorName.length > 0) {
      return constructorName;
    }
  }
  return typeof reference;
};

class ConvexCallTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`convex timeout after ${timeoutMs}ms (${label})`);
    this.name = "ConvexCallTimeoutError";
  }
}

const isRetryableConvexError = (error: unknown): boolean => {
  if (error instanceof ConvexCallTimeoutError) {
    return true;
  }
  const code = classifyErrorCode(toErrorMessage(error));
  return (
    code === CONVEX_TIMEOUT ||
    code === CONVEX_UNAVAILABLE ||
    code === CONVEX_CONFLICT ||
    code === NETWORK_TIMEOUT
  );
};

export const resilientConvexCall = async <T>(
  fn: () => Promise<T>,
  options: ConvexCallOptions,
): Promise<T> => {
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new ConvexCallTimeoutError(options.label, options.timeoutMs));
          }, options.timeoutMs);
        }),
      ]).finally(() => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      });
    } catch (error) {
      if (attempt >= options.retries || !isRetryableConvexError(error)) {
        throw error;
      }
      await sleep(500 * 2 ** attempt);
    }
  }

  throw new Error(`unreachable resilientConvexCall state (${options.label})`);
};

export const fireAndForgetWithDlq = async (
  label: string,
  fn: () => Promise<void>,
  convex: FireAndForgetDlqClient,
  options?: {
    logger?: FireAndForgetLogger;
    payload?: Record<string, unknown>;
  },
): Promise<void> => {
  try {
    await resilientConvexCall(fn, {
      timeoutMs: CONVEX_READ_TIMEOUT_MS,
      retries: 2,
      label,
    });
  } catch (error) {
    const failureReason = toErrorMessage(error);
    try {
      await convex.enqueueDeadLetter({
        sourceTable: FIRE_AND_FORGET_DEAD_LETTER_SOURCE,
        sourceId: label,
        failureReason,
        errorCode: classifyErrorCode(failureReason),
        ...(options?.payload ? { payload: options.payload } : {}),
      });
    } catch (enqueueError) {
      options?.logger?.warn("fire_and_forget.dlq_enqueue_failed", {
        label,
        error: failureReason,
        dlq_error: toErrorMessage(enqueueError),
      });
    }
  }
};

export class ConvexInternalClient {
  private readonly client: ConvexHttpClient;
  private readonly resilientClient: ConvexHttpClient;

  constructor() {
    const env = getEnv();
    const url = env.CONVEX_URL;
    if (!url) {
      throw new Error("Missing Convex URL. Set CONVEX_URL.");
    }

    this.client = new ConvexHttpClient(url);
    const adminKey =
      toUsableAdminKey(env.KEPPO_CONVEX_ADMIN_KEY) ??
      toUsableAdminKey(resolveLocalAdminKey({ searchParentDirectories: true }));
    if (!adminKey) {
      throw new Error(
        "Missing KEPPO_CONVEX_ADMIN_KEY. API internal bridge requires admin auth for internal Convex functions.",
      );
    }
    setClientAdminAuth(this.client, adminKey);
    this.resilientClient = {
      query: async (reference: unknown, args?: unknown) =>
        await this.callQuery(reference, args, `query:${describeConvexReference(reference)}`),
      mutation: async (reference: unknown, args?: unknown) =>
        await this.callMutation(reference, args, `mutation:${describeConvexReference(reference)}`),
      action: async (reference: unknown, args?: unknown) =>
        await this.callAction(reference, args, `action:${describeConvexReference(reference)}`),
    } as ConvexHttpClient;
  }

  private async callQuery<T>(reference: unknown, args: unknown, label: string): Promise<T> {
    return await this.callQueryWithOptions(reference, args, {
      timeoutMs: CONVEX_READ_TIMEOUT_MS,
      retries: 2,
      label,
    });
  }

  private async callQueryWithOptions<T>(
    reference: unknown,
    args: unknown,
    options: ConvexCallOptions,
  ): Promise<T> {
    return await resilientConvexCall(
      async () => (await this.client.query(reference as never, args as never)) as T,
      options,
    );
  }

  private async callMutation<T>(reference: unknown, args: unknown, label: string): Promise<T> {
    return await resilientConvexCall(
      async () => (await this.client.mutation(reference as never, args as never)) as T,
      {
        timeoutMs: CONVEX_WRITE_TIMEOUT_MS,
        retries: 2,
        label,
      },
    );
  }

  private async callAction<T>(reference: unknown, args: unknown, label: string): Promise<T> {
    return await this.callActionWithOptions(reference, args, {
      timeoutMs: CONVEX_ACTION_TIMEOUT_MS,
      retries: 2,
      label,
    });
  }

  private async callActionWithOptions<T>(
    reference: unknown,
    args: unknown,
    options: ConvexCallOptions,
  ): Promise<T> {
    return await resilientConvexCall(
      async () => (await this.client.action(reference as never, args as never)) as T,
      options,
    );
  }

  async authenticateCredential(
    workspaceId: string,
    secret: string,
    ipHash?: string,
  ): Promise<CredentialAuthResult> {
    return await this.callMutation(
      refs.authenticateCredential,
      {
        workspaceId,
        secret,
        ...(ipHash ? { ipHash } : {}),
      },
      "mutation:authenticateCredential",
    );
  }

  async markCredentialUsed(credentialId: string, ipHash?: string): Promise<void> {
    await this.callMutation(
      refs.markCredentialUsed,
      {
        credentialId,
        ...(ipHash ? { ipHash } : {}),
      },
      "mutation:markCredentialUsed",
    );
  }

  async getRunBySession(workspaceId: string, sessionId: string): Promise<{ id: string } | null> {
    return await this.callQuery(
      refs.getRunBySession,
      {
        workspaceId,
        sessionId,
      },
      "query:getRunBySession",
    );
  }

  async createRun(params: {
    workspaceId: string;
    sessionId: string | null;
    clientType: ClientType;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    return await this.callMutation(
      refs.createRun,
      {
        workspaceId: params.workspaceId,
        sessionId: params.sessionId,
        clientType: params.clientType,
        metadata: params.metadata ?? {},
      },
      "mutation:createRun",
    );
  }

  async touchRun(runId: string): Promise<void> {
    await this.callMutation(refs.touchRun, { runId }, "mutation:touchRun");
  }

  async closeRunBySession(workspaceId: string, sessionId: string): Promise<boolean> {
    return await this.callMutation(
      refs.closeRunBySession,
      {
        workspaceId,
        sessionId,
      },
      "mutation:closeRunBySession",
    );
  }

  async listToolCatalog(): Promise<Array<{ name: string; description: string }>> {
    return (await this.callAction(refs.listToolCatalog, {}, "action:listToolCatalog")) as Array<{
      name: string;
      description: string;
    }>;
  }

  async listToolCatalogForWorkspace(
    workspaceId: string,
  ): Promise<Array<{ name: string; description: string }>> {
    return (await this.callAction(
      refs.listToolCatalogForWorkspace,
      {
        workspaceId,
      },
      "action:listToolCatalogForWorkspace",
    )) as Array<{ name: string; description: string }>;
  }

  async getWorkspaceCodeModeContext(workspaceId: string): Promise<WorkspaceCodeModeContext> {
    return await this.callQuery(
      refs.getWorkspaceCodeModeContext,
      {
        workspaceId,
      },
      "query:getWorkspaceCodeModeContext",
    );
  }

  async getWorkspaceById(workspaceId: string): Promise<WorkspaceRecord> {
    return await this.callQuery(refs.getWorkspaceById, { workspaceId }, "query:getWorkspaceById");
  }

  async getWorkspaceCredentialStatus(workspaceId: string): Promise<WorkspaceCredentialStatus> {
    return await this.callQuery(
      refs.getWorkspaceCredentialStatus,
      { workspaceId },
      "query:getWorkspaceCredentialStatus",
    );
  }

  async probeConvexHealth(): Promise<ConvexHealthProbe> {
    return await this.callQuery(refs.probeConvexHealth, {}, "query:probeConvexHealth");
  }

  async checkCronHealth(): Promise<CronHealthRow[]> {
    return await this.callQuery(refs.checkCronHealth, {}, "query:checkCronHealth");
  }

  async getFeatureFlag(key: KnownFeatureFlag, options?: { timeoutMs?: number }): Promise<boolean> {
    return await this.callQueryWithOptions(
      refs.getFeatureFlagValue,
      { key },
      {
        timeoutMs: options?.timeoutMs ?? 2_000,
        retries: 0,
        label: `query:getFeatureFlagValue:${key}`,
      },
    );
  }

  async listAllFeatureFlags(): Promise<FeatureFlagRecord[]> {
    return await this.callQuery(refs.listAllFeatureFlags, {}, "query:listAllFeatureFlags");
  }

  async listRecentAuditErrors(params?: { limit?: number }): Promise<AuditErrorRecord[]> {
    const limit =
      params?.limit !== undefined && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(100, Math.floor(params.limit)))
        : 50;
    return await this.callQuery(
      refs.listRecentAuditErrors,
      { limit },
      "query:listRecentAuditErrors",
    );
  }

  async listPendingDeadLetters(params: { limit: number }): Promise<DeadLetterEntry[]> {
    const limit = Number.isFinite(params.limit) ? Math.max(1, Math.floor(params.limit)) : 50;
    return await this.callQuery(
      refs.listPendingDeadLetters,
      { limit },
      "query:listPendingDeadLetters",
    );
  }

  async enqueueDeadLetter(params: {
    sourceTable: typeof FIRE_AND_FORGET_DEAD_LETTER_SOURCE;
    sourceId: string;
    failureReason: string;
    errorCode?: KeppoErrorCode;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.callMutation(
      refs.enqueueDeadLetter,
      {
        sourceTable: params.sourceTable,
        sourceId: params.sourceId,
        failureReason: params.failureReason,
        ...(params.errorCode ? { errorCode: params.errorCode } : {}),
        ...(params.payload ? { payload: params.payload } : {}),
      },
      "mutation:enqueueDeadLetter",
    );
  }

  async summarizeRateLimitHealth(params?: {
    sampleLimit?: number;
    activeWithinMs?: number;
  }): Promise<RateLimitHealthSummary> {
    const sampleLimit =
      params?.sampleLimit !== undefined && Number.isFinite(params.sampleLimit)
        ? Math.max(1, Math.floor(params.sampleLimit))
        : 200;
    const activeWithinMs =
      params?.activeWithinMs !== undefined && Number.isFinite(params.activeWithinMs)
        ? Math.max(1_000, Math.floor(params.activeWithinMs))
        : 5 * 60_000;
    return await this.callQuery(
      refs.summarizeRateLimitHealth,
      {
        sampleLimit,
        activeWithinMs,
      },
      "query:summarizeRateLimitHealth",
    );
  }

  async replayDeadLetter(params: {
    dlqId: string;
  }): Promise<{ replayed: boolean; status: DeadLetterStatus }> {
    return await this.callMutation(
      refs.replayDeadLetter,
      {
        dlqId: params.dlqId,
      },
      "mutation:replayDeadLetter",
    );
  }

  async abandonDeadLetter(params: {
    dlqId: string;
  }): Promise<{ abandoned: boolean; status: DeadLetterStatus }> {
    return await this.callMutation(
      refs.abandonDeadLetter,
      {
        dlqId: params.dlqId,
      },
      "mutation:abandonDeadLetter",
    );
  }

  async searchTools(params: {
    query: string;
    provider?: string;
    capability?: string;
    limit?: number;
  }): Promise<ToolSearchResult[]> {
    return await this.callQuery(
      refs.searchTools,
      {
        query: params.query,
        ...(params.provider ? { provider: params.provider } : {}),
        ...(params.capability ? { capability: params.capability } : {}),
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
      },
      "query:searchTools",
    );
  }

  async seedToolIndex(): Promise<void> {
    await this.callMutation(refs.seedToolIndex, {}, "mutation:seedToolIndex");
  }

  async executeToolCall(params: {
    workspaceId: string;
    runId: string;
    automationRunId?: string;
    toolName: string;
    input: Record<string, unknown>;
    credentialId: string;
  }): Promise<Record<string, unknown>> {
    const payload = parseConvexPayload(convexExecuteToolCallPayloadSchema, params);
    return parseConvexPayload(
      jsonRecordSchema,
      await this.callAction(
        refs.executeToolCall,
        {
          workspaceId: payload.workspaceId,
          runId: payload.runId,
          ...(payload.automationRunId ? { automationRunId: payload.automationRunId } : {}),
          toolName: payload.toolName,
          input: payload.input,
          credentialId: payload.credentialId,
        },
        "action:executeToolCall",
      ),
    );
  }

  async executeCustomToolCall(params: {
    workspaceId: string;
    runId: string;
    toolName: string;
    input: Record<string, unknown>;
    credentialId: string;
  }): Promise<Record<string, unknown>> {
    const payload = parseConvexPayload(convexExecuteToolCallPayloadSchema, params);
    return parseConvexPayload(
      jsonRecordSchema,
      await this.callAction(
        refs.executeCustomToolCall,
        {
          workspaceId: payload.workspaceId,
          runId: payload.runId,
          toolName: payload.toolName,
          input: payload.input,
          credentialId: payload.credentialId,
        },
        "action:executeCustomToolCall",
      ),
    );
  }

  async runMaintenanceTick(params: {
    approvedLimit: number;
    ttlMinutes: number;
    inactivityMinutes: number;
  }): Promise<MaintenanceTickResult> {
    const payload = parseConvexPayload(convexRunMaintenanceTickPayloadSchema, params);
    return parseConvexPayload(
      workerMaintenanceTickResultSchema,
      await this.callAction(refs.runMaintenanceTick, payload, "action:runMaintenanceTick"),
    );
  }

  async scheduledMaintenanceSweep(): Promise<ScheduledMaintenanceSweepResult> {
    const result = await this.callActionWithOptions(
      refs.scheduledMaintenanceSweepWithHeartbeat,
      {},
      {
        timeoutMs: CONVEX_MAINTENANCE_SWEEP_TIMEOUT_MS,
        retries: 0,
        label: "action:scheduledMaintenanceSweepWithHeartbeat",
      },
    );
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("action:scheduledMaintenanceSweepWithHeartbeat returned an invalid payload");
    }

    const raw = result as {
      queue?: { attempted?: unknown; dispatched?: unknown; skipped?: unknown };
      skippedReason?: unknown;
      maintenance?: unknown;
      invites?: { expired?: unknown };
    };

    return {
      queue: {
        attempted: typeof raw.queue?.attempted === "number" ? Math.max(0, raw.queue.attempted) : 0,
        dispatched:
          typeof raw.queue?.dispatched === "number" ? Math.max(0, raw.queue.dispatched) : 0,
        skipped: typeof raw.queue?.skipped === "number" ? Math.max(0, raw.queue.skipped) : 0,
      },
      skippedReason: raw.skippedReason === "lease_held" ? raw.skippedReason : null,
      maintenance: parseConvexPayload(workerMaintenanceTickResultSchema, raw.maintenance ?? {}, {
        message:
          "action:scheduledMaintenanceSweepWithHeartbeat maintenance payload failed validation",
      }),
      invites: {
        expired: typeof raw.invites?.expired === "number" ? Math.max(0, raw.invites.expired) : 0,
      },
    };
  }

  async scheduledMaintenanceSweepManual(): Promise<ScheduledMaintenanceSweepResult> {
    const result = await this.callActionWithOptions(
      refs.scheduledMaintenanceSweepManual,
      {},
      {
        timeoutMs: CONVEX_MAINTENANCE_SWEEP_TIMEOUT_MS,
        retries: 0,
        label: "action:scheduledMaintenanceSweepManual",
      },
    );
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("action:scheduledMaintenanceSweepManual returned an invalid payload");
    }

    const raw = result as {
      queue?: { attempted?: unknown; dispatched?: unknown; skipped?: unknown };
      skippedReason?: unknown;
      maintenance?: unknown;
      invites?: { expired?: unknown };
    };

    return {
      queue: {
        attempted: typeof raw.queue?.attempted === "number" ? Math.max(0, raw.queue.attempted) : 0,
        dispatched:
          typeof raw.queue?.dispatched === "number" ? Math.max(0, raw.queue.dispatched) : 0,
        skipped: typeof raw.queue?.skipped === "number" ? Math.max(0, raw.queue.skipped) : 0,
      },
      skippedReason: raw.skippedReason === "lease_held" ? raw.skippedReason : null,
      maintenance: parseConvexPayload(workerMaintenanceTickResultSchema, raw.maintenance ?? {}, {
        message: "action:scheduledMaintenanceSweepManual maintenance payload failed validation",
      }),
      invites: {
        expired: typeof raw.invites?.expired === "number" ? Math.max(0, raw.invites.expired) : 0,
      },
    };
  }

  async listApprovedActionDispatches(params: { limit: number }): Promise<ApprovedActionDispatch[]> {
    const limit = Number.isFinite(params.limit) ? Math.max(1, Math.floor(params.limit)) : 50;
    return parseConvexPayload(
      convexApprovedActionDispatchListSchema,
      await this.callQuery(
        refs.listApprovedActionDispatches,
        { limit },
        "query:listApprovedActionDispatches",
      ),
    );
  }

  async executeApprovedAction(params: { actionId: string }): Promise<ExecuteApprovedActionResult> {
    return parseConvexPayload(
      convexExecuteApprovedActionResultSchema,
      await this.callAction(
        refs.executeApprovedAction,
        {
          actionId: params.actionId,
        },
        "action:executeApprovedAction",
      ),
    );
  }

  async scheduleApprovedAction(params: {
    actionId: string;
    source?: string;
  }): Promise<ApprovedActionScheduleResult> {
    const result = await this.callMutation(
      refs.scheduleApprovedAction,
      {
        actionId: params.actionId,
        ...(params.source ? { source: params.source } : {}),
      },
      "mutation:scheduleApprovedAction",
    );
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("mutation:scheduleApprovedAction returned an invalid payload");
    }
    const raw = result as {
      dispatched?: unknown;
      reason?: unknown;
      messageId?: unknown;
    };
    return {
      dispatched: typeof raw.dispatched === "boolean" ? raw.dispatched : false,
      reason: typeof raw.reason === "string" ? raw.reason : "scheduled",
      ...(typeof raw.messageId === "string" ? { messageId: raw.messageId } : {}),
    };
  }

  async upsertOAuthProviderForOrg(params: {
    orgId: string;
    provider: CanonicalProviderId;
    displayName: string;
    scopes: string[];
    externalAccountId: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const payload = parseConvexPayload(convexUpsertOAuthProviderPayloadSchema, params);
    await this.callMutation(
      refs.upsertOAuthProviderForOrg,
      {
        orgId: payload.orgId,
        provider: payload.provider,
        displayName: payload.displayName,
        scopes: payload.scopes,
        externalAccountId: payload.externalAccountId,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        expiresAt: payload.expiresAt,
        metadata: payload.metadata ?? {},
      },
      "mutation:upsertOAuthProviderForOrg",
    );
  }

  async upsertManagedOAuthConnectState(params: {
    orgId: string;
    provider: CanonicalProviderId;
    correlationId: string;
    createdAt: string;
    expiresAt: string;
    pkceCodeVerifier?: string;
  }): Promise<void> {
    const payload = parseConvexPayload(convexManagedOAuthConnectStatePayloadSchema, params);
    await this.callMutation(
      refs.upsertManagedOAuthConnectState,
      {
        orgId: payload.orgId,
        provider: payload.provider,
        correlationId: payload.correlationId,
        createdAt: payload.createdAt,
        expiresAt: payload.expiresAt,
        ...(payload.pkceCodeVerifier ? { pkceCodeVerifier: payload.pkceCodeVerifier } : {}),
      },
      "mutation:upsertManagedOAuthConnectState",
    );
  }

  async getManagedOAuthConnectState(params: {
    orgId: string;
    provider: CanonicalProviderId;
    correlationId: string;
  }): Promise<{
    provider: CanonicalProviderId;
    correlationId: string;
    createdAt: string;
    expiresAt: string;
    pkceCodeVerifier: string | null;
  } | null> {
    const payload = parseConvexPayload(
      convexManagedOAuthConnectStatePayloadSchema.pick({
        orgId: true,
        provider: true,
        correlationId: true,
      }),
      params,
    );
    const result = await this.callQuery(
      refs.getManagedOAuthConnectState,
      {
        orgId: payload.orgId,
        provider: payload.provider,
        correlationId: payload.correlationId,
      },
      "query:getManagedOAuthConnectState",
    );
    return result === null
      ? null
      : parseConvexPayload(convexManagedOAuthConnectStateSchema, result);
  }

  async deleteManagedOAuthConnectState(params: {
    orgId: string;
    provider: CanonicalProviderId;
    correlationId: string;
  }): Promise<void> {
    const payload = parseConvexPayload(
      convexManagedOAuthConnectStatePayloadSchema.pick({
        orgId: true,
        provider: true,
        correlationId: true,
      }),
      params,
    );
    await this.callMutation(
      refs.deleteManagedOAuthConnectState,
      {
        orgId: payload.orgId,
        provider: payload.provider,
        correlationId: payload.correlationId,
      },
      "mutation:deleteManagedOAuthConnectState",
    );
  }

  async recordProviderWebhook(params: {
    provider: CanonicalProviderId;
    externalAccountId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
    receivedAt?: string;
  }): Promise<{ matched_orgs: number; matched_integrations: number; matched_org_ids: string[] }> {
    const payload = parseConvexPayload(convexRecordProviderWebhookPayloadSchema, params);
    const parsed = parseConvexPayload(
      convexRecordProviderWebhookResultSchema,
      await this.callMutation(
        refs.recordProviderWebhook,
        {
          provider: payload.provider,
          ...(payload.externalAccountId !== undefined
            ? { externalAccountId: payload.externalAccountId }
            : {}),
          eventType: payload.eventType,
          payload: payload.payload,
          ...(payload.receivedAt ? { receivedAt: payload.receivedAt } : {}),
        },
        "mutation:recordProviderWebhook",
      ),
    );
    return {
      matched_orgs: parsed.matched_orgs,
      matched_integrations: parsed.matched_integrations,
      matched_org_ids: parsed.matched_org_ids ?? [],
    };
  }

  async matchAndQueueAutomationTriggers(params: {
    orgId: string;
    eventProvider: string;
    eventType: string;
    eventId: string;
    eventPayload: Record<string, unknown>;
  }): Promise<{ queued_count: number; skipped_count: number }> {
    return matchAndQueueAutomationTriggersImpl(this.resilientClient, params);
  }

  async ingestProviderEvent(params: {
    orgId: string;
    provider: CanonicalProviderId;
    triggerKey?: string;
    providerEventId: string;
    providerEventType: string;
    deliveryMode: "webhook" | "polling";
    eventPayload: Record<string, unknown>;
    eventPayloadRef?: string | null;
  }): Promise<{ queued_count: number; skipped_count: number }> {
    const payload = parseConvexPayload(convexIngestProviderEventPayloadSchema, params);
    return parseConvexPayload(
      convexIngestProviderEventResultSchema,
      await ingestProviderEventImpl(this.resilientClient, {
        orgId: payload.orgId,
        provider: payload.provider,
        ...(payload.triggerKey !== undefined ? { triggerKey: payload.triggerKey } : {}),
        providerEventId: payload.providerEventId,
        providerEventType: payload.providerEventType,
        deliveryMode: payload.deliveryMode,
        eventPayload: payload.eventPayload,
        ...(payload.eventPayloadRef !== undefined
          ? { eventPayloadRef: payload.eventPayloadRef }
          : {}),
      }),
    );
  }

  async getAutomationRunDispatchContext(params: {
    automationRunId: string;
  }): Promise<AutomationRunDispatchContext | null> {
    return getAutomationRunDispatchContextImpl(this.resilientClient, params);
  }

  async issueAutomationWorkspaceCredential(params: {
    workspaceId: string;
    automationRunId?: string;
  }): Promise<string> {
    const result = await this.callMutation<{ credential_secret: string }>(
      refs.issueAutomationWorkspaceCredential,
      {
        workspaceId: params.workspaceId,
        ...(params.automationRunId ? { automationRunId: params.automationRunId } : {}),
      },
      "mutation:issueAutomationWorkspaceCredential",
    );
    return result.credential_secret;
  }

  async updateAutomationRunStatus(params: {
    automationRunId: string;
    status: AutomationRunStatus;
    errorMessage?: string;
    sandboxId?: string | null;
    mcpSessionId?: string | null;
  }): Promise<void> {
    return updateAutomationRunStatusImpl(this.resilientClient, params);
  }

  async appendAutomationRunLog(params: {
    automationRunId: string;
    level: AutomationRunLogLevel;
    content: string;
    eventType?: AutomationRunEventType;
    eventData?: Record<string, unknown>;
  }): Promise<void> {
    return appendAutomationRunLogImpl(this.resilientClient, params);
  }

  async getOrgAiKey(params: {
    orgId: string;
    provider: AiModelProvider;
    keyMode: AiKeyMode;
  }): Promise<OrgAiKey | null> {
    return getOrgAiKeyImpl(this.resilientClient, params);
  }

  async upsertOpenAiOauthKey(params: {
    orgId: string;
    userId: string;
    credentials: {
      access_token: string;
      refresh_token: string;
      expires_at: string;
      scopes: string[];
      email: string | null;
      account_id: string | null;
      id_token: string | null;
      token_type: string | null;
      last_refresh: string | null;
    };
  }): Promise<void> {
    await upsertOpenAiOauthKeyImpl(this.resilientClient, params);
  }

  async upsertBundledOrgAiKey(params: {
    orgId: string;
    provider: AiModelProvider;
    rawKey: string;
    createdBy?: string;
  }): Promise<void> {
    await upsertBundledOrgAiKeyImpl(this.resilientClient, params);
  }

  async deactivateBundledOrgAiKeys(params: { orgId: string }): Promise<void> {
    await deactivateBundledOrgAiKeysImpl(this.resilientClient, params);
  }

  async deductAiCredit(params: {
    orgId: string;
    usageSource?: "generation" | "runtime";
  }): Promise<AiCreditsBalance> {
    return deductAiCreditImpl(this.resilientClient, params);
  }

  async getAiCreditBalance(params: { orgId: string }): Promise<AiCreditsBalance> {
    return getAiCreditBalanceImpl(this.resilientClient, params);
  }

  async addPurchasedCredits(params: {
    orgId: string;
    credits: number;
    priceCents: number;
    stripePaymentIntentId: string | null;
  }): Promise<PurchasedCredits> {
    return addPurchasedCreditsImpl(this.resilientClient, params);
  }

  async addPurchasedAutomationRuns(params: {
    orgId: string;
    tier: string;
    multiplier: string;
    runs: number;
    toolCalls: number;
    toolCallTimeMs: number;
    priceCents: number;
    stripePaymentIntentId: string | null;
  }): Promise<PurchasedAutomationRunTopup> {
    return addPurchasedAutomationRunsImpl(this.resilientClient, params);
  }

  async claimApiDedupeKey(params: {
    scope: ApiDedupeScope;
    dedupeKey: string;
    ttlMs: number;
    initialStatus?: ApiDedupeStatus;
  }): Promise<ApiDedupeRecord & { claimed: boolean }> {
    return claimApiDedupeKeyImpl(this.resilientClient, params);
  }

  async getApiDedupeKey(params: {
    scope: ApiDedupeScope;
    dedupeKey: string;
  }): Promise<ApiDedupeRecord | null> {
    return getApiDedupeKeyImpl(this.resilientClient, params);
  }

  async setApiDedupePayload(params: {
    scope: ApiDedupeScope;
    dedupeKey: string;
    payload: Record<string, unknown>;
  }): Promise<boolean> {
    return setApiDedupePayloadImpl(this.resilientClient, params);
  }

  async completeApiDedupeKey(params: {
    scope: ApiDedupeScope;
    dedupeKey: string;
  }): Promise<boolean> {
    return completeApiDedupeKeyImpl(this.resilientClient, params);
  }

  async releaseApiDedupeKey(params: {
    scope: ApiDedupeScope;
    dedupeKey: string;
  }): Promise<boolean> {
    return releaseApiDedupeKeyImpl(this.resilientClient, params);
  }

  async checkRateLimit(params: { key: string; limit: number; windowMs: number }): Promise<{
    allowed: boolean;
    remaining: number;
    retryAfterMs: number;
  }> {
    return (await this.callMutation(refs.checkRateLimit, params, "mutation:checkRateLimit")) as {
      allowed: boolean;
      remaining: number;
      retryAfterMs: number;
    };
  }

  async getBillingUsageForOrg(orgId: string): Promise<BillingUsage> {
    return getBillingUsageForOrgImpl(this.resilientClient, orgId);
  }

  async getSubscriptionForOrg(orgId: string): Promise<OrgSubscription | null> {
    return getSubscriptionForOrgImpl(this.resilientClient, orgId);
  }

  async convertActiveInvitePromo(params: {
    orgId: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  }): Promise<number> {
    return convertActiveInvitePromoImpl(this.resilientClient, params);
  }

  async getSubscriptionByStripeCustomer(stripeCustomerId: string): Promise<OrgSubscription | null> {
    return getSubscriptionByStripeCustomerImpl(this.resilientClient, stripeCustomerId);
  }

  async getSubscriptionByStripeSubscription(
    stripeSubscriptionId: string,
  ): Promise<OrgSubscription | null> {
    return getSubscriptionByStripeSubscriptionImpl(this.resilientClient, stripeSubscriptionId);
  }

  async upsertSubscriptionForOrg(params: {
    orgId: string;
    tier: SubscriptionTier;
    status: SubscriptionStatus;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  }): Promise<void> {
    return upsertSubscriptionForOrgImpl(this.resilientClient, params);
  }

  async downgradeOrgToFree(orgId: string): Promise<void> {
    return downgradeOrgToFreeImpl(this.resilientClient, orgId);
  }

  async setSubscriptionStatusByCustomer(params: {
    stripeCustomerId: string;
    status: SubscriptionStatus;
  }): Promise<void> {
    return setSubscriptionStatusByCustomerImpl(this.resilientClient, params);
  }

  async setSubscriptionStatusByStripeSubscription(params: {
    stripeSubscriptionId: string;
    status: SubscriptionStatus;
    tier?: SubscriptionTier;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
  }): Promise<void> {
    return setSubscriptionStatusByStripeSubscriptionImpl(this.resilientClient, params);
  }

  async createAuditEvent(params: CreateAuditEventParams): Promise<void> {
    return createAuditEventImpl(this.resilientClient, params);
  }

  async emitNotificationForOrg(params: {
    orgId: string;
    eventType: NotificationEventId;
    context?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    actionId?: string;
    ctaUrl?: string;
    ctaLabel?: string;
  }): Promise<{ created: number; queued: number }> {
    return emitNotificationForOrgImpl(this.resilientClient, params);
  }

  async registerPushEndpointForUser(params: {
    orgId: string;
    userId: string;
    destination: string;
    pushSubscription: string;
    preferences?: Record<string, boolean>;
  }): Promise<{ id: string }> {
    return registerPushEndpointForUserImpl(this.resilientClient, params);
  }

  async getNotificationDeliveryEvent(eventId: string): Promise<NotificationDeliveryEvent | null> {
    return getNotificationDeliveryEventImpl(this.resilientClient, eventId);
  }

  async markNotificationEventSent(eventId: string): Promise<void> {
    return markNotificationEventSentImpl(this.resilientClient, eventId);
  }

  async markNotificationEventFailed(params: {
    eventId: string;
    error: string;
    retryable?: boolean;
    deadLetterPayload?: Record<string, unknown>;
  }): Promise<{
    attempts: number;
    shouldRetry: boolean;
    status:
      | typeof NOTIFICATION_DELIVERY_STATUS.pending
      | typeof NOTIFICATION_DELIVERY_STATUS.failed;
    retryAfterMs: number | null;
    maxRetries: number;
  }> {
    return markNotificationEventFailedImpl(this.resilientClient, params);
  }

  async disableNotificationEndpoint(endpointId: string): Promise<void> {
    return disableNotificationEndpointImpl(this.resilientClient, endpointId);
  }

  async createInviteInternal(params: {
    orgId: string;
    inviterUserId: string;
    email: string;
    role: UserRole;
  }): Promise<{ inviteId: string; rawToken: string; orgName: string }> {
    return createInviteInternalImpl(this.resilientClient, params);
  }

  async acceptInviteInternal(params: {
    tokenHash: string;
    userId: string;
  }): Promise<{ orgId: string; orgName: string; role: UserRole }> {
    return acceptInviteInternalImpl(this.resilientClient, params);
  }

  async cleanupExpiredInvites(): Promise<{ expired: number }> {
    return cleanupExpiredInvitesImpl(this.resilientClient);
  }

  async storeInviteToken(params: {
    inviteId: string;
    orgId: string;
    email: string;
    rawToken: string;
    createdAt: string;
  }): Promise<void> {
    return storeInviteTokenImpl(this.resilientClient, params);
  }

  async resolveApiSessionFromToken(sessionToken: string): Promise<{
    userId: string;
    orgId: string;
    role: UserRole;
  } | null> {
    return resolveApiSessionFromTokenImpl(this.resilientClient, sessionToken);
  }

  async recordProviderMetric(params: {
    orgId: string;
    metric: ProviderMetricName;
    provider?: CanonicalProviderId;
    providerInput?: string;
    route?: string;
    outcome?: ProviderMetricOutcome;
    reasonCode?: string;
    value?: number;
  }): Promise<void> {
    return recordProviderMetricImpl(this.resilientClient, params);
  }
}
