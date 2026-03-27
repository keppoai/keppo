import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createHash } from "node:crypto";
import {
  resolveLocalAdminKey,
  setClientAdminAuth,
  toUsableAdminKey,
} from "../../../packages/shared/src/convex-admin.js";
import type { AppContext } from "../fixtures/app-context.fixture";

const refs = {
  seedAutomationFixture: makeFunctionReference<"mutation">("e2e:seedAutomationFixture"),
  createAutomationForWorkspace: makeFunctionReference<"mutation">(
    "e2e:createAutomationForWorkspace",
  ),
  createAutomationViaContract: makeFunctionReference<"mutation">("e2e:createAutomationViaContract"),
  createAutomationRun: makeFunctionReference<"mutation">("automation_runs:createAutomationRun"),
  getAutomationRun: makeFunctionReference<"query">("e2e:getAutomationFixtureRun"),
  getAutomationRunLogs: makeFunctionReference<"query">("e2e:getAutomationFixtureRunLogs"),
  getInviteToken: makeFunctionReference<"query">("e2e:getInviteToken"),
  getLatestInviteTokenForEmail: makeFunctionReference<"query">("e2e:getLatestInviteTokenForEmail"),
  getAuthUserForTesting: makeFunctionReference<"query">("mcp:getAuthUserForTesting"),
  acceptInviteInternal: makeFunctionReference<"mutation">("invites:acceptInviteInternal"),
  listAutomationFixtureRuns: makeFunctionReference<"query">("e2e:listAutomationFixtureRuns"),
  appendAutomationRunLog: makeFunctionReference<"mutation">(
    "automation_runs:appendAutomationRunLog",
  ),
  updateAutomationRunStatus: makeFunctionReference<"mutation">(
    "automation_runs:updateAutomationRunStatus",
  ),
  addPurchasedCredits: makeFunctionReference<"mutation">("ai_credits:addPurchasedCredits"),
  setOrgFeatureAccess: makeFunctionReference<"mutation">("e2e:setOrgFeatureAccess"),
  createAuditEvent: makeFunctionReference<"mutation">("mcp:createAuditEvent"),
  registerNotificationEndpoint: makeFunctionReference<"mutation">(
    "notifications/endpoints:registerEndpoint",
  ),
  createNotificationEvent: makeFunctionReference<"mutation">(
    "notifications:createNotificationEvent",
  ),
  markNotificationEventFailed: makeFunctionReference<"mutation">("notifications:markEventFailed"),
};

const resolveAdminKey = (): string => {
  const adminKey =
    toUsableAdminKey(process.env.KEPPO_CONVEX_ADMIN_KEY) ??
    toUsableAdminKey(resolveLocalAdminKey());
  if (!adminKey) {
    throw new Error("Missing KEPPO_CONVEX_ADMIN_KEY for E2E admin helpers.");
  }
  return adminKey;
};

export class ConvexAdminHelper {
  private readonly client: ConvexHttpClient;

  constructor(private readonly app: AppContext) {
    this.client = new ConvexHttpClient(app.runtime.convexUrl);
    setClientAdminAuth(this.client, resolveAdminKey());
  }

  async seedAutomationFixture(params: {
    tier?: "free" | "starter" | "pro";
    scheduleCron?: string;
  }) {
    return await this.client.mutation(refs.seedAutomationFixture, params);
  }

  async createAutomationForWorkspace(params: {
    orgId: string;
    workspaceId: string;
    name?: string;
    description?: string;
    prompt?: string;
  }) {
    return await this.client.mutation(refs.createAutomationForWorkspace, params);
  }

  async createAutomationViaContract(params: { tier?: "free" | "starter" | "pro" }) {
    return await this.client.mutation(refs.createAutomationViaContract, params);
  }

  async getInviteToken(inviteId: string) {
    return await this.client.query(refs.getInviteToken, { inviteId });
  }

  async getLatestInviteTokenForEmail(orgId: string, email: string) {
    return await this.client.query(refs.getLatestInviteTokenForEmail, {
      orgId,
      email,
    });
  }

  async getAuthUserByEmail(email: string) {
    return await this.client.query(refs.getAuthUserForTesting, {
      email,
    });
  }

  async acceptInviteForUser(rawToken: string, userId: string) {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    return await this.client.mutation(refs.acceptInviteInternal, {
      tokenHash,
      userId,
    });
  }

  async listAutomationRuns(automationId: string) {
    return await this.client.query(refs.listAutomationFixtureRuns, { automationId });
  }

  async createAutomationRun(
    automationId: string,
    triggerType: "schedule" | "event" | "manual" = "manual",
  ) {
    return await this.client.mutation(refs.createAutomationRun, {
      automation_id: automationId,
      trigger_type: triggerType,
    });
  }

  async getAutomationRun(automationRunId: string) {
    return await this.client.query(refs.getAutomationRun, {
      automationRunId: automationRunId,
    });
  }

  async getAutomationRunLogs(automationRunId: string) {
    return await this.client.query(refs.getAutomationRunLogs, {
      automationRunId: automationRunId,
    });
  }

  async appendRunLog(
    automationRunId: string,
    content: string,
    level: "stdout" | "stderr" | "system" = "stdout",
    options?: {
      eventType?: "system" | "automation_config" | "thinking" | "tool_call" | "output" | "error";
      eventData?: Record<string, unknown>;
    },
  ) {
    return await this.client.mutation(refs.appendAutomationRunLog, {
      automation_run_id: automationRunId,
      level,
      content,
      ...(options?.eventType ? { event_type: options.eventType } : {}),
      ...(options?.eventData ? { event_data: options.eventData } : {}),
    });
  }

  async finishRun(
    automationRunId: string,
    status: "running" | "succeeded" | "failed" | "cancelled" | "timed_out",
  ) {
    return await this.client.mutation(refs.updateAutomationRunStatus, {
      automation_run_id: automationRunId,
      status,
    });
  }

  async addPurchasedCredits(orgId: string, credits: number) {
    return await this.client.mutation(refs.addPurchasedCredits, {
      org_id: orgId,
      credits,
    });
  }

  async setOrgFeatureAccess(orgId: string, featureKey: string, enabled = true) {
    return await this.client.mutation(refs.setOrgFeatureAccess, {
      orgId,
      featureKey,
      enabled,
    });
  }

  async setOrgMaxMembers(orgId: string, maxMembers: number) {
    return await this.setOrgFeatureAccess(orgId, `e2e:max-members:${orgId}:${maxMembers}`, true);
  }

  async createAuditEvent(params: {
    orgId: string;
    actorType: "user" | "system" | "automation" | "worker";
    actorId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }) {
    return await this.client.mutation(refs.createAuditEvent, params);
  }

  async registerNotificationEndpoint(params: {
    orgId: string;
    type: "email" | "push";
    destination: string;
    pushSubscription?: string;
    preferences?: Record<string, boolean>;
  }) {
    return await this.client.mutation(refs.registerNotificationEndpoint, params);
  }

  async createNotificationEvent(params: {
    orgId: string;
    eventType: string;
    channel: "email" | "push" | "in_app";
    title: string;
    body: string;
    ctaUrl: string;
    ctaLabel: string;
    endpointId?: string;
  }) {
    return await this.client.mutation(refs.createNotificationEvent, params);
  }

  async markNotificationEventFailed(eventId: string, error: string) {
    return await this.client.mutation(refs.markNotificationEventFailed, {
      eventId,
      error,
      retryable: false,
    });
  }
}

export const createConvexAdmin = (app: AppContext): ConvexAdminHelper => {
  return new ConvexAdminHelper(app);
};
