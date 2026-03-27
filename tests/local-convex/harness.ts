import { ConvexHttpClient } from "convex/browser";
import { KeppoStore } from "../../packages/shared/src/store";
import {
  resolveLocalAdminKey,
  setClientAdminAuth,
  toUsableAdminKey,
} from "../../packages/shared/src/convex-admin.js";
import { resetConvexDeploymentViaImport } from "../e2e/helpers/convex-import-reset";
import { withPausedRuntimeCronDriver } from "../e2e/infra/stack-manager";
import { ensureEmailPasswordUser } from "../e2e/helpers/email-password-user";
import { readLocalEnvValue } from "../e2e/helpers/local-env";
import { McpClient } from "../e2e/helpers/mcp-client";

export const resolveConvexUrl = (): string => {
  if (process.env.CONVEX_URL) {
    return process.env.CONVEX_URL;
  }
  const fromFile = readLocalEnvValue("CONVEX_URL");
  if (fromFile) {
    return fromFile;
  }
  throw new Error("CONVEX_URL is not set. Run `npx convex dev --once --local` first.");
};

export const resolveApiBaseUrl = (): string => {
  return process.env.KEPPO_API_BASE_URL ?? "http://127.0.0.1:3210";
};

export const resolveFakeGatewayBaseUrl = (): string => {
  return process.env.KEPPO_FAKE_GATEWAY_BASE_URL ?? "http://127.0.0.1:9911";
};

export const resolveDashboardBaseUrl = (): string => {
  return process.env.KEPPO_DASHBOARD_BASE_URL ?? "http://127.0.0.1:3211";
};

export const resolveQueueBrokerBaseUrl = (): string => {
  return process.env.KEPPO_LOCAL_QUEUE_BROKER_URL ?? "http://127.0.0.1:9910";
};

export const resolveAdminKey = (errorMessage: string): string => {
  const adminKey =
    toUsableAdminKey(process.env.KEPPO_CONVEX_ADMIN_KEY) ??
    toUsableAdminKey(resolveLocalAdminKey());
  if (adminKey) {
    return adminKey;
  }
  throw new Error(errorMessage);
};

export const convexUrl = resolveConvexUrl();
export const apiBaseUrl = resolveApiBaseUrl();
export const fakeGatewayBaseUrl = resolveFakeGatewayBaseUrl();
export const dashboardBaseUrl = resolveDashboardBaseUrl();
export const queueBrokerBaseUrl = resolveQueueBrokerBaseUrl();
export const adminKey = resolveAdminKey("Missing KEPPO_CONVEX_ADMIN_KEY for local Convex tests.");

export const createRandomToken = (): string => {
  return Math.random().toString(16).slice(2, 10);
};

export const createNamespace = (prefix: string, scenarioId: string): string => {
  return `${prefix}.${scenarioId}.${Date.now().toString(36)}.${createRandomToken()}`;
};

export const isOptimisticConcurrencyFailure = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("optimisticconcurrencycontrolfailure");
};

export const runWithOccRetry = async <T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isOptimisticConcurrencyFailure(error) || attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw new Error("Retry attempts exhausted");
};

export const createAdminClient = (): ConvexHttpClient => {
  const client = new ConvexHttpClient(convexUrl);
  setClientAdminAuth(client, adminKey);
  return client;
};

export const createStore = (): KeppoStore => {
  return new KeppoStore(convexUrl, adminKey);
};

export const createHeaders = (namespace: string, scenarioId: string): Record<string, string> => {
  return {
    "x-keppo-e2e-namespace": namespace,
    "x-e2e-scenario-id": scenarioId,
  };
};

export const createMcpClient = (
  workspaceId: string,
  bearerToken: string,
  headers: Record<string, string>,
): McpClient => {
  return new McpClient({
    baseUrl: apiBaseUrl,
    workspaceId,
    bearerToken,
    extraHeaders: headers,
  });
};

const resolveConvexSiteBaseUrl = (url: string): string => {
  const parsed = new URL(url);
  const defaultPort = parsed.protocol === "https:" ? 443 : 80;
  const convexPort = Number.parseInt(parsed.port || String(defaultPort), 10);
  const sitePort = Number.isFinite(convexPort) ? convexPort + 1 : defaultPort;
  return `${parsed.protocol}//${parsed.hostname}:${sitePort}`;
};

export const createApiSessionCookie = async (params: {
  headers: Record<string, string>;
  email: string;
  password: string;
  name: string;
}): Promise<string> => {
  const authBaseUrl = `${resolveConvexSiteBaseUrl(convexUrl)}/api/auth`;
  const request = async (
    path: "sign-in/email" | "sign-up/email",
    payload: Record<string, unknown>,
  ): Promise<Response> => {
    return await fetch(`${authBaseUrl}/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: dashboardBaseUrl,
        ...params.headers,
      },
      body: JSON.stringify(payload),
    });
  };

  let response = await request("sign-in/email", {
    email: params.email,
    password: params.password,
  });

  if (!response.ok) {
    const signUpResponse = await request("sign-up/email", {
      name: params.name,
      email: params.email,
      password: params.password,
    });
    if (signUpResponse.ok) {
      response = signUpResponse;
    } else if (signUpResponse.status === 422) {
      response = await request("sign-in/email", {
        email: params.email,
        password: params.password,
      });
    }
  }

  if (!response.ok) {
    throw new Error(`Failed to create auth session for ${params.email}: ${response.status}`);
  }

  const setCookie =
    (typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie().find((value) => value.includes("session_token"))
      : null) ?? response.headers.get("set-cookie");

  if (!setCookie) {
    throw new Error(`Missing Better Auth session cookie for ${params.email}.`);
  }

  return setCookie.split(";")[0] ?? setCookie;
};

export const ensureLocalEmailPasswordUser = async (params: {
  headers: Record<string, string>;
  email: string;
  password: string;
  name: string;
}): Promise<void> => {
  await ensureEmailPasswordUser({
    dashboardBaseUrl,
    headers: params.headers,
    email: params.email,
    password: params.password,
    name: params.name,
  });
};

const resetAllLocalConvexStateUnpaused = async (): Promise<void> => {
  await resetConvexDeploymentViaImport({
    env: {
      CONVEX_URL: convexUrl,
    },
  });
};

export const resetAllLocalConvexState = async (): Promise<void> => {
  await withPausedRuntimeCronDriver(0, async () => {
    await resetAllLocalConvexStateUnpaused();
  });
};

export const resetAllLocalRuntimeState = async (): Promise<void> => {
  await withPausedRuntimeCronDriver(0, async () => {
    const gatewayReset = await fetch(`${fakeGatewayBaseUrl}/__reset`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!gatewayReset.ok) {
      throw new Error(`Failed to reset local fake gateway: ${gatewayReset.status}`);
    }
    const queueReset = await fetch(`${queueBrokerBaseUrl}/reset`, {
      method: "POST",
    });
    if (!queueReset.ok) {
      throw new Error(`Failed to reset local queue broker: ${queueReset.status}`);
    }
    await resetAllLocalConvexStateUnpaused();
  });
};

export const withLocalConvexNamespace = async <T>(
  prefix: string,
  scenarioId: string,
  fn: (params: { namespace: string; headers: Record<string, string> }) => Promise<T>,
): Promise<T> => {
  const namespace = createNamespace(prefix, scenarioId);
  const headers = createHeaders(namespace, scenarioId);
  await resetAllLocalRuntimeState();
  try {
    return await fn({ namespace, headers });
  } finally {
    await resetAllLocalRuntimeState();
  }
};
