import { isJsonRecord, parseJsonValue } from "@keppo/shared/providers/boundaries/json";
import type { Workspace } from "./types";
import { toUserFacingError } from "./user-facing-errors";

export const readRuleErrorMessage = (value: unknown): string => {
  return toUserFacingError(value, {
    fallback: "Rule validation failed.",
  }).summary;
};

export const parseRuleTestContext = (
  raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } => {
  if (!raw.trim()) {
    return { ok: true, value: {} };
  }

  try {
    const parsed = parseJsonValue(raw);
    if (!isJsonRecord(parsed)) {
      return {
        ok: false,
        message: "Test context must be a JSON object",
      };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, message: "Invalid JSON in test context" };
  }
};

export const parsePolicyModeSelection = (value: string): Workspace["policy_mode"] | null => {
  if (value === "manual_only" || value === "rules_first" || value === "rules_plus_agent") {
    return value;
  }
  return null;
};
