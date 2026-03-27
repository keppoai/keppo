import * as celJs from "cel-js";
import { type Failure } from "cel-js";

export interface CelValidationResult {
  ok: boolean;
  error?: string;
}

export const CEL_EXPRESSION_MAX_BYTES = 2 * 1024;
export const CEL_EVALUATION_TIMEOUT_MS = 100;

const MAX_PARSE_CACHE_ENTRIES = 256;

type CelCst = Parameters<typeof celJs.evaluate>[0];
type CelParseCacheEntry = { ok: true; cst: CelCst } | { ok: false; error: string };

const parseCache = new Map<string, CelParseCacheEntry>();
let parseInvocationCount = 0;

const CEL_EXPRESSION_TOO_LARGE_ERROR = `CEL expression exceeds max size of ${CEL_EXPRESSION_MAX_BYTES} bytes.`;

const expressionByteLength = (expression: string): number => {
  return Buffer.byteLength(expression, "utf8");
};

const cacheParsedExpression = (
  expression: string,
  entry: CelParseCacheEntry,
): CelParseCacheEntry => {
  if (parseCache.has(expression)) {
    parseCache.delete(expression);
  }
  parseCache.set(expression, entry);
  if (parseCache.size > MAX_PARSE_CACHE_ENTRIES) {
    const oldest = parseCache.keys().next().value;
    if (typeof oldest === "string") {
      parseCache.delete(oldest);
    }
  }
  return entry;
};

const parseExpression = (expression: string): CelParseCacheEntry => {
  const cached = parseCache.get(expression);
  if (cached) {
    parseCache.delete(expression);
    parseCache.set(expression, cached);
    return cached;
  }

  const parsed = celJs.parse(expression);
  parseInvocationCount += 1;
  if (!parsed.isSuccess) {
    return cacheParsedExpression(expression, {
      ok: false,
      error: (parsed as Failure).errors[0] ?? "Invalid CEL expression",
    });
  }

  return cacheParsedExpression(expression, {
    ok: true,
    cst: parsed.cst as CelCst,
  });
};

export const validateCel = (expression: string): CelValidationResult => {
  if (expressionByteLength(expression) > CEL_EXPRESSION_MAX_BYTES) {
    return { ok: false, error: CEL_EXPRESSION_TOO_LARGE_ERROR };
  }

  const parsed = parseExpression(expression);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true };
};

export const evaluateCel = (expression: string, context: Record<string, unknown>): boolean => {
  if (expressionByteLength(expression) > CEL_EXPRESSION_MAX_BYTES) {
    throw new Error(CEL_EXPRESSION_TOO_LARGE_ERROR);
  }

  const parsed = parseExpression(expression);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  const normalizedContext = {
    ...context,
    now: {
      getHours: () => new Date(String(context.now ?? new Date().toISOString())).getUTCHours(),
      iso: context.now,
    },
  };

  const startedAtMs = Date.now();
  const result = celJs.evaluate(parsed.cst, normalizedContext);
  const elapsedMs = Date.now() - startedAtMs;
  if (elapsedMs > CEL_EVALUATION_TIMEOUT_MS) {
    throw new Error(`CEL evaluation exceeded ${CEL_EVALUATION_TIMEOUT_MS}ms budget.`);
  }

  return Boolean(result);
};

export const __resetCelParseCacheForTests = (): void => {
  parseCache.clear();
  parseInvocationCount = 0;
};

export const __getCelParseInstrumentationForTests = (): {
  parseInvocationCount: number;
  cacheSize: number;
} => {
  return {
    parseInvocationCount,
    cacheSize: parseCache.size,
  };
};
