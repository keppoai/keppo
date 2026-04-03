import type {
  CanonicalProviderId,
  ProviderAuthMode,
  ProviderModuleMetadata,
  ProviderRiskClass,
} from "@keppo/shared/providers";
import type { ProviderEventRecord } from "./provider-events";

export type FakeProviderId = CanonicalProviderId;

export type ProviderFakeRuntimeContext = {
  httpClient: (url: string | URL, init?: RequestInit) => Promise<Response>;
  clock: {
    now: () => number;
    nowIso: () => string;
  };
  idGenerator: {
    randomId: (prefix: string) => string;
  };
};

export type OAuthAuthorizeParams = {
  namespace: string;
  redirectUri: string;
  state: string;
  scope?: string;
  returnTo?: string;
};

export type OAuthCodeExchangePayload = {
  namespace: string;
  code: string;
  grantType: "authorization_code" | "refresh_token";
  refreshToken?: string;
  redirectUri?: string;
};

export type OAuthTokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  [key: string]: unknown;
};

export type ProviderReadRequest = {
  namespace: string;
  resource: string;
  query: Record<string, string>;
};

export type ProviderWriteRequest = {
  namespace: string;
  resource: string;
  body: unknown;
  headers: Headers;
};

export type ProviderFakeMetadata = {
  canonicalProviderId: FakeProviderId;
  gatewayProviderId: string;
  authMode: ProviderAuthMode;
  toolOwnership: string[];
  fixturePack: string;
  riskClass: ProviderRiskClass;
  moduleVersion: number;
  moduleMetadata: Pick<
    ProviderModuleMetadata,
    "providerId" | "auth" | "capabilities" | "featureGate" | "riskClass" | "toolOwnership"
  > | null;
  conformance: {
    read: { method: "GET"; path: string };
    write?: { method: "POST"; path: string; payload: Record<string, unknown> };
  };
};

export interface ProviderFakeContract {
  readonly providerId: string;
  readonly canonicalProviderId: FakeProviderId;
  getAuthorizationUrl(params: OAuthAuthorizeParams): URL;
  exchangeCodeForTokens(payload: OAuthCodeExchangePayload): OAuthTokenResponse;
  getProfile(namespace: string): Promise<Record<string, unknown>>;
  listResources(request: ProviderReadRequest): Promise<Record<string, unknown>>;
  readResource(request: ProviderReadRequest): Promise<Record<string, unknown>>;
  writeResource(request: ProviderWriteRequest): Promise<Record<string, unknown>>;
  simulateAsyncWork?(request: ProviderWriteRequest): Promise<Record<string, unknown>>;
  reset(namespace?: string): void;
  seed(namespace: string, seedData: Record<string, unknown>): void;
  captureEvent(event: ProviderEventRecord): void;
  getSdkCalls?(namespace?: string): Array<Record<string, unknown>>;
}
