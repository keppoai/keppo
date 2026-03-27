import type {
  FakeProviderId,
  OAuthAuthorizeParams,
  OAuthCodeExchangePayload,
  OAuthTokenResponse,
  ProviderFakeContract,
  ProviderFakeRuntimeContext,
  ProviderReadRequest,
  ProviderWriteRequest,
} from "./contract/provider-contract";
import type { ProviderEventRecord } from "./contract/provider-events";

type AuthCodeState = {
  namespace: string;
  code: string;
  state: string;
  redirectUri: string;
  scope: string;
  expiresAt: number;
};

type TokenState = {
  namespace: string;
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: number;
  revoked: boolean;
};

type NamespaceRateLimit = {
  windowStartedAt: number;
  count: number;
};

export type NamespaceState = {
  codes: Map<string, AuthCodeState>;
  tokensByAccess: Map<string, TokenState>;
  accessByRefresh: Map<string, string>;
  requestIds: Set<string>;
  idempotencyResponses: Map<string, Record<string, unknown>>;
  rateLimit: NamespaceRateLimit;
  store: Record<string, unknown>;
  events: ProviderEventRecord[];
};

export abstract class BaseProviderFake implements ProviderFakeContract {
  readonly providerId: string;
  readonly canonicalProviderId: FakeProviderId;
  protected readonly runtime: ProviderFakeRuntimeContext;
  protected readonly gatewayBaseUrl: string;
  protected readonly states = new Map<string, NamespaceState>();

  constructor(
    providerId: string,
    gatewayBaseUrl: string,
    runtime: ProviderFakeRuntimeContext,
    canonicalProviderId: FakeProviderId = providerId as FakeProviderId,
  ) {
    this.providerId = providerId;
    this.canonicalProviderId = canonicalProviderId;
    this.runtime = runtime;
    this.gatewayBaseUrl = gatewayBaseUrl.endsWith("/")
      ? gatewayBaseUrl.slice(0, -1)
      : gatewayBaseUrl;
  }

  protected nowMs(): number {
    return this.runtime.clock.now();
  }

  protected createTokenId(prefix: string): string {
    return this.runtime.idGenerator.randomId(prefix);
  }

  protected initialNamespaceStore(): Record<string, unknown> {
    return {};
  }

  protected getNamespaceState(namespace: string): NamespaceState {
    const key = namespace.trim() || "global";
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }

    const created: NamespaceState = {
      codes: new Map<string, AuthCodeState>(),
      tokensByAccess: new Map<string, TokenState>(),
      accessByRefresh: new Map<string, string>(),
      requestIds: new Set<string>(),
      idempotencyResponses: new Map<string, Record<string, unknown>>(),
      rateLimit: {
        windowStartedAt: this.nowMs(),
        count: 0,
      },
      store: this.initialNamespaceStore(),
      events: [],
    };
    this.states.set(key, created);
    return created;
  }

  protected issueAuthorizationCode(params: OAuthAuthorizeParams): string {
    const code = this.createTokenId(`${this.providerId}_code`);
    const state = this.getNamespaceState(params.namespace);
    state.codes.set(code, {
      namespace: params.namespace,
      code,
      state: params.state,
      redirectUri: params.redirectUri,
      scope: params.scope ?? "",
      expiresAt: this.nowMs() + 60_000,
    });
    return code;
  }

  createAuthorizationCode(params: OAuthAuthorizeParams): string {
    return this.issueAuthorizationCode(params);
  }

  protected issueToken(namespace: string, scope: string): OAuthTokenResponse {
    const state = this.getNamespaceState(namespace);
    const accessToken = this.createTokenId(`${this.providerId}_access`);
    const refreshToken = this.createTokenId(`${this.providerId}_refresh`);
    const expiresIn = 3600;

    const tokenState: TokenState = {
      namespace,
      accessToken,
      refreshToken,
      scope,
      expiresAt: this.nowMs() + expiresIn * 1000,
      revoked: false,
    };
    state.tokensByAccess.set(accessToken, tokenState);
    state.accessByRefresh.set(refreshToken, accessToken);

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope,
    };
  }

  protected refreshToken(namespace: string, refreshToken: string): OAuthTokenResponse {
    const state = this.getNamespaceState(namespace);
    const currentAccess = state.accessByRefresh.get(refreshToken);
    if (!currentAccess) {
      throw new Error("invalid_refresh_token");
    }
    const existing = state.tokensByAccess.get(currentAccess);
    if (!existing || existing.revoked) {
      throw new Error("invalid_refresh_token");
    }

    existing.revoked = true;
    const rotated = this.issueToken(namespace, existing.scope);
    state.accessByRefresh.delete(refreshToken);

    return rotated;
  }

  assertAccessToken(namespace: string, accessToken: string | null): void {
    if (!accessToken) {
      throw new Error("missing_access_token");
    }
    const state = this.getNamespaceState(namespace);
    const token = state.tokensByAccess.get(accessToken);
    const envKey = `KEPPO_FAKE_${this.providerId.toUpperCase()}_ACCESS_TOKEN`;
    const fallbackToken = process.env[envKey]?.trim();
    const staticPrefix = `fake_${this.providerId}_access_token`;
    if (!token && (accessToken === fallbackToken || accessToken.startsWith(staticPrefix))) {
      return;
    }
    if (!token || token.revoked) {
      throw new Error("invalid_access_token");
    }
    if (token.expiresAt <= this.nowMs()) {
      throw new Error("expired_access_token");
    }
  }

  protected assertIdempotent(namespace: string, requestId: string | null): void {
    if (!requestId) {
      return;
    }
    const state = this.getNamespaceState(namespace);
    if (state.requestIds.has(requestId)) {
      return;
    }
    state.requestIds.add(requestId);
  }

  protected getIdempotentResponse(
    namespace: string,
    requestId: string | null,
  ): Record<string, unknown> | null {
    if (!requestId) {
      return null;
    }
    const state = this.getNamespaceState(namespace);
    return state.idempotencyResponses.get(requestId) ?? null;
  }

  protected setIdempotentResponse(
    namespace: string,
    requestId: string | null,
    response: Record<string, unknown>,
  ): void {
    if (!requestId) {
      return;
    }
    const state = this.getNamespaceState(namespace);
    state.idempotencyResponses.set(requestId, response);
  }

  protected enforceRateLimit(namespace: string, maxPerMinute: number): void {
    const state = this.getNamespaceState(namespace);
    const current = this.nowMs();
    if (current - state.rateLimit.windowStartedAt >= 60_000) {
      state.rateLimit.windowStartedAt = current;
      state.rateLimit.count = 0;
    }
    state.rateLimit.count += 1;
    if (state.rateLimit.count > maxPerMinute) {
      throw new Error("rate_limited");
    }
  }

  getAuthorizationUrl(params: OAuthAuthorizeParams): URL {
    const callback = new URL(`${this.gatewayBaseUrl}/${this.providerId}/oauth/callback`);
    callback.searchParams.set("namespace", params.namespace);
    callback.searchParams.set("redirect_uri", params.redirectUri);
    callback.searchParams.set("state", params.state);
    if (params.scope) {
      callback.searchParams.set("scope", params.scope);
    }
    if (params.returnTo) {
      callback.searchParams.set("return_to", params.returnTo);
    }
    return callback;
  }

  exchangeCodeForTokens(payload: OAuthCodeExchangePayload): OAuthTokenResponse {
    if (payload.grantType === "refresh_token") {
      if (!payload.refreshToken) {
        throw new Error("missing_refresh_token");
      }
      return this.refreshToken(payload.namespace, payload.refreshToken);
    }

    const state = this.getNamespaceState(payload.namespace);
    const code = state.codes.get(payload.code);
    if (!code) {
      throw new Error("invalid_code");
    }
    if (code.expiresAt <= this.nowMs()) {
      state.codes.delete(payload.code);
      throw new Error("expired_code");
    }
    if (payload.redirectUri && payload.redirectUri !== code.redirectUri) {
      throw new Error("invalid_redirect_uri");
    }

    state.codes.delete(payload.code);
    return this.issueToken(payload.namespace, code.scope);
  }

  async getProfile(namespace: string): Promise<Record<string, unknown>> {
    return {
      id: `${this.providerId}_${namespace}`,
      provider: this.providerId,
      namespace,
    };
  }

  async listResources(_request: ProviderReadRequest): Promise<Record<string, unknown>> {
    throw new Error("unsupported_list_resources");
  }

  async readResource(_request: ProviderReadRequest): Promise<Record<string, unknown>> {
    throw new Error("unsupported_read_resource");
  }

  async writeResource(_request: ProviderWriteRequest): Promise<Record<string, unknown>> {
    throw new Error("unsupported_write_resource");
  }

  reset(namespace?: string): void {
    if (!namespace) {
      this.states.clear();
      return;
    }
    this.states.delete(namespace);
  }

  seed(namespace: string, seedData: Record<string, unknown>): void {
    const state = this.getNamespaceState(namespace);
    state.store = {
      ...state.store,
      ...seedData,
    };
  }

  captureEvent(event: ProviderEventRecord): void {
    const state = this.getNamespaceState(event.namespace);
    state.events.push(event);
  }

  getSdkCalls(_namespace?: string): Array<Record<string, unknown>> {
    return [];
  }

  getEvents(namespace?: string): ProviderEventRecord[] {
    if (!namespace) {
      return [...this.states.values()].flatMap((entry) => entry.events);
    }
    return [...this.getNamespaceState(namespace).events];
  }

  protected getNamespaceStore<T extends Record<string, unknown>>(namespace: string): T {
    return this.getNamespaceState(namespace).store as T;
  }

  protected setNamespaceStore(namespace: string, nextStore: Record<string, unknown>): void {
    const state = this.getNamespaceState(namespace);
    state.store = nextStore;
  }

  protected buildProviderActionId(prefix: string): string {
    return this.runtime.idGenerator.randomId(prefix);
  }

  protected newEventId(): string {
    return this.runtime.idGenerator.randomId(`${this.providerId}_evt`);
  }

  nextGatewayEventId(): string {
    return this.newEventId();
  }

  gatewayNowIso(): string {
    return this.nowIso();
  }

  protected nowIso(): string {
    return this.runtime.clock.nowIso();
  }
}
