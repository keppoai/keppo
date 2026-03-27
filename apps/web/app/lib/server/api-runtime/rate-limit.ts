export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

type RateLimitClient = {
  checkRateLimit: (params: {
    key: string;
    limit: number;
    windowMs: number;
  }) => Promise<RateLimitResult>;
};

type DenyCacheEntry = {
  denyUntilMs: number;
};

export class DurableSlidingWindowRateLimiter {
  private readonly denyCache = new Map<string, DenyCacheEntry>();

  constructor(
    private readonly client: RateLimitClient,
    private readonly namespace: string,
  ) {}

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const normalizedLimit = Math.max(1, Math.floor(limit));
    const normalizedWindowMs = Math.max(1000, Math.floor(windowMs));
    const storageKey = `${this.namespace}:${key}`;

    const cached = this.denyCache.get(storageKey);
    if (cached && cached.denyUntilMs > now) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1000, cached.denyUntilMs - now),
      };
    }

    if (cached) {
      this.denyCache.delete(storageKey);
    }

    const result = await this.client.checkRateLimit({
      key: storageKey,
      limit: normalizedLimit,
      windowMs: normalizedWindowMs,
    });

    if (!result.allowed) {
      this.denyCache.set(storageKey, {
        denyUntilMs: now + Math.max(1000, result.retryAfterMs),
      });
    } else {
      this.denyCache.delete(storageKey);
    }

    return {
      allowed: result.allowed,
      remaining: Math.max(0, result.remaining),
      retryAfterMs: Math.max(0, result.retryAfterMs),
    };
  }
}

export type RateLimiter = Pick<DurableSlidingWindowRateLimiter, "check">;

export const createDurableRateLimiter = (
  client: RateLimitClient,
  namespace: string,
): DurableSlidingWindowRateLimiter => {
  return new DurableSlidingWindowRateLimiter(client, namespace);
};

type RateLimitMiddlewareConfig = {
  limiter: RateLimiter;
  key: (c: RateLimitContext) => string;
  limit: number;
  windowMs: number;
  onRejected?: (c: RateLimitContext, result: RateLimitResult) => Response | Promise<Response>;
};

type RateLimitContext = any;

const toRetryAfterSeconds = (retryAfterMs: number): string => {
  return String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
};

export const createRateLimitMiddleware = (config: RateLimitMiddlewareConfig) => {
  return async (c: RateLimitContext, next: () => Promise<void>) => {
    const key = config.key(c);
    const result = await config.limiter.check(key, config.limit, config.windowMs);

    c.header("X-RateLimit-Limit", String(Math.max(1, config.limit)));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      c.header("Retry-After", toRetryAfterSeconds(result.retryAfterMs));
      if (config.onRejected) {
        return await config.onRejected(c, result);
      }
      return c.json(
        {
          error: "Too many requests",
        },
        429,
      );
    }

    await next();
  };
};
