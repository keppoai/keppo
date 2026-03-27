const KEPPO_ERROR_CODE_VALUES = {
  providerTokenExpired: "provider_token_expired",
  providerRateLimited: "provider_rate_limited",
  providerUnavailable: "provider_unavailable",
  providerScopeMissing: "provider_scope_missing",
  providerApiError: "provider_api_error",
  convexTimeout: "convex_timeout",
  convexConflict: "convex_conflict",
  convexUnavailable: "convex_unavailable",
  queueDeliveryFailed: "queue_delivery_failed",
  queueDuplicate: "queue_duplicate",
  authSessionExpired: "auth_session_expired",
  authInsufficientRole: "auth_insufficient_role",
  authCredentialRevoked: "auth_credential_revoked",
  networkTimeout: "network_timeout",
  networkBlocked: "network_blocked",
  internalUnexpected: "internal_unexpected",
} as const;

export type KeppoErrorCodeLiteral =
  (typeof KEPPO_ERROR_CODE_VALUES)[keyof typeof KEPPO_ERROR_CODE_VALUES];

declare const keppoErrorCodeBrand: unique symbol;

export type KeppoErrorCode = KeppoErrorCodeLiteral & {
  readonly [keppoErrorCodeBrand]: true;
};

export const KEPPO_ERROR_CATEGORIES = [
  "provider",
  "convex",
  "queue",
  "auth",
  "network",
  "internal",
] as const;
export type KeppoErrorCategory = (typeof KEPPO_ERROR_CATEGORIES)[number];

export const KEPPO_ERROR_SEVERITIES = ["info", "warning", "critical"] as const;
export type KeppoErrorSeverity = (typeof KEPPO_ERROR_SEVERITIES)[number];

const brandKeppoErrorCode = <T extends KeppoErrorCodeLiteral>(code: T): KeppoErrorCode =>
  code as KeppoErrorCode;

export const PROVIDER_TOKEN_EXPIRED = brandKeppoErrorCode(
  KEPPO_ERROR_CODE_VALUES.providerTokenExpired,
);
export const PROVIDER_RATE_LIMITED = brandKeppoErrorCode(
  KEPPO_ERROR_CODE_VALUES.providerRateLimited,
);
export const PROVIDER_UNAVAILABLE = brandKeppoErrorCode(
  KEPPO_ERROR_CODE_VALUES.providerUnavailable,
);
export const PROVIDER_SCOPE_MISSING = brandKeppoErrorCode(
  KEPPO_ERROR_CODE_VALUES.providerScopeMissing,
);
export const PROVIDER_API_ERROR = brandKeppoErrorCode(KEPPO_ERROR_CODE_VALUES.providerApiError);
export const CONVEX_TIMEOUT = brandKeppoErrorCode(KEPPO_ERROR_CODE_VALUES.convexTimeout);
export const CONVEX_CONFLICT = brandKeppoErrorCode(KEPPO_ERROR_CODE_VALUES.convexConflict);
export const CONVEX_UNAVAILABLE = brandKeppoErrorCode(KEPPO_ERROR_CODE_VALUES.convexUnavailable);
export const QUEUE_DELIVERY_FAILED = brandKeppoErrorCode(
  KEPPO_ERROR_CODE_VALUES.queueDeliveryFailed,
);
export const QUEUE_DUPLICATE = brandKeppoErrorCode(KEPPO_ERROR_CODE_VALUES.queueDuplicate);
export const AUTH_SESSION_EXPIRED = brandKeppoErrorCode(KEPPO_ERROR_CODE_VALUES.authSessionExpired);
export const AUTH_INSUFFICIENT_ROLE = brandKeppoErrorCode(
  KEPPO_ERROR_CODE_VALUES.authInsufficientRole,
);
export const AUTH_CREDENTIAL_REVOKED = brandKeppoErrorCode(
  KEPPO_ERROR_CODE_VALUES.authCredentialRevoked,
);
export const NETWORK_TIMEOUT = brandKeppoErrorCode(KEPPO_ERROR_CODE_VALUES.networkTimeout);
export const NETWORK_BLOCKED = brandKeppoErrorCode(KEPPO_ERROR_CODE_VALUES.networkBlocked);
export const INTERNAL_UNEXPECTED = brandKeppoErrorCode(KEPPO_ERROR_CODE_VALUES.internalUnexpected);

export const KEPPO_ERROR_CODES = [
  PROVIDER_TOKEN_EXPIRED,
  PROVIDER_RATE_LIMITED,
  PROVIDER_UNAVAILABLE,
  PROVIDER_SCOPE_MISSING,
  PROVIDER_API_ERROR,
  CONVEX_TIMEOUT,
  CONVEX_CONFLICT,
  CONVEX_UNAVAILABLE,
  QUEUE_DELIVERY_FAILED,
  QUEUE_DUPLICATE,
  AUTH_SESSION_EXPIRED,
  AUTH_INSUFFICIENT_ROLE,
  AUTH_CREDENTIAL_REVOKED,
  NETWORK_TIMEOUT,
  NETWORK_BLOCKED,
  INTERNAL_UNEXPECTED,
] as const;

const KEPPO_ERROR_CODE_SET = new Set<string>(KEPPO_ERROR_CODES);
export const KEPPO_ERROR_CODE_LITERALS = Object.values(
  KEPPO_ERROR_CODE_VALUES,
) as ReadonlyArray<KeppoErrorCodeLiteral>;

export type KeppoErrorDefinition = {
  code: KeppoErrorCode;
  category: KeppoErrorCategory;
  retryable: boolean;
  severity: KeppoErrorSeverity;
  description: string;
};

const ERROR_DEFINITIONS = [
  {
    code: PROVIDER_TOKEN_EXPIRED,
    category: "provider",
    retryable: false,
    severity: "warning",
    description: "Provider credential expired or was revoked and needs operator action.",
  },
  {
    code: PROVIDER_RATE_LIMITED,
    category: "provider",
    retryable: true,
    severity: "warning",
    description: "Provider API rate limited the request and should be retried with backoff.",
  },
  {
    code: PROVIDER_UNAVAILABLE,
    category: "provider",
    retryable: true,
    severity: "critical",
    description: "Provider API is unavailable or returning transient 5xx responses.",
  },
  {
    code: PROVIDER_SCOPE_MISSING,
    category: "provider",
    retryable: false,
    severity: "warning",
    description: "Provider credential is missing required scopes or permissions.",
  },
  {
    code: PROVIDER_API_ERROR,
    category: "provider",
    retryable: false,
    severity: "warning",
    description: "Provider API returned a non-transient functional error.",
  },
  {
    code: CONVEX_TIMEOUT,
    category: "convex",
    retryable: true,
    severity: "warning",
    description: "Convex call timed out before a result was returned.",
  },
  {
    code: CONVEX_CONFLICT,
    category: "convex",
    retryable: true,
    severity: "warning",
    description: "Convex write conflict or optimistic concurrency failure occurred.",
  },
  {
    code: CONVEX_UNAVAILABLE,
    category: "convex",
    retryable: true,
    severity: "critical",
    description: "Convex was unavailable or refused the request.",
  },
  {
    code: QUEUE_DELIVERY_FAILED,
    category: "queue",
    retryable: true,
    severity: "warning",
    description: "Queued delivery failed after retry attempts and should be replayed later.",
  },
  {
    code: QUEUE_DUPLICATE,
    category: "queue",
    retryable: false,
    severity: "info",
    description: "Queued work was already processed and should not be retried.",
  },
  {
    code: AUTH_SESSION_EXPIRED,
    category: "auth",
    retryable: false,
    severity: "warning",
    description: "The caller session expired and must be renewed.",
  },
  {
    code: AUTH_INSUFFICIENT_ROLE,
    category: "auth",
    retryable: false,
    severity: "warning",
    description: "The caller lacks the required workspace or org role.",
  },
  {
    code: AUTH_CREDENTIAL_REVOKED,
    category: "auth",
    retryable: false,
    severity: "critical",
    description: "The backing credential was revoked and must be reconnected.",
  },
  {
    code: NETWORK_TIMEOUT,
    category: "network",
    retryable: true,
    severity: "warning",
    description: "The request timed out on the network before the upstream responded.",
  },
  {
    code: NETWORK_BLOCKED,
    category: "network",
    retryable: false,
    severity: "warning",
    description: "The request was blocked by allowlist or egress policy.",
  },
  {
    code: INTERNAL_UNEXPECTED,
    category: "internal",
    retryable: false,
    severity: "critical",
    description: "Unexpected internal failure without a more specific classification.",
  },
] as const satisfies ReadonlyArray<KeppoErrorDefinition>;

export const ERROR_CATALOG = new Map<KeppoErrorCode, KeppoErrorDefinition>(
  ERROR_DEFINITIONS.map((definition) => [definition.code, definition]),
);

export const isKeppoErrorCode = (value: unknown): value is KeppoErrorCode => {
  return typeof value === "string" && KEPPO_ERROR_CODE_SET.has(value);
};

export const isRetryableError = (code: KeppoErrorCode): boolean => {
  return ERROR_CATALOG.get(code)?.retryable ?? false;
};

const REASON_MATCHERS: Array<{ pattern: RegExp; code: KeppoErrorCode }> = [
  {
    pattern: /\b(invalid_grant|token expired|token revoked|invalid token|refresh token missing)\b/u,
    code: PROVIDER_TOKEN_EXPIRED,
  },
  {
    pattern: /\b(rate[ -]?limited|too many requests|429|throttl)/u,
    code: PROVIDER_RATE_LIMITED,
  },
  {
    pattern:
      /\b(503|service unavailable|bad gateway|gateway timeout|upstream unavailable|econnrefused|enotfound)\b/u,
    code: PROVIDER_UNAVAILABLE,
  },
  {
    pattern:
      /\b(missing scope|missing_scopes|insufficient scope|permission denied|forbidden scope)\b/u,
    code: PROVIDER_SCOPE_MISSING,
  },
  {
    pattern: /\b(convex timeout|convex timed out|convex call timed out)\b/u,
    code: CONVEX_TIMEOUT,
  },
  {
    pattern: /\b(convex unavailable|convex refused|convex 503)\b/u,
    code: CONVEX_UNAVAILABLE,
  },
  {
    pattern: /\b(conflict|write conflict|optimistic concurrency)\b/u,
    code: CONVEX_CONFLICT,
  },
  {
    pattern: /\b(queue duplicate|duplicate delivery|already processed|dedupe)\b/u,
    code: QUEUE_DUPLICATE,
  },
  {
    pattern: /\b(queue delivery failed|delivery failed|delivery exhausted)\b/u,
    code: QUEUE_DELIVERY_FAILED,
  },
  {
    pattern: /\b(session expired|reauth|login required|unauthorized session)\b/u,
    code: AUTH_SESSION_EXPIRED,
  },
  {
    pattern: /\b(insufficient role|not authorized|admin only)\b/u,
    code: AUTH_INSUFFICIENT_ROLE,
  },
  {
    pattern:
      /\b(credential revoked|credential_error|integration_not_connected|missing_refresh_token)\b/u,
    code: AUTH_CREDENTIAL_REVOKED,
  },
  {
    pattern: /\b(network blocked|allowlist blocked|blocked outbound|egress denied)\b/u,
    code: NETWORK_BLOCKED,
  },
  {
    pattern: /\b(timeout|timed out|etimedout|aborterror)\b/u,
    code: NETWORK_TIMEOUT,
  },
  {
    pattern: /\b(provider api error|execution_failed|invalid request|unprocessable)\b/u,
    code: PROVIDER_API_ERROR,
  },
];

export const classifyErrorCode = (reason: string): KeppoErrorCode => {
  const normalizedReason = reason.trim().toLowerCase();
  for (const matcher of REASON_MATCHERS) {
    if (matcher.pattern.test(normalizedReason)) {
      return matcher.code;
    }
  }
  return INTERNAL_UNEXPECTED;
};

export const KEPPO_ERROR_CODE = {
  providerTokenExpired: PROVIDER_TOKEN_EXPIRED,
  providerRateLimited: PROVIDER_RATE_LIMITED,
  providerUnavailable: PROVIDER_UNAVAILABLE,
  providerScopeMissing: PROVIDER_SCOPE_MISSING,
  providerApiError: PROVIDER_API_ERROR,
  convexTimeout: CONVEX_TIMEOUT,
  convexConflict: CONVEX_CONFLICT,
  convexUnavailable: CONVEX_UNAVAILABLE,
  queueDeliveryFailed: QUEUE_DELIVERY_FAILED,
  queueDuplicate: QUEUE_DUPLICATE,
  authSessionExpired: AUTH_SESSION_EXPIRED,
  authInsufficientRole: AUTH_INSUFFICIENT_ROLE,
  authCredentialRevoked: AUTH_CREDENTIAL_REVOKED,
  networkTimeout: NETWORK_TIMEOUT,
  networkBlocked: NETWORK_BLOCKED,
  internalUnexpected: INTERNAL_UNEXPECTED,
} as const satisfies Record<string, KeppoErrorCode>;
