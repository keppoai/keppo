import { isJsonRecord, parseJsonValue } from "./providers/boundaries/json.js";

export const AI_CREDIT_ERROR_CODES = ["AI_CREDIT_LIMIT_REACHED"] as const;
export type AiCreditErrorCode = (typeof AI_CREDIT_ERROR_CODES)[number];
export const AI_CREDIT_ERROR_CODE = {
  limitReached: "AI_CREDIT_LIMIT_REACHED",
} as const satisfies Record<string, AiCreditErrorCode>;

const AI_CREDIT_ERROR_CODE_SET = new Set<string>(AI_CREDIT_ERROR_CODES);

const cleanAiCreditErrorMessage = (value: string): string => {
  const trimmed = value.trim();
  const uncaughtMatch = trimmed.match(/Uncaught (?:Error|ConvexError):\s*([\s\S]*)$/);
  const extracted = uncaughtMatch?.[1] ?? trimmed;
  return extracted
    .replace(/\s+at\s+[^\n]+/g, "")
    .replace(/\s+Called by client\s*$/i, "")
    .trim();
};

const extractAiCreditErrorMessage = (error: unknown): string => {
  if (typeof error === "string") {
    return cleanAiCreditErrorMessage(error);
  }
  if (error instanceof Error) {
    return cleanAiCreditErrorMessage(error.message);
  }
  if (isJsonRecord(error) && typeof error.message === "string") {
    return cleanAiCreditErrorMessage(error.message);
  }
  if (isJsonRecord(error) && typeof error.error === "string") {
    return cleanAiCreditErrorMessage(error.error);
  }
  return cleanAiCreditErrorMessage(String(error));
};

export type AiCreditErrorPayload = {
  code: AiCreditErrorCode;
  org_id: string;
};

export const formatAiCreditErrorPayload = (payload: AiCreditErrorPayload): string => {
  return JSON.stringify(payload);
};

export const parseAiCreditErrorCode = (error: unknown): AiCreditErrorCode | null => {
  const trimmed = extractAiCreditErrorMessage(error);
  if (!trimmed) {
    return null;
  }
  if (trimmed === AI_CREDIT_ERROR_CODE.limitReached) {
    return trimmed;
  }
  try {
    const parsed = parseJsonValue(trimmed);
    if (!isJsonRecord(parsed) || typeof parsed.code !== "string") {
      return null;
    }
    return AI_CREDIT_ERROR_CODE_SET.has(parsed.code) ? (parsed.code as AiCreditErrorCode) : null;
  } catch {
    return null;
  }
};
