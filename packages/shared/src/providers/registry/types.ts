import type { z } from "zod";
import type {
  AutomationProviderTrigger,
  AutomationProviderTriggerDeliveryMode,
} from "../../automations.js";
import type { Connector, ConnectorContext, PreparedWrite } from "../../connectors/base.js";
import type { ToolDefinition } from "../../tool-definitions.js";
import type {
  CanonicalProviderId,
  ProviderAuthExchangeRequest,
  ProviderAuthRequest,
  ProviderCredentialBundle,
  ProviderExecuteToolRequest,
  ProviderModuleMetadata,
  ProviderRuntimeContext,
  ProviderWebhookEvent,
  ProviderWebhookVerificationRequest,
  ProviderWebhookVerificationResult,
} from "../../providers.js";
import type { ProviderDetailUiConfig } from "../../providers-ui.js";

export type ProviderSchemasFacet = {
  toolInputSchemas: Record<string, z.ZodTypeAny>;
};

export type ProviderAuthFacet = {
  buildAuthRequest: (
    request: ProviderAuthRequest,
    runtime: ProviderRuntimeContext,
  ) => Promise<Record<string, unknown>>;
  exchangeCredentials: (
    request: ProviderAuthExchangeRequest,
    runtime: ProviderRuntimeContext,
  ) => Promise<ProviderCredentialBundle>;
};

export type ProviderToolsFacet = {
  tools: Array<ToolDefinition>;
  executeTool: (
    request: ProviderExecuteToolRequest,
    runtime: ProviderRuntimeContext,
  ) => Promise<Record<string, unknown> | PreparedWrite>;
  healthcheck: (
    context: ConnectorContext,
    runtime: ProviderRuntimeContext,
  ) => Promise<{ ok: boolean; detail: string }>;
};

export type ProviderRefreshFacet = {
  refreshCredentials: (
    refreshToken: string,
    runtime: ProviderRuntimeContext,
  ) => Promise<ProviderCredentialBundle>;
};

export type ProviderWebhooksFacet = {
  verifyWebhook: (
    request: ProviderWebhookVerificationRequest,
    runtime: ProviderRuntimeContext,
  ) => Promise<ProviderWebhookVerificationResult>;
  extractWebhookEvent: (
    payload: Record<string, unknown>,
    request: ProviderWebhookVerificationRequest,
    runtime: ProviderRuntimeContext,
  ) => ProviderWebhookEvent;
};

export type ProviderAutomationTriggerDefinition = {
  key: string;
  eventType: string;
  schemaVersion: number;
  scheduler: {
    strategy: "polling";
    cadenceMinutes: number;
    maxCandidatesPerReconcile: number;
  };
  display: {
    label: string;
    description: string;
  };
  filterUi: {
    title?: string;
    description?: string;
    fields: Array<{
      key: string;
      label: string;
      type: "text" | "email" | "csv" | "boolean";
      description?: string;
      placeholder?: string;
      required?: boolean;
    }>;
  };
  filterSchema: z.ZodTypeAny;
  eventSchema: z.ZodTypeAny;
  supportedDeliveryModes: Array<AutomationProviderTriggerDeliveryMode>;
  defaultDeliveryMode: AutomationProviderTriggerDeliveryMode;
  fallbackDeliveryMode?: AutomationProviderTriggerDeliveryMode;
  buildDefaultTrigger: () => AutomationProviderTrigger;
  matchesEvent: (params: {
    filter: Record<string, unknown>;
    event: Record<string, unknown>;
  }) => boolean;
};

export type ProviderAutomationTriggersFacet = {
  triggers: Record<string, ProviderAutomationTriggerDefinition>;
};

export type RegisteredProviderAutomationTrigger = {
  providerId: CanonicalProviderId;
  trigger: ProviderAutomationTriggerDefinition;
};

export type ProviderAutomationTriggerLifecycleEvent = {
  triggerKey: string;
  providerEventId: string;
  providerEventType: string;
  deliveryMode: AutomationProviderTriggerDeliveryMode;
  eventPayload: Record<string, unknown>;
  eventPayloadRef?: string | null;
};

export type ProviderAutomationTriggerLifecycleRequest = {
  trigger: ProviderAutomationTriggerDefinition;
  activeTriggers: Array<{
    automationId: string;
    configVersionId: string;
    trigger: AutomationProviderTrigger;
  }>;
  state: Record<string, unknown>;
  context: ConnectorContext;
};

export type ProviderAutomationTriggerLifecycleResult = {
  state: Record<string, unknown>;
  subscriptionState: AutomationProviderTrigger["subscription_state"];
  events: Array<ProviderAutomationTriggerLifecycleEvent>;
};

export type ProviderAutomationTriggerLifecycleFacet = {
  sync: (
    request: ProviderAutomationTriggerLifecycleRequest,
    runtime: ProviderRuntimeContext,
  ) => Promise<ProviderAutomationTriggerLifecycleResult>;
  poll: (
    request: ProviderAutomationTriggerLifecycleRequest,
    runtime: ProviderRuntimeContext,
  ) => Promise<ProviderAutomationTriggerLifecycleResult>;
};

export type ProviderRequiredFacets = {
  metadata: ProviderModuleMetadata;
  schemas: ProviderSchemasFacet;
  auth: ProviderAuthFacet;
  tools: ProviderToolsFacet;
  ui: ProviderDetailUiConfig;
};

export type ProviderCapabilityFacets = {
  refresh?: ProviderRefreshFacet;
  webhooks?: ProviderWebhooksFacet;
  automationTriggers?: ProviderAutomationTriggersFacet;
  automationTriggerLifecycle?: ProviderAutomationTriggerLifecycleFacet;
};

export interface ProviderModuleV2<
  TProviderId extends CanonicalProviderId = CanonicalProviderId,
  TCapabilities extends ProviderModuleMetadata["capabilities"] =
    ProviderModuleMetadata["capabilities"],
> {
  schemaVersion: number;
  providerId: TProviderId;
  metadata: ProviderModuleMetadata & {
    providerId: TProviderId;
    capabilities: TCapabilities;
  };
  connector: Connector;
  facets: ProviderRequiredFacets & ProviderCapabilityFacets;
}
