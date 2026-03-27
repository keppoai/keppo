import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  type ManagedOAuthProvider,
  type BoundaryParseSource,
} from "@keppo/shared/providers/boundaries/common";
import {
  type BoundaryParseIssue,
  buildBoundaryErrorEnvelope,
  parseApiBoundary,
  parseWebhookResponse,
} from "@keppo/shared/providers/boundaries/error-boundary";
import { parseJsonValue } from "@keppo/shared/providers/boundaries/json";
import { oauthConnectResponseSchema } from "@keppo/shared/providers/boundaries/api-schemas";
import { getProviderRuntimeSecrets } from "@keppo/shared/provider-runtime-secrets";
import { safeFetch } from "@keppo/shared/network";
import { type ProviderRuntimeContext } from "@keppo/shared/provider-runtime-context";
import { OAUTH_STATE_DECODE_REASON, type OAuthStateDecodeReason } from "@keppo/shared/domain";
import { getEnv, getRawEnv } from "./env.js";

type RuntimeLogger = {
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

const safeFetchNamespaceOptions = (namespace: string | null): { namespace?: string } => {
  return namespace === null ? {} : { namespace };
};

export const toBase64Url = (value: string): string =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const fromBase64Url = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  try {
    const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
};

const toBase64UrlFromBuffer = (value: Buffer): string => {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const resolveOAuthStateSigningSecret = (): string => {
  const env = getEnv();
  const explicit = env.KEPPO_OAUTH_STATE_SECRET;
  if (explicit) {
    return explicit;
  }
  throw new Error("Missing OAuth state signing secret. Set KEPPO_OAUTH_STATE_SECRET.");
};

const buildOAuthStateSignature = (encodedPayload: string): string => {
  const signature = createHmac("sha256", resolveOAuthStateSigningSecret())
    .update(encodedPayload)
    .digest();
  return toBase64UrlFromBuffer(signature);
};

const timingSafeEqualText = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
};

export const signOAuthStatePayload = (payloadRaw: string): string => {
  const encodedPayload = toBase64Url(payloadRaw);
  const signature = buildOAuthStateSignature(encodedPayload);
  return `${encodedPayload}.${signature}`;
};

export type OAuthStateDecodeResult =
  | { ok: true; payloadRaw: string }
  | {
      ok: false;
      reason: OAuthStateDecodeReason;
    };

export const verifyAndDecodeOAuthStatePayload = (
  signedState: string | null | undefined,
): OAuthStateDecodeResult => {
  if (!signedState || signedState.trim().length === 0) {
    return { ok: false, reason: OAUTH_STATE_DECODE_REASON.missingState };
  }
  const trimmed = signedState.trim();
  const separatorIndex = trimmed.indexOf(".");
  if (
    separatorIndex <= 0 ||
    separatorIndex === trimmed.length - 1 ||
    trimmed.indexOf(".", separatorIndex + 1) !== -1
  ) {
    return { ok: false, reason: OAUTH_STATE_DECODE_REASON.invalidFormat };
  }
  const encodedPayload = trimmed.slice(0, separatorIndex);
  const signature = trimmed.slice(separatorIndex + 1);
  const expectedSignature = buildOAuthStateSignature(encodedPayload);
  if (!timingSafeEqualText(expectedSignature, signature)) {
    return { ok: false, reason: OAUTH_STATE_DECODE_REASON.invalidSignature };
  }
  const payloadRaw = fromBase64Url(encodedPayload);
  if (!payloadRaw) {
    return { ok: false, reason: OAUTH_STATE_DECODE_REASON.invalidEncoding };
  }
  return {
    ok: true,
    payloadRaw,
  };
};

export const safeReturnToPath = (value: string | null | undefined): string => {
  if (!value) {
    return "/";
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
};

export const getE2ENamespace = (headerValue: string | undefined): string | null => {
  if (!headerValue) {
    return null;
  }
  const trimmed = headerValue.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const toProviderRuntimeContext = (
  namespace: string | null,
  logger: RuntimeLogger,
): ProviderRuntimeContext => ({
  httpClient: (url, init) =>
    safeFetch(url, init, "api.provider.runtime.http", safeFetchNamespaceOptions(namespace)),
  clock: {
    now: () => Date.now(),
    nowIso: () => new Date().toISOString(),
  },
  idGenerator: {
    randomId: (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
  },
  logger: {
    debug: (message, metadata) => logger.debug(message, metadata ?? {}),
    info: (message, metadata) => logger.info(message, metadata ?? {}),
    warn: (message, metadata) => logger.warn(message, metadata ?? {}),
    error: (message, metadata) => logger.error(message, metadata ?? {}),
  },
  secrets: getProviderRuntimeSecrets({ env: getRawEnv() }),
  featureFlags: {},
});

export const toLowercaseHeaders = (headers: Headers): Record<string, string | undefined> => {
  const normalized: Record<string, string | undefined> = {};
  headers.forEach((value, key) => {
    normalized[key.toLowerCase()] = value;
  });
  return normalized;
};

export const parseContentLengthBytes = (headerValue: string | undefined): number | null => {
  if (!headerValue) {
    return null;
  }
  const parsed = Number.parseInt(headerValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

export const oauthErrorPayload = (params: {
  provider: ManagedOAuthProvider | string;
  code: string;
  message: string;
  correlationId?: string | undefined;
  source?: BoundaryParseSource;
  issues?: BoundaryParseIssue[] | undefined;
}) => {
  return parseApiBoundary(
    oauthConnectResponseSchema,
    {
      error: {
        code: params.code,
        message: params.message,
        provider: params.provider,
        ...(params.source ? { source: params.source } : {}),
        ...(params.issues ? { issues: params.issues } : {}),
        ...(params.correlationId ? { correlation_id: params.correlationId } : {}),
      },
    },
    {
      defaultCode: "invalid_oauth_connect_response",
      message: "Invalid OAuth connect response payload.",
    },
  );
};

export const oauthBoundaryResponse = (
  responder: { json: (payload: unknown, status?: number) => Response },
  provider: ManagedOAuthProvider | "unknown",
  error: unknown,
) => {
  const envelope = buildBoundaryErrorEnvelope(error, {
    defaultCode: "invalid_request",
    defaultMessage: "Invalid request payload",
    source: "api",
    provider,
  });

  return responder.json(
    oauthErrorPayload({
      provider,
      code: envelope.error.code,
      message: envelope.error.message,
      source: envelope.error.source,
      issues: envelope.error.issues,
    }),
    400,
  );
};

export const webhookBoundaryResponse = (
  responder: { json: (payload: unknown, status?: number) => Response },
  provider: string,
  defaultCode: string,
  defaultMessage: string,
  error: unknown,
) => {
  const envelope = buildBoundaryErrorEnvelope(error, {
    defaultCode,
    defaultMessage,
    source: "api",
    provider,
  });

  return responder.json(
    parseWebhookResponse({
      error: {
        ...envelope.error,
      },
    }),
    400,
  );
};

const parseCookieHeader = (value: string | undefined): Record<string, string> => {
  if (!value) {
    return {};
  }

  const cookies: Record<string, string> = {};
  for (const item of value.split(";")) {
    const segment = item.trim();
    if (!segment) {
      continue;
    }
    const divider = segment.indexOf("=");
    if (divider < 0) {
      continue;
    }
    const name = segment.slice(0, divider).trim();
    const rawValue = segment.slice(divider + 1).trim();
    if (!name || !rawValue) {
      continue;
    }
    cookies[name] = rawValue;
  }
  return cookies;
};

export const readBetterAuthSessionToken = (cookieHeader: string | undefined): string | null => {
  const cookies = parseCookieHeader(cookieHeader);
  const normalizeSessionToken = (value: string): string | null => {
    const token = value.trim();
    if (token.length === 0) {
      return null;
    }
    const separatorIndex = token.indexOf(".");
    if (separatorIndex <= 0) {
      return token;
    }
    return token.slice(0, separatorIndex);
  };
  const directCandidates = [
    "__Secure-better-auth.session_token",
    "better-auth.session_token",
    "__Secure-session_token",
    "session_token",
  ];

  for (const name of directCandidates) {
    const token = cookies[name];
    if (typeof token === "string") {
      const normalized = normalizeSessionToken(token);
      if (normalized) {
        return normalized;
      }
    }
  }

  for (const [name, value] of Object.entries(cookies)) {
    if (!name.endsWith("session_token")) {
      continue;
    }
    const normalized = normalizeSessionToken(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

export const resolveOrigins = (dashboardOrigin: string): string[] => {
  const env = getEnv();
  const normalizeOrigin = (rawValue: string, source: string): string => {
    const value = rawValue.trim();
    if (value === "*") {
      throw new Error(`Invalid ${source}: wildcard '*' is not allowed.`);
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`Invalid ${source}: '${rawValue}' is not a valid URL.`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Invalid ${source}: '${rawValue}' must use http:// or https://.`);
    }
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error(`Invalid ${source}: '${rawValue}' must be an origin without path/query.`);
    }
    return parsed.origin;
  };

  const fromEnv = (env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return [...new Set(fromEnv.map((origin) => normalizeOrigin(origin, "CORS_ALLOWED_ORIGINS")))];
  }
  return [normalizeOrigin(dashboardOrigin, "KEPPO_DASHBOARD_ORIGIN")];
};

export const asPositiveNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const asNonNegativeNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

type HeaderSource =
  | Headers
  | Request
  | {
      headers?: Headers | null | undefined;
      req?: {
        raw?: Request | null | undefined;
        header?: ((name: string) => string | undefined) | null | undefined;
      };
    };

const resolveHeaderValue = (source: HeaderSource, name: string): string | null => {
  if (source instanceof Request) {
    return source.headers.get(name);
  }
  if (source instanceof Headers) {
    return source.get(name);
  }
  if (source.headers instanceof Headers) {
    return source.headers.get(name);
  }
  const requestHeader = source.req?.raw?.headers.get(name);
  if (typeof requestHeader === "string") {
    return requestHeader;
  }
  const honoHeader = source.req?.header?.(name);
  return typeof honoHeader === "string" ? honoHeader : null;
};

export const resolveClientIp = (source: HeaderSource): string => {
  const env = getEnv();
  const firstHeaderIp = (value: string | undefined): string | null => {
    if (!value) {
      return null;
    }
    const first = value
      .split(",")
      .map((segment) => segment.trim())
      .find((segment) => segment.length > 0);
    return first ?? null;
  };

  const trustedProxy = env.KEPPO_TRUSTED_PROXY;
  const proxyHeaderOrder: string[] =
    trustedProxy === "cloudflare"
      ? ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]
      : trustedProxy === "vercel"
        ? ["x-real-ip", "x-forwarded-for"]
        : [];

  for (const headerName of proxyHeaderOrder) {
    const resolved = firstHeaderIp(resolveHeaderValue(source, headerName) ?? undefined);
    if (resolved) {
      return resolved;
    }
  }

  return "::";
};

export const hashIpAddress = (value: string): string => {
  return createHash("sha256").update(value, "utf8").digest("hex");
};

export const parseJsonPayload = (raw: string): unknown => {
  return parseJsonValue(raw, {
    message: "Request body must be valid JSON.",
  });
};

export const getRedirectUri = (requestUrl: string, provider: ManagedOAuthProvider): string => {
  const env = getEnv();
  const apiBase = env.KEPPO_API_INTERNAL_BASE_URL ?? `${new URL(requestUrl).origin}/api`;
  return new URL(`/oauth/integrations/${provider}/callback`, `${apiBase}/`).toString();
};
