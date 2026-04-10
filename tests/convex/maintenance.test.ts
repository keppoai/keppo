import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import {
  ACTION_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  CREDENTIAL_TYPE,
  INVITE_STATUS,
  RUN_STATUS,
} from "../../convex/domain_constants";
import { shouldContinueTimeoutSweep } from "../../convex/mcp/mutations_maintenance";
import { createConvexTestHarness, seedAutomationFixture } from "./harness";

const refs = {
  expirePendingActions: makeFunctionReference<"mutation">("mcp:expirePendingActions"),
  timeoutInactiveRuns: makeFunctionReference<"mutation">("mcp:timeoutInactiveRuns"),
  runSecurityMaintenance: makeFunctionReference<"mutation">("mcp:runSecurityMaintenance"),
  acquireLeaseInternal: makeFunctionReference<"mutation">("cron_heartbeats:acquireLeaseInternal"),
  recordSuccessInternal: makeFunctionReference<"mutation">("cron_heartbeats:recordSuccessInternal"),
  recordFailureInternal: makeFunctionReference<"mutation">("cron_heartbeats:recordFailureInternal"),
  scheduledMaintenanceSweepWithHeartbeat: makeFunctionReference<"action">(
    "cron_heartbeats:scheduledMaintenanceSweepWithHeartbeat",
  ),
  scheduledMaintenanceSweepManual: makeFunctionReference<"action">(
    "cron_heartbeats:scheduledMaintenanceSweepManual",
  ),
  checkCronHealth: makeFunctionReference<"query">("cron_heartbeats:checkCronHealth"),
};

describe("convex maintenance mutations", () => {
  it("times out only active runs that are old enough to be inactive", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_maintenance_timeout";
    const fixture = await seedAutomationFixture(t, orgId);
    const staleAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const recentAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    await t.run(async (ctx) => {
      await ctx.db.insert("automation_runs", {
        id: "run_stale",
        automation_id: fixture.automationId,
        org_id: orgId,
        workspace_id: fixture.workspaceId,
        config_version_id: fixture.configVersionId,
        trigger_type: "manual",
        error_message: null,
        sandbox_id: null,
        log_storage_id: null,
        created_at: staleAt,
        mcp_session_id: null,
        client_type: "other",
        metadata: {
          last_activity_at: staleAt,
        },
        started_at: staleAt,
        ended_at: null,
        status: RUN_STATUS.active,
      });

      await ctx.db.insert("automation_runs", {
        id: "run_recent",
        automation_id: fixture.automationId,
        org_id: orgId,
        workspace_id: fixture.workspaceId,
        config_version_id: fixture.configVersionId,
        trigger_type: "manual",
        error_message: null,
        sandbox_id: null,
        log_storage_id: null,
        created_at: recentAt,
        mcp_session_id: null,
        client_type: "other",
        metadata: {
          last_activity_at: recentAt,
        },
        started_at: recentAt,
        ended_at: null,
        status: RUN_STATUS.active,
      });
    });

    const timedOut = await t.mutation(refs.timeoutInactiveRuns, {
      inactivityMinutes: 30,
    });
    expect(timedOut).toBe(1);

    const [staleRun, recentRun] = await Promise.all([
      t.run((ctx) =>
        ctx.db
          .query("automation_runs")
          .withIndex("by_custom_id", (q) => q.eq("id", "run_stale"))
          .unique(),
      ),
      t.run((ctx) =>
        ctx.db
          .query("automation_runs")
          .withIndex("by_custom_id", (q) => q.eq("id", "run_recent"))
          .unique(),
      ),
    ]);

    expect(staleRun?.status).toBe(RUN_STATUS.timedOut);
    expect(staleRun?.ended_at).not.toBeNull();
    expect(recentRun?.status).toBe(RUN_STATUS.active);
    expect(recentRun?.ended_at).toBeNull();
  });

  it("bounds inactive-run maintenance to a single sweep batch", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_maintenance_timeout_batch";
    const fixture = await seedAutomationFixture(t, orgId);
    const staleAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    await t.run(async (ctx) => {
      for (let index = 0; index < 210; index += 1) {
        await ctx.db.insert("automation_runs", {
          id: `run_stale_batch_${index}`,
          automation_id: fixture.automationId,
          org_id: orgId,
          workspace_id: fixture.workspaceId,
          config_version_id: fixture.configVersionId,
          trigger_type: "manual",
          error_message: null,
          sandbox_id: null,
          log_storage_id: null,
          created_at: staleAt,
          mcp_session_id: null,
          client_type: "other",
          metadata: {
            last_activity_at: staleAt,
          },
          started_at: staleAt,
          ended_at: null,
          status: RUN_STATUS.active,
        });
      }
    });

    const timedOut = await t.mutation(refs.timeoutInactiveRuns, {
      inactivityMinutes: 30,
    });

    expect(timedOut).toBe(50);
  });

  it("does not continue timeout sweeps when the batch made no progress", () => {
    expect(
      shouldContinueTimeoutSweep({
        fetchedRuns: 50,
        timedOutRuns: 0,
      }),
    ).toBe(false);
    expect(
      shouldContinueTimeoutSweep({
        fetchedRuns: 49,
        timedOutRuns: 12,
      }),
    ).toBe(false);
    expect(
      shouldContinueTimeoutSweep({
        fetchedRuns: 50,
        timedOutRuns: 12,
      }),
    ).toBe(true);
  });

  it("bounds pending-action expiration to a single sweep batch", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_maintenance_expiration_batch";
    const fixture = await seedAutomationFixture(t, orgId);
    const expiredAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const runId = "run_pending_expiration_batch";

    await t.run(async (ctx) => {
      await ctx.db.insert("automation_runs", {
        id: runId,
        automation_id: fixture.automationId,
        org_id: orgId,
        workspace_id: fixture.workspaceId,
        config_version_id: fixture.configVersionId,
        trigger_type: "manual",
        error_message: null,
        sandbox_id: null,
        log_storage_id: null,
        created_at: expiredAt,
        mcp_session_id: null,
        client_type: "other",
        metadata: {},
        started_at: expiredAt,
        ended_at: null,
        status: RUN_STATUS.active,
      });
      for (let index = 0; index < 210; index += 1) {
        await ctx.db.insert("actions", {
          id: `act_pending_batch_${index}`,
          workspace_id: fixture.workspaceId,
          automation_run_id: runId,
          tool_call_id: `tool_pending_batch_${index}`,
          idempotency_key: `pending-batch-${index}`,
          action_type: "send_email",
          status: ACTION_STATUS.pending,
          risk_level: "medium",
          normalized_payload_enc: "invalid",
          payload_preview: { sequence: index },
          payload_purged_at: null,
          created_at: expiredAt,
          resolved_at: null,
          result_redacted: null,
        });
      }
    });

    const expired = await t.mutation(refs.expirePendingActions, {
      ttlMinutes: 30,
    });

    expect(expired).toBe(50);
  });

  it("expires pending actions and dismisses only in-app approval notifications", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_maintenance_expiration_notifications";
    const fixture = await seedAutomationFixture(t, orgId);
    const expiredAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const runId = "run_pending_expiration_notifications";
    const actionId = "act_pending_expiration_notifications";

    await t.run(async (ctx) => {
      await ctx.db.insert("automation_runs", {
        id: runId,
        automation_id: fixture.automationId,
        org_id: orgId,
        workspace_id: fixture.workspaceId,
        config_version_id: fixture.configVersionId,
        trigger_type: "manual",
        error_message: null,
        sandbox_id: null,
        log_storage_id: null,
        created_at: expiredAt,
        mcp_session_id: null,
        client_type: "other",
        metadata: {},
        started_at: expiredAt,
        ended_at: null,
        status: RUN_STATUS.active,
      });
      await ctx.db.insert("actions", {
        id: actionId,
        workspace_id: fixture.workspaceId,
        automation_run_id: runId,
        tool_call_id: "tool_pending_expiration_notifications",
        idempotency_key: "pending-expiration-notifications",
        action_type: "send_email",
        status: ACTION_STATUS.pending,
        risk_level: "medium",
        normalized_payload_enc: "invalid",
        payload_preview: { sequence: 1 },
        payload_purged_at: null,
        created_at: expiredAt,
        resolved_at: null,
        result_redacted: null,
      });
      await ctx.db.insert("notification_events", {
        id: "notif_inapp_approval_expire",
        org_id: orgId,
        event_type: "approval_needed",
        channel: NOTIFICATION_CHANNEL.inApp,
        title: "Approval required",
        body: "Pending action waiting for approval",
        cta_url: "/approvals",
        cta_label: "Review",
        metadata: JSON.stringify({ source: "maintenance-test" }),
        action_id: actionId,
        endpoint_id: null,
        read_at: null,
        status: NOTIFICATION_DELIVERY_STATUS.sent,
        attempts: 0,
        last_error: null,
        created_at: expiredAt,
      });
      await ctx.db.insert("notification_events", {
        id: "notif_email_approval_expire",
        org_id: orgId,
        event_type: "approval_needed",
        channel: NOTIFICATION_CHANNEL.email,
        title: "Approval required",
        body: "Delivery row should stay untouched",
        cta_url: "/approvals",
        cta_label: "Review",
        metadata: JSON.stringify({ source: "maintenance-test" }),
        action_id: actionId,
        endpoint_id: "endpoint_expire",
        read_at: null,
        status: NOTIFICATION_DELIVERY_STATUS.pending,
        attempts: 0,
        last_error: null,
        created_at: expiredAt,
      });
    });

    await expect(
      t.mutation(refs.expirePendingActions, {
        ttlMinutes: 30,
      }),
    ).resolves.toBe(1);

    const [action, inAppEvent, emailEvent] = await Promise.all([
      t.run((ctx) =>
        ctx.db
          .query("actions")
          .withIndex("by_custom_id", (q) => q.eq("id", actionId))
          .unique(),
      ),
      t.run((ctx) =>
        ctx.db
          .query("notification_events")
          .withIndex("by_custom_id", (q) => q.eq("id", "notif_inapp_approval_expire"))
          .unique(),
      ),
      t.run((ctx) =>
        ctx.db
          .query("notification_events")
          .withIndex("by_custom_id", (q) => q.eq("id", "notif_email_approval_expire"))
          .unique(),
      ),
    ]);

    expect(action?.status).toBe(ACTION_STATUS.expired);
    expect(action?.resolved_at).toBeTruthy();
    expect(inAppEvent?.read_at).toBeTruthy();
    expect(emailEvent?.read_at).toBeNull();
  });

  it("can continue credential-rotation scans past a fully already-recommended first batch", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_rotation_continuation";
    const fixture = await seedAutomationFixture(t, orgId);
    const createdAt = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const recentAuditAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const credentialId = (index: number) => `cred_rotation_${String(index).padStart(2, "0")}`;
    const firstBatchIds = Array.from({ length: 25 }, (_, index) => credentialId(index));

    await t.run(async (ctx) => {
      for (let index = 0; index < 30; index += 1) {
        await ctx.db.insert("workspace_credentials", {
          id: credentialId(index),
          workspace_id: fixture.workspaceId,
          type: CREDENTIAL_TYPE.bearerToken,
          hashed_secret: `hashed_secret_${index}`,
          last_used_at: createdAt,
          revoked_at: null,
          created_at: createdAt,
        });
      }

      for (const credentialId of firstBatchIds) {
        await ctx.db.insert("audit_events", {
          id: `audit_rotation_${credentialId}`,
          org_id: orgId,
          actor_type: AUDIT_ACTOR_TYPE.system,
          actor_id: "maintenance",
          event_type: AUDIT_EVENT_TYPES.securityCredentialRotationRecommended,
          payload: {
            workspace_id: fixture.workspaceId,
            credential_id: credentialId,
            credential_age_days: 120,
            threshold_days: 90,
          },
          created_at: recentAuditAt,
        });
      }
    });

    const firstPass = await t.mutation(refs.runSecurityMaintenance, {
      credentialRotationDays: 90,
    });
    expect(firstPass.credentialRotationRecommendations).toBe(0);

    const secondPass = await t.mutation(refs.runSecurityMaintenance, {
      credentialRotationDays: 90,
      rotationCursorCreatedAt: createdAt,
      rotationCursorId: credentialId(24),
    });
    expect(secondPass.credentialRotationRecommendations).toBe(5);
  });

  it("runs the maintenance cron wrapper, expires invites, and records a heartbeat", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_maintenance_cron_wrapper";
    await seedAutomationFixture(t, orgId);
    const expiredAt = new Date(Date.now() - 60_000).toISOString();

    await t.run(async (ctx) => {
      await ctx.db.insert("invites", {
        id: "inv_expired_wrapper",
        org_id: orgId,
        email: "expired@example.com",
        role: "viewer",
        token_hash: "hash_expired_wrapper",
        invited_by: "usr_test",
        status: INVITE_STATUS.pending,
        created_at: expiredAt,
        expires_at: expiredAt,
        accepted_at: null,
      });
    });

    const result = await t.action(refs.scheduledMaintenanceSweepWithHeartbeat, {});
    expect(result.queue).toEqual({
      attempted: 0,
      dispatched: 0,
      skipped: 0,
    });
    expect(result.skippedReason).toBeNull();
    expect(result.invites).toEqual({
      expired: 1,
    });

    const [invite, cronHealth] = await Promise.all([
      t.run((ctx) =>
        ctx.db
          .query("invites")
          .withIndex("by_custom_id", (q) => q.eq("id", "inv_expired_wrapper"))
          .unique(),
      ),
      t.query(refs.checkCronHealth, {}),
    ]);

    expect(invite?.status).toBe(INVITE_STATUS.expired);
    expect(cronHealth).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobName: "maintenance-sweep",
          status: "HEALTHY",
          consecutiveFailures: 0,
          lastSuccessAt: expect.any(String),
        }),
      ]),
    );
  });

  it("keeps manual maintenance available when preview omits the scheduled cron", async () => {
    vi.stubEnv("KEPPO_ENVIRONMENT", "preview");
    try {
      const t = createConvexTestHarness();
      const orgId = "org_convex_maintenance_manual_preview";
      await seedAutomationFixture(t, orgId);
      const expiredAt = new Date(Date.now() - 60_000).toISOString();

      await t.run(async (ctx) => {
        await ctx.db.insert("invites", {
          id: "inv_expired_manual_preview",
          org_id: orgId,
          email: "expired-preview@example.com",
          role: "viewer",
          token_hash: "hash_expired_manual_preview",
          invited_by: "usr_test",
          status: INVITE_STATUS.pending,
          created_at: expiredAt,
          expires_at: expiredAt,
          accepted_at: null,
        });
      });

      const result = await t.action(refs.scheduledMaintenanceSweepManual, {});
      expect(result.queue).toEqual({
        attempted: 0,
        dispatched: 0,
        skipped: 0,
      });
      expect(result.skippedReason).toBeNull();
      expect(result.invites).toEqual({
        expired: 1,
      });

      const invite = await t.run((ctx) =>
        ctx.db
          .query("invites")
          .withIndex("by_custom_id", (q) => q.eq("id", "inv_expired_manual_preview"))
          .unique(),
      );

      expect(invite?.status).toBe(INVITE_STATUS.expired);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("omits preview-disabled cron health entries even when stale heartbeat rows already exist", async () => {
    vi.stubEnv("KEPPO_ENVIRONMENT", "preview");
    try {
      const t = createConvexTestHarness();
      const staleAt = new Date(Date.now() - 30 * 60_000).toISOString();

      await t.run(async (ctx) => {
        await ctx.db.insert("cron_heartbeats", {
          id: "cron_preview_maintenance",
          job_name: "maintenance-sweep",
          last_success_at: staleAt,
          last_failure_at: null,
          last_error: null,
          consecutive_failures: 0,
          updated_at: staleAt,
        });
        await ctx.db.insert("cron_heartbeats", {
          id: "cron_preview_scheduler",
          job_name: "automation-scheduler-check",
          last_success_at: staleAt,
          last_failure_at: null,
          last_error: null,
          consecutive_failures: 0,
          updated_at: staleAt,
        });
      });

      const cronHealth = await t.query(refs.checkCronHealth, {});

      expect(cronHealth.map((job) => job.jobName)).not.toContain("maintenance-sweep");
      expect(cronHealth).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            jobName: "automation-scheduler-check",
            status: "STALE",
          }),
        ]),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("marks missing expected cron heartbeats stale once other cron activity proves the deployment has been live", async () => {
    const t = createConvexTestHarness();
    const staleAt = new Date(Date.now() - 30 * 60_000).toISOString();

    await t.run(async (ctx) => {
      await ctx.db.insert("cron_heartbeats", {
        id: "cron_prod_scheduler",
        job_name: "automation-scheduler-check",
        last_success_at: staleAt,
        last_failure_at: null,
        last_error: null,
        consecutive_failures: 0,
        updated_at: staleAt,
      });
    });

    const cronHealth = await t.query(refs.checkCronHealth, {});

    expect(cronHealth).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobName: "maintenance-sweep",
          status: "STALE",
          lastSuccessAt: null,
        }),
      ]),
    );
  });

  it("preserves lease ownership when heartbeat mutations update sweep status", async () => {
    const t = createConvexTestHarness();
    const jobName = "maintenance-sweep";

    expect(
      await t.mutation(refs.acquireLeaseInternal, {
        jobName,
        owner: "lease_owner_a",
        leaseMs: 60_000,
      }),
    ).toBe(true);

    await t.mutation(refs.recordSuccessInternal, { jobName });
    await t.mutation(refs.recordFailureInternal, { jobName, error: "boom" });

    const heartbeat = await t.run((ctx) =>
      ctx.db
        .query("cron_heartbeats")
        .withIndex("by_job", (q) => q.eq("job_name", jobName))
        .unique(),
    );

    expect(heartbeat?.lock_owner).toBe("lease_owner_a");
    expect(heartbeat?.lock_expires_at).not.toBeNull();
    expect(heartbeat?.last_error).toBe("boom");
  });

  it("surfaces lease contention for manual runs and marks cron runs failed", async () => {
    const t = createConvexTestHarness();
    const jobName = "maintenance-sweep";

    expect(
      await t.mutation(refs.acquireLeaseInternal, {
        jobName,
        owner: "lease_owner_a",
        leaseMs: 60_000,
      }),
    ).toBe(true);

    const manualResult = await t.action(refs.scheduledMaintenanceSweepManual, {});
    expect(manualResult.skippedReason).toBe("lease_held");
    expect(manualResult.queue).toEqual({
      attempted: 0,
      dispatched: 0,
      skipped: 0,
    });

    await expect(t.action(refs.scheduledMaintenanceSweepWithHeartbeat, {})).rejects.toThrow(
      "maintenance_sweep_lease_held",
    );

    const cronHealth = await t.query(refs.checkCronHealth, {});
    expect(cronHealth).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobName,
          consecutiveFailures: 1,
          lastError: "maintenance_sweep_lease_held",
        }),
      ]),
    );
  });

  it("no-ops background heartbeat maintenance in E2E mode while recording success", async () => {
    vi.stubEnv("KEPPO_E2E_MODE", "true");
    try {
      const t = createConvexTestHarness();

      const result = await t.action(refs.scheduledMaintenanceSweepWithHeartbeat, {});
      expect(result).toEqual({
        queue: {
          attempted: 0,
          dispatched: 0,
          skipped: 0,
        },
        skippedReason: null,
        maintenance: {
          processed: 0,
          expired: 0,
          timedOutRuns: 0,
          securityFlagsCreated: 0,
          credentialLockoutRowsPurged: 0,
          credentialRotationRecommendations: 0,
          notificationsSent: 0,
          notificationsFailed: 0,
          purgedActions: 0,
          purgedBlobs: 0,
          purgedAudits: 0,
        },
        invites: {
          expired: 0,
        },
      });

      const cronHealth = await t.query(refs.checkCronHealth, {});
      expect(cronHealth).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            jobName: "maintenance-sweep",
            status: "HEALTHY",
            consecutiveFailures: 0,
            lastSuccessAt: expect.any(String),
          }),
        ]),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
