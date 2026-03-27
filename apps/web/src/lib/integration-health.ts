import {
  INTEGRATION_ERROR_CLASSIFICATIONS,
  isIntegrationErrorCode,
} from "@keppo/shared/execution-errors";

const humanizeToken = (value: string): string => {
  return value
    .split("_")
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (part.toLowerCase() === "api") {
        return "API";
      }
      const lower = part.toLowerCase();
      if (index === 0) {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }
      return lower;
    })
    .join(" ");
};

export const formatIntegrationErrorDiagnostic = (params: {
  lastErrorCategory?: string | null | undefined;
  lastErrorCode?: string | null | undefined;
}): string | null => {
  const parts = [params.lastErrorCategory, params.lastErrorCode]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => humanizeToken(value));

  if (parts.length === 0) {
    return null;
  }

  return parts.join(" / ");
};

export const getIntegrationUnhealthyReason = (params: {
  isExpired?: boolean;
  degradedReason?: string | null | undefined;
  lastErrorCode?: string | null | undefined;
  lastErrorCategory?: string | null | undefined;
  hasRecentHealthFailure?: boolean;
}): string | null => {
  if (params.isExpired) {
    return "Saved credential expired. Reconnect to restore provider access.";
  }

  if (typeof params.degradedReason === "string" && params.degradedReason.trim().length > 0) {
    return params.degradedReason.trim();
  }

  if (params.lastErrorCode && isIntegrationErrorCode(params.lastErrorCode)) {
    return INTEGRATION_ERROR_CLASSIFICATIONS[params.lastErrorCode].degradedReason;
  }

  if (params.lastErrorCode || params.lastErrorCategory) {
    const diagnostic = formatIntegrationErrorDiagnostic(params);
    return diagnostic ? `${diagnostic}.` : "Recent health checks reported a provider issue.";
  }

  if (params.hasRecentHealthFailure) {
    return "Recent health checks reported a provider issue.";
  }

  return null;
};
