import { createLogger, type Logger } from "./logging.js";

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitOpenError extends Error {
  readonly circuitName: string;
  readonly state: CircuitBreakerState;
  readonly retryAt: number;

  constructor(params: { circuitName: string; state: CircuitBreakerState; retryAt: number }) {
    super(
      `Circuit "${params.circuitName}" is ${params.state}; retry after ${new Date(params.retryAt).toISOString()}`,
    );
    this.name = "CircuitOpenError";
    this.circuitName = params.circuitName;
    this.state = params.state;
    this.retryAt = params.retryAt;
  }
}

export interface CircuitBreakerConfig {
  name: string;
  failureThreshold?: number;
  cooldownMs?: number;
  logger?: Pick<Logger, "warn">;
  now?: () => number;
}

export type ProviderCircuitBreakerSnapshot = {
  provider: string;
  name: string;
  state: CircuitBreakerState;
  failureThreshold: number;
  cooldownMs: number;
  consecutiveFailures: number;
  openedAt: number | null;
};

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 30_000;

export class CircuitBreaker {
  readonly name: string;
  readonly failureThreshold: number;
  readonly cooldownMs: number;
  private readonly logger: Pick<Logger, "warn">;
  private readonly now: () => number;

  private state: CircuitBreakerState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private halfOpenProbeInFlight = false;

  constructor(config: CircuitBreakerConfig) {
    this.name = config.name;
    this.failureThreshold = Math.max(
      1,
      Math.floor(config.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD),
    );
    this.cooldownMs = Math.max(1_000, Math.floor(config.cooldownMs ?? DEFAULT_COOLDOWN_MS));
    this.logger = config.logger ?? createLogger("circuit-breaker");
    this.now = config.now ?? Date.now;
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  getSnapshot(): {
    name: string;
    state: CircuitBreakerState;
    failureThreshold: number;
    cooldownMs: number;
    consecutiveFailures: number;
    openedAt: number | null;
  } {
    return {
      name: this.name,
      state: this.state,
      failureThreshold: this.failureThreshold,
      cooldownMs: this.cooldownMs,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
    };
  }

  reset(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.halfOpenProbeInFlight = false;
    this.transition("CLOSED", "manual_reset");
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const now = this.now();

    if (this.state === "OPEN") {
      const openedAt = this.openedAt ?? now;
      if (now - openedAt >= this.cooldownMs) {
        this.transition("HALF_OPEN", "cooldown_elapsed");
      } else {
        throw new CircuitOpenError({
          circuitName: this.name,
          state: this.state,
          retryAt: openedAt + this.cooldownMs,
        });
      }
    }

    if (this.state === "HALF_OPEN" && this.halfOpenProbeInFlight) {
      throw new CircuitOpenError({
        circuitName: this.name,
        state: this.state,
        retryAt: now + this.cooldownMs,
      });
    }

    const isHalfOpenProbe = this.state === "HALF_OPEN";
    if (isHalfOpenProbe) {
      this.halfOpenProbeInFlight = true;
    }

    try {
      const result = await fn();
      this.consecutiveFailures = 0;
      this.openedAt = null;
      this.transition("CLOSED", isHalfOpenProbe ? "probe_succeeded" : "request_succeeded");
      return result;
    } catch (error) {
      if (isHalfOpenProbe) {
        this.openCircuit("probe_failed");
      } else {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= this.failureThreshold) {
          this.openCircuit("failure_threshold_reached");
        }
      }
      throw error;
    } finally {
      if (isHalfOpenProbe) {
        this.halfOpenProbeInFlight = false;
      }
    }
  }

  private openCircuit(reason: string): void {
    this.openedAt = this.now();
    this.transition("OPEN", reason);
  }

  private transition(next: CircuitBreakerState, reason: string): void {
    const previous = this.state;
    if (previous === next) {
      return;
    }
    this.state = next;
    this.logger.warn("circuit_breaker.state_transition", {
      name: this.name,
      from: previous,
      to: next,
      reason,
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: this.failureThreshold,
      cooldownMs: this.cooldownMs,
    });
  }
}

const PROVIDER_BREAKER_OVERRIDES: Record<string, Partial<CircuitBreakerConfig>> = {
  stripe: { failureThreshold: 7, cooldownMs: 30_000 },
  reddit: { failureThreshold: 3, cooldownMs: 20_000 },
  x: { failureThreshold: 3, cooldownMs: 20_000 },
};

const providerCircuitBreakers = new Map<string, CircuitBreaker>();

export const createProviderCircuitBreaker = (providerName: string): CircuitBreaker => {
  const normalized = providerName.trim().toLowerCase();
  const existing = providerCircuitBreakers.get(normalized);
  if (existing) {
    return existing;
  }
  const overrides = PROVIDER_BREAKER_OVERRIDES[normalized] ?? {};
  const config: CircuitBreakerConfig = {
    name: `provider:${normalized}`,
  };
  if (typeof overrides.failureThreshold === "number") {
    config.failureThreshold = overrides.failureThreshold;
  }
  if (typeof overrides.cooldownMs === "number") {
    config.cooldownMs = overrides.cooldownMs;
  }
  const breaker = new CircuitBreaker(config);
  providerCircuitBreakers.set(normalized, breaker);
  return breaker;
};

export const listProviderCircuitBreakerStates = (): ProviderCircuitBreakerSnapshot[] => {
  return [...providerCircuitBreakers.entries()].map(([provider, breaker]) => ({
    provider,
    ...breaker.getSnapshot(),
  }));
};

export const resetProviderCircuitBreakers = (): void => {
  for (const breaker of providerCircuitBreakers.values()) {
    breaker.reset();
  }
};

export const wrapObjectWithCircuitBreaker = <T extends object>(
  object: T,
  circuitBreaker: CircuitBreaker,
): T => {
  const wrappers = new Map<PropertyKey, unknown>();
  return new Proxy(object, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      if (wrappers.has(prop)) {
        return wrappers.get(prop);
      }
      const wrapped = (...args: unknown[]) =>
        circuitBreaker.execute(async () => value.apply(target, args) as Awaited<unknown>);
      wrappers.set(prop, wrapped);
      return wrapped;
    },
  });
};
