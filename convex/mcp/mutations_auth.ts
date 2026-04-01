import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { nowIso, randomIdFor } from "../_auth";
import {
  ABUSE_FLAG_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  WORKSPACE_STATUS,
  isAutomationRunTerminalStatus,
} from "../domain_constants";
import { MCP_CREDENTIAL_AUTH_STATUS } from "../mcp_runtime_shared";
import { normalizeAutomationRunStatus } from "../automation_run_status";
import { toWorkspaceBoundary } from "../workspaces_shared";
import { workspaceValidator } from "./shared";

const AUTH_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LOCKOUT_THRESHOLD = 10;
const CREDENTIAL_SHARING_WINDOW_MS = 60 * 60 * 1000;
const CREDENTIAL_SHARING_THRESHOLD = 5;

const sha256Hex = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const authenticateCredential = internalMutation({
  args: {
    workspaceId: v.string(),
    secret: v.string(),
    ipHash: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      status: v.literal(MCP_CREDENTIAL_AUTH_STATUS.ok),
      credential_id: v.string(),
      workspace: workspaceValidator,
      automation_run_id: v.optional(v.string()),
    }),
    v.object({
      status: v.literal(MCP_CREDENTIAL_AUTH_STATUS.suspended),
      reason: v.string(),
    }),
    v.object({
      status: v.literal(MCP_CREDENTIAL_AUTH_STATUS.locked),
      retry_after_ms: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .unique();
    if (!workspace || workspace.status !== WORKSPACE_STATUS.active) {
      return null;
    }

    const now = Date.now();
    const failureRows = args.ipHash
      ? await ctx.db
          .query("credential_auth_failures")
          .withIndex("by_workspace_ip", (q) =>
            q.eq("workspace_id", args.workspaceId).eq("ip_hash", args.ipHash!),
          )
          .collect()
      : [];
    const failure = failureRows[0] ?? null;

    if (failure?.locked_at) {
      const lockedAt = Date.parse(failure.locked_at);
      if (Number.isFinite(lockedAt) && now - lockedAt < AUTH_LOCKOUT_WINDOW_MS) {
        return {
          status: MCP_CREDENTIAL_AUTH_STATUS.locked,
          retry_after_ms: Math.max(1000, AUTH_LOCKOUT_WINDOW_MS - (now - lockedAt)),
        };
      }

      await ctx.db.patch(failure._id, {
        locked_at: null,
        attempt_count: 0,
      });
    }

    const hashed = await sha256Hex(args.secret);
    const matches = await ctx.db
      .query("workspace_credentials")
      .withIndex("by_hashed_secret", (q) => q.eq("hashed_secret", hashed))
      .collect();

    const credential = matches.find(
      (entry) => entry.workspace_id === args.workspaceId && entry.revoked_at === null,
    );
    if (!credential) {
      if (!args.ipHash) {
        return null;
      }

      const nowTimestamp = nowIso();
      if (!failure) {
        await ctx.db.insert("credential_auth_failures", {
          id: randomIdFor("authfail"),
          workspace_id: args.workspaceId,
          ip_hash: args.ipHash,
          attempt_count: 1,
          first_attempt_at: nowTimestamp,
          last_attempt_at: nowTimestamp,
          locked_at: null,
        });
        await ctx.db.insert("audit_events", {
          id: randomIdFor("audit"),
          org_id: workspace.org_id,
          actor_type: AUDIT_ACTOR_TYPE.system,
          actor_id: "auth",
          event_type: AUDIT_EVENT_TYPES.securityCredentialAuthFailed,
          payload: {
            workspace_id: args.workspaceId,
            ip_hash: args.ipHash,
            attempt_count: 1,
          },
          created_at: nowTimestamp,
        });
        return null;
      }

      const lastAttempt = Date.parse(failure.last_attempt_at);
      const withinWindow =
        Number.isFinite(lastAttempt) && now - lastAttempt < AUTH_LOCKOUT_WINDOW_MS;
      const nextAttemptCount = withinWindow ? failure.attempt_count + 1 : 1;
      const nextFirstAttemptAt = withinWindow ? failure.first_attempt_at : nowTimestamp;
      const shouldLock = nextAttemptCount >= AUTH_LOCKOUT_THRESHOLD;
      const lockedAt = shouldLock ? nowTimestamp : null;

      await ctx.db.patch(failure._id, {
        attempt_count: nextAttemptCount,
        first_attempt_at: nextFirstAttemptAt,
        last_attempt_at: nowTimestamp,
        locked_at: lockedAt,
      });

      await ctx.db.insert("audit_events", {
        id: randomIdFor("audit"),
        org_id: workspace.org_id,
        actor_type: AUDIT_ACTOR_TYPE.system,
        actor_id: "auth",
        event_type: shouldLock
          ? AUDIT_EVENT_TYPES.securityCredentialLocked
          : AUDIT_EVENT_TYPES.securityCredentialAuthFailed,
        payload: {
          workspace_id: args.workspaceId,
          ip_hash: args.ipHash,
          attempt_count: nextAttemptCount,
          threshold: AUTH_LOCKOUT_THRESHOLD,
        },
        created_at: nowTimestamp,
      });

      if (shouldLock) {
        return {
          status: MCP_CREDENTIAL_AUTH_STATUS.locked,
          retry_after_ms: AUTH_LOCKOUT_WINDOW_MS,
        };
      }

      return null;
    }

    const automationRunId =
      typeof credential.metadata?.automation_run_id === "string"
        ? credential.metadata.automation_run_id.trim()
        : null;
    if (automationRunId) {
      const automationRun = await ctx.db
        .query("automation_runs")
        .withIndex("by_custom_id", (q) => q.eq("id", automationRunId))
        .unique();
      const isActiveAutomationCredential =
        automationRun !== null &&
        automationRun.workspace_id === args.workspaceId &&
        !isAutomationRunTerminalStatus(normalizeAutomationRunStatus(automationRun));
      if (!isActiveAutomationCredential) {
        await ctx.db.patch(credential._id, { revoked_at: nowIso() });
        return null;
      }
    }

    if (failure && (failure.attempt_count > 0 || failure.locked_at !== null)) {
      await ctx.db.patch(failure._id, {
        attempt_count: 0,
        locked_at: null,
        first_attempt_at: nowIso(),
        last_attempt_at: nowIso(),
      });
    }

    const suspensionRows = await ctx.db
      .query("org_suspensions")
      .withIndex("by_org", (q) => q.eq("org_id", workspace.org_id))
      .collect();
    const activeSuspension = suspensionRows.find((row) => row.lifted_at === null);
    if (activeSuspension) {
      return {
        status: MCP_CREDENTIAL_AUTH_STATUS.suspended,
        reason: activeSuspension.reason,
      };
    }

    return {
      status: MCP_CREDENTIAL_AUTH_STATUS.ok,
      credential_id: credential.id,
      workspace: toWorkspaceBoundary(workspace),
      ...(automationRunId ? { automation_run_id: automationRunId } : {}),
    };
  },
});

export const markCredentialUsed = internalMutation({
  args: {
    credentialId: v.string(),
    ipHash: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const credential = await ctx.db
      .query("workspace_credentials")
      .withIndex("by_custom_id", (q) => q.eq("id", args.credentialId))
      .unique();
    if (credential) {
      const currentTimestamp = nowIso();
      await ctx.db.patch(credential._id, { last_used_at: currentTimestamp });

      if (args.ipHash) {
        const usageRows = await ctx.db
          .query("credential_usage_observations")
          .withIndex("by_credential_ip", (q) =>
            q.eq("credential_id", credential.id).eq("ip_hash", args.ipHash!),
          )
          .collect();
        const existingUsage = usageRows[0] ?? null;
        if (existingUsage) {
          await ctx.db.patch(existingUsage._id, {
            last_seen_at: currentTimestamp,
          });
        } else {
          await ctx.db.insert("credential_usage_observations", {
            id: randomIdFor("credip"),
            credential_id: credential.id,
            workspace_id: credential.workspace_id,
            ip_hash: args.ipHash,
            first_seen_at: currentTimestamp,
            last_seen_at: currentTimestamp,
          });
        }

        const recentCutoff = new Date(Date.now() - CREDENTIAL_SHARING_WINDOW_MS).toISOString();
        const recentUsage = await ctx.db
          .query("credential_usage_observations")
          .withIndex("by_credential", (q) => q.eq("credential_id", credential.id))
          .collect();
        const distinctRecentIps = new Set(
          recentUsage.filter((row) => row.last_seen_at >= recentCutoff).map((row) => row.ip_hash),
        );

        if (distinctRecentIps.size > CREDENTIAL_SHARING_THRESHOLD) {
          const workspace = await ctx.db
            .query("workspaces")
            .withIndex("by_custom_id", (q) => q.eq("id", credential.workspace_id))
            .unique();

          if (workspace) {
            const details = JSON.stringify({
              workspace_id: credential.workspace_id,
              credential_id: credential.id,
              distinct_ip_hashes: distinctRecentIps.size,
              threshold: CREDENTIAL_SHARING_THRESHOLD,
            });
            const existingFlag = await ctx.db
              .query("abuse_flags")
              .withIndex("by_org", (q) => q.eq("org_id", workspace.org_id))
              .collect();
            const duplicate = existingFlag.find(
              (row) =>
                row.status === ABUSE_FLAG_STATUS.open &&
                row.flag_type === "credential_sharing_suspect" &&
                row.details === details,
            );

            if (!duplicate) {
              await ctx.db.insert("abuse_flags", {
                id: randomIdFor("aflag"),
                org_id: workspace.org_id,
                flag_type: "credential_sharing_suspect",
                severity: "medium",
                details,
                status: ABUSE_FLAG_STATUS.open,
                reviewed_by: null,
                reviewed_at: null,
                created_at: currentTimestamp,
              });
              await ctx.db.insert("audit_events", {
                id: randomIdFor("audit"),
                org_id: workspace.org_id,
                actor_type: AUDIT_ACTOR_TYPE.system,
                actor_id: "mcp",
                event_type: AUDIT_EVENT_TYPES.securityCredentialSharingSuspect,
                payload: {
                  workspace_id: credential.workspace_id,
                  credential_id: credential.id,
                  distinct_ip_hashes: distinctRecentIps.size,
                  threshold: CREDENTIAL_SHARING_THRESHOLD,
                },
                created_at: currentTimestamp,
              });
            }
          }
        }
      }
    }
    return null;
  },
});
