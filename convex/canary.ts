import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { AUDIT_ACTOR_TYPE, AUDIT_EVENT_TYPES } from "./domain_constants";

const SYSTEM_ORG_ID = "system";
const SYNTHETIC_CANARY_JOB = "synthetic-canary";
const HEALTH_PATH = "/health";
const DEFAULT_E2E_PORT_BASE = 9900;
const DEFAULT_E2E_PORT_BLOCK_SIZE = 20;
const DEFAULT_E2E_API_PORT_OFFSET = 2;

const refs = {
  checkCronHealth: makeFunctionReference<"query">("cron_heartbeats:checkCronHealth"),
  createAuditEvent: makeFunctionReference<"mutation">("mcp:createAuditEvent"),
  resolveCanaryTarget: makeFunctionReference<"query">("canary:resolveCanaryTarget"),
};

type CanaryTarget = {
  orgId: string;
  workspaceId: string;
  credentialId: string;
} | null;

const resolveE2eApiBaseUrl = (): string | null => {
  const workerIndex = Number.parseInt(process.env.KEPPO_E2E_WORKER_INDEX ?? "", 10);
  if (!Number.isInteger(workerIndex) || workerIndex < 0) {
    return null;
  }
  const basePort = Number.parseInt(process.env.KEPPO_E2E_PORT_BASE ?? "", 10);
  const blockSize = Number.parseInt(process.env.KEPPO_E2E_PORT_BLOCK_SIZE ?? "", 10);
  const safeBase =
    Number.isInteger(basePort) && basePort >= 1024 ? basePort : DEFAULT_E2E_PORT_BASE;
  const safeBlockSize =
    Number.isInteger(blockSize) && blockSize >= 5 ? blockSize : DEFAULT_E2E_PORT_BLOCK_SIZE;
  const apiPort = safeBase + workerIndex * safeBlockSize + DEFAULT_E2E_API_PORT_OFFSET;
  return `http://127.0.0.1:${apiPort}`;
};

const toOrigin = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const resolveApiBaseUrl = (): string | null => {
  const explicitBase = process.env.KEPPO_API_INTERNAL_BASE_URL?.trim();
  if (explicitBase) {
    return explicitBase.replace(/\/+$/, "");
  }
  const keppoUrl = process.env.KEPPO_URL?.trim();
  if (keppoUrl) {
    try {
      return new URL("/api", keppoUrl).toString().replace(/\/+$/, "");
    } catch {
      // Fall through to the remaining local/e2e-only heuristics.
    }
  }
  const queueConsumerOrigin = toOrigin(process.env.KEPPO_LOCAL_QUEUE_CONSUMER_URL);
  if (queueConsumerOrigin) {
    return queueConsumerOrigin;
  }
  return resolveE2eApiBaseUrl();
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const assertResponseOk = async (response: Response, label: string): Promise<void> => {
  if (response.ok) {
    return;
  }
  const body = await response.text().catch(() => "");
  const detail = body.trim();
  throw new Error(
    `${label} returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
  );
};

export const resolveCanaryTarget = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      orgId: v.string(),
      workspaceId: v.string(),
      credentialId: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx): Promise<CanaryTarget> => {
    const credential = await ctx.db
      .query("workspace_credentials")
      .withIndex("by_revoked_created", (q) => q.eq("revoked_at", null))
      .order("asc")
      .first();
    if (!credential) {
      return null;
    }

    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", credential.workspace_id))
      .unique();
    if (!workspace) {
      return null;
    }

    return {
      orgId: workspace.org_id,
      workspaceId: workspace.id,
      credentialId: credential.id,
    };
  },
});

export const runCanaryCheck = internalAction({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    checkedAt: v.string(),
    latencyMs: v.number(),
    apiBaseUrl: v.string(),
    targetWorkspaceId: v.string(),
    targetCredentialId: v.string(),
  }),
  handler: async (ctx) => {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    const target = await ctx.runQuery(refs.resolveCanaryTarget, {});
    const apiBaseUrl = resolveApiBaseUrl();
    const e2eMode = process.env.KEPPO_E2E_MODE === "true";

    try {
      if (!target) {
        throw new Error("Synthetic canary requires at least one active workspace credential.");
      }
      if (!apiBaseUrl) {
        if (e2eMode) {
          return {
            ok: true,
            checkedAt,
            latencyMs: Date.now() - startedAt,
            apiBaseUrl: "e2e:skipped",
            targetWorkspaceId: target.workspaceId,
            targetCredentialId: target.credentialId,
          };
        }
        throw new Error(
          "Synthetic canary could not derive an API base URL from KEPPO_URL, KEPPO_API_INTERNAL_BASE_URL, KEPPO_LOCAL_QUEUE_CONSUMER_URL, or E2E worker port settings.",
        );
      }

      const response = await fetch(`${apiBaseUrl}${HEALTH_PATH}`, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      await assertResponseOk(response, "Synthetic canary API health check");

      const cronRows = await ctx.runQuery(refs.checkCronHealth, {});
      const unhealthyJobs = cronRows.filter(
        (row: { jobName: string; status: string }) =>
          row.jobName !== SYNTHETIC_CANARY_JOB && row.status !== "healthy",
      );
      if (unhealthyJobs.length > 0) {
        throw new Error(
          `Synthetic canary found unhealthy cron jobs: ${unhealthyJobs
            .map((row: { jobName: string; status: string }) => `${row.jobName}:${row.status}`)
            .join(", ")}`,
        );
      }

      return {
        ok: true,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        apiBaseUrl,
        targetWorkspaceId: target.workspaceId,
        targetCredentialId: target.credentialId,
      };
    } catch (error) {
      const orgId = target?.orgId ?? SYSTEM_ORG_ID;
      const latencyMs = Date.now() - startedAt;
      await ctx.runMutation(refs.createAuditEvent, {
        orgId,
        actorType: AUDIT_ACTOR_TYPE.system,
        actorId: SYNTHETIC_CANARY_JOB,
        eventType: AUDIT_EVENT_TYPES.canaryFailed,
        payload: {
          api_base_url: apiBaseUrl,
          checked_at: checkedAt,
          latency_ms: latencyMs,
          target_workspace_id: target?.workspaceId ?? null,
          target_credential_id: target?.credentialId ?? null,
          error: toErrorMessage(error),
        },
      });
      throw error;
    }
  },
});
