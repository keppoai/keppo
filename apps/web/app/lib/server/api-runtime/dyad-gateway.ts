import { convertAiCreditsToDyadGatewayBudgetUsd } from "@keppo/shared/automations";
import { getEnv, type ApiEnv } from "./env.js";

export type DyadGatewayConfig = {
  baseUrl: string;
  masterKey: string;
  teamId: string;
};

export type DyadGatewayUserInfo = {
  user_id: string;
  spend: number;
  max_budget: number;
  budget_reset_at: string | null;
};

const trimToUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

export const hasDyadGatewayConfig = (env: ApiEnv = getEnv()): boolean => {
  return Boolean(
    trimToUndefined(env.KEPPO_LLM_GATEWAY_URL) &&
    trimToUndefined(env.KEPPO_LLM_GATEWAY_MASTER_KEY) &&
    trimToUndefined(env.KEPPO_LLM_GATEWAY_TEAM_ID),
  );
};

export const resolveDyadGatewayConfig = (env: ApiEnv = getEnv()): DyadGatewayConfig => {
  const baseUrl = trimToUndefined(env.KEPPO_LLM_GATEWAY_URL);
  const masterKey = trimToUndefined(env.KEPPO_LLM_GATEWAY_MASTER_KEY);
  const teamId = trimToUndefined(env.KEPPO_LLM_GATEWAY_TEAM_ID);
  if (!baseUrl || !masterKey || !teamId) {
    throw new Error(
      "Missing Dyad Gateway configuration. Expected KEPPO_LLM_GATEWAY_URL, KEPPO_LLM_GATEWAY_MASTER_KEY, and KEPPO_LLM_GATEWAY_TEAM_ID.",
    );
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    masterKey,
    teamId,
  };
};

export const toDyadGatewayUserId = (orgId: string): string => `keppo:${orgId}`;

const readJsonResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const fetchDyadGateway = async <T>(params: {
  path: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  allowNotFound?: boolean;
}): Promise<T | null> => {
  const config = resolveDyadGatewayConfig();
  const url = new URL(params.path, `${config.baseUrl}/`);
  const response = await fetch(url, {
    method: params.method ?? "GET",
    headers: {
      authorization: `Bearer ${config.masterKey}`,
      accept: "application/json",
      ...(params.body ? { "content-type": "application/json" } : {}),
    },
    ...(params.body ? { body: JSON.stringify(params.body) } : {}),
  });
  if (params.allowNotFound && response.status === 404) {
    return null;
  }
  if (!response.ok) {
    await readJsonResponse(response);
    throw new Error(
      `Dyad Gateway request failed (${params.method ?? "GET"} ${params.path}) with status ${response.status}`,
    );
  }
  return (await readJsonResponse(response)) as T | null;
};

export const getDyadGatewayUserInfo = async (
  orgId: string,
): Promise<DyadGatewayUserInfo | null> => {
  const userId = toDyadGatewayUserId(orgId);
  const payload = await fetchDyadGateway<{
    user_info?: {
      user_id?: string;
      spend?: number;
      max_budget?: number;
      budget_reset_at?: string | null;
    };
  }>({
    path: `/user/info?user_id=${encodeURIComponent(userId)}`,
    allowNotFound: true,
  });
  if (!payload?.user_info?.user_id) {
    return null;
  }
  return {
    user_id: payload.user_info.user_id,
    spend: typeof payload.user_info.spend === "number" ? payload.user_info.spend : 0,
    max_budget: typeof payload.user_info.max_budget === "number" ? payload.user_info.max_budget : 0,
    budget_reset_at: payload.user_info.budget_reset_at ?? null,
  };
};

export const createDyadGatewayUser = async (params: {
  orgId: string;
  maxBudgetUsd: number;
  userEmail?: string | null;
}): Promise<string> => {
  const config = resolveDyadGatewayConfig();
  const payload = await fetchDyadGateway<{ key?: string }>({
    path: "/user/new",
    method: "POST",
    body: {
      user_id: toDyadGatewayUserId(params.orgId),
      ...(params.userEmail?.trim() ? { user_email: params.userEmail.trim() } : {}),
      max_budget: params.maxBudgetUsd,
      budget_duration: "1mo",
      teams: [config.teamId],
    },
  });
  const key = payload?.key?.trim();
  if (!key) {
    throw new Error("Dyad Gateway user creation did not return a key.");
  }
  return key;
};

export const updateDyadGatewayUser = async (params: {
  orgId: string;
  maxBudgetUsd: number;
  resetSpend?: boolean;
}): Promise<void> => {
  await fetchDyadGateway({
    path: "/user/update",
    method: "POST",
    body: {
      user_id: toDyadGatewayUserId(params.orgId),
      max_budget: params.maxBudgetUsd,
      // LiteLLM rejects a literal zero spend reset here, so use the smallest supported value.
      ...(params.resetSpend ? { spend: 0.01 } : {}),
    },
  });
};

export const generateDyadGatewayKey = async (orgId: string): Promise<string> => {
  const payload = await fetchDyadGateway<{ key?: string }>({
    path: "/key/generate",
    method: "POST",
    body: {
      user_id: toDyadGatewayUserId(orgId),
    },
  });
  const key = payload?.key?.trim();
  if (!key) {
    throw new Error("Dyad Gateway key generation did not return a key.");
  }
  return key;
};

export const deleteDyadGatewayKeys = async (keys: string[]): Promise<void> => {
  const normalized = keys.map((key) => key.trim()).filter((key) => key.length > 0);
  if (normalized.length === 0) {
    return;
  }
  await fetchDyadGateway({
    path: "/key/delete",
    method: "POST",
    body: {
      keys: normalized,
    },
  });
};

export const deleteDyadGatewayUser = async (orgId: string): Promise<void> => {
  await fetchDyadGateway({
    path: "/user/delete",
    method: "POST",
    body: {
      user_ids: [toDyadGatewayUserId(orgId)],
    },
  });
};

export const resolveDyadGatewayBudgetUsdForTier = (credits: number): number =>
  convertAiCreditsToDyadGatewayBudgetUsd(credits);
