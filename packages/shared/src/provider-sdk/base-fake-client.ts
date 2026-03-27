import { createInMemoryProviderSdkCallLog } from "./call-log.js";
import type { CanonicalProviderId } from "../provider-catalog.js";
import type { ProviderSdkCallLog, ProviderSdkError, ProviderSdkPort } from "./port.js";

export const createNoopProviderSdkCallLog = (): ProviderSdkCallLog => {
  return {
    capture: () => {},
    list: () => [],
    reset: () => {},
  };
};

export abstract class BaseFakeClient<TState> implements ProviderSdkPort {
  readonly providerId: CanonicalProviderId;
  readonly runtime = "fake" as const;
  readonly callLog: ProviderSdkCallLog;

  private readonly states = new Map<string, TState>();

  constructor(options: { providerId: CanonicalProviderId; callLog?: ProviderSdkCallLog }) {
    this.providerId = options.providerId;
    this.callLog = options.callLog ?? createInMemoryProviderSdkCallLog();
  }

  reset(namespace?: string): void {
    if (!namespace) {
      this.states.clear();
      this.callLog.reset();
      return;
    }

    const key = this.getNamespaceKey(namespace);
    this.states.delete(key);
    this.callLog.reset(namespace);
  }

  protected getState(namespace?: string): TState {
    const key = this.getNamespaceKey(namespace);
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }

    const created = this.createDefaultState();
    this.states.set(key, created);
    return created;
  }

  protected async runOperation<TResult>(options: {
    namespace?: string | undefined;
    method: string;
    args: unknown;
    accessToken?: string | null | undefined;
    assertToken?: (accessToken: string | null | undefined) => void;
    idempotencyKey?: string | undefined;
    mapError: (method: string, error: unknown) => ProviderSdkError;
    before?: ((state: TState) => void) | undefined;
    execute: (state: TState) => Promise<TResult> | TResult;
  }): Promise<TResult> {
    try {
      if (options.accessToken !== undefined) {
        if (options.assertToken) {
          options.assertToken(options.accessToken);
        } else {
          this.assertAccessToken(options.accessToken);
        }
      }
      const state = this.getState(options.namespace);
      options.before?.(state);
      const response = await options.execute(state);
      this.captureOk(
        options.namespace,
        options.method,
        options.args,
        response,
        options.idempotencyKey,
      );
      return response;
    } catch (error) {
      const sdkError = options.mapError(options.method, error);
      this.captureError(
        options.namespace,
        options.method,
        options.args,
        sdkError,
        options.idempotencyKey,
      );
      throw sdkError;
    }
  }

  protected runProviderOperation<TResult>(options: {
    namespace?: string | undefined;
    method: string;
    args: unknown;
    accessToken?: string | null | undefined;
    assertToken?: ((accessToken: string | null | undefined) => void) | undefined;
    idempotencyKey?: string | undefined;
    mapError: (method: string, error: unknown) => ProviderSdkError;
    before?: ((state: TState) => void) | undefined;
    execute: (state: TState) => Promise<TResult> | TResult;
  }): Promise<TResult> {
    return this.runOperation({
      method: options.method,
      args: options.args,
      mapError: options.mapError,
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
      ...(options.accessToken !== undefined ? { accessToken: options.accessToken } : {}),
      ...(options.assertToken ? { assertToken: options.assertToken } : {}),
      ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.before ? { before: options.before } : {}),
      execute: options.execute,
    });
  }

  protected assertAccessToken(accessToken: string | null | undefined): void {
    if (!accessToken || !accessToken.trim()) {
      throw new Error("missing_access_token");
    }
    const normalized = accessToken.trim();
    if (normalized.includes("invalid") || normalized.includes("expired")) {
      throw new Error("invalid_access_token");
    }
  }

  protected getStoredIdempotentResponse<T>(
    responses: Map<string, unknown>,
    method: string,
    idempotencyKey?: string,
  ): T | null {
    if (!idempotencyKey) {
      return null;
    }
    return (responses.get(`${method}:${idempotencyKey}`) as T | undefined) ?? null;
  }

  protected getIdempotentResponse<T>(
    responsesOrState: Map<string, unknown> | { idempotentResponses: Map<string, unknown> },
    method: string,
    idempotencyKey?: string,
  ): T | null {
    return this.getStoredIdempotentResponse(
      responsesOrState instanceof Map ? responsesOrState : responsesOrState.idempotentResponses,
      method,
      idempotencyKey,
    );
  }

  protected setStoredIdempotentResponse(
    responses: Map<string, unknown>,
    method: string,
    idempotencyKey: string | undefined,
    response: unknown,
  ): void {
    if (!idempotencyKey) {
      return;
    }
    responses.set(`${method}:${idempotencyKey}`, response);
  }

  protected setIdempotentResponse(
    responsesOrState: Map<string, unknown> | { idempotentResponses: Map<string, unknown> },
    method: string,
    idempotencyKey: string | undefined,
    response: unknown,
  ): void {
    this.setStoredIdempotentResponse(
      responsesOrState instanceof Map ? responsesOrState : responsesOrState.idempotentResponses,
      method,
      idempotencyKey,
      response,
    );
  }

  protected captureOk(
    namespace: string | undefined,
    method: string,
    args: unknown,
    response: unknown,
    idempotencyKey?: string,
  ): void {
    this.callLog.capture({
      namespace,
      providerId: this.providerId,
      runtime: this.runtime,
      method,
      args,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      outcome: {
        ok: true,
        response,
      },
    });
  }

  protected captureError(
    namespace: string | undefined,
    method: string,
    args: unknown,
    error: ProviderSdkError,
    idempotencyKey?: string,
  ): void {
    this.callLog.capture({
      namespace,
      providerId: this.providerId,
      runtime: this.runtime,
      method,
      args,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      outcome: {
        ok: false,
        error: error.shape,
      },
    });
  }

  protected getNamespaceKey(namespace?: string): string {
    return (namespace ?? "global").trim() || "global";
  }

  protected async runCachedOperation<TResult>(options: {
    namespace?: string | undefined;
    method: string;
    args: unknown;
    accessToken?: string | null | undefined;
    assertToken?: (accessToken: string | null | undefined) => void;
    idempotencyKey?: string | undefined;
    mapError: (method: string, error: unknown) => ProviderSdkError;
    before?: ((state: TState) => void) | undefined;
    getCachedValue: (state: TState) => TResult | null | undefined;
    setCachedValue: (state: TState, response: TResult) => void;
    execute: (state: TState) => Promise<TResult> | TResult;
  }): Promise<TResult> {
    return this.runOperation({
      method: options.method,
      args: options.args,
      mapError: options.mapError,
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
      ...(options.accessToken !== undefined ? { accessToken: options.accessToken } : {}),
      ...(options.assertToken ? { assertToken: options.assertToken } : {}),
      ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.before ? { before: options.before } : {}),
      execute: async (state) => {
        const cached = options.getCachedValue(state);
        if (cached !== undefined && cached !== null) {
          return cached;
        }

        const response = await options.execute(state);
        options.setCachedValue(state, response);
        return response;
      },
    });
  }

  protected runProviderCachedOperation<TResult>(options: {
    namespace?: string | undefined;
    method: string;
    args: unknown;
    accessToken?: string | null | undefined;
    assertToken?: ((accessToken: string | null | undefined) => void) | undefined;
    idempotencyKey?: string | undefined;
    mapError: (method: string, error: unknown) => ProviderSdkError;
    before?: ((state: TState) => void) | undefined;
    getCachedValue: (state: TState) => TResult | null | undefined;
    setCachedValue: (state: TState, response: TResult) => void;
    execute: (state: TState) => Promise<TResult> | TResult;
  }): Promise<TResult> {
    return this.runCachedOperation({
      method: options.method,
      args: options.args,
      mapError: options.mapError,
      getCachedValue: options.getCachedValue,
      setCachedValue: options.setCachedValue,
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
      ...(options.accessToken !== undefined ? { accessToken: options.accessToken } : {}),
      ...(options.assertToken ? { assertToken: options.assertToken } : {}),
      ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.before ? { before: options.before } : {}),
      execute: options.execute,
    });
  }

  protected async runIdempotentOperation<TResult>(options: {
    namespace?: string | undefined;
    method: string;
    args: unknown;
    accessToken?: string | null | undefined;
    assertToken?: (accessToken: string | null | undefined) => void;
    idempotencyKey?: string | undefined;
    mapError: (method: string, error: unknown) => ProviderSdkError;
    before?: ((state: TState) => void) | undefined;
    getResponses: (state: TState) => Map<string, unknown>;
    execute: (state: TState) => Promise<TResult> | TResult;
  }): Promise<TResult> {
    return this.runOperation({
      method: options.method,
      args: options.args,
      mapError: options.mapError,
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
      ...(options.accessToken !== undefined ? { accessToken: options.accessToken } : {}),
      ...(options.assertToken ? { assertToken: options.assertToken } : {}),
      ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.before ? { before: options.before } : {}),
      execute: async (state) => {
        const existing = this.getStoredIdempotentResponse<TResult>(
          options.getResponses(state),
          options.method,
          options.idempotencyKey,
        );
        if (existing !== null) {
          return existing;
        }

        const response = await options.execute(state);
        this.setStoredIdempotentResponse(
          options.getResponses(state),
          options.method,
          options.idempotencyKey,
          response,
        );
        return response;
      },
    });
  }

  protected runProviderIdempotentOperation<TResult>(options: {
    namespace?: string | undefined;
    method: string;
    args: unknown;
    accessToken?: string | null | undefined;
    assertToken?: ((accessToken: string | null | undefined) => void) | undefined;
    idempotencyKey?: string | undefined;
    mapError: (method: string, error: unknown) => ProviderSdkError;
    before?: ((state: TState) => void) | undefined;
    getResponses: (state: TState) => Map<string, unknown>;
    execute: (state: TState) => Promise<TResult> | TResult;
  }): Promise<TResult> {
    return this.runIdempotentOperation({
      method: options.method,
      args: options.args,
      mapError: options.mapError,
      getResponses: options.getResponses,
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
      ...(options.accessToken !== undefined ? { accessToken: options.accessToken } : {}),
      ...(options.assertToken ? { assertToken: options.assertToken } : {}),
      ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.before ? { before: options.before } : {}),
      execute: options.execute,
    });
  }

  protected abstract createDefaultState(): TState;
}
