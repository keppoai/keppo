import type { ConvexHttpClient } from "convex/browser";
import type {
  AiCreditPurchaseStatus,
  AutomationRunTopupPurchaseStatus,
} from "@keppo/shared/domain";
import type {
  AiCreditUsageSource,
  AiKeyCredentialKind,
  AiKeyMode,
  AiModelProvider,
  AutomationConfigTriggerType,
  AutomationProviderTriggerDeliveryMode,
  AutomationRunEventType,
  AutomationRunLogLevel,
  AutomationRunOutcomeSource,
  AutomationRunStatus,
  AutomationRunTriggerType,
  AutomationRunnerType,
  AutomationStatus,
  NetworkAccessMode,
} from "@keppo/shared/automations";
import { refs } from "./refs.js";

export type { AutomationRunStatus } from "@keppo/shared/automations";

export async function matchAndQueueAutomationTriggers(
  client: ConvexHttpClient,
  params: {
    orgId: string;
    eventProvider: string;
    eventType: string;
    eventId: string;
    eventPayload: Record<string, unknown>;
  },
): Promise<{ queued_count: number; skipped_count: number }> {
  return (await client.mutation(refs.matchAndQueueAutomationTriggers, {
    org_id: params.orgId,
    event_provider: params.eventProvider,
    event_type: params.eventType,
    event_id: params.eventId,
    event_payload: params.eventPayload,
  })) as { queued_count: number; skipped_count: number };
}

export async function ingestProviderEvent(
  client: ConvexHttpClient,
  params: {
    orgId: string;
    provider: string;
    triggerKey?: string;
    providerEventId: string;
    providerEventType: string;
    deliveryMode: AutomationProviderTriggerDeliveryMode;
    eventPayload: Record<string, unknown>;
    eventPayloadRef?: string | null;
  },
): Promise<{ queued_count: number; skipped_count: number }> {
  return (await client.mutation(refs.ingestProviderEvent, {
    org_id: params.orgId,
    provider: params.provider,
    ...(params.triggerKey !== undefined ? { trigger_key: params.triggerKey } : {}),
    provider_event_id: params.providerEventId,
    provider_event_type: params.providerEventType,
    delivery_mode: params.deliveryMode,
    event_payload: params.eventPayload,
    ...(params.eventPayloadRef !== undefined ? { event_payload_ref: params.eventPayloadRef } : {}),
  })) as { queued_count: number; skipped_count: number };
}

export type AutomationRunDispatchContext = {
  run: {
    id: string;
    automation_id: string;
    org_id: string;
    workspace_id: string;
    config_version_id: string;
    trigger_type: AutomationRunTriggerType;
    status: AutomationRunStatus;
    started_at: string | null;
    ended_at: string | null;
    error_message: string | null;
    sandbox_id: string | null;
    mcp_session_id: string | null;
    outcome: {
      success: boolean;
      summary: string;
      source: AutomationRunOutcomeSource;
      recorded_at: string;
    } | null;
    log_storage_id: string | null;
    created_at: string;
  };
  automation: {
    id: string;
    org_id: string;
    workspace_id: string;
    name: string;
    status: AutomationStatus;
  };
  config: {
    id: string;
    automation_id: string;
    trigger_type: AutomationConfigTriggerType;
    schedule_cron: string | null;
    provider_trigger: {
      provider_id: string;
      trigger_key: string;
      schema_version: number;
      filter: Record<string, unknown>;
      delivery: {
        preferred_mode: "webhook" | "polling";
        supported_modes: Array<"webhook" | "polling">;
        fallback_mode: "webhook" | "polling" | null;
      };
      subscription_state: {
        status: "inactive" | "pending" | "active" | "degraded" | "expired" | "failed";
        active_mode: "webhook" | "polling" | null;
        last_error: string | null;
        updated_at: string | null;
      };
    } | null;
    provider_trigger_migration_state: {
      status: "native" | "legacy_passthrough" | "migration_required";
      message: string;
      legacy_event_provider: string | null;
      legacy_event_type: string | null;
      legacy_event_predicate: string | null;
    } | null;
    event_provider: string | null;
    event_type: string | null;
    event_predicate: string | null;
    runner_type: AutomationRunnerType;
    ai_model_provider: AiModelProvider;
    ai_model_name: string;
    prompt: string;
    network_access: NetworkAccessMode;
  };
};

export async function getAutomationRunDispatchContext(
  client: ConvexHttpClient,
  params: { automationRunId: string },
): Promise<AutomationRunDispatchContext | null> {
  return (await client.query(refs.getAutomationRunDispatchContext, {
    automation_run_id: params.automationRunId,
  })) as AutomationRunDispatchContext | null;
}

export async function updateAutomationRunStatus(
  client: ConvexHttpClient,
  params: {
    automationRunId: string;
    status: AutomationRunStatus;
    errorMessage?: string;
    sandboxId?: string | null;
    mcpSessionId?: string | null;
  },
): Promise<void> {
  await client.mutation(refs.updateAutomationRunStatus, {
    automation_run_id: params.automationRunId,
    status: params.status,
    ...(params.errorMessage !== undefined ? { error_message: params.errorMessage } : {}),
    ...(params.sandboxId !== undefined ? { sandbox_id: params.sandboxId } : {}),
    ...(params.mcpSessionId !== undefined ? { mcp_session_id: params.mcpSessionId } : {}),
  });
}

export async function appendAutomationRunLog(
  client: ConvexHttpClient,
  params: {
    automationRunId: string;
    level: AutomationRunLogLevel;
    content: string;
    eventType?: AutomationRunEventType;
    eventData?: Record<string, unknown>;
  },
): Promise<void> {
  await client.mutation(refs.appendAutomationRunLog, {
    automation_run_id: params.automationRunId,
    level: params.level,
    content: params.content,
    ...(params.eventType !== undefined ? { event_type: params.eventType } : {}),
    ...(params.eventData !== undefined ? { event_data: params.eventData } : {}),
  });
}

export type OrgAiKey = {
  id: string;
  org_id: string;
  provider: AiModelProvider;
  key_mode: AiKeyMode;
  encrypted_key: string;
  credential_kind: AiKeyCredentialKind;
  key_hint: string;
  key_version: number;
  is_active: boolean;
  subject_email: string | null;
  account_id: string | null;
  token_expires_at: string | null;
  last_refreshed_at: string | null;
  last_validated_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export async function getOrgAiKey(
  client: ConvexHttpClient,
  params: {
    orgId: string;
    provider: AiModelProvider;
    keyMode: AiKeyMode;
  },
): Promise<OrgAiKey | null> {
  return (await client.query(refs.getOrgAiKey, {
    org_id: params.orgId,
    provider: params.provider,
    key_mode: params.keyMode,
  })) as OrgAiKey | null;
}

export async function upsertOpenAiOauthKey(
  client: ConvexHttpClient,
  params: {
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
  },
): Promise<void> {
  await client.mutation(refs.upsertOpenAiOauthKey, {
    org_id: params.orgId,
    user_id: params.userId,
    credentials: params.credentials,
  });
}

export async function upsertBundledOrgAiKey(
  client: ConvexHttpClient,
  params: {
    orgId: string;
    provider: AiModelProvider;
    rawKey: string;
    createdBy?: string;
  },
): Promise<void> {
  const internalClient = client as unknown as {
    mutation: (reference: unknown, args: unknown) => Promise<unknown>;
  };
  await internalClient.mutation(refs.upsertBundledOrgAiKey, {
    org_id: params.orgId,
    provider: params.provider,
    raw_key: params.rawKey,
    ...(params.createdBy ? { created_by: params.createdBy } : {}),
  });
}

export async function deactivateBundledOrgAiKeys(
  client: ConvexHttpClient,
  params: { orgId: string },
): Promise<void> {
  const internalClient = client as unknown as {
    mutation: (reference: unknown, args: unknown) => Promise<unknown>;
  };
  await internalClient.mutation(refs.deactivateBundledOrgAiKeys, {
    org_id: params.orgId,
  });
}

export type AiCreditsBalance = {
  org_id: string;
  period_start: string;
  period_end: string;
  allowance_total: number;
  allowance_used: number;
  allowance_remaining: number;
  purchased_remaining: number;
  total_available: number;
  bundled_runtime_enabled: boolean;
};

export async function getAiCreditBalance(
  client: ConvexHttpClient,
  params: { orgId: string },
): Promise<AiCreditsBalance> {
  const internalClient = client as unknown as {
    query: (reference: unknown, args: unknown) => Promise<unknown>;
  };
  return (await internalClient.query(refs.getAiCreditBalance as unknown, {
    org_id: params.orgId,
  })) as AiCreditsBalance;
}

export async function deductAiCredit(
  client: ConvexHttpClient,
  params: { orgId: string; usageSource?: AiCreditUsageSource },
): Promise<AiCreditsBalance> {
  return (await client.mutation(refs.deductAiCredit, {
    org_id: params.orgId,
    ...(params.usageSource ? { usage_source: params.usageSource } : {}),
  })) as AiCreditsBalance;
}

export type PurchasedCredits = {
  id: string;
  org_id: string;
  credits: number;
  price_cents: number;
  stripe_payment_intent_id: string | null;
  purchased_at: string;
  expires_at: string;
  credits_remaining: number;
  status: AiCreditPurchaseStatus;
};

export async function addPurchasedCredits(
  client: ConvexHttpClient,
  params: {
    orgId: string;
    credits: number;
    priceCents: number;
    stripePaymentIntentId: string | null;
  },
): Promise<PurchasedCredits> {
  return (await client.mutation(refs.addPurchasedCredits, {
    org_id: params.orgId,
    credits: params.credits,
    price_cents: params.priceCents,
    stripe_payment_intent_id: params.stripePaymentIntentId,
  })) as PurchasedCredits;
}

export type PurchasedAutomationRunTopup = {
  id: string;
  org_id: string;
  tier_at_purchase: string;
  multiplier: string;
  runs_total: number;
  runs_remaining: number;
  tool_calls_total: number;
  tool_calls_remaining: number;
  tool_call_time_ms: number;
  price_cents: number;
  stripe_payment_intent_id: string | null;
  purchased_at: string;
  expires_at: string;
  status: AutomationRunTopupPurchaseStatus;
};

export async function addPurchasedAutomationRuns(
  client: ConvexHttpClient,
  params: {
    orgId: string;
    tier: string;
    multiplier: string;
    runs: number;
    toolCalls: number;
    toolCallTimeMs: number;
    priceCents: number;
    stripePaymentIntentId: string | null;
  },
): Promise<PurchasedAutomationRunTopup> {
  return (await client.mutation(refs.addPurchasedAutomationRuns, {
    orgId: params.orgId,
    tier: params.tier,
    multiplier: params.multiplier,
    runs: params.runs,
    toolCalls: params.toolCalls,
    toolCallTimeMs: params.toolCallTimeMs,
    priceCents: params.priceCents,
    stripePaymentIntentId: params.stripePaymentIntentId,
  })) as PurchasedAutomationRunTopup;
}
