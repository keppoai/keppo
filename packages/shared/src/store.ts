import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { resolveLocalAdminKey, setClientAdminAuth, toUsableAdminKey } from "./convex-admin.js";
import { SUBSCRIPTION_STATUS, type SubscriptionStatus, type SubscriptionTier } from "./domain.js";
import type { Action, DbSchema, NotificationEndpoint, Provider, Workspace } from "./types.js";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  createWorkspaceForOrg: makeFunctionReference<"mutation">("mcp:createWorkspaceForOrg"),
  rotateWorkspaceCredentialForTesting: makeFunctionReference<"mutation">(
    "mcp:rotateWorkspaceCredentialForTesting",
  ),
  upsertOAuthProviderForOrg: makeFunctionReference<"mutation">(
    "integrations:upsertOAuthProviderForOrg",
  ),
  setWorkspaceIntegrations: makeFunctionReference<"mutation">(
    "mcp:setWorkspaceIntegrationsForTesting",
  ),
  disconnectOAuthProviderForOrg: makeFunctionReference<"mutation">(
    "integrations:disconnectOAuthProviderForOrg",
  ),
  setToolAutoApproval: makeFunctionReference<"mutation">("e2e:setToolAutoApproval"),
  approveAction: makeFunctionReference<"mutation">("e2e:approveAction"),
  setActionStatus: makeFunctionReference<"mutation">("mcp:setActionStatus"),
  upsertSubscriptionForOrg: makeFunctionReference<"mutation">("billing:upsertSubscriptionForOrg"),
  backdateActionForMaintenance: makeFunctionReference<"mutation">(
    "e2e:backdateActionForMaintenance",
  ),
  backdateRunActivityForAction: makeFunctionReference<"mutation">(
    "e2e:backdateRunActivityForAction",
  ),
  setOrgSuspended: makeFunctionReference<"mutation">("e2e:setOrgSuspended"),
  listPendingActionsForWorkspace: makeFunctionReference<"query">(
    "mcp:listPendingActionsForWorkspace",
  ),
  findWorkspaceForOrgForTesting: makeFunctionReference<"query">(
    "mcp:findWorkspaceForOrgForTesting",
  ),
  getActionForTesting: makeFunctionReference<"query">("mcp:getActionForTesting"),
  findNotificationEndpointForTesting: makeFunctionReference<"query">(
    "mcp:findNotificationEndpointForTesting",
  ),
  getDbSnapshot: makeFunctionReference<"query">("mcp:getDbSnapshot"),
  getAuthOrgById: makeFunctionReference<"query">("mcp:getAuthOrganizationForTesting"),
};

export class KeppoStore {
  private readonly client: ConvexHttpClient;

  constructor(convexUrl?: string, convexAdminKey?: string) {
    const url = convexUrl ?? process.env.CONVEX_URL;
    if (!url) {
      throw new Error("Missing Convex URL. Set CONVEX_URL.");
    }

    this.client = new ConvexHttpClient(url);

    const adminKey =
      toUsableAdminKey(convexAdminKey) ??
      toUsableAdminKey(process.env.KEPPO_CONVEX_ADMIN_KEY) ??
      toUsableAdminKey(resolveLocalAdminKey());

    if (!adminKey) {
      throw new Error(
        "Missing KEPPO_CONVEX_ADMIN_KEY. Server-side KeppoStore requires admin auth for internal Convex functions.",
      );
    }

    setClientAdminAuth(this.client, adminKey);
  }

  /**
   * Retry a Convex client call on transient function-execution timeouts
   * (local Convex 1s budget) or OCC failures that surface under CI load.
   */
  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const retryable =
          message.includes("Function execution timed out") ||
          message.includes("OptimisticConcurrencyControlFailure");
        if (!retryable || attempt >= maxRetries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private retryQuery(ref: any, args: any): Promise<any> {
    return this.withRetry(() => this.client.query(ref, args));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private retryMutation(ref: any, args: any): Promise<any> {
    return this.withRetry(() => this.client.mutation(ref, args));
  }

  async ensurePersonalOrgForUser(params: {
    id: string;
    email: string;
    name: string;
  }): Promise<string> {
    return (await this.retryMutation(refs.seedUserOrg, {
      userId: params.id,
      email: params.email,
      name: params.name,
    })) as string;
  }

  async createWorkspace(params: {
    org_id: string;
    name: string;
    policy_mode: Workspace["policy_mode"];
    default_action_behavior: Workspace["default_action_behavior"];
  }): Promise<Workspace> {
    return (await this.retryMutation(refs.createWorkspaceForOrg, {
      orgId: params.org_id,
      name: params.name,
      policyMode: params.policy_mode,
      defaultActionBehavior: params.default_action_behavior,
    })) as Workspace;
  }

  async rotateCredential(workspaceId: string): Promise<{
    credential: {
      id: string;
      workspace_id: string;
    };
    secret: string;
  }> {
    const rotated = (await this.retryMutation(refs.rotateWorkspaceCredentialForTesting, {
      workspaceId,
    })) as {
      credential_id: string;
      secret: string;
    };

    return {
      credential: {
        id: rotated.credential_id,
        workspace_id: workspaceId,
      },
      secret: rotated.secret,
    };
  }

  async connectIntegration(params: {
    org_id: string;
    provider: Provider;
    display_name: string;
    scopes: string[];
    external_account_id: string;
    access_token: string;
    refresh_token: string | null;
    credential_expires_at: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.retryMutation(refs.upsertOAuthProviderForOrg, {
      orgId: params.org_id,
      provider: params.provider,
      displayName: params.display_name,
      scopes: params.scopes,
      externalAccountId: params.external_account_id,
      accessToken: params.access_token,
      refreshToken: params.refresh_token,
      expiresAt: params.credential_expires_at,
      metadata: params.metadata ?? {},
    });
  }

  async setWorkspaceIntegrations(params: {
    workspace_id: string;
    providers: Provider[];
  }): Promise<void> {
    await this.retryMutation(refs.setWorkspaceIntegrations, {
      workspaceId: params.workspace_id,
      providers: params.providers,
    });
  }

  async disconnectIntegration(params: { org_id: string; provider: Provider }): Promise<void> {
    await this.retryMutation(refs.disconnectOAuthProviderForOrg, {
      orgId: params.org_id,
      provider: params.provider,
    });
  }

  async setToolAutoApproval(params: {
    workspace_id: string;
    tool_name: string;
    enabled: boolean;
  }): Promise<void> {
    await this.retryMutation(refs.setToolAutoApproval, {
      workspaceId: params.workspace_id,
      toolName: params.tool_name,
      enabled: params.enabled,
    });
  }

  async approveAction(
    actionId: string,
    actorId = "usr_e2e",
    reason = "approved by e2e",
  ): Promise<void> {
    await this.retryMutation(refs.approveAction, {
      actionId,
      actorId,
      reason,
    });
  }

  async setActionStatus(
    actionId: string,
    status: DbSchema["actions"][number]["status"],
    resultRedacted?: Record<string, unknown> | null,
  ): Promise<void> {
    await this.retryMutation(refs.setActionStatus, {
      actionId,
      status,
      ...(resultRedacted !== undefined ? { resultRedacted } : {}),
    });
  }

  async setOrgSubscription(params: {
    org_id: string;
    tier: SubscriptionTier;
    status?: SubscriptionStatus;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    current_period_start?: string;
    current_period_end?: string;
  }): Promise<void> {
    const now = new Date();
    const defaultStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();
    const defaultEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    ).toISOString();
    await this.retryMutation(refs.upsertSubscriptionForOrg, {
      orgId: params.org_id,
      tier: params.tier,
      status: params.status ?? SUBSCRIPTION_STATUS.active,
      stripeCustomerId: params.stripe_customer_id ?? null,
      stripeSubscriptionId: params.stripe_subscription_id ?? null,
      currentPeriodStart: params.current_period_start ?? defaultStart,
      currentPeriodEnd: params.current_period_end ?? defaultEnd,
    });
  }

  async backdateActionForMaintenance(actionId: string, minutesAgo: number): Promise<void> {
    await this.retryMutation(refs.backdateActionForMaintenance, {
      actionId,
      minutesAgo,
    });
  }

  async backdateRunActivityForAction(actionId: string, minutesAgo: number): Promise<void> {
    await this.retryMutation(refs.backdateRunActivityForAction, {
      actionId,
      minutesAgo,
    });
  }

  async setOrgSuspended(params: {
    org_id: string;
    suspended: boolean;
    reason?: string;
  }): Promise<void> {
    await this.retryMutation(refs.setOrgSuspended, {
      orgId: params.org_id,
      suspended: params.suspended,
      ...(params.reason ? { reason: params.reason } : {}),
    });
  }

  async listPendingActions(workspaceId: string): Promise<Array<DbSchema["actions"][number]>> {
    const rows = (await this.retryQuery(refs.listPendingActionsForWorkspace, {
      workspaceId,
    })) as Array<{
      id: string;
      status: string;
      payload_preview: Record<string, unknown>;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      automation_run_id: "",
      tool_call_id: "",
      action_type: "",
      risk_level: "low",
      normalized_payload_enc: "",
      payload_preview: row.payload_preview,
      payload_purged_at: null,
      status: row.status as DbSchema["actions"][number]["status"],
      idempotency_key: "",
      created_at: row.created_at,
      resolved_at: null,
      result_redacted: null,
    }));
  }

  async findWorkspaceForOrg(orgId: string, slug?: string): Promise<Workspace | null> {
    return (await this.retryQuery(refs.findWorkspaceForOrgForTesting, {
      orgId,
      ...(slug ? { slug } : {}),
    })) as Workspace | null;
  }

  async getAction(actionId: string): Promise<Action | null> {
    return (await this.retryQuery(refs.getActionForTesting, {
      actionId,
    })) as Action | null;
  }

  async findNotificationEndpoint(params: {
    orgId: string;
    destination?: string;
    enabled?: boolean;
    type?: NotificationEndpoint["type"];
    userId?: string;
  }): Promise<NotificationEndpoint | null> {
    return (await this.retryQuery(refs.findNotificationEndpointForTesting, {
      orgId: params.orgId,
      ...(params.destination !== undefined ? { destination: params.destination } : {}),
      ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
      ...(params.type !== undefined ? { type: params.type } : {}),
      ...(params.userId !== undefined ? { userId: params.userId } : {}),
    })) as NotificationEndpoint | null;
  }

  async getDbSnapshot(): Promise<DbSchema> {
    return (await this.retryQuery(refs.getDbSnapshot, {})) as DbSchema;
  }

  async getAuthOrganization(orgId: string): Promise<{
    id: string;
    name: string;
    slug: string;
    metadata: string | null;
    createdAt: number;
  } | null> {
    return (await this.retryQuery(refs.getAuthOrgById, {
      orgId,
    })) as {
      id: string;
      name: string;
      slug: string;
      metadata: string | null;
      createdAt: number;
    } | null;
  }
}
