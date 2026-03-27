import type { Connector, ConnectorContext } from "../connectors/base.js";
import { PROVIDER_DEFAULT_SCOPES } from "../provider-default-scopes.js";
import { createFakeGmailClientStore, createFakeGmailSdk } from "../provider-sdk/google/fake.js";
import { createFakeStripeClientStore, createFakeStripeSdk } from "../provider-sdk/stripe/fake.js";
import { createFakeGithubClientStore, createFakeGithubSdk } from "../provider-sdk/github/fake.js";
import { createFakeSlackClientStore, createFakeSlackSdk } from "../provider-sdk/slack/fake.js";
import { createFakeNotionClientStore, createFakeNotionSdk } from "../provider-sdk/notion/fake.js";
import { createFakeRedditClientStore, createFakeRedditSdk } from "../provider-sdk/reddit/fake.js";
import { createFakeXClientStore, createFakeXSdk } from "../provider-sdk/x/fake.js";
import type { ProviderSdkCallLog } from "../provider-sdk/port.js";
import { createGoogleConnector } from "../providers/modules/google/connector.js";
import { createStripeConnector } from "../providers/modules/stripe/connector.js";
import { createGithubConnector } from "../providers/modules/github/connector.js";
import { createSlackConnector } from "../providers/modules/slack/connector.js";
import { createNotionConnector } from "../providers/modules/notion/connector.js";
import { createRedditConnector } from "../providers/modules/reddit/connector.js";
import { createXConnector } from "../providers/modules/x/connector.js";
import type { CanonicalProviderId } from "../provider-ids.js";

export type SdkBackedProviderId = Exclude<CanonicalProviderId, "custom">;

export const CONFORMANCE_NAMESPACE = "conformance-vitest";

type HarnessSdk = {
  callLog: ProviderSdkCallLog;
};

type HarnessInternals = {
  connector: Connector;
  sdk: HarnessSdk;
  clientStore: unknown;
};

export type ConnectorHarness = HarnessInternals & {
  callLog: ProviderSdkCallLog;
  context: ConnectorContext;
  buildContext: (contextOverrides?: Partial<ConnectorContext>) => ConnectorContext;
  resetCallLog: () => void;
};

const buildContext = (
  providerId: SdkBackedProviderId,
  contextOverrides: Partial<ConnectorContext> = {},
): ConnectorContext => {
  return {
    workspaceId: "workspace_conformance",
    orgId: "org_conformance",
    access_token: "test_access_token",
    scopes: [...PROVIDER_DEFAULT_SCOPES[providerId]],
    metadata: {
      e2e_namespace: CONFORMANCE_NAMESPACE,
    },
    ...contextOverrides,
  };
};

const createHarnessInternals = (providerId: SdkBackedProviderId): HarnessInternals => {
  switch (providerId) {
    case "google": {
      const clientStore = createFakeGmailClientStore();
      const sdk = createFakeGmailSdk({ clientStore });
      return {
        connector: createGoogleConnector({ sdk }),
        sdk,
        clientStore,
      };
    }
    case "stripe": {
      const clientStore = createFakeStripeClientStore();
      const sdk = createFakeStripeSdk({ clientStore });
      return {
        connector: createStripeConnector({ sdk }),
        sdk,
        clientStore,
      };
    }
    case "github": {
      const clientStore = createFakeGithubClientStore();
      const sdk = createFakeGithubSdk({ clientStore });
      return {
        connector: createGithubConnector({ sdk }),
        sdk,
        clientStore,
      };
    }
    case "slack": {
      const clientStore = createFakeSlackClientStore();
      const sdk = createFakeSlackSdk({ clientStore });
      return {
        connector: createSlackConnector({ sdk }),
        sdk,
        clientStore,
      };
    }
    case "notion": {
      const clientStore = createFakeNotionClientStore();
      const sdk = createFakeNotionSdk({ clientStore });
      return {
        connector: createNotionConnector({ sdk }),
        sdk,
        clientStore,
      };
    }
    case "reddit": {
      const clientStore = createFakeRedditClientStore();
      const sdk = createFakeRedditSdk({ clientStore });
      return {
        connector: createRedditConnector({ sdk }),
        sdk,
        clientStore,
      };
    }
    case "x": {
      const clientStore = createFakeXClientStore();
      const sdk = createFakeXSdk({ clientStore });
      return {
        connector: createXConnector({ sdk }),
        sdk,
        clientStore,
      };
    }
  }
};

export const createConnectorHarness = (
  providerId: SdkBackedProviderId,
  options?: {
    contextOverrides?: Partial<ConnectorContext>;
  },
): ConnectorHarness => {
  const internals = createHarnessInternals(providerId);
  const callLog = internals.sdk.callLog;

  return {
    ...internals,
    callLog,
    context: buildContext(providerId, options?.contextOverrides),
    buildContext: (contextOverrides = {}) => buildContext(providerId, contextOverrides),
    resetCallLog: () => {
      callLog.reset(CONFORMANCE_NAMESPACE);
    },
  };
};
