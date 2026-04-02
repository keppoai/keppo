import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { components } from "../../convex/_generated/api";
import { AUTOMATION_RUN_STATUS, RUN_STATUS } from "../../convex/domain_constants";
import { AUTOMATION_DISPATCH_TOKEN_REUSE_WINDOW_MS } from "../../packages/shared/src/automations";
import { listPollingAutomationTriggers } from "../../packages/shared/src/providers/automation-trigger-registry";
import {
  buildDispatchAutomationRunArgs,
  buildGetDispatchAuditContextArgs,
  buildTerminateAutomationRunArgs,
} from "../../convex/automation_scheduler_shared";
import { createConvexTestHarness, seedAutomationFixture } from "./harness";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  triggerAutomationRunManual: makeFunctionReference<"mutation">(
    "automation_runs:triggerAutomationRunManual",
  ),
  dispatchAutomationRun: makeFunctionReference<"action">(
    "automation_scheduler:dispatchAutomationRun",
  ),
  reapStaleRuns: makeFunctionReference<"mutation">("automation_scheduler:reapStaleRuns"),
};

describe("automation scheduler contract boundaries", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("exposes canonical shared builders for internal scheduler boundaries", () => {
    expect(buildGetDispatchAuditContextArgs("run_123")).toEqual({ runId: "run_123" });
    expect(buildDispatchAutomationRunArgs("run_123")).toEqual({ runId: "run_123" });
    expect(buildDispatchAutomationRunArgs("run_123", "ns.1")).toEqual({
      runId: "run_123",
      namespace: "ns.1",
    });
    expect(buildTerminateAutomationRunArgs("run_456")).toEqual({ runId: "run_456" });
  });

  it("enumerates reconcile targets from the provider trigger registry instead of hardcoding Gmail", () => {
    const reconcileTargets = listPollingAutomationTriggers().map(({ providerId, trigger }) => ({
      providerId,
      triggerKey: trigger.key,
      cadenceMinutes: trigger.scheduler.cadenceMinutes,
    }));

    expect(reconcileTargets).toEqual(
      expect.arrayContaining([
        {
          providerId: "google",
          triggerKey: "incoming_email",
          cadenceMinutes: 1,
        },
        {
          providerId: "reddit",
          triggerKey: "mentions",
          cadenceMinutes: 1,
        },
        {
          providerId: "reddit",
          triggerKey: "unread_inbox_message",
          cadenceMinutes: 1,
        },
        {
          providerId: "x",
          triggerKey: "mentions",
          cadenceMinutes: 1,
        },
      ]),
    );
  });

  it("schedules manual dispatches through the shared dispatch contract", async () => {
    vi.useFakeTimers();
    vi.stubEnv(
      "KEPPO_AUTOMATION_DISPATCH_URL",
      "http://scheduler.test/internal/automations/dispatch",
    );
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass_secret_test");
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const t = createConvexTestHarness();
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_convex_scheduler_manual",
      email: "convex-scheduler-manual@example.com",
      name: "Convex Scheduler Manual",
    });
    const authUserId = await t.run(async (ctx) => {
      const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: "convex-scheduler-manual@example.com" }],
      })) as { _id?: string } | null;
      return user?._id ?? null;
    });
    expect(authUserId).toBeTruthy();
    const authT = t.withIdentity({
      subject: authUserId!,
      email: "convex-scheduler-manual@example.com",
      name: "Convex Scheduler Manual",
      activeOrganizationId: orgId,
    });
    const fixture = await seedAutomationFixture(t, orgId);

    const run = await authT.mutation(refs.triggerAutomationRunManual, {
      automation_id: fixture.automationId,
    });

    expect(run.status).toBe(AUTOMATION_RUN_STATUS.pending);

    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://scheduler.test/internal/automations/dispatch",
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      automation_run_id: run.id,
      dispatch_token: expect.any(String),
    });
    const dispatchHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(dispatchHeaders.get("x-vercel-protection-bypass")).toBe("bypass_secret_test");
  });

  it("reuses a recent dispatch token instead of overwriting an in-flight pending run token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T05:00:00.000Z"));
    vi.stubEnv(
      "KEPPO_AUTOMATION_DISPATCH_URL",
      "http://scheduler.test/internal/automations/dispatch",
    );
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const t = createConvexTestHarness();
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_convex_scheduler_retry",
      email: "convex-scheduler-retry@example.com",
      name: "Convex Scheduler Retry",
    });
    const authUserId = await t.run(async (ctx) => {
      const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: "convex-scheduler-retry@example.com" }],
      })) as { _id?: string } | null;
      return user?._id ?? null;
    });
    const authT = t.withIdentity({
      subject: authUserId!,
      email: "convex-scheduler-retry@example.com",
      name: "Convex Scheduler Retry",
      activeOrganizationId: orgId,
    });
    const fixture = await seedAutomationFixture(t, orgId);
    const run = await authT.mutation(refs.triggerAutomationRunManual, {
      automation_id: fixture.automationId,
    });

    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
    });

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      dispatch_token: string;
    };
    vi.setSystemTime(new Date(Date.now() + AUTOMATION_DISPATCH_TOKEN_REUSE_WINDOW_MS - 1_000));
    await t.action(refs.dispatchAutomationRun, {
      runId: run.id,
    });
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      dispatch_token: string;
    };

    expect(secondBody.dispatch_token).toBe(firstBody.dispatch_token);
  });

  it("does not redispatch or cancel runs that are no longer pending", async () => {
    vi.useFakeTimers();
    vi.stubEnv(
      "KEPPO_AUTOMATION_DISPATCH_URL",
      "http://scheduler.test/internal/automations/dispatch",
    );
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const t = createConvexTestHarness();
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_convex_scheduler_running",
      email: "convex-scheduler-running@example.com",
      name: "Convex Scheduler Running",
    });
    const authUserId = await t.run(async (ctx) => {
      const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: "convex-scheduler-running@example.com" }],
      })) as { _id?: string } | null;
      return user?._id ?? null;
    });
    const authT = t.withIdentity({
      subject: authUserId!,
      email: "convex-scheduler-running@example.com",
      name: "Convex Scheduler Running",
      activeOrganizationId: orgId,
    });
    const fixture = await seedAutomationFixture(t, orgId);
    const run = await authT.mutation(refs.triggerAutomationRunManual, {
      automation_id: fixture.automationId,
    });

    await t.mutation(
      makeFunctionReference<"mutation">("automation_runs:updateAutomationRunStatus"),
      {
        automation_run_id: run.id,
        status: AUTOMATION_RUN_STATUS.running,
      },
    );

    const result = await t.action(refs.dispatchAutomationRun, {
      runId: run.id,
    });

    expect(result).toMatchObject({
      dispatched: false,
      status: "dispatch_run_not_pending",
      http_status: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects manual runs server-side when automation execution is not ready", async () => {
    const t = createConvexTestHarness();
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_convex_scheduler_manual_no_key",
      email: "convex-scheduler-manual-no-key@example.com",
      name: "Convex Scheduler Manual No Key",
    });
    const authUserId = await t.run(async (ctx) => {
      const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: "convex-scheduler-manual-no-key@example.com" }],
      })) as { _id?: string } | null;
      return user?._id ?? null;
    });
    expect(authUserId).toBeTruthy();
    const authT = t.withIdentity({
      subject: authUserId!,
      email: "convex-scheduler-manual-no-key@example.com",
      name: "Convex Scheduler Manual No Key",
      activeOrganizationId: orgId,
    });
    const fixture = await seedAutomationFixture(t, orgId, { hasActiveAiKey: false });

    await expect(
      authT.mutation(refs.triggerAutomationRunManual, {
        automation_id: fixture.automationId,
      }),
    ).rejects.toThrow(/automation\.byok_required/);
  });

  it("normalizes an /api internal base when dispatching manual runs", async () => {
    vi.useFakeTimers();
    vi.stubEnv("KEPPO_API_INTERNAL_BASE_URL", "https://keppo.ai/api");
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass_secret_test");
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const t = createConvexTestHarness();
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_convex_scheduler_manual_api_base",
      email: "convex-scheduler-manual-api-base@example.com",
      name: "Convex Scheduler Manual API Base",
    });
    const authUserId = await t.run(async (ctx) => {
      const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: "convex-scheduler-manual-api-base@example.com" }],
      })) as { _id?: string } | null;
      return user?._id ?? null;
    });
    expect(authUserId).toBeTruthy();
    const authT = t.withIdentity({
      subject: authUserId!,
      email: "convex-scheduler-manual-api-base@example.com",
      name: "Convex Scheduler Manual API Base",
      activeOrganizationId: orgId,
    });
    const fixture = await seedAutomationFixture(t, orgId);

    const run = await authT.mutation(refs.triggerAutomationRunManual, {
      automation_id: fixture.automationId,
    });

    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://keppo.ai/internal/automations/dispatch",
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      automation_run_id: run.id,
      dispatch_token: expect.any(String),
    });
    const dispatchHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(dispatchHeaders.get("x-vercel-protection-bypass")).toBe("bypass_secret_test");
  });

  it("rewrites bundled missing-key dispatch failures with the bundled credential label", async () => {
    vi.useFakeTimers();
    vi.stubEnv(
      "KEPPO_AUTOMATION_DISPATCH_URL",
      "http://scheduler.test/internal/automations/dispatch",
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            status: "missing_ai_key",
            provider: "openai",
            key_mode: "bundled",
          }),
          {
            status: 503,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const t = createConvexTestHarness();
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId: "usr_convex_scheduler_bundled_missing_key",
      email: "convex-scheduler-bundled-missing-key@example.com",
      name: "Convex Scheduler Bundled Missing Key",
    });
    const authUserId = await t.run(async (ctx) => {
      const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: "convex-scheduler-bundled-missing-key@example.com" }],
      })) as { _id?: string } | null;
      return user?._id ?? null;
    });
    expect(authUserId).toBeTruthy();
    const authT = t.withIdentity({
      subject: authUserId!,
      email: "convex-scheduler-bundled-missing-key@example.com",
      name: "Convex Scheduler Bundled Missing Key",
      activeOrganizationId: orgId,
    });
    const fixture = await seedAutomationFixture(t, orgId);

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query("automation_config_versions")
        .withIndex("by_custom_id", (q) => q.eq("id", fixture.configVersionId))
        .unique();
      if (!config) {
        throw new Error("Missing fixture config");
      }
      await ctx.db.patch(config._id, {});
    });

    const run = await authT.mutation(refs.triggerAutomationRunManual, {
      automation_id: fixture.automationId,
    });

    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
    });

    const updatedRun = await t.run(async (ctx) => {
      return await ctx.db
        .query("automation_runs")
        .withIndex("by_custom_id", (q) => q.eq("id", run.id))
        .unique();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updatedRun?.error_message).toBe(
      "Dispatch failed: Bundled OpenAI access is unavailable for this org. Please contact support.",
    );
  });

  it("schedules stale-run termination through the shared terminate contract", async () => {
    vi.useFakeTimers();
    vi.stubEnv(
      "KEPPO_AUTOMATION_TERMINATE_URL",
      "http://scheduler.test/internal/automations/terminate",
    );
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass_secret_test");
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const t = createConvexTestHarness();
    const fixture = await seedAutomationFixture(t, "org_convex_scheduler_timeout");
    const startedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await t.run(async (ctx) => {
      await ctx.db.insert("automation_runs", {
        id: "arun_timeout_contract",
        automation_id: fixture.automationId,
        org_id: "org_convex_scheduler_timeout",
        workspace_id: fixture.workspaceId,
        config_version_id: fixture.configVersionId,
        trigger_type: "manual",
        error_message: null,
        sandbox_id: null,
        log_storage_id: null,
        created_at: startedAt,
        mcp_session_id: null,
        client_type: "other",
        metadata: {
          automation_run_status: AUTOMATION_RUN_STATUS.running,
          log_bytes: 0,
          log_eviction_noted: false,
        },
        started_at: startedAt,
        ended_at: null,
        status: RUN_STATUS.active,
      });
    });

    const result = await t.mutation(refs.reapStaleRuns, { limit: 10 });
    expect(result.timed_out_count).toBe(1);

    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://scheduler.test/internal/automations/terminate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ automation_run_id: "arun_timeout_contract" }),
      }),
    );
    const terminateHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(terminateHeaders.get("x-vercel-protection-bypass")).toBe("bypass_secret_test");
  });

  it("normalizes an /api internal base when terminating stale runs", async () => {
    vi.useFakeTimers();
    vi.stubEnv("KEPPO_API_INTERNAL_BASE_URL", "https://keppo.ai/api");
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass_secret_test");
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const t = createConvexTestHarness();
    const fixture = await seedAutomationFixture(t, "org_convex_scheduler_timeout_api_base");
    const startedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await t.run(async (ctx) => {
      await ctx.db.insert("automation_runs", {
        id: "arun_timeout_contract_api_base",
        automation_id: fixture.automationId,
        org_id: "org_convex_scheduler_timeout_api_base",
        workspace_id: fixture.workspaceId,
        config_version_id: fixture.configVersionId,
        trigger_type: "manual",
        error_message: null,
        sandbox_id: null,
        log_storage_id: null,
        created_at: startedAt,
        mcp_session_id: null,
        client_type: "other",
        metadata: {
          automation_run_status: AUTOMATION_RUN_STATUS.running,
          log_bytes: 0,
          log_eviction_noted: false,
        },
        started_at: startedAt,
        ended_at: null,
        status: RUN_STATUS.active,
      });
    });

    const result = await t.mutation(refs.reapStaleRuns, { limit: 10 });
    expect(result.timed_out_count).toBe(1);

    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://keppo.ai/internal/automations/terminate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ automation_run_id: "arun_timeout_contract_api_base" }),
      }),
    );
    const terminateHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(terminateHeaders.get("x-vercel-protection-bypass")).toBe("bypass_secret_test");
  });
});
