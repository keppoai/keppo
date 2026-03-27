import { parseJsonValue } from "@keppo/shared/providers/boundaries/json";
import type { UserFacingError } from "@/lib/user-facing-errors";

export type TierLimitKind = "workspace" | "automation" | "member";

export type TierLimitError = {
  kind: TierLimitKind;
  code: string;
  current: number | null;
  max: number | null;
  tier: string | null;
};

const KIND_BY_CODE: Record<string, TierLimitKind> = {
  WORKSPACE_LIMIT_REACHED: "workspace",
  AUTOMATION_LIMIT_REACHED: "automation",
  MEMBER_LIMIT_REACHED: "member",
};

const tryParseRecord = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = parseJsonValue(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const readStructuredPayload = (message: string): Record<string, unknown> | null => {
  const direct = tryParseRecord(message);
  if (direct) {
    return direct;
  }

  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParseRecord(message.slice(start, end + 1));
  }

  return null;
};

const extractPayload = (error: unknown): Record<string, unknown> | null => {
  if (!error || typeof error !== "object") {
    return null;
  }

  // ConvexError carries structured data in .data
  const maybeData = (error as Record<string, unknown>).data;
  if (maybeData && typeof maybeData === "object" && !Array.isArray(maybeData)) {
    return maybeData as Record<string, unknown>;
  }

  // Fallback: try to parse JSON from the error message
  if (error instanceof Error) {
    return readStructuredPayload(error.message);
  }

  return null;
};

export const parseTierLimitError = (error: unknown): TierLimitError | null => {
  const payload = extractPayload(error);
  if (!payload) {
    return null;
  }

  const code = typeof payload.code === "string" ? payload.code : null;
  if (!code || !(code in KIND_BY_CODE)) {
    return null;
  }
  const kind = KIND_BY_CODE[code];
  if (!kind) {
    return null;
  }

  return {
    kind,
    code,
    current: typeof payload.current_count === "number" ? payload.current_count : null,
    max: typeof payload.max_count === "number" ? payload.max_count : null,
    tier: typeof payload.tier === "string" ? payload.tier : null,
  };
};

export const buildTierLimitErrorCopy = (
  limit: TierLimitError,
): Pick<UserFacingError, "title" | "summary" | "nextSteps"> => {
  const noun =
    limit.kind === "workspace"
      ? "workspace"
      : limit.kind === "automation"
        ? "automation"
        : "member seat";
  const usage =
    limit.current !== null && limit.max !== null ? ` (${limit.current}/${limit.max})` : "";

  return {
    title: "Plan limit reached",
    summary: `Your current plan has no more ${noun}${limit.max === 1 ? "" : "s"} available${usage}.`,
    nextSteps: [
      "Open billing to upgrade the organization plan.",
      `Or remove an existing ${noun} and retry this action.`,
    ],
  };
};
