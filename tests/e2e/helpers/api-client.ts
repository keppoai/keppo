import type { APIRequestContext } from "@playwright/test";

export const apiJson = async <T>(
  request: APIRequestContext,
  url: string,
  namespace: string,
  init?: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    payload?: unknown;
    scenarioId?: string;
  },
): Promise<T> => {
  const response = await request.fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-keppo-e2e-namespace": namespace,
      ...(init?.scenarioId ? { "x-e2e-scenario-id": init.scenarioId } : {}),
    },
    data: init?.payload,
  });
  const text = await response.text();
  if (!response.ok()) {
    throw new Error(`API request failed (${response.status()}): ${url}\n${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
};

export const postGatewayReset = async (baseUrl: string, namespace: string): Promise<void> => {
  const response = await fetch(`${baseUrl}/__reset`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-keppo-e2e-namespace": namespace,
    },
    body: JSON.stringify({ namespace }),
  });
  if (!response.ok) {
    throw new Error(`Failed to reset fake gateway namespace ${namespace}`);
  }
};

export const postGatewaySeed = async (
  baseUrl: string,
  namespace: string,
  providerId: string,
  seed: Record<string, unknown>,
): Promise<void> => {
  const response = await fetch(`${baseUrl}/__seed`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-keppo-e2e-namespace": namespace,
    },
    body: JSON.stringify({
      namespace,
      providerId,
      seed,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to seed provider ${providerId} for ${namespace}: ${text}`);
  }
};

export const listProviderEvents = async (
  baseUrl: string,
  namespace: string,
  providerId?: string,
): Promise<Array<Record<string, unknown>>> => {
  const query = new URLSearchParams({ namespace });
  if (providerId) {
    query.set("providerId", providerId);
  }
  const response = await fetch(`${baseUrl}/__provider-events?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to list provider events for ${namespace}`);
  }
  const payload = (await response.json()) as { events?: Array<Record<string, unknown>> };
  return payload.events ?? [];
};

export const listProviderSdkCalls = async (
  baseUrl: string,
  namespace: string,
  providerId?: string,
): Promise<Array<Record<string, unknown>>> => {
  const payload = await listProviderSdkCallsSince(baseUrl, namespace, providerId);
  return payload.calls;
};

export const listProviderSdkCallsSince = async (
  baseUrl: string,
  namespace: string,
  providerId?: string,
  since?: number,
): Promise<{
  calls: Array<Record<string, unknown>>;
  total: number;
}> => {
  const query = new URLSearchParams({ namespace });
  if (providerId) {
    query.set("providerId", providerId);
  }
  if (typeof since === "number" && Number.isInteger(since) && since >= 0) {
    query.set("since", String(since));
  }
  const response = await fetch(`${baseUrl}/__sdk-calls?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to list provider SDK calls for ${namespace}`);
  }
  const payload = (await response.json()) as {
    calls?: Array<Record<string, unknown>>;
    total?: unknown;
  };
  const calls = payload.calls ?? [];
  const total = Number(payload.total);
  return {
    calls,
    total: Number.isInteger(total) && total >= 0 ? total : calls.length,
  };
};
