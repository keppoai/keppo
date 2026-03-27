"use node";

import { isDeepStrictEqual } from "node:util";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { ConnectorContext } from "../packages/shared/src/connectors/base.js";
import type { CanonicalProviderId } from "../packages/shared/src/provider-catalog.js";
import {
  getProviderModuleV2,
  listPollingAutomationTriggers,
} from "../packages/shared/src/providers/modules/index.js";
import { internalAction } from "./_generated/server";
import {
  createRefreshConnectorContextAccessToken,
  toProviderRuntimeContext,
} from "./mcp_node/provider_runtime";

const DEFAULT_PROVIDER_TRIGGER_MAINTENANCE_LIMIT = 100;

const refs = {
  listProviderTriggerCandidates: makeFunctionReference<"query">(
    "automation_triggers:listProviderTriggerCandidates",
  ),
  updateProviderTriggerSubscriptionState: makeFunctionReference<"mutation">(
    "automation_triggers:updateProviderTriggerSubscriptionState",
  ),
  getProviderTriggerIntegrationContext: makeFunctionReference<"query">(
    "integrations:getProviderTriggerIntegrationContext",
  ),
  updateProviderTriggerIntegrationState: makeFunctionReference<"mutation">(
    "integrations:updateProviderTriggerIntegrationState",
  ),
  ingestProviderEvent: makeFunctionReference<"mutation">("automation_triggers:ingestProviderEvent"),
  updateIntegrationCredential: makeFunctionReference<"mutation">("mcp:updateIntegrationCredential"),
  markCredentialRefreshResult: makeFunctionReference<"mutation">(
    "integrations:markCredentialRefreshResult",
  ),
};

type ProviderTriggerCandidate = {
  org_id: string;
  workspace_id: string;
  provider: string;
  trigger_key: string;
  automation_id: string;
  config_version_id: string;
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
  };
};

type ProviderTriggerIntegrationContext = {
  org_id: string;
  provider: string;
  scopes: string[];
  access_token: string | null;
  refresh_token: string | null;
  access_token_expires_at: string | null;
  integration_account_id: string | null;
  external_account_id: string | null;
  metadata: Record<string, unknown>;
} | null;

const refreshConnectorContextAccessToken = createRefreshConnectorContextAccessToken({
  markCredentialRefreshResult: async (ctx, args) => {
    await ctx.runMutation(refs.markCredentialRefreshResult, args);
  },
  updateIntegrationCredential: async (ctx, args) => {
    await ctx.runMutation(refs.updateIntegrationCredential, args);
  },
});

const clampPositiveLimit = (raw: number | undefined, fallback: number, max = 2_000): number => {
  const parsed = Math.floor(raw ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, parsed));
};

const getProviderTriggerLifecycleState = (
  metadata: Record<string, unknown>,
  provider: string,
  triggerKey: string,
): Record<string, unknown> => {
  const root =
    metadata.automation_trigger_lifecycle &&
    typeof metadata.automation_trigger_lifecycle === "object" &&
    !Array.isArray(metadata.automation_trigger_lifecycle)
      ? (metadata.automation_trigger_lifecycle as Record<string, unknown>)
      : {};
  const providerRoot =
    root[provider] && typeof root[provider] === "object" && !Array.isArray(root[provider])
      ? (root[provider] as Record<string, unknown>)
      : {};
  const state =
    providerRoot[triggerKey] &&
    typeof providerRoot[triggerKey] === "object" &&
    !Array.isArray(providerRoot[triggerKey])
      ? (providerRoot[triggerKey] as Record<string, unknown>)
      : {};
  return state;
};

const buildLifecycleFailureState = (current: Record<string, unknown>, errorMessage: string) => ({
  ...current,
  last_error: errorMessage.slice(0, 240),
  updated_at: new Date().toISOString(),
});

const buildLifecycleFailureSubscription = (
  current: ProviderTriggerCandidate["provider_trigger"]["subscription_state"],
  errorMessage: string,
) => ({
  status:
    current.status === "active" || current.status === "degraded"
      ? ("degraded" as const)
      : ("failed" as const),
  active_mode:
    current.status === "active" || current.status === "degraded" ? current.active_mode : null,
  last_error: errorMessage.slice(0, 240),
  updated_at: new Date().toISOString(),
});

const asLifecycleStateRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

export const reconcileProviderTriggerSubscriptions = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.object({
    processed: v.number(),
    events_ingested: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx, args) => {
    const limit = clampPositiveLimit(args.limit, DEFAULT_PROVIDER_TRIGGER_MAINTENANCE_LIMIT, 500);
    const candidates: ProviderTriggerCandidate[] = [];

    for (const { providerId, trigger } of listPollingAutomationTriggers()) {
      const remaining = limit - candidates.length;
      if (remaining <= 0) {
        break;
      }
      const providerLimit = Math.min(remaining, trigger.scheduler.maxCandidatesPerReconcile);
      const providerCandidates = (await ctx.runQuery(refs.listProviderTriggerCandidates, {
        provider: providerId,
        trigger_key: trigger.key,
        limit: providerLimit,
      })) as Array<ProviderTriggerCandidate>;
      candidates.push(...providerCandidates);
    }

    const grouped = new Map<string, Array<ProviderTriggerCandidate>>();
    for (const candidate of candidates) {
      const key = `${candidate.org_id}:${candidate.provider}:${candidate.trigger_key}`;
      const entries = grouped.get(key) ?? [];
      entries.push(candidate);
      grouped.set(key, entries);
    }

    let processed = 0;
    let eventsIngested = 0;
    let failed = 0;

    for (const group of grouped.values()) {
      const first = group[0];
      if (!first) {
        continue;
      }
      processed += 1;

      const providerModule = getProviderModuleV2(first.provider);
      const lifecycleFacet = providerModule.facets.automationTriggerLifecycle;
      const triggerDefinition =
        providerModule.facets.automationTriggers?.triggers[first.trigger_key];
      if (!lifecycleFacet || !triggerDefinition) {
        failed += 1;
        continue;
      }

      const integrationContext = (await ctx.runQuery(refs.getProviderTriggerIntegrationContext, {
        orgId: first.org_id,
        provider: first.provider as CanonicalProviderId,
      })) as ProviderTriggerIntegrationContext;

      const configVersionIds = group.map((candidate) => candidate.config_version_id);
      const activeTriggers = group.map((candidate) => ({
        automationId: candidate.automation_id,
        configVersionId: candidate.config_version_id,
        trigger: candidate.provider_trigger,
      }));

      if (!integrationContext) {
        const subscription = buildLifecycleFailureSubscription(
          first.provider_trigger.subscription_state,
          "integration_not_connected",
        );
        await ctx.runMutation(refs.updateProviderTriggerSubscriptionState, {
          config_version_ids: configVersionIds,
          subscription_state: subscription,
        });
        failed += 1;
        continue;
      }

      const namespace =
        typeof integrationContext.metadata.e2e_namespace === "string" &&
        integrationContext.metadata.e2e_namespace.trim()
          ? integrationContext.metadata.e2e_namespace.trim()
          : undefined;
      const runtimeContext = toProviderRuntimeContext(namespace);
      const lifecycleState = getProviderTriggerLifecycleState(
        integrationContext.metadata,
        first.provider,
        first.trigger_key,
      );
      let latestLifecycleState = lifecycleState;
      let latestSubscriptionState = first.provider_trigger.subscription_state;

      try {
        const refreshedContext = await refreshConnectorContextAccessToken(ctx, {
          provider: first.provider as CanonicalProviderId,
          context: {
            workspaceId: first.workspace_id,
            orgId: first.org_id,
            scopes: integrationContext.scopes,
            ...(integrationContext.access_token
              ? { access_token: integrationContext.access_token }
              : {}),
            ...(integrationContext.refresh_token !== null
              ? { refresh_token: integrationContext.refresh_token }
              : {}),
            ...(integrationContext.access_token_expires_at !== null
              ? { access_token_expires_at: integrationContext.access_token_expires_at }
              : {}),
            ...(integrationContext.integration_account_id !== null
              ? { integration_account_id: integrationContext.integration_account_id }
              : {}),
            ...(integrationContext.external_account_id !== null
              ? { external_account_id: integrationContext.external_account_id }
              : {}),
            metadata: integrationContext.metadata,
          } satisfies ConnectorContext,
        });

        const syncResult = await lifecycleFacet.sync(
          {
            trigger: triggerDefinition,
            activeTriggers,
            state: lifecycleState,
            context: refreshedContext,
          },
          runtimeContext,
        );

        if (!isDeepStrictEqual(latestLifecycleState, syncResult.state)) {
          await ctx.runMutation(refs.updateProviderTriggerIntegrationState, {
            orgId: first.org_id,
            provider: first.provider as CanonicalProviderId,
            triggerKey: first.trigger_key,
            state: syncResult.state,
          });
        }
        latestLifecycleState = asLifecycleStateRecord(syncResult.state);
        if (!isDeepStrictEqual(latestSubscriptionState, syncResult.subscriptionState)) {
          await ctx.runMutation(refs.updateProviderTriggerSubscriptionState, {
            config_version_ids: configVersionIds,
            subscription_state: syncResult.subscriptionState,
          });
        }
        latestSubscriptionState = syncResult.subscriptionState;

        const pollResult = await lifecycleFacet.poll(
          {
            trigger: triggerDefinition,
            activeTriggers,
            state: syncResult.state,
            context: refreshedContext,
          },
          runtimeContext,
        );

        if (!isDeepStrictEqual(latestLifecycleState, pollResult.state)) {
          await ctx.runMutation(refs.updateProviderTriggerIntegrationState, {
            orgId: first.org_id,
            provider: first.provider as CanonicalProviderId,
            triggerKey: first.trigger_key,
            state: pollResult.state,
          });
        }
        latestLifecycleState = asLifecycleStateRecord(pollResult.state);
        if (!isDeepStrictEqual(latestSubscriptionState, pollResult.subscriptionState)) {
          await ctx.runMutation(refs.updateProviderTriggerSubscriptionState, {
            config_version_ids: configVersionIds,
            subscription_state: pollResult.subscriptionState,
          });
        }
        latestSubscriptionState = pollResult.subscriptionState;

        for (const event of pollResult.events) {
          await ctx.runMutation(refs.ingestProviderEvent, {
            org_id: first.org_id,
            provider: first.provider,
            trigger_key: event.triggerKey,
            provider_event_id: event.providerEventId,
            provider_event_type: event.providerEventType,
            delivery_mode: event.deliveryMode,
            event_payload: event.eventPayload,
            ...(event.eventPayloadRef !== undefined
              ? { event_payload_ref: event.eventPayloadRef }
              : {}),
          });
          eventsIngested += 1;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        try {
          const failureState = buildLifecycleFailureState(latestLifecycleState, errorMessage);
          if (!isDeepStrictEqual(latestLifecycleState, failureState)) {
            await ctx.runMutation(refs.updateProviderTriggerIntegrationState, {
              orgId: first.org_id,
              provider: first.provider as CanonicalProviderId,
              triggerKey: first.trigger_key,
              state: failureState,
            });
          }
          const failureSubscription = buildLifecycleFailureSubscription(
            latestSubscriptionState,
            errorMessage,
          );
          if (!isDeepStrictEqual(latestSubscriptionState, failureSubscription)) {
            await ctx.runMutation(refs.updateProviderTriggerSubscriptionState, {
              config_version_ids: configVersionIds,
              subscription_state: failureSubscription,
            });
          }
        } catch (stateUpdateError) {
          console.error("automation_trigger.reconcile.failure_state_update_failed", {
            error:
              stateUpdateError instanceof Error
                ? stateUpdateError.message
                : String(stateUpdateError),
            org_id: first.org_id,
            provider: first.provider,
            trigger_key: first.trigger_key,
          });
        }
        failed += 1;
      }
    }

    return {
      processed,
      events_ingested: eventsIngested,
      failed,
    };
  },
});
