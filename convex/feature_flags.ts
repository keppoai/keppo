import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { CANONICAL_PROVIDER_IDS } from "../packages/shared/src/provider-ids.js";
import { AUDIT_ACTOR_TYPE, AUDIT_EVENT_TYPES } from "./domain_constants";
import { nowIso, randomIdFor, requireIdentity } from "./_auth";

const featureFlagViewValidator = v.object({
  id: v.string(),
  key: v.string(),
  label: v.string(),
  description: v.string(),
  enabled: v.boolean(),
  created_at: v.string(),
  updated_at: v.string(),
});

type FeatureFlagView = {
  id: string;
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

const PROVIDER_REGISTRY_PATH_FEATURE_FLAG = "KEPPO_FEATURE_PROVIDER_REGISTRY_PATH" as const;
const AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG =
  "KEPPO_FEATURE_AUTOMATION_SUBSCRIPTION_AUTH" as const;

type ProviderRolloutFeatureFlag =
  `KEPPO_FEATURE_INTEGRATIONS_${Uppercase<(typeof CANONICAL_PROVIDER_IDS)[number]>}_FULL`;

type KnownFeatureFlag =
  | typeof PROVIDER_REGISTRY_PATH_FEATURE_FLAG
  | typeof AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG
  | ProviderRolloutFeatureFlag;

type FeatureFlagDefinition = {
  name: KnownFeatureFlag;
  defaultValue: boolean;
  description: string;
};

const providerRolloutFeatureFlag = (provider: (typeof CANONICAL_PROVIDER_IDS)[number]) =>
  `KEPPO_FEATURE_INTEGRATIONS_${provider.toUpperCase()}_FULL` as ProviderRolloutFeatureFlag;

const FEATURE_FLAG_DEFINITIONS: FeatureFlagDefinition[] = [
  {
    name: PROVIDER_REGISTRY_PATH_FEATURE_FLAG,
    defaultValue: true,
    description: "Global kill switch for provider registry runtime dispatch.",
  },
  {
    name: AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG,
    defaultValue: false,
    description: "Enables automation subscription-login auth flows and configuration.",
  },
  ...CANONICAL_PROVIDER_IDS.map((provider) => ({
    name: providerRolloutFeatureFlag(provider),
    defaultValue: true,
    description: `Rollout gate for ${provider} provider runtime paths.`,
  })),
];

const isKnownFeatureFlag = (name: string): name is KnownFeatureFlag =>
  FEATURE_FLAG_DEFINITIONS.some((definition) => definition.name === name);

const defaultFeatureFlagValue = (name: KnownFeatureFlag): boolean =>
  FEATURE_FLAG_DEFINITIONS.find((definition) => definition.name === name)?.defaultValue ?? false;

const readAdminUserIds = (): Set<string> => {
  const raw = process.env.KEPPO_ADMIN_USER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
};

const requireAdmin = async (
  ctx: Parameters<typeof requireIdentity>[0],
): Promise<{ userId: string }> => {
  const identity = await requireIdentity(ctx);
  if (!readAdminUserIds().has(identity.subject)) {
    throw new Error("Forbidden");
  }
  return { userId: identity.subject };
};

const definitionByKey = new Map(
  FEATURE_FLAG_DEFINITIONS.map((definition) => [definition.name, definition]),
);

const toFeatureFlagView = (
  key: KnownFeatureFlag,
  row: {
    id: string;
    key: string;
    label: string;
    description: string;
    enabled: boolean;
    created_at: string;
    updated_at: string;
  } | null,
): FeatureFlagView => {
  const definition = definitionByKey.get(key);
  const now = nowIso();
  return {
    id: row?.id ?? `default_${key.toLowerCase()}`,
    key,
    label: row?.label ?? key,
    description: row?.description ?? definition?.description ?? "",
    enabled: row?.enabled ?? defaultFeatureFlagValue(key),
    created_at: row?.created_at ?? now,
    updated_at: row?.updated_at ?? now,
  };
};

export const getFeatureFlagValue = query({
  args: {
    key: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    if (!isKnownFeatureFlag(args.key)) {
      return false;
    }
    const row = await ctx.db
      .query("feature_flags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    return row?.enabled ?? defaultFeatureFlagValue(args.key);
  },
});

export const listAllFlags = internalQuery({
  args: {},
  returns: v.array(featureFlagViewValidator),
  handler: async (ctx) => {
    const rows = await ctx.db.query("feature_flags").collect();
    const rowsByKey = new Map(rows.map((row) => [row.key, row]));
    const knownFlags = FEATURE_FLAG_DEFINITIONS.map((definition) =>
      toFeatureFlagView(definition.name, rowsByKey.get(definition.name) ?? null),
    );
    const extraFlags = rows
      .filter((row) => !definitionByKey.has(row.key as KnownFeatureFlag))
      .map((row) => ({
        id: row.id,
        key: row.key,
        label: row.label,
        description: row.description,
        enabled: row.enabled,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));
    return [...knownFlags, ...extraFlags].sort((left, right) => left.key.localeCompare(right.key));
  },
});

export const toggleFeatureFlag = mutation({
  args: {
    key: v.string(),
    enabled: v.boolean(),
  },
  returns: featureFlagViewValidator,
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    if (!isKnownFeatureFlag(args.key)) {
      throw new Error("Unknown feature flag");
    }

    const existing = await ctx.db
      .query("feature_flags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const now = nowIso();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        updated_at: now,
      });
    } else {
      const definition = definitionByKey.get(args.key);
      await ctx.db.insert("feature_flags", {
        id: randomIdFor("flag"),
        key: args.key,
        label: args.key,
        description: definition?.description ?? "",
        enabled: args.enabled,
        created_at: now,
        updated_at: now,
      });
    }

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: "platform_admin",
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: userId,
      event_type: AUDIT_EVENT_TYPES.adminFeatureFlagUpdated,
      payload: {
        key: args.key,
        enabled: args.enabled,
      },
      created_at: now,
    });

    const updated = await ctx.db
      .query("feature_flags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    return toFeatureFlagView(args.key, updated);
  },
});
