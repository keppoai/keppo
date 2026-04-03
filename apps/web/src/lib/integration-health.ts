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

const isExpiredTimestamp = (value: string | null | undefined): boolean => {
  if (!value) {
    return false;
  }
  const expiresAt = Date.parse(value);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
};

export const formatIntegrationCredentialExpiry = (params: {
  credentialExpiresAt?: string | null | undefined;
  hasRefreshToken?: boolean | null | undefined;
}): string => {
  if (!params.credentialExpiresAt) {
    return "Unknown";
  }

  if (params.hasRefreshToken && isExpiredTimestamp(params.credentialExpiresAt)) {
    return `${params.credentialExpiresAt} (access token expired, auto-refresh available)`;
  }

  return params.credentialExpiresAt;
};

export const isIntegrationCredentialExpired = (params: {
  credentialExpiresAt?: string | null | undefined;
  hasRefreshToken?: boolean | null | undefined;
}): boolean => {
  if (params.hasRefreshToken) {
    return false;
  }
  return isExpiredTimestamp(params.credentialExpiresAt);
};

export const isIntegrationReconnectRequired = (params: {
  status?: string | null | undefined;
  credentialExpiresAt?: string | null | undefined;
  hasRefreshToken?: boolean | null | undefined;
  lastErrorCategory?: string | null | undefined;
}): boolean => {
  if (params.status === "disconnected") {
    return false;
  }
  if (
    isIntegrationCredentialExpired({
      credentialExpiresAt: params.credentialExpiresAt,
      hasRefreshToken: params.hasRefreshToken,
    })
  ) {
    return true;
  }
  return params.status === "degraded" && params.lastErrorCategory === "auth";
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
