import {
  providerRegistry as sharedProviderRegistry,
  type CanonicalProviderId,
} from "../../../packages/shared/src/providers.js";
import type {
  ProviderFakeContract,
  ProviderFakeMetadata,
  ProviderFakeRuntimeContext,
} from "./contract/provider-contract";
import { GithubFake } from "./fakes/github";
import { GmailFake } from "./fakes/gmail";
import { NotionFake } from "./fakes/notion";
import { RedditFake } from "./fakes/reddit";
import { SlackFake } from "./fakes/slack";
import { StripeFake } from "./fakes/stripe";
import { XFake } from "./fakes/x";
import { createProviderFakeRuntime } from "./runtime";

type FakeProviderFactory = {
  gatewayProviderId: string;
  fixturePack: string;
  conformance: ProviderFakeMetadata["conformance"];
  createFake: (
    gatewayProviderId: string,
    fakeGatewayBaseUrl: string,
    runtime: ProviderFakeRuntimeContext,
  ) => ProviderFakeContract;
};

const fakeProviderFactories: Partial<Record<CanonicalProviderId, FakeProviderFactory>> = {
  google: {
    gatewayProviderId: "gmail",
    fixturePack: "connect-read-write",
    conformance: {
      read: { method: "GET", path: "/gmail/v1/users/me/messages?maxResults=2" },
      write: {
        method: "POST",
        path: "/gmail/v1/users/me/messages/send",
        payload: { raw: "ZmFrZQ" },
      },
    },
    createFake: (gatewayProviderId, fakeGatewayBaseUrl, runtime) =>
      new GmailFake(gatewayProviderId, fakeGatewayBaseUrl, runtime, "google"),
  },
  stripe: {
    gatewayProviderId: "stripe",
    fixturePack: "connect-refund",
    conformance: {
      read: { method: "GET", path: "/stripe/v1/list/customers" },
      write: {
        method: "POST",
        path: "/stripe/v1/write/refunds",
        payload: {
          charge: "ch_cus_100",
          amount: 4900,
          currency: "usd",
        },
      },
    },
    createFake: (gatewayProviderId, fakeGatewayBaseUrl, runtime) =>
      new StripeFake(gatewayProviderId, fakeGatewayBaseUrl, runtime, "stripe"),
  },
  slack: {
    gatewayProviderId: "slack",
    fixturePack: "connect-post-message",
    conformance: {
      read: { method: "GET", path: "/slack/v1/list/channels" },
      write: {
        method: "POST",
        path: "/slack/v1/write/chat.postMessage",
        payload: {
          channel: "C001",
          text: "Hello",
        },
      },
    },
    createFake: (gatewayProviderId, fakeGatewayBaseUrl, runtime) =>
      new SlackFake(gatewayProviderId, fakeGatewayBaseUrl, runtime, "slack"),
  },
  notion: {
    gatewayProviderId: "notion",
    fixturePack: "connect-create-page",
    conformance: {
      read: { method: "GET", path: "/notion/v1/list/pages?query=Support" },
      write: {
        method: "POST",
        path: "/notion/v1/write/pages",
        payload: {
          title: "Escalation Summary",
          content: "Notion write coverage from conformance suite.",
        },
      },
    },
    createFake: (gatewayProviderId, fakeGatewayBaseUrl, runtime) =>
      new NotionFake(gatewayProviderId, fakeGatewayBaseUrl, runtime, "notion"),
  },
  reddit: {
    gatewayProviderId: "reddit",
    fixturePack: "connect-create-post",
    conformance: {
      read: { method: "GET", path: "/reddit/v1/r/support/search?q=keppo&limit=2" },
      write: {
        method: "POST",
        path: "/reddit/v1/api/submit",
        payload: {
          sr: "support",
          title: "Conformance write",
          text: "Reddit write coverage from conformance suite.",
        },
      },
    },
    createFake: (gatewayProviderId, fakeGatewayBaseUrl, runtime) =>
      new RedditFake(gatewayProviderId, fakeGatewayBaseUrl, runtime, "reddit"),
  },
  x: {
    gatewayProviderId: "x",
    fixturePack: "connect-create-post",
    conformance: {
      read: { method: "GET", path: "/x/v1/2/tweets/search/recent?query=keppo&max_results=2" },
      write: {
        method: "POST",
        path: "/x/v1/2/tweets",
        payload: {
          text: "Conformance write",
        },
      },
    },
    createFake: (gatewayProviderId, fakeGatewayBaseUrl, runtime) =>
      new XFake(gatewayProviderId, fakeGatewayBaseUrl, runtime, "x"),
  },
  github: {
    gatewayProviderId: "github",
    fixturePack: "connect-comment",
    conformance: {
      read: { method: "GET", path: "/github/v1/list/issues" },
      write: {
        method: "POST",
        path: "/github/v1/write/issues/comment",
        payload: {
          body: "Hello",
        },
      },
    },
    createFake: (gatewayProviderId, fakeGatewayBaseUrl, runtime) =>
      new GithubFake(gatewayProviderId, fakeGatewayBaseUrl, runtime, "github"),
  },
};

export type ProviderMetadata = ProviderFakeMetadata & {
  providerId: string;
  fake: ProviderFakeContract;
};

export const createProviderRegistry = (
  fakeGatewayBaseUrl: string,
  runtime: ProviderFakeRuntimeContext = createProviderFakeRuntime(),
): ProviderMetadata[] => {
  const managedProviders = sharedProviderRegistry
    .listProviders()
    .map((module) => {
      const factory = fakeProviderFactories[module.metadata.providerId];
      if (!factory) {
        return null;
      }
      return {
        providerId: factory.gatewayProviderId,
        canonicalProviderId: module.metadata.providerId,
        gatewayProviderId: factory.gatewayProviderId,
        authMode: module.metadata.auth.mode,
        toolOwnership: [...module.metadata.toolOwnership],
        fixturePack: factory.fixturePack,
        riskClass: module.metadata.riskClass,
        moduleVersion: 1,
        moduleMetadata: {
          providerId: module.metadata.providerId,
          auth: module.metadata.auth,
          capabilities: module.metadata.capabilities,
          featureGate: module.metadata.featureGate,
          riskClass: module.metadata.riskClass,
          toolOwnership: [...module.metadata.toolOwnership],
        },
        conformance: factory.conformance,
        fake: factory.createFake(factory.gatewayProviderId, fakeGatewayBaseUrl, runtime),
      } satisfies ProviderMetadata;
    })
    .filter((entry): entry is ProviderMetadata => entry !== null);

  return managedProviders;
};

export const mapProviderRegistry = (entries: ProviderMetadata[]): Map<string, ProviderMetadata> => {
  const mapped = new Map<string, ProviderMetadata>();
  for (const entry of entries) {
    mapped.set(entry.providerId, entry);
    if (entry.canonicalProviderId !== entry.providerId) {
      mapped.set(entry.canonicalProviderId, entry);
    }
  }
  return mapped;
};
