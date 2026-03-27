import { createInMemoryProviderSdkCallLog } from "./call-log.js";
import type { CanonicalProviderId } from "../provider-catalog.js";
import type {
  ProviderSdkCallLog,
  ProviderSdkError,
  ProviderSdkPort,
  ProviderSdkRuntime,
} from "./port.js";

export abstract class BaseSdkPort<TCreateClient> implements ProviderSdkPort {
  readonly providerId: CanonicalProviderId;
  readonly runtime: ProviderSdkRuntime;
  readonly callLog: ProviderSdkCallLog;

  protected readonly createClient: TCreateClient;

  constructor(options: {
    providerId: CanonicalProviderId;
    createClient: TCreateClient;
    runtime?: ProviderSdkRuntime;
    callLog?: ProviderSdkCallLog;
  }) {
    this.providerId = options.providerId;
    this.createClient = options.createClient;
    this.runtime = options.runtime ?? "real";
    this.callLog = options.callLog ?? createInMemoryProviderSdkCallLog();
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
}
