import { getProviderDefaultScopes } from "../provider-default-scopes.js";
import type { CanonicalProviderId } from "../provider-ids.js";
import { allTools } from "../tool-definitions.js";
import { TOOL_CALL_RESULT_STATUS } from "../domain.js";
import type { ActionRiskLevel, Capability } from "../types.js";
import { plannedActionCatalogSeeds } from "./action-catalog-planned/index.js";

export type ProviderActionTier = "T1" | "T2" | "T3";
export type ProviderActionImplementationStatus = "implemented" | "planned" | "not_started";

export type ProviderActionRequiredOutcome =
  | "success"
  | "invalid_input"
  | "auth_or_scope_error"
  | typeof TOOL_CALL_RESULT_STATUS.idempotentReplay;

export type ProviderActionCatalogEntry = {
  providerId: CanonicalProviderId;
  toolName: string;
  actionType: string;
  capability: Capability;
  riskLevel: ActionRiskLevel;
  requiresApproval: boolean;
  tier: ProviderActionTier;
  implementationStatus: ProviderActionImplementationStatus;
  expectedSdkMethods: Array<string>;
  fakeGateway: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    routeTemplate: string;
    samplePayload: Record<string, unknown> | null;
  };
  requiredOAuthScopes: Array<string>;
  requiredOutcomes: Array<ProviderActionRequiredOutcome>;
  description: string;
};

export type ProviderLifecycleActionKey =
  | "oauth_connect"
  | "oauth_authorize"
  | "oauth_callback"
  | "oauth_token"
  | "refresh"
  | "webhook";

export type ProviderLifecycleActionMatrix = Record<
  CanonicalProviderId,
  Record<ProviderLifecycleActionKey, boolean>
>;

type ActionCatalogSeed = {
  providerId: CanonicalProviderId;
  toolName: string;
  actionType: string;
  capability: Capability;
  riskLevel: ActionRiskLevel;
  tier: ProviderActionTier;
  implementationStatus: ProviderActionImplementationStatus;
  sdkMethod: string;
  description: string;
};

const providerScopeExpansion: Record<CanonicalProviderId, Array<string>> = {
  google: ["gmail.compose", "gmail.settings.basic", "gmail.labels"],
  stripe: [],
  github: ["workflow", "read:org", "repo"],
  slack: [
    "channels:history",
    "channels:manage",
    "users:read",
    "search:read",
    "files:read",
    "files:write",
    "pins:read",
    "pins:write",
    "reactions:read",
    "reactions:write",
    "chat:write.customize",
    "im:write",
  ],
  notion: [],
  reddit: [
    "read",
    "submit",
    "privatemessages",
    "modposts",
    "modflair",
    "modlog",
    "modmail",
    "vote",
    "edit",
    "flair",
    "history",
    "identity",
    "save",
    "report",
    "subscribe",
  ],
  x: [
    "tweet.read",
    "tweet.write",
    "users.read",
    "dm.read",
    "dm.write",
    "follows.read",
    "follows.write",
    "like.read",
    "like.write",
    "block.read",
    "block.write",
    "mute.read",
    "mute.write",
    "bookmark.read",
    "bookmark.write",
    "list.read",
    "list.write",
  ],
  linkedin: [],
  custom: [],
};

const dedupeScopes = (scopes: Array<string>): Array<string> => {
  return [...new Set(scopes.map((scope) => scope.trim()).filter((scope) => scope.length > 0))];
};

const providerCatalogScopes: Record<CanonicalProviderId, Array<string>> = {
  google: dedupeScopes([...getProviderDefaultScopes("google"), ...providerScopeExpansion.google]),
  stripe: dedupeScopes([...getProviderDefaultScopes("stripe"), ...providerScopeExpansion.stripe]),
  github: dedupeScopes([...getProviderDefaultScopes("github"), ...providerScopeExpansion.github]),
  slack: dedupeScopes([...getProviderDefaultScopes("slack"), ...providerScopeExpansion.slack]),
  notion: dedupeScopes([...getProviderDefaultScopes("notion"), ...providerScopeExpansion.notion]),
  reddit: dedupeScopes([...getProviderDefaultScopes("reddit"), ...providerScopeExpansion.reddit]),
  x: dedupeScopes([...getProviderDefaultScopes("x"), ...providerScopeExpansion.x]),
  linkedin: dedupeScopes([
    ...getProviderDefaultScopes("linkedin"),
    ...providerScopeExpansion.linkedin,
  ]),
  custom: dedupeScopes([...getProviderDefaultScopes("custom"), ...providerScopeExpansion.custom]),
};

const oauthProviders = new Set<CanonicalProviderId>([
  "google",
  "stripe",
  "github",
  "slack",
  "notion",
  "reddit",
  "x",
  "linkedin",
]);
const refreshProviders = new Set<CanonicalProviderId>(["google", "stripe", "github"]);
const webhookProviders = new Set<CanonicalProviderId>(["stripe", "github"]);

const gatewayProviderIdByCanonical: Record<CanonicalProviderId, string> = {
  google: `g${"mail"}`,
  stripe: "stripe",
  github: "github",
  slack: "slack",
  notion: "notion",
  reddit: "reddit",
  x: "x",
  linkedin: "linkedin",
  custom: "custom",
};
const expectedToolPrefixByProvider: Record<CanonicalProviderId, string> = {
  google: `g${"mail"}`,
  stripe: "stripe",
  github: "github",
  slack: "slack",
  notion: "notion",
  reddit: "reddit",
  x: "x",
  linkedin: "linkedin",
  custom: "custom",
};

const providerSortIndex: Record<CanonicalProviderId, number> = {
  google: 0,
  stripe: 1,
  github: 2,
  slack: 3,
  notion: 4,
  reddit: 5,
  x: 6,
  linkedin: 7,
  custom: 8,
};

const toImplementedActionTier = (
  capability: Capability,
  riskLevel: ActionRiskLevel,
): ProviderActionTier => {
  if (capability === "write" && riskLevel === "high") {
    return "T1";
  }
  if (riskLevel === "low") {
    return "T1";
  }
  if (riskLevel === "medium") {
    return "T2";
  }
  return "T3";
};

const implementedActionCatalogSeeds: Array<ActionCatalogSeed> = allTools
  .filter((tool) => tool.provider !== "keppo")
  .map((tool) => ({
    providerId: tool.provider as CanonicalProviderId,
    toolName: tool.name,
    actionType: tool.action_type,
    capability: tool.capability,
    riskLevel: tool.risk_level,
    tier: toImplementedActionTier(tool.capability, tool.risk_level),
    implementationStatus: "implemented",
    sdkMethod: tool.action_type,
    description: tool.description,
  }));

const implementedToolNameSet = new Set(
  implementedActionCatalogSeeds.map((entry) => entry.toolName),
);
const plannedCatalogSeeds: Array<ActionCatalogSeed> = plannedActionCatalogSeeds
  .filter((seed) => !implementedToolNameSet.has(seed.toolName))
  .map((seed) => ({
    ...seed,
    implementationStatus: "planned",
  }));

const actionCatalogSeeds: Array<ActionCatalogSeed> = [
  ...implementedActionCatalogSeeds,
  ...plannedCatalogSeeds,
].sort((a, b) => {
  const providerOrder = providerSortIndex[a.providerId] - providerSortIndex[b.providerId];
  if (providerOrder !== 0) {
    return providerOrder;
  }
  return a.toolName.localeCompare(b.toolName);
});

const readOutcomes: Array<ProviderActionRequiredOutcome> = [
  "success",
  "invalid_input",
  "auth_or_scope_error",
];

const writeOutcomes: Array<ProviderActionRequiredOutcome> = [
  ...readOutcomes,
  TOOL_CALL_RESULT_STATUS.idempotentReplay,
];

const toFakeGatewayContract = (
  providerId: CanonicalProviderId,
  actionType: string,
  capability: Capability,
  sdkMethod: string,
): ProviderActionCatalogEntry["fakeGateway"] => {
  const httpMatch = sdkMethod.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/);
  const httpMethod = httpMatch?.[1];
  const httpRoute = httpMatch?.[2];
  if (typeof httpMethod === "string" && typeof httpRoute === "string") {
    return {
      method: httpMethod as ProviderActionCatalogEntry["fakeGateway"]["method"],
      routeTemplate: httpRoute.trim(),
      samplePayload:
        capability === "write"
          ? {
              input: {
                action: actionType,
                value: "example",
              },
            }
          : null,
    };
  }

  const gatewayProviderId = gatewayProviderIdByCanonical[providerId] ?? providerId;
  return {
    method: capability === "read" ? "GET" : "POST",
    routeTemplate: `/${gatewayProviderId}/v1/${capability === "read" ? "list" : "write"}/${actionType}`,
    samplePayload:
      capability === "write"
        ? {
            input: {
              action: actionType,
              value: "example",
            },
          }
        : null,
  };
};

export const providerLifecycleActionMatrix: ProviderLifecycleActionMatrix = {
  google: {
    oauth_connect: true,
    oauth_authorize: true,
    oauth_callback: true,
    oauth_token: true,
    refresh: true,
    webhook: false,
  },
  stripe: {
    oauth_connect: true,
    oauth_authorize: true,
    oauth_callback: true,
    oauth_token: true,
    refresh: true,
    webhook: true,
  },
  github: {
    oauth_connect: true,
    oauth_authorize: true,
    oauth_callback: true,
    oauth_token: true,
    refresh: true,
    webhook: true,
  },
  slack: {
    oauth_connect: true,
    oauth_authorize: true,
    oauth_callback: true,
    oauth_token: true,
    refresh: false,
    webhook: false,
  },
  notion: {
    oauth_connect: true,
    oauth_authorize: true,
    oauth_callback: true,
    oauth_token: true,
    refresh: false,
    webhook: false,
  },
  reddit: {
    oauth_connect: true,
    oauth_authorize: true,
    oauth_callback: true,
    oauth_token: true,
    refresh: false,
    webhook: false,
  },
  x: {
    oauth_connect: true,
    oauth_authorize: true,
    oauth_callback: true,
    oauth_token: true,
    refresh: false,
    webhook: false,
  },
  linkedin: {
    oauth_connect: true,
    oauth_authorize: true,
    oauth_callback: true,
    oauth_token: true,
    refresh: false,
    webhook: false,
  },
  custom: {
    oauth_connect: false,
    oauth_authorize: false,
    oauth_callback: false,
    oauth_token: false,
    refresh: false,
    webhook: false,
  },
};

export const providerActionCatalog: ReadonlyArray<ProviderActionCatalogEntry> =
  actionCatalogSeeds.map((seed) => {
    const requiresApproval = seed.capability === "write";

    return {
      providerId: seed.providerId,
      toolName: seed.toolName,
      actionType: seed.actionType,
      capability: seed.capability,
      riskLevel: seed.riskLevel,
      requiresApproval,
      tier: seed.tier,
      implementationStatus: seed.implementationStatus,
      expectedSdkMethods: [seed.sdkMethod],
      fakeGateway: toFakeGatewayContract(
        seed.providerId,
        seed.actionType,
        seed.capability,
        seed.sdkMethod,
      ),
      requiredOAuthScopes: [...(providerCatalogScopes[seed.providerId] ?? [])],
      requiredOutcomes: seed.capability === "write" ? [...writeOutcomes] : [...readOutcomes],
      description: seed.description,
    };
  });

export const providerActionCatalogByToolName = new Map(
  providerActionCatalog.map((entry) => [entry.toolName, entry] as const),
);

export const getProviderActionCatalogEntry = (
  toolName: string,
): ProviderActionCatalogEntry | undefined => {
  return providerActionCatalogByToolName.get(toolName);
};

export const getProviderActionCatalogForProvider = (
  providerId: CanonicalProviderId,
): Array<ProviderActionCatalogEntry> => {
  return providerActionCatalog.filter((entry) => entry.providerId === providerId);
};

export const getProviderActionCatalogValidationErrors = (): Array<string> => {
  const errors: Array<string> = [];

  const implementedToolNameSet = new Set(
    allTools.filter((tool) => tool.provider !== "keppo").map((tool) => tool.name),
  );
  const toolNames = new Set<string>();
  for (const entry of providerActionCatalog) {
    if (toolNames.has(entry.toolName)) {
      errors.push(`Duplicate action catalog entry for ${entry.toolName}.`);
    }
    toolNames.add(entry.toolName);

    if (!entry.expectedSdkMethods.length) {
      errors.push(`${entry.toolName} is missing expected SDK method mappings.`);
    }
    const expectedPrefix = expectedToolPrefixByProvider[entry.providerId] ?? entry.providerId;
    if (!entry.toolName.startsWith(`${expectedPrefix}.`)) {
      errors.push(`${entry.toolName} must be namespaced under provider prefix ${expectedPrefix}.`);
    }

    if (!entry.requiredOutcomes.includes("success")) {
      errors.push(`${entry.toolName} must include success as a required outcome.`);
    }

    if (
      entry.capability === "write" &&
      !entry.requiredOutcomes.includes(TOOL_CALL_RESULT_STATUS.idempotentReplay)
    ) {
      errors.push(`${entry.toolName} write actions must require idempotent_replay coverage.`);
    }

    if (
      entry.capability === "read" &&
      entry.requiredOutcomes.includes(TOOL_CALL_RESULT_STATUS.idempotentReplay)
    ) {
      errors.push(`${entry.toolName} read actions must not require idempotent_replay coverage.`);
    }
  }

  const implementedFromCatalog = providerActionCatalog
    .filter((entry) => entry.implementationStatus === "implemented")
    .map((entry) => entry.toolName);

  for (const toolName of implementedToolNameSet) {
    if (!toolNames.has(toolName)) {
      errors.push(`Implemented tool ${toolName} is missing from providerActionCatalog.`);
    }
  }

  for (const toolName of implementedFromCatalog) {
    if (!implementedToolNameSet.has(toolName)) {
      errors.push(
        `Catalog marks ${toolName} as implemented, but it is missing from shared tool definitions.`,
      );
    }
  }

  if (implementedFromCatalog.length !== implementedToolNameSet.size) {
    errors.push(
      `Implemented action count mismatch. catalog=${implementedFromCatalog.length}, tool-definitions=${implementedToolNameSet.size}.`,
    );
  }

  for (const entry of providerActionCatalog) {
    if (entry.implementationStatus !== "planned") {
      continue;
    }
    if (implementedToolNameSet.has(entry.toolName)) {
      errors.push(`Planned action ${entry.toolName} collides with an implemented tool.`);
    }
  }

  for (const [providerId, matrix] of Object.entries(providerLifecycleActionMatrix)) {
    const canonicalProviderId = providerId as CanonicalProviderId;
    const isOauthProvider = oauthProviders.has(canonicalProviderId);
    const hasRefresh = refreshProviders.has(canonicalProviderId);
    const hasWebhook = webhookProviders.has(canonicalProviderId);

    if (
      matrix.oauth_connect !== isOauthProvider ||
      matrix.oauth_authorize !== isOauthProvider ||
      matrix.oauth_callback !== isOauthProvider ||
      matrix.oauth_token !== isOauthProvider
    ) {
      errors.push(
        `Lifecycle matrix OAuth mismatch for ${providerId}. Expected oauth entries to be ${isOauthProvider}.`,
      );
    }

    if (matrix.refresh !== hasRefresh) {
      errors.push(`Lifecycle matrix refresh mismatch for ${providerId}.`);
    }

    if (matrix.webhook !== hasWebhook) {
      errors.push(`Lifecycle matrix webhook mismatch for ${providerId}.`);
    }
  }

  return errors;
};

export const providerActionCatalogIsValid = (): boolean => {
  return getProviderActionCatalogValidationErrors().length === 0;
};
