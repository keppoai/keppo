import type { CanonicalProviderId } from "../provider-catalog.js";

export type ProviderSdkRuntime = "real" | "fake";

export type ProviderSdkErrorCategory =
  | "auth"
  | "rate_limit"
  | "permission"
  | "not_found"
  | "validation"
  | "timeout"
  | "transient"
  | "unknown";

export interface ProviderSdkErrorShape {
  category: ProviderSdkErrorCategory;
  code: string;
  status?: number;
  message: string;
  retryable: boolean;
}

export class ProviderSdkError extends Error {
  readonly providerId: CanonicalProviderId;
  readonly method: string;
  readonly shape: ProviderSdkErrorShape;
  readonly causeData?: unknown;

  constructor(params: {
    providerId: CanonicalProviderId;
    method: string;
    shape: ProviderSdkErrorShape;
    causeData?: unknown;
  }) {
    super(params.shape.message);
    this.name = "ProviderSdkError";
    this.providerId = params.providerId;
    this.method = params.method;
    this.shape = params.shape;
    this.causeData = params.causeData;
  }
}

export interface ProviderSdkPage<TItem> {
  items: Array<TItem>;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ProviderSdkCallRecord {
  namespace?: string | undefined;
  providerId: CanonicalProviderId;
  runtime: ProviderSdkRuntime;
  method: string;
  args: unknown;
  idempotencyKey?: string | undefined;
  outcome: { ok: true; response: unknown } | { ok: false; error: ProviderSdkErrorShape };
}

export interface ProviderSdkCallLog {
  capture: (record: ProviderSdkCallRecord) => void;
  list: (namespace?: string) => Array<ProviderSdkCallRecord>;
  reset: (namespace?: string) => void;
}

export interface ProviderSdkPort {
  readonly providerId: CanonicalProviderId;
  readonly runtime: ProviderSdkRuntime;
  readonly callLog?: ProviderSdkCallLog;
}
