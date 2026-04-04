import OpenAI from "openai";
import type { ConvexInternalClient } from "./convex.js";
import {
  AI_KEY_MODE,
  createAutomationRouteError,
  type AiCreditUsageSource,
  type AiModelProvider,
} from "@keppo/shared/automations";
import {
  createDyadGatewayUser,
  generateDyadGatewayKey,
  getDyadGatewayUserInfo,
  hasDyadGatewayConfig,
  resolveDyadGatewayMaxBudgetUsd,
  updateDyadGatewayUser,
  type DyadGatewayUserInfo,
} from "./dyad-gateway.js";
import { decryptStoredKey } from "./routes/automations.js";

type BundledAiConvex = Pick<
  ConvexInternalClient,
  "getAiCreditBalance" | "getOrgAiKey" | "syncAiCreditsFromGateway" | "upsertBundledOrgAiKey"
>;

type BundledAiSyncSnapshot = {
  gatewayUser: DyadGatewayUserInfo;
  synced: Awaited<ReturnType<BundledAiConvex["syncAiCreditsFromGateway"]>>;
};

export type BundledAiBillingState = {
  balance: Awaited<ReturnType<BundledAiConvex["getAiCreditBalance"]>>;
  spendUsd: number;
  maxBudgetUsd: number;
  budgetResetAt: string | null;
};

const BUNDLED_GATEWAY_PROVIDERS: AiModelProvider[] = ["openai", "anthropic"];

export const resolveBundledGatewayUrl = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const assertBundledGatewayManagementConfigured = (gatewayBaseUrl: string | null): string => {
  if (!gatewayBaseUrl || !hasDyadGatewayConfig()) {
    throw createAutomationRouteError(
      "missing_env",
      "Bundled AI gateway management is unavailable.",
    );
  }
  return gatewayBaseUrl;
};

const provisionBundledGatewayKey = async (params: {
  orgId: string;
  maxBudgetUsd: number;
  existingUser: DyadGatewayUserInfo | null;
}): Promise<{ rawKey: string; user: DyadGatewayUserInfo | null }> => {
  if (params.existingUser) {
    return {
      rawKey: await generateDyadGatewayKey(params.orgId),
      user: params.existingUser,
    };
  }
  try {
    return {
      rawKey: await createDyadGatewayUser({
        orgId: params.orgId,
        maxBudgetUsd: params.maxBudgetUsd,
      }),
      user: await getDyadGatewayUserInfo(params.orgId),
    };
  } catch (error) {
    const concurrentUser = await getDyadGatewayUserInfo(params.orgId);
    if (!concurrentUser) {
      throw error;
    }
    return {
      rawKey: await generateDyadGatewayKey(params.orgId),
      user: concurrentUser,
    };
  }
};

export const syncBundledAiCreditsFromGateway = async (params: {
  convex: BundledAiConvex;
  orgId: string;
  gatewayBaseUrl: string | null;
  usageSource?: AiCreditUsageSource;
}): Promise<BundledAiSyncSnapshot | null> => {
  assertBundledGatewayManagementConfigured(params.gatewayBaseUrl);
  const gatewayUser = await getDyadGatewayUserInfo(params.orgId);
  if (!gatewayUser) {
    return null;
  }
  const synced = await params.convex.syncAiCreditsFromGateway({
    orgId: params.orgId,
    spendUsd: gatewayUser.spend,
    maxBudgetUsd: gatewayUser.max_budget,
    budgetResetAt: gatewayUser.budget_reset_at,
    ...(params.usageSource ? { usageSource: params.usageSource } : {}),
  });
  return {
    gatewayUser,
    synced,
  };
};

export const ensureBundledGatewayKeyForOrg = async (params: {
  convex: BundledAiConvex;
  orgId: string;
  provider: AiModelProvider;
  gatewayBaseUrl: string | null;
}): Promise<{
  encryptedKey: string;
  credentialKind: "secret";
  billingState: BundledAiBillingState;
}> => {
  assertBundledGatewayManagementConfigured(params.gatewayBaseUrl);
  const [existingKey, existingUser] = await Promise.all([
    params.convex.getOrgAiKey({
      orgId: params.orgId,
      provider: params.provider,
      keyMode: AI_KEY_MODE.bundled,
    }),
    getDyadGatewayUserInfo(params.orgId),
  ]);
  const syncedBalance = existingUser
    ? await params.convex.syncAiCreditsFromGateway({
        orgId: params.orgId,
        spendUsd: existingUser.spend,
        maxBudgetUsd: existingUser.max_budget,
        budgetResetAt: existingUser.budget_reset_at,
      })
    : null;
  const balance =
    syncedBalance?.balance ?? (await params.convex.getAiCreditBalance({ orgId: params.orgId }));
  const maxBudgetUsd = resolveDyadGatewayMaxBudgetUsd({
    remainingCredits: balance.total_available,
    currentSpendUsd: existingUser?.spend ?? 0,
  });

  if (existingUser && existingUser.max_budget !== maxBudgetUsd) {
    await updateDyadGatewayUser({
      orgId: params.orgId,
      maxBudgetUsd,
    });
  }

  if (existingKey?.is_active && existingUser) {
    return {
      encryptedKey: existingKey.encrypted_key,
      credentialKind: "secret",
      billingState: {
        balance,
        spendUsd: existingUser.spend,
        maxBudgetUsd,
        budgetResetAt: existingUser.budget_reset_at,
      },
    };
  }

  const provisioned = await provisionBundledGatewayKey({
    orgId: params.orgId,
    maxBudgetUsd,
    existingUser,
  });

  const provisionedKeys = await Promise.all(
    BUNDLED_GATEWAY_PROVIDERS.map((provider) =>
      params.convex.upsertBundledOrgAiKey({
        orgId: params.orgId,
        provider,
        rawKey: provisioned.rawKey,
        createdBy: "bundled_ai",
      }),
    ),
  );
  const provisionedKey = provisionedKeys.find((key) => key.provider === params.provider) ?? null;
  if (!provisionedKey?.is_active) {
    throw createAutomationRouteError(
      "automation_route_failed",
      "Bundled AI gateway key is unavailable.",
    );
  }

  return {
    encryptedKey: provisionedKey.encrypted_key,
    credentialKind: "secret",
    billingState: {
      balance,
      spendUsd: provisioned.user?.spend ?? existingUser?.spend ?? 0,
      maxBudgetUsd,
      budgetResetAt: provisioned.user?.budget_reset_at ?? existingUser?.budget_reset_at ?? null,
    },
  };
};

export const createBundledOpenAiClientForOrg = async (params: {
  convex: BundledAiConvex;
  orgId: string;
  gatewayBaseUrl: string | null;
}): Promise<{ client: OpenAI; billingState: BundledAiBillingState }> => {
  const gatewayBaseUrl = assertBundledGatewayManagementConfigured(params.gatewayBaseUrl);
  const bundledKey = await ensureBundledGatewayKeyForOrg({
    convex: params.convex,
    orgId: params.orgId,
    provider: "openai",
    gatewayBaseUrl,
  });
  return {
    client: new OpenAI({
      apiKey: await decryptStoredKey(bundledKey.encryptedKey),
      baseURL: gatewayBaseUrl,
    }),
    billingState: bundledKey.billingState,
  };
};
