export interface ProviderRuntimeContext {
  httpClient: (url: string, init?: RequestInit) => Promise<Response>;
  clock: {
    now: () => number;
    nowIso: () => string;
  };
  idGenerator: {
    randomId: (prefix: string) => string;
  };
  logger: {
    debug: (message: string, metadata?: Record<string, unknown>) => void;
    info: (message: string, metadata?: Record<string, unknown>) => void;
    warn: (message: string, metadata?: Record<string, unknown>) => void;
    error: (message: string, metadata?: Record<string, unknown>) => void;
  };
  secrets: Record<string, string | undefined>;
  featureFlags: Record<string, boolean | undefined>;
}
