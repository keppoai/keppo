import {
  API_DEDUPE_STATUS,
  IDEMPOTENCY_RESOLUTION_STATUS,
  type ApiDedupeScope,
  type ApiDedupeStatus,
  type IdempotencyResolutionStatus,
} from "@keppo/shared/domain";

type ApiDedupeRecord = {
  status: ApiDedupeStatus;
  payload: Record<string, unknown> | null;
  expiresAtMs: number;
};

export type IdempotencyClient = {
  claimApiDedupeKey: (params: {
    scope: ApiDedupeScope;
    dedupeKey: string;
    ttlMs: number;
    initialStatus?: ApiDedupeStatus;
  }) => Promise<ApiDedupeRecord & { claimed: boolean }>;
  getApiDedupeKey: (params: {
    scope: ApiDedupeScope;
    dedupeKey: string;
  }) => Promise<ApiDedupeRecord | null>;
  setApiDedupePayload: (params: {
    scope: ApiDedupeScope;
    dedupeKey: string;
    payload: Record<string, unknown>;
  }) => Promise<boolean>;
  completeApiDedupeKey: (params: { scope: ApiDedupeScope; dedupeKey: string }) => Promise<boolean>;
  releaseApiDedupeKey: (params: { scope: ApiDedupeScope; dedupeKey: string }) => Promise<boolean>;
};

export { IDEMPOTENCY_RESOLUTION_STATUS };
export type { IdempotencyResolutionStatus };

export type IdempotencyResolution<TPayload> =
  | {
      status: typeof IDEMPOTENCY_RESOLUTION_STATUS.completed;
      payload: Record<string, unknown> | null;
    }
  | {
      status: typeof IDEMPOTENCY_RESOLUTION_STATUS.payloadReady;
      payload: TPayload;
    }
  | {
      status: typeof IDEMPOTENCY_RESOLUTION_STATUS.unresolved;
    };

const sleep = async (delayMs: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

export const waitForIdempotencyResolution = async <TPayload>(params: {
  client: Pick<IdempotencyClient, "getApiDedupeKey">;
  scope: ApiDedupeScope;
  dedupeKey: string;
  waitMs: number;
  pollIntervalMs: number;
  parsePayload?: (payload: Record<string, unknown> | null) => TPayload | null;
}): Promise<IdempotencyResolution<TPayload>> => {
  const deadline = Date.now() + Math.max(0, params.waitMs);
  const pollIntervalMs = Math.max(1, params.pollIntervalMs);
  while (Date.now() < deadline) {
    const current = await params.client.getApiDedupeKey({
      scope: params.scope,
      dedupeKey: params.dedupeKey,
    });
    if (!current) {
      return { status: IDEMPOTENCY_RESOLUTION_STATUS.unresolved };
    }
    if (current.status === API_DEDUPE_STATUS.completed) {
      return {
        status: IDEMPOTENCY_RESOLUTION_STATUS.completed,
        payload: current.payload,
      };
    }
    const parsedPayload = params.parsePayload?.(current.payload) ?? null;
    if (parsedPayload) {
      return {
        status: IDEMPOTENCY_RESOLUTION_STATUS.payloadReady,
        payload: parsedPayload,
      };
    }
    await sleep(pollIntervalMs);
  }
  return { status: IDEMPOTENCY_RESOLUTION_STATUS.unresolved };
};

export const withIdempotency = async <TResult, TPayload = never>(params: {
  client: IdempotencyClient;
  scope: ApiDedupeScope;
  dedupeKey: string;
  ttlMs: number;
  initialStatus?: ApiDedupeStatus;
  waitMs?: number;
  pollIntervalMs?: number;
  parseReplayPayload?: (payload: Record<string, unknown> | null) => TPayload | null;
  execute: (helpers: {
    setPayload: (payload: Record<string, unknown>) => Promise<void>;
  }) => Promise<TResult>;
  onReplay: (resolution: IdempotencyResolution<TPayload>) => Promise<TResult> | TResult;
}): Promise<TResult> => {
  const claim = await params.client.claimApiDedupeKey({
    scope: params.scope,
    dedupeKey: params.dedupeKey,
    ttlMs: Math.max(1, Math.floor(params.ttlMs)),
    initialStatus: params.initialStatus ?? API_DEDUPE_STATUS.pending,
  });

  if (!claim.claimed) {
    if (claim.status === API_DEDUPE_STATUS.completed) {
      return await params.onReplay({
        status: IDEMPOTENCY_RESOLUTION_STATUS.completed,
        payload: claim.payload,
      });
    }

    if (params.waitMs && params.waitMs > 0) {
      const replayResolution = await waitForIdempotencyResolution({
        client: params.client,
        scope: params.scope,
        dedupeKey: params.dedupeKey,
        waitMs: params.waitMs,
        pollIntervalMs: params.pollIntervalMs ?? 120,
        ...(params.parseReplayPayload ? { parsePayload: params.parseReplayPayload } : {}),
      });
      return await params.onReplay(replayResolution);
    }

    return await params.onReplay({
      status: IDEMPOTENCY_RESOLUTION_STATUS.unresolved,
    });
  }

  try {
    const result = await params.execute({
      setPayload: async (payload) => {
        const persisted = await params.client.setApiDedupePayload({
          scope: params.scope,
          dedupeKey: params.dedupeKey,
          payload,
        });
        if (!persisted) {
          throw new Error(
            `Failed to persist idempotency payload for scope=${params.scope} key=${params.dedupeKey}.`,
          );
        }
      },
    });
    await params.client.completeApiDedupeKey({
      scope: params.scope,
      dedupeKey: params.dedupeKey,
    });
    return result;
  } catch (error) {
    await params.client.releaseApiDedupeKey({
      scope: params.scope,
      dedupeKey: params.dedupeKey,
    });
    throw error;
  }
};
