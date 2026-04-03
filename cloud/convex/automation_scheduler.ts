import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../../convex/_generated/server";
import { getTierConfig } from "@keppo/shared/subscriptions";
import {
  getAiKeyModeLabel,
  getAiModelProviderLabel,
  AUTOMATION_DISPATCH_TOKEN_REUSE_WINDOW_MS,
} from "@keppo/shared/automations";
import {
  AUTOMATION_DISPATCH_ACTION_STATUS,
  AUTOMATION_STATUS,
  AUTOMATION_TRIGGER_EVENT_STATUS,
  AUTOMATION_TERMINATE_ACTION_STATUS,
  AUTOMATION_RUN_ARCHIVED_LOG_ENCODING,
  AUTOMATION_RUN_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  RUN_STATUS,
  SUBSCRIPTION_TIER,
  RUN_TRIGGER_TYPE,
  type AutomationRunStatus,
  type SubscriptionTier,
} from "../../convex/domain_constants";
import { parseAutomationDispatchMissingAiKeyResponse } from "@keppo/shared/providers/boundaries/error-boundary";
import { parseApiJsonBoundary } from "@keppo/shared/providers/boundaries/json";
import { normalizeAutomationRunStatus } from "../../convex/automation_run_status";
import {
  automationDispatchActionStatusValidator,
  automationRunArchivedLogEncodingValidator,
  automationRunLogLevelValidator,
  automationTerminateActionStatusValidator,
} from "../../convex/validators";
import {
  automationSchedulerRefs,
  buildDispatchAutomationRunArgs,
  buildGetDispatchAuditContextArgs,
  buildTerminateAutomationRunArgs,
  dispatchAutomationRunArgsValidator,
  getDispatchAuditContextArgsValidator,
  terminateAutomationRunArgsValidator,
} from "../../convex/automation_scheduler_shared";
import { automationDispatchMissingAiKeyResponseSchema } from "@keppo/shared/providers/boundaries/api-schemas";

const refs = {
  getSubscriptionForOrg: makeFunctionReference<"query">("billing:getSubscriptionForOrg"),
  createAutomationRun: makeFunctionReference<"mutation">("automation_runs:createAutomationRun"),
  getAutomationRunDispatchContext: makeFunctionReference<"query">(
    "automation_runs:getAutomationRunDispatchContext",
  ),
  issueAutomationRunDispatchToken: makeFunctionReference<"mutation">(
    "automation_runs:issueAutomationRunDispatchToken",
  ),
  updateAutomationRunStatus: makeFunctionReference<"mutation">(
    "automation_runs:updateAutomationRunStatus",
  ),
  createAuditEvent: makeFunctionReference<"mutation">("mcp:createAuditEvent"),
  ...automationSchedulerRefs,
  listArchivableRunsForLogArchive: makeFunctionReference<"query">(
    "automation_scheduler:listArchivableRunsForLogArchive",
  ),
  getRunLogsForArchive: makeFunctionReference<"query">("automation_scheduler:getRunLogsForArchive"),
  finalizeRunLogArchive: makeFunctionReference<"mutation">(
    "automation_scheduler:finalizeRunLogArchive",
  ),
};

const nowMs = (): number => Date.now();
const HOT_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;
const runningLifecycleStatuses = new Set<AutomationRunStatus>([AUTOMATION_RUN_STATUS.running]);
const AUTOMATION_DISPATCH_PATH = "/internal/automations/dispatch";
const AUTOMATION_TERMINATE_PATH = "/internal/automations/terminate";
const DEFAULT_E2E_PORT_BASE = 9900;
const DEFAULT_E2E_PORT_BLOCK_SIZE = 20;
const DEFAULT_E2E_INTERNAL_ROUTE_PORT_OFFSET = 3;
const DEFAULT_SCHEDULE_SCAN_LIMIT = 200;
const DEFAULT_STALE_RUN_SCAN_LIMIT = 250;
const DEFAULT_LOG_ARCHIVE_SCAN_LIMIT = 500;
const DEFAULT_COLD_LOG_SCAN_LIMIT = 500;
const DISPATCH_RETRY_DELAY_MS = 1_000;
const textEncoder = new TextEncoder();
const DISPATCH_TOKEN_FALLBACK_DERIVATION_INFO = "keppo:dispatch-token:v1";

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const resolveNamespaceInternalBase = (namespace?: string): string | null => {
  if (!namespace) {
    return null;
  }
  const segments = namespace.split(".");
  if (segments.length < 4) {
    return null;
  }
  const workerIndex = Number(segments[1]);
  if (!Number.isInteger(workerIndex) || workerIndex < 0) {
    return null;
  }
  const basePort = Number.parseInt(process.env.KEPPO_E2E_PORT_BASE ?? "", 10);
  const blockSize = Number.parseInt(process.env.KEPPO_E2E_PORT_BLOCK_SIZE ?? "", 10);
  const safeBase =
    Number.isInteger(basePort) && basePort >= 1024 ? basePort : DEFAULT_E2E_PORT_BASE;
  const safeBlockSize =
    Number.isInteger(blockSize) && blockSize >= 5 ? blockSize : DEFAULT_E2E_PORT_BLOCK_SIZE;
  const port = safeBase + workerIndex * safeBlockSize + DEFAULT_E2E_INTERNAL_ROUTE_PORT_OFFSET;
  return `http://127.0.0.1:${port}`;
};

const resolveNamespaceCronSecret = (namespace?: string): string | null => {
  if (!namespace) {
    return null;
  }
  const segments = namespace.split(".");
  if (segments.length < 4) {
    return null;
  }
  const workerIndex = Number(segments[1]);
  if (!Number.isInteger(workerIndex) || workerIndex < 0) {
    return null;
  }
  return `e2e-cron-token-${workerIndex}`;
};

const resolveRootOwnedRouteUrl = (baseUrl: string, pathname: string): string => {
  try {
    return new URL(pathname, baseUrl).toString();
  } catch {
    return `${baseUrl.replace(/\/+$/, "")}${pathname}`;
  }
};

const resolveAutomationDispatchUrl = (namespace?: string): string | null => {
  const explicitUrl = process.env.KEPPO_AUTOMATION_DISPATCH_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }
  const explicitBase = process.env.KEPPO_API_INTERNAL_BASE_URL?.trim();
  if (explicitBase) {
    return resolveRootOwnedRouteUrl(explicitBase, AUTOMATION_DISPATCH_PATH);
  }
  const namespaceBase = resolveNamespaceInternalBase(namespace);
  if (namespaceBase) {
    return resolveRootOwnedRouteUrl(namespaceBase, AUTOMATION_DISPATCH_PATH);
  }
  return null;
};

const resolveAutomationTerminateUrl = (namespace?: string): string | null => {
  const explicitUrl = process.env.KEPPO_AUTOMATION_TERMINATE_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }
  const explicitBase = process.env.KEPPO_API_INTERNAL_BASE_URL?.trim();
  if (explicitBase) {
    return resolveRootOwnedRouteUrl(explicitBase, AUTOMATION_TERMINATE_PATH);
  }
  const namespaceBase = resolveNamespaceInternalBase(namespace);
  if (namespaceBase) {
    return resolveRootOwnedRouteUrl(namespaceBase, AUTOMATION_TERMINATE_PATH);
  }
  return null;
};

const resolveInternalAuthHeader = (namespace?: string): string | null => {
  const namespaceSecret = resolveNamespaceCronSecret(namespace)?.trim();
  if (process.env.KEPPO_E2E_MODE === "true" && namespaceSecret) {
    return `Bearer ${namespaceSecret}`;
  }
  const envSecret =
    process.env.KEPPO_CRON_SECRET ??
    process.env.KEPPO_QUEUE_SECRET ??
    process.env.VERCEL_CRON_SECRET;
  const secret = envSecret;
  if (!secret) {
    return null;
  }
  const trimmed = secret.trim();
  return trimmed.length > 0 ? `Bearer ${trimmed}` : null;
};

const applyVercelProtectionBypassHeader = (headers: Headers): Headers => {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (secret) {
    headers.set("x-vercel-protection-bypass", secret);
  }
  return headers;
};

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
};

const computeAutomationDispatchToken = async (
  runId: string,
  issuedAt: string,
): Promise<{ raw: string; hash: string }> => {
  const explicitSecret = process.env.KEPPO_AUTOMATION_DISPATCH_TOKEN_SECRET?.trim();
  const masterKey = process.env.KEPPO_MASTER_KEY?.trim();
  const secret = explicitSecret || masterKey;
  if (!secret) {
    throw new Error(
      "Missing KEPPO_AUTOMATION_DISPATCH_TOKEN_SECRET or KEPPO_MASTER_KEY for automation dispatch token derivation.",
    );
  }
  const keyMaterial =
    explicitSecret || !masterKey
      ? textEncoder.encode(secret)
      : new Uint8Array(
          await crypto.subtle.sign(
            "HMAC",
            await crypto.subtle.importKey(
              "raw",
              textEncoder.encode(masterKey),
              { name: "HMAC", hash: "SHA-256" },
              false,
              ["sign"],
            ),
            textEncoder.encode(DISPATCH_TOKEN_FALLBACK_DERIVATION_INFO),
          ),
        );
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(`${runId}:${issuedAt}`),
  );
  const raw = `dispatch_${bytesToHex(new Uint8Array(signature))}`;
  return {
    raw,
    hash: await sha256Hex(raw),
  };
};

const getAutomationDispatchHttpErrorMessage = (response: {
  status: number;
  bodyText: string;
}): string => {
  let errorMessage = `${response.status} ${response.bodyText.slice(0, 400)}`;
  try {
    const parsed = parseApiJsonBoundary(
      response.bodyText,
      automationDispatchMissingAiKeyResponseSchema,
      {
        defaultCode: "invalid_automation_dispatch_response",
        message: "Invalid automation dispatch response payload.",
      },
    );
    const missingAiKey = parseAutomationDispatchMissingAiKeyResponse(parsed);
    if (missingAiKey.status === "missing_ai_key") {
      const providerLabel = getAiModelProviderLabel(missingAiKey.provider);
      if (missingAiKey.key_mode === "bundled") {
        errorMessage = `Bundled ${providerLabel} access is unavailable for this org. Please contact support.`;
      } else {
        const keyModeLabel = getAiKeyModeLabel(missingAiKey.key_mode);
        errorMessage = `No active ${providerLabel} ${keyModeLabel} found. Add or activate one in Settings → AI Keys.`;
      }
    }
  } catch {
    // body was not JSON; keep raw error message
  }
  return errorMessage;
};

const matchCronField = (field: string, value: number, max: number): boolean => {
  if (field === "*") {
    return true;
  }
  for (const part of field.split(",")) {
    const stepMatch = /^(\*|\d+(-\d+)?)\/(\d+)$/.exec(part);
    if (stepMatch) {
      const step = Number(stepMatch[3]);
      if (step <= 0) continue;
      const rangeMatch = /^(\d+)-(\d+)$/.exec(stepMatch[1] ?? "");
      const start = rangeMatch
        ? Number(rangeMatch[1])
        : stepMatch[1] === "*"
          ? 0
          : Number(stepMatch[1]);
      const end = rangeMatch ? Number(rangeMatch[2]) : max;
      if (value >= start && value <= end && (value - start) % step === 0) return true;
      continue;
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(part);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (value >= start && value <= end) return true;
      continue;
    }
    if (/^\d+$/.test(part)) {
      if (Number(part) === value) return true;
      continue;
    }
  }
  return false;
};

export const shouldRunAt = (cronExpr: string, now: Date, lastRunAt: Date | null): boolean => {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minuteField, hourField, domField, monthField, dowField] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();
  const dom = now.getUTCDate();
  const month = now.getUTCMonth() + 1;
  const dow = now.getUTCDay();

  if (!matchCronField(minuteField, minute, 59)) return false;
  if (!matchCronField(hourField, hour, 23)) return false;
  if (!matchCronField(domField, dom, 31)) return false;
  if (!matchCronField(monthField, month, 12)) return false;
  if (!matchCronField(dowField, dow, 6)) return false;

  if (lastRunAt) {
    const lastMinuteStart = new Date(lastRunAt);
    lastMinuteStart.setUTCSeconds(0, 0);
    const nowMinuteStart = new Date(now);
    nowMinuteStart.setUTCSeconds(0, 0);
    if (lastMinuteStart.getTime() === nowMinuteStart.getTime()) return false;
  }

  return true;
};

const clampPositiveLimit = (raw: number | undefined, fallback: number, max = 2_000): number => {
  const parsed = Math.floor(raw ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, parsed));
};

const loadCurrentConfig = async (ctx: MutationCtx, configVersionId: string) => {
  return await ctx.db
    .query("automation_config_versions")
    .withIndex("by_custom_id", (q) => q.eq("id", configVersionId))
    .unique();
};

const getLastScheduledRunForAutomation = async (ctx: MutationCtx, automationId: string) => {
  const rows = await ctx.db
    .query("automation_runs")
    .withIndex("by_automation_trigger_started", (q) =>
      q.eq("automation_id", automationId).eq("trigger_type", RUN_TRIGGER_TYPE.schedule),
    )
    .order("desc")
    .take(1);
  return rows[0] ?? null;
};

const archivedRunCandidateValidator = v.object({
  run_id: v.string(),
  ended_at: v.string(),
});

const archivedRunLogLineValidator = v.object({
  seq: v.number(),
  level: automationRunLogLevelValidator,
  content: v.string(),
  timestamp: v.string(),
});

export const checkScheduledAutomations = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    dispatched: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const scanLimit = clampPositiveLimit(args.limit, DEFAULT_SCHEDULE_SCAN_LIMIT);
    const automations = await ctx.db
      .query("automations")
      .withIndex("by_status", (q) => q.eq("status", AUTOMATION_STATUS.active))
      .take(scanLimit);
    let scanned = 0;
    let dispatched = 0;
    let skipped = 0;
    const now = nowMs();

    for (const automation of automations) {
      scanned += 1;
      const config = await loadCurrentConfig(ctx, automation.current_config_version_id);
      if (!config || config.trigger_type !== RUN_TRIGGER_TYPE.schedule || !config.schedule_cron) {
        skipped += 1;
        continue;
      }

      const lastScheduled = await getLastScheduledRunForAutomation(ctx, automation.id);
      const lastRunDate = lastScheduled
        ? new Date(Date.parse(lastScheduled.created_at ?? lastScheduled.started_at))
        : null;
      const due = shouldRunAt(
        config.schedule_cron,
        new Date(now),
        lastRunDate && !Number.isNaN(lastRunDate.getTime()) ? lastRunDate : null,
      );

      if (!due) {
        skipped += 1;
        continue;
      }

      let run;
      try {
        run = await ctx.runMutation(refs.createAutomationRun, {
          automation_id: automation.id,
          trigger_type: RUN_TRIGGER_TYPE.schedule,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await ctx
          .runMutation(refs.createAuditEvent, {
            orgId: automation.org_id,
            actorType: AUDIT_ACTOR_TYPE.system,
            actorId: "automation_scheduler",
            eventType: AUDIT_EVENT_TYPES.queueDispatchScheduleFailed,
            payload: {
              source: "check_scheduled_automations",
              automation_id: automation.id,
              error: errorMessage,
            },
          })
          .catch(() => undefined);
        skipped += 1;
        continue;
      }
      try {
        await ctx.scheduler.runAfter(
          0,
          refs.dispatchAutomationRun,
          buildDispatchAutomationRunArgs(run.id),
        );
        dispatched += 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await ctx.runMutation(refs.updateAutomationRunStatus, {
          automation_run_id: run.id,
          status: AUTOMATION_RUN_STATUS.cancelled,
          error_message: "Dispatch failed: unable to schedule dispatch action",
        });
        await ctx
          .runMutation(refs.createAuditEvent, {
            orgId: automation.org_id,
            actorType: AUDIT_ACTOR_TYPE.system,
            actorId: "automation_scheduler",
            eventType: AUDIT_EVENT_TYPES.queueDispatchScheduleFailed,
            payload: {
              source: "check_scheduled_automations",
              automation_id: automation.id,
              automation_run_id: run.id,
              error: errorMessage,
            },
          })
          .catch(() => undefined);
        skipped += 1;
      }
    }

    return { scanned, dispatched, skipped };
  },
});

export const getDispatchAuditContext = internalQuery({
  args: getDispatchAuditContextArgsValidator,
  returns: v.union(
    v.object({
      orgId: v.string(),
      automationId: v.union(v.string(), v.null()),
      workspaceId: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("automation_runs")
      .withIndex("by_custom_id", (q) => q.eq("id", args.runId))
      .unique();
    if (!run || !run.org_id) {
      return null;
    }
    return {
      orgId: run.org_id,
      automationId: run.automation_id ?? null,
      workspaceId: run.workspace_id ?? null,
    };
  },
});

export const dispatchAutomationRun = internalAction({
  args: dispatchAutomationRunArgsValidator,
  returns: v.object({
    dispatched: v.boolean(),
    status: automationDispatchActionStatusValidator,
    http_status: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const dispatchAuditContext = await ctx.runQuery(
      refs.getDispatchAuditContext,
      buildGetDispatchAuditContextArgs(args.runId),
    );
    const emitDispatchFailureAudit = async (errorMessage: string, source: string) => {
      if (!dispatchAuditContext) {
        return;
      }
      await ctx
        .runMutation(refs.createAuditEvent, {
          orgId: dispatchAuditContext.orgId,
          actorType: AUDIT_ACTOR_TYPE.system,
          actorId: "automation_scheduler",
          eventType: AUDIT_EVENT_TYPES.queueDispatchScheduleFailed,
          payload: {
            source,
            automation_run_id: args.runId,
            automation_id: dispatchAuditContext.automationId,
            workspace_id: dispatchAuditContext.workspaceId,
            error: errorMessage,
          },
        })
        .catch(() => undefined);
    };

    const dispatchUrl = resolveAutomationDispatchUrl(args.namespace);
    if (!dispatchUrl) {
      await emitDispatchFailureAudit(
        "Missing KEPPO_AUTOMATION_DISPATCH_URL",
        "dispatch_action_config",
      );
      await ctx
        .runMutation(refs.updateAutomationRunStatus, {
          automation_run_id: args.runId,
          status: AUTOMATION_RUN_STATUS.cancelled,
          error_message: "Dispatch failed: missing KEPPO_AUTOMATION_DISPATCH_URL",
        })
        .catch(() => undefined);
      return {
        dispatched: false,
        status: AUTOMATION_DISPATCH_ACTION_STATUS.dispatchUrlMissing,
        http_status: null,
      };
    }

    const headers = new Headers({
      "content-type": "application/json",
    });
    const authorization = resolveInternalAuthHeader(args.namespace);
    if (authorization) {
      headers.set("authorization", authorization);
    }
    applyVercelProtectionBypassHeader(headers);

    try {
      const nextIssuedAt = new Date().toISOString();
      const dispatchToken = await computeAutomationDispatchToken(args.runId, nextIssuedAt);
      const issued = await ctx.runMutation(refs.issueAutomationRunDispatchToken, {
        automation_run_id: args.runId,
        dispatch_token: dispatchToken.raw,
        dispatch_token_hash: dispatchToken.hash,
        dispatch_token_issued_at: nextIssuedAt,
      });
      const response = await fetch(dispatchUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          automation_run_id: args.runId,
          dispatch_token: issued.dispatch_token,
        }),
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        const errorMessage = getAutomationDispatchHttpErrorMessage({
          status: response.status,
          bodyText,
        });
        const responseStatus = (() => {
          try {
            const parsed = JSON.parse(bodyText) as { status?: unknown };
            return typeof parsed.status === "string" ? parsed.status : null;
          } catch {
            return null;
          }
        })();
        if (response.status === 404 && responseStatus === "run_not_found") {
          const latestContext = await ctx.runQuery(refs.getAutomationRunDispatchContext, {
            automation_run_id: args.runId,
          });
          if (!latestContext || latestContext.run.status !== AUTOMATION_RUN_STATUS.pending) {
            return {
              dispatched: false,
              status: AUTOMATION_DISPATCH_ACTION_STATUS.dispatchRunNotPending,
              http_status: response.status,
            };
          }
          await emitDispatchFailureAudit(errorMessage, "dispatch_action_http");
          if (issued.reused_existing_token) {
            await ctx.scheduler.runAfter(
              DISPATCH_RETRY_DELAY_MS,
              refs.dispatchAutomationRun,
              buildDispatchAutomationRunArgs(args.runId, args.namespace),
            );
            return {
              dispatched: false,
              status: AUTOMATION_DISPATCH_ACTION_STATUS.dispatchHttpError,
              http_status: response.status,
            };
          }
          await ctx
            .runMutation(refs.updateAutomationRunStatus, {
              automation_run_id: args.runId,
              status: AUTOMATION_RUN_STATUS.cancelled,
              error_message: `Dispatch failed: ${errorMessage}`,
            })
            .catch(() => undefined);
          return {
            dispatched: false,
            status: AUTOMATION_DISPATCH_ACTION_STATUS.dispatchHttpError,
            http_status: response.status,
          };
        }
        await emitDispatchFailureAudit(errorMessage, "dispatch_action_http");
        await ctx
          .runMutation(refs.updateAutomationRunStatus, {
            automation_run_id: args.runId,
            status: AUTOMATION_RUN_STATUS.cancelled,
            error_message: `Dispatch failed: ${errorMessage}`,
          })
          .catch(() => undefined);
        return {
          dispatched: false,
          status: AUTOMATION_DISPATCH_ACTION_STATUS.dispatchHttpError,
          http_status: response.status,
        };
      }

      return {
        dispatched: true,
        status: AUTOMATION_DISPATCH_ACTION_STATUS.dispatched,
        http_status: response.status,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage === "AutomationRunNotPending") {
        return {
          dispatched: false,
          status: AUTOMATION_DISPATCH_ACTION_STATUS.dispatchRunNotPending,
          http_status: null,
        };
      }
      await emitDispatchFailureAudit(errorMessage, "dispatch_action_request");
      await ctx
        .runMutation(refs.updateAutomationRunStatus, {
          automation_run_id: args.runId,
          status: AUTOMATION_RUN_STATUS.cancelled,
          error_message: `Dispatch failed: ${errorMessage}`,
        })
        .catch(() => undefined);
      return {
        dispatched: false,
        status: AUTOMATION_DISPATCH_ACTION_STATUS.dispatchRequestFailed,
        http_status: null,
      };
    }
  },
});

export const terminateAutomationRun = internalAction({
  args: terminateAutomationRunArgsValidator,
  returns: v.object({
    terminated: v.boolean(),
    status: automationTerminateActionStatusValidator,
    http_status: v.union(v.number(), v.null()),
  }),
  handler: async (_ctx, args) => {
    const terminateUrl = resolveAutomationTerminateUrl(args.namespace);
    if (!terminateUrl) {
      return {
        terminated: false,
        status: AUTOMATION_TERMINATE_ACTION_STATUS.terminateUrlMissing,
        http_status: null,
      };
    }

    const headers = new Headers({
      "content-type": "application/json",
    });
    const authorization = resolveInternalAuthHeader(args.namespace);
    if (authorization) {
      headers.set("authorization", authorization);
    }
    applyVercelProtectionBypassHeader(headers);

    try {
      const response = await fetch(terminateUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          automation_run_id: args.runId,
        }),
      });
      if (!response.ok) {
        return {
          terminated: false,
          status: AUTOMATION_TERMINATE_ACTION_STATUS.terminateHttpError,
          http_status: response.status,
        };
      }
      return {
        terminated: true,
        status: AUTOMATION_TERMINATE_ACTION_STATUS.terminated,
        http_status: null,
      };
    } catch {
      return {
        terminated: false,
        status: AUTOMATION_TERMINATE_ACTION_STATUS.terminateRequestFailed,
        http_status: null,
      };
    }
  },
});

export const reapStaleRuns = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.object({
    timed_out_count: v.number(),
  }),
  handler: async (ctx, args) => {
    const scanLimit = clampPositiveLimit(args.limit, DEFAULT_STALE_RUN_SCAN_LIMIT);
    const activeRows = await ctx.db
      .query("automation_runs")
      .withIndex("by_status_started", (q) => q.eq("status", RUN_STATUS.active))
      .take(scanLimit);
    const rows = activeRows.filter((row) =>
      runningLifecycleStatuses.has(normalizeAutomationRunStatus(row)),
    );
    const orgTier = new Map<string, SubscriptionTier>();
    let timedOutCount = 0;
    const now = nowMs();

    for (const row of rows) {
      if (!row.automation_id || !row.org_id) {
        continue;
      }
      const startedAtMs = Date.parse(row.started_at);
      if (Number.isNaN(startedAtMs)) {
        continue;
      }

      let tier = orgTier.get(row.org_id);
      if (!tier) {
        const subscription = await ctx.runQuery(refs.getSubscriptionForOrg, { orgId: row.org_id });
        const resolvedTier: SubscriptionTier = subscription?.tier ?? SUBSCRIPTION_TIER.free;
        tier = resolvedTier;
        orgTier.set(row.org_id, tier);
      }
      const resolvedTier = tier ?? SUBSCRIPTION_TIER.free;
      const maxDurationMs = getTierConfig(resolvedTier).automation_limits.max_run_duration_ms;
      if (now - startedAtMs <= maxDurationMs) {
        continue;
      }

      await ctx.runMutation(refs.updateAutomationRunStatus, {
        automation_run_id: row.id,
        status: AUTOMATION_RUN_STATUS.timedOut,
        error_message: "Run exceeded max duration",
      });
      await ctx.scheduler
        .runAfter(0, refs.terminateAutomationRun, buildTerminateAutomationRunArgs(row.id))
        .catch(() => undefined);
      timedOutCount += 1;
    }

    return {
      timed_out_count: timedOutCount,
    };
  },
});

export const listArchivableRunsForLogArchive = internalQuery({
  args: {
    limit: v.optional(v.number()),
    scanLimit: v.optional(v.number()),
  },
  returns: v.array(archivedRunCandidateValidator),
  handler: async (ctx, args) => {
    const limit = clampPositiveLimit(args.limit, 25);
    const scanLimit = clampPositiveLimit(
      args.scanLimit,
      Math.max(limit, DEFAULT_LOG_ARCHIVE_SCAN_LIMIT),
    );
    const now = nowMs();
    return (
      await Promise.all([
        ctx.db
          .query("automation_runs")
          .withIndex("by_status_ended", (q) => q.eq("status", RUN_STATUS.ended))
          .take(scanLimit),
        ctx.db
          .query("automation_runs")
          .withIndex("by_status_ended", (q) => q.eq("status", RUN_STATUS.timedOut))
          .take(scanLimit),
      ])
    )
      .flat()
      .filter((run) => {
        if (run.log_storage_id || !run.ended_at) {
          return false;
        }
        const endedAtMs = Date.parse(run.ended_at);
        return Number.isFinite(endedAtMs) && now - endedAtMs >= HOT_LOG_RETENTION_MS;
      })
      .sort((a, b) => a.ended_at!.localeCompare(b.ended_at!))
      .slice(0, limit)
      .map((run) => ({
        run_id: run.id,
        ended_at: run.ended_at!,
      }));
  },
});

export const getRunLogsForArchive = internalQuery({
  args: {
    automation_run_id: v.string(),
  },
  returns: v.array(archivedRunLogLineValidator),
  handler: async (ctx, args) => {
    const lines = await ctx.db
      .query("automation_run_logs")
      .withIndex("by_run_seq", (q) => q.eq("automation_run_id", args.automation_run_id))
      .collect();
    return lines.map((line) => ({
      seq: line.seq,
      level: line.level,
      content: line.content,
      timestamp: line.timestamp,
    }));
  },
});

export const finalizeRunLogArchive = internalMutation({
  args: {
    automation_run_id: v.string(),
    storage_id: v.id("_storage"),
    archived_log_encoding: automationRunArchivedLogEncodingValidator,
    archived_log_line_count: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("automation_runs")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automation_run_id))
      .unique();
    if (!run || run.log_storage_id) {
      return false;
    }

    await ctx.db.patch(run._id, {
      log_storage_id: args.storage_id,
      metadata: {
        ...run.metadata,
        archived_log_encoding: args.archived_log_encoding,
        archived_log_line_count: args.archived_log_line_count,
      },
    });

    const logs = await ctx.db
      .query("automation_run_logs")
      .withIndex("by_run_seq", (q) => q.eq("automation_run_id", args.automation_run_id))
      .collect();
    for (const log of logs) {
      await ctx.db.delete(log._id);
    }

    return true;
  },
});

export const archiveHotLogs = internalAction({
  args: {
    limit: v.optional(v.number()),
    scanLimit: v.optional(v.number()),
  },
  returns: v.object({
    archived_count: v.number(),
  }),
  handler: async (ctx, args) => {
    const candidates = await ctx.runQuery(refs.listArchivableRunsForLogArchive, {
      limit: args.limit,
      scanLimit: args.scanLimit,
    });
    let archived = 0;
    for (const run of candidates) {
      const lines = (await ctx.runQuery(refs.getRunLogsForArchive, {
        automation_run_id: run.run_id,
      })) as Array<{
        seq: number;
        level: "stdout" | "stderr" | "system";
        content: string;
        timestamp: string;
      }>;
      if (lines.length === 0) {
        continue;
      }

      const payload = {
        version: 1,
        compressed: false,
        archived_at: new Date(nowMs()).toISOString(),
        run_id: run.run_id,
        lines: lines.map((line) => ({
          seq: line.seq,
          level: line.level,
          content: line.content,
          timestamp: line.timestamp,
        })),
      };

      const serialized = JSON.stringify(payload);
      const sourceBlob = new Blob([serialized], { type: "application/json" });
      const compressedBlob =
        typeof CompressionStream === "function"
          ? new Blob(
              [
                await new Response(
                  sourceBlob.stream().pipeThrough(new CompressionStream("gzip")),
                ).arrayBuffer(),
              ],
              { type: "application/gzip" },
            )
          : sourceBlob;

      const storageId = await ctx.storage.store(compressedBlob);
      const finalized = await ctx.runMutation(refs.finalizeRunLogArchive, {
        automation_run_id: run.run_id,
        storage_id: storageId,
        archived_log_encoding:
          typeof CompressionStream === "function"
            ? AUTOMATION_RUN_ARCHIVED_LOG_ENCODING.gzip
            : AUTOMATION_RUN_ARCHIVED_LOG_ENCODING.identity,
        archived_log_line_count: lines.length,
      });
      if (finalized) {
        archived += 1;
      }
    }

    return {
      archived_count: archived,
    };
  },
});

export const expireColdLogs = internalMutation({
  args: {
    limit: v.optional(v.number()),
    scanLimit: v.optional(v.number()),
  },
  returns: v.object({
    expired_count: v.number(),
  }),
  handler: async (ctx, args) => {
    const limit = clampPositiveLimit(args.limit, 25);
    const scanLimit = clampPositiveLimit(
      args.scanLimit,
      Math.max(limit, DEFAULT_COLD_LOG_SCAN_LIMIT),
    );
    const now = nowMs();
    const orgTier = new Map<string, SubscriptionTier>();
    const runs = (
      await Promise.all([
        ctx.db
          .query("automation_runs")
          .withIndex("by_status_ended", (q) => q.eq("status", RUN_STATUS.ended))
          .take(scanLimit),
        ctx.db
          .query("automation_runs")
          .withIndex("by_status_ended", (q) => q.eq("status", RUN_STATUS.timedOut))
          .take(scanLimit),
      ])
    )
      .flat()
      .filter((run) =>
        Boolean(run.automation_id && run.org_id && run.log_storage_id && run.ended_at),
      );

    let expired = 0;
    for (const run of runs) {
      if (expired >= limit || !run.org_id || !run.ended_at || !run.log_storage_id) {
        continue;
      }
      let tier = orgTier.get(run.org_id);
      if (!tier) {
        const subscription = await ctx.runQuery(refs.getSubscriptionForOrg, { orgId: run.org_id });
        const resolvedTier: SubscriptionTier = subscription?.tier ?? SUBSCRIPTION_TIER.free;
        tier = resolvedTier;
        orgTier.set(run.org_id, tier);
      }
      const resolvedTier = tier ?? SUBSCRIPTION_TIER.free;
      const retentionMs =
        getTierConfig(resolvedTier).automation_limits.log_retention_days * 24 * 60 * 60 * 1000;
      const endedAtMs = Date.parse(run.ended_at);
      if (Number.isNaN(endedAtMs) || now - endedAtMs <= retentionMs) {
        continue;
      }

      await ctx.storage.delete(run.log_storage_id);
      await ctx.db.patch(run._id, {
        log_storage_id: null,
      });
      expired += 1;
    }

    return {
      expired_count: expired,
    };
  },
});

export const processAutomationTriggerEvents = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.object({
    processed: v.number(),
    dispatched: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const limit = clampPositiveLimit(args.limit, 25);
    const pending = await ctx.db
      .query("automation_trigger_events")
      .withIndex("by_status_created", (q) =>
        q.eq("status", AUTOMATION_TRIGGER_EVENT_STATUS.pending),
      )
      .take(limit);

    let processed = 0;
    let dispatched = 0;
    let skipped = 0;

    for (const event of pending) {
      processed += 1;
      const automation = await ctx.db
        .query("automations")
        .withIndex("by_custom_id", (q) => q.eq("id", event.automation_id))
        .unique();
      if (!automation || automation.status !== AUTOMATION_STATUS.active) {
        await ctx.db.patch(event._id, {
          status: AUTOMATION_TRIGGER_EVENT_STATUS.skipped,
          failure_reason: "automation_inactive",
        });
        skipped += 1;
        continue;
      }

      try {
        const run = await ctx.runMutation(refs.createAutomationRun, {
          automation_id: automation.id,
          trigger_type: RUN_TRIGGER_TYPE.event,
          ...(event.config_version_id ? { config_version_id: event.config_version_id } : {}),
        });
        await ctx.scheduler.runAfter(
          0,
          refs.dispatchAutomationRun,
          buildDispatchAutomationRunArgs(run.id),
        );
        await ctx.db.patch(event._id, {
          status: AUTOMATION_TRIGGER_EVENT_STATUS.dispatched,
          failure_reason: null,
          automation_run_id: run.id,
        });
        dispatched += 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await ctx.db.patch(event._id, {
          status: AUTOMATION_TRIGGER_EVENT_STATUS.skipped,
          failure_reason: errorMessage.slice(0, 256),
        });
        await ctx
          .runMutation(refs.createAuditEvent, {
            orgId: automation.org_id,
            actorType: AUDIT_ACTOR_TYPE.system,
            actorId: "automation_scheduler",
            eventType: AUDIT_EVENT_TYPES.queueDispatchScheduleFailed,
            payload: {
              source: "process_automation_trigger_events",
              automation_id: automation.id,
              trigger_event_id: event.id,
              error: errorMessage,
            },
          })
          .catch(() => undefined);
        skipped += 1;
      }
    }

    return {
      processed,
      dispatched,
      skipped,
    };
  },
});
