export type AsyncJobRetryPolicy = {
  jobType: "notification_delivery" | "maintenance_task" | "dead_letter_replay";
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
};

export const NOTIFICATION_DELIVERY_RETRY_POLICY: AsyncJobRetryPolicy = {
  jobType: "notification_delivery",
  maxRetries: 5,
  baseBackoffMs: 5_000,
  maxBackoffMs: 120_000,
};

export const MAINTENANCE_TASK_RETRY_POLICY: AsyncJobRetryPolicy = {
  jobType: "maintenance_task",
  maxRetries: 3,
  baseBackoffMs: 30_000,
  maxBackoffMs: 300_000,
};

export const DLQ_AUTO_RETRY_POLICY: AsyncJobRetryPolicy = {
  jobType: "dead_letter_replay",
  maxRetries: 5,
  baseBackoffMs: 60_000,
  maxBackoffMs: 600_000,
};

const stableHash = (input: string): number => {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const toJitterMultiplier = (seed: string): number => {
  const bucket = stableHash(seed) % 501;
  return 0.5 + bucket / 1000;
};

export const computeRetryDelayMs = (params: {
  policy: AsyncJobRetryPolicy;
  attemptNumber: number;
  seed: string;
}): number => {
  const attempt = Math.max(1, Math.floor(params.attemptNumber));
  const baseBackoffMs = Math.max(1_000, Math.floor(params.policy.baseBackoffMs));
  const maxBackoffMs = Math.max(baseBackoffMs, Math.floor(params.policy.maxBackoffMs));
  const backoffMs = Math.min(maxBackoffMs, baseBackoffMs * 2 ** Math.max(0, attempt - 1));
  return Math.max(1_000, Math.floor(backoffMs * toJitterMultiplier(params.seed)));
};
