import { safeFetch } from "../../network.js";
import {
  resolveProviderApiBaseUrl,
  trimTrailingSlash,
  withTrailingSlash,
} from "../fake-routing.js";
import type { CreateLinkedInClient, LinkedInClient } from "./client-interface.js";
import type {
  LinkedInJsonResponse,
  LinkedInQueryValue,
  LinkedInRequestJsonClientArgs,
} from "./types.js";

const DEFAULT_LINKEDIN_API_BASE_URL = "https://api.linkedin.com";
const DEFAULT_RESTLI_PROTOCOL_VERSION = "2.0.0";
const RESERVED_HEADER_NAMES = new Set([
  "accept",
  "authorization",
  "content-length",
  "content-type",
  "host",
  "linkedin-version",
  "x-restli-protocol-version",
]);
const PROFILE_PATHS = ["/v2/userinfo", "/v2/me", "/rest/me"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const resolveLinkedInApiBaseUrl = (accessToken: string, namespace?: string): string => {
  return resolveProviderApiBaseUrl({
    accessToken,
    namespace,
    fakeTokenPrefix: "fake_linkedin_",
    configuredBaseUrl: process.env.LINKEDIN_API_BASE_URL,
    defaultBaseUrl: DEFAULT_LINKEDIN_API_BASE_URL,
    formatFakeBaseUrl: (baseUrl) => `${trimTrailingSlash(baseUrl)}/linkedin/v1`,
    formatRealBaseUrl: trimTrailingSlash,
  });
};

const buildRequestUrl = (
  baseUrl: string,
  path: string,
  query?: Record<string, LinkedInQueryValue>,
): URL => {
  const trimmedPath = path.trim();
  if (!trimmedPath.startsWith("/") || trimmedPath.startsWith("//")) {
    throw new Error("invalid_request: LinkedIn API path must start with '/'.");
  }

  const url = new URL(trimmedPath.replace(/^\/+/, ""), withTrailingSlash(baseUrl));
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
};

const normalizeHeaders = (headers: Record<string, string> | undefined): Record<string, string> => {
  if (!headers) {
    return {};
  }

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    if (RESERVED_HEADER_NAMES.has(normalizedKey.toLowerCase())) {
      continue;
    }
    sanitized[normalizedKey] = normalizedValue;
  }
  return sanitized;
};

const responseHeadersToObject = (response: Response): Record<string, string> => {
  return Object.fromEntries(response.headers.entries());
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid_provider_response: LinkedIn API did not return valid JSON.");
  }
};

const extractErrorMessage = (body: unknown, fallback: string): string => {
  if (isRecord(body)) {
    const directMessage = toTrimmedString(body.message) ?? toTrimmedString(body.error_description);
    if (directMessage) {
      return directMessage;
    }
    const errorMessage = toTrimmedString(body.error);
    if (errorMessage) {
      return errorMessage;
    }
  }
  return fallback;
};

const toErrorCode = (status: number): string => {
  if (status === 401) {
    return "invalid_token";
  }
  if (status === 403) {
    return "permission_denied";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 408 || status === 504) {
    return "timeout";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 400 && status < 500) {
    return "invalid_request";
  }
  return "provider_error";
};

const shouldRetryProfilePath = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("permission_denied") ||
    message.includes("not_found") ||
    message.includes("invalid_request")
  );
};

export const createRealLinkedInClient: CreateLinkedInClient = (
  accessToken,
  namespace,
): LinkedInClient => {
  const apiBaseUrl = resolveLinkedInApiBaseUrl(accessToken, namespace);

  const requestJson = async (
    args: LinkedInRequestJsonClientArgs,
  ): Promise<LinkedInJsonResponse> => {
    const url = buildRequestUrl(apiBaseUrl, args.path, args.query);
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-RestLi-Protocol-Version":
        args.restliProtocolVersion?.trim() || DEFAULT_RESTLI_PROTOCOL_VERSION,
      ...normalizeHeaders(args.headers),
    };
    if (args.linkedinVersion?.trim()) {
      headers["LinkedIn-Version"] = args.linkedinVersion.trim();
    }

    const requestInit: RequestInit = {
      method: args.method,
      headers,
    };
    if (args.body !== undefined) {
      headers["Content-Type"] = "application/json";
      requestInit.body = JSON.stringify(args.body);
    }

    const response = await safeFetch(
      url,
      requestInit,
      `linkedin.client.${args.method.toLowerCase()}`,
      namespace ? { namespace } : {},
    );
    const body = await parseResponseBody(response);

    if (!response.ok) {
      const message = extractErrorMessage(body, `LinkedIn API request failed: ${response.status}`);
      throw new Error(`${toErrorCode(response.status)}: ${message}`);
    }

    return {
      status: response.status,
      data: body,
      headers: responseHeadersToObject(response),
    };
  };

  return {
    getProfile: async () => {
      for (const path of PROFILE_PATHS) {
        try {
          const response = await requestJson({
            method: "GET",
            path,
          });
          if (isRecord(response.data)) {
            return response.data;
          }
        } catch (error) {
          if (shouldRetryProfilePath(error)) {
            continue;
          }
          throw error;
        }
      }
      throw new Error(
        "invalid_provider_response: LinkedIn profile lookup did not return a provider account identifier.",
      );
    },
    requestJson,
  };
};
