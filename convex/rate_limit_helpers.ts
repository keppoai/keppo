import { makeFunctionReference } from "convex/server";
import type { MutationCtx } from "./_generated/server";

const refs = {
  checkRateLimit: makeFunctionReference<"mutation">("rate_limits:checkRateLimit"),
};

const toRetryAfterSeconds = (retryAfterMs: number): number =>
  Math.max(1, Math.ceil(Math.max(0, retryAfterMs) / 1000));

export const enforceRateLimit = async (
  ctx: MutationCtx,
  params: {
    key: string;
    limit: number;
    windowMs: number;
    message: string;
  },
): Promise<void> => {
  const result = await ctx.runMutation(refs.checkRateLimit, {
    key: params.key,
    limit: params.limit,
    windowMs: params.windowMs,
  });
  if (result.allowed) {
    return;
  }
  throw new Error(`${params.message} Try again in ${toRetryAfterSeconds(result.retryAfterMs)}s.`);
};
