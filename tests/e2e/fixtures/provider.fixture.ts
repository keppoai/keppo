import { McpClient } from "../helpers/mcp-client";
import { listProviderEvents, postGatewaySeed } from "../helpers/api-client";
import { connectOAuthScenario } from "../providers/scenarios/connect-oauth";
import { listThreadsScenario } from "../providers/scenarios/list-threads";
import { rateLimitScenario } from "../providers/scenarios/rate-limit";
import { sendMessageScenario } from "../providers/scenarios/send-message";
import { timeoutScenario } from "../providers/scenarios/timeout";
import { tokenRefreshScenario } from "../providers/scenarios/token-refresh";
import { test as base, expect } from "./auth.fixture";

const scenarioSeeds: Record<string, Record<string, unknown>> = {
  [connectOAuthScenario.id]: {},
  [listThreadsScenario.id]: listThreadsScenario.seed ?? {},
  [sendMessageScenario.id]: {},
  [tokenRefreshScenario.id]: {},
  [rateLimitScenario.id]: rateLimitScenario.seed ?? {},
  [timeoutScenario.id]: timeoutScenario.seed ?? {},
};

export type ProviderFixture = {
  provider: {
    seedScenario: (providerId: string, scenarioId: string) => Promise<void>;
    events: (providerId?: string) => Promise<Array<Record<string, unknown>>>;
    createMcpClient: (workspaceId: string, bearerToken: string) => McpClient;
  };
};

export const test = base.extend<ProviderFixture>({
  provider: async ({ app }, use) => {
    const seedScenario = async (providerId: string, scenarioId: string): Promise<void> => {
      await postGatewaySeed(
        app.fakeGatewayBaseUrl,
        app.namespace,
        providerId,
        scenarioSeeds[scenarioId] ?? {},
      );
    };

    const events = async (providerId?: string): Promise<Array<Record<string, unknown>>> => {
      return await listProviderEvents(app.fakeGatewayBaseUrl, app.namespace, providerId);
    };

    const createMcpClient = (workspaceId: string, bearerToken: string): McpClient => {
      return new McpClient({
        baseUrl: app.apiBaseUrl,
        workspaceId,
        bearerToken,
        extraHeaders: app.headers,
      });
    };

    await use({
      seedScenario,
      events,
      createMcpClient,
    });
  },
});

export { expect };
