import { POLICY_DECISION_RESULT, type PolicyDecisionResult } from "./domain.js";

export interface PolicyAutomationResult {
  result: PolicyDecisionResult;
  explanation: string;
  confidence: number;
}

const parseMoneyLimit = (text: string): number | null => {
  const match = text.match(/under\s*\$\s*(\d+(?:\.\d+)?)/i);
  return match?.[1] ? Number(match[1]) : null;
};

const parseDomain = (text: string): string | null => {
  const match = text.match(/outside\s+(?:our\s+)?([a-z0-9.-]+\.[a-z]{2,})/i);
  return match?.[1] ? match[1].toLowerCase() : null;
};

export const evaluatePolicyAutomation = (
  policies: string[],
  actionType: string,
  preview: Record<string, unknown>,
): PolicyAutomationResult => {
  if (policies.length === 0) {
    return {
      result: POLICY_DECISION_RESULT.escalate,
      explanation: "No active policies were configured.",
      confidence: 0,
    };
  }

  for (const policy of policies) {
    const normalized = policy.toLowerCase();

    if (normalized.includes("refund") && normalized.includes("under")) {
      const limit = parseMoneyLimit(normalized);
      if (limit !== null && actionType === "refund") {
        const amount = Number(preview.amount ?? 0);
        if (Number.isFinite(amount) && amount <= limit) {
          return {
            result: POLICY_DECISION_RESULT.approve,
            explanation: `Policy matched: refund amount ${amount} is within $${limit}.`,
            confidence: 0.9,
          };
        }
        return {
          result: POLICY_DECISION_RESULT.deny,
          explanation: `Policy matched: refund amount exceeds $${limit}.`,
          confidence: 0.92,
        };
      }
    }

    if (normalized.includes("outside") && normalized.includes("domain")) {
      const domain = parseDomain(normalized);
      const recipients = Array.isArray(preview.recipients) ? preview.recipients : [];
      if (domain && actionType.includes("email")) {
        const external = recipients.some((entry) => {
          if (typeof entry !== "string") {
            return false;
          }
          return !entry.toLowerCase().endsWith(`@${domain}`);
        });

        if (external) {
          return {
            result: POLICY_DECISION_RESULT.deny,
            explanation: `Policy matched: found recipients outside ${domain}.`,
            confidence: 0.95,
          };
        }

        return {
          result: POLICY_DECISION_RESULT.approve,
          explanation: `Policy matched: all recipients are inside ${domain}.`,
          confidence: 0.82,
        };
      }
    }

    if (normalized.includes("only in") && normalized.includes("#support")) {
      const channel = preview.channel;
      if (typeof channel === "string") {
        if (channel === "#support") {
          return {
            result: POLICY_DECISION_RESULT.approve,
            explanation: "Policy matched: channel is #support.",
            confidence: 0.85,
          };
        }
        return {
          result: POLICY_DECISION_RESULT.deny,
          explanation: "Policy matched: non-support channel detected.",
          confidence: 0.85,
        };
      }
    }
  }

  return {
    result: POLICY_DECISION_RESULT.escalate,
    explanation:
      "Policy agent could not determine a deterministic outcome from configured policies.",
    confidence: 0.4,
  };
};
