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

export const syncBundledAiCreditsFromGateway = async (params: {
  convex: BundledAiConvex;
  orgId: string;
  gatewayBaseUrl: string | null;
  usageSource?: AiCreditUsageSource;
}): Promise<BundledAiSyncSnapshot> => {
  assertBundledGatewayManagementConfigured(params.gatewayBaseUrl);
  const gatewayUser = await getDyadGatewayUserInfo(params.orgId);
  if (!gatewayUser) {
    throw createAutomationRouteError(
      "automation_route_failed",
      "Bundled AI gateway user is unavailable.",
    );
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
}> => {
  const existingKey = await params.convex.getOrgAiKey({
    orgId: params.orgId,
    provider: params.provider,
    keyMode: AI_KEY_MODE.bundled,
  });
  if (existingKey?.is_active) {
    return {
      encryptedKey: existingKey.encrypted_key,
      credentialKind: "secret",
    };
  }

  assertBundledGatewayManagementConfigured(params.gatewayBaseUrl);
  const existingUser = await getDyadGatewayUserInfo(params.orgId);
  if (existingUser) {
    await params.convex.syncAiCreditsFromGateway({
      orgId: params.orgId,
      spendUsd: existingUser.spend,
      maxBudgetUsd: existingUser.max_budget,
      budgetResetAt: existingUser.budget_reset_at,
    });
  }

  const balance = await params.convex.getAiCreditBalance({ orgId: params.orgId });
  const maxBudgetUsd = resolveDyadGatewayMaxBudgetUsd({
    remainingCredits: balance.total_available,
    currentSpendUsd: existingUser?.spend ?? 0,
  });
  const rawKey = existingUser
    ? (await updateDyadGatewayUser({
        orgId: params.orgId,
        maxBudgetUsd,
      }),
      await generateDyadGatewayKey(params.orgId))
    : await createDyadGatewayUser({
        orgId: params.orgId,
        maxBudgetUsd,
      });

  for (const provider of BUNDLED_GATEWAY_PROVIDERS) {
    await params.convex.upsertBundledOrgAiKey({
      orgId: params.orgId,
      provider,
      rawKey,
      createdBy: "bundled_ai",
    });
  }

  const provisionedKey = await params.convex.getOrgAiKey({
    orgId: params.orgId,
    provider: params.provider,
    keyMode: AI_KEY_MODE.bundled,
  });
  if (!provisionedKey?.is_active) {
    throw createAutomationRouteError(
      "automation_route_failed",
      "Bundled AI gateway key is unavailable.",
    );
  }

  return {
    encryptedKey: provisionedKey.encrypted_key,
    credentialKind: "secret",
  };
};

export const createBundledOpenAiClientForOrg = async (params: {
  convex: BundledAiConvex;
  orgId: string;
  gatewayBaseUrl: string | null;
}): Promise<OpenAI> => {
  const gatewayBaseUrl = assertBundledGatewayManagementConfigured(params.gatewayBaseUrl);
  const bundledKey = await ensureBundledGatewayKeyForOrg({
    convex: params.convex,
    orgId: params.orgId,
    provider: "openai",
    gatewayBaseUrl,
  });
  return new OpenAI({
    apiKey: await decryptStoredKey(bundledKey.encryptedKey),
    baseURL: gatewayBaseUrl,
  });
};
