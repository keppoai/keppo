import { BaseConnector } from "../../../connectors/base-connector.js";
import type { Connector, ConnectorContext } from "../../../connectors/base.js";
import {
  createProviderCircuitBreaker,
  wrapObjectWithCircuitBreaker,
} from "../../../circuit-breaker.js";
import { createRealLinkedInSdk } from "../../../provider-sdk/linkedin/real.js";
import type { LinkedInSdkPort } from "../../../provider-sdk/linkedin/types.js";
import { linkedinTools as linkedinToolDefinitions } from "../../../tool-definitions.js";

type LinkedInReadToolName = "linkedin.getProfile" | "linkedin.readApi";
type LinkedInWriteToolName = "linkedin.writeApi";

type LinkedInReadDispatchInput = {
  validated: Record<string, unknown>;
  accessToken: string;
  namespace: string | undefined;
};

type LinkedInPrepareDispatchInput = {
  validated: Record<string, unknown>;
};

type LinkedInWriteDispatchInput = {
  normalizedPayload: Record<string, unknown>;
  accessToken: string;
  namespace: string | undefined;
};

const requiredScopesByTool: Record<string, string[]> = {};
const providerCircuitBreaker = createProviderCircuitBreaker("linkedin");

const asQuery = (value: unknown): Record<string, string | number | boolean> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const query = value as Record<string, string | number | boolean>;
  return Object.keys(query).length > 0 ? query : undefined;
};

const asHeaders = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const headers = value as Record<string, string>;
  return Object.keys(headers).length > 0 ? headers : undefined;
};

const readOptionalString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const summarizeBody = (value: unknown): Record<string, unknown> => {
  if (value === undefined) {
    return {};
  }
  if (Array.isArray(value)) {
    return {
      body_type: "array",
      body_length: value.length,
    };
  }
  if (value && typeof value === "object") {
    return {
      body_type: "object",
      body_keys: Object.keys(value as Record<string, unknown>).sort(),
    };
  }
  return {
    body_type: typeof value,
  };
};

const buildRequestArgs = (
  validated: Record<string, unknown>,
  runtime: { accessToken: string; namespace: string | undefined },
  methodOverride?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
) => {
  const request = {
    accessToken: runtime.accessToken,
    ...(runtime.namespace ? { namespace: runtime.namespace } : {}),
    method: methodOverride ?? String(validated.method ?? "GET"),
    path: String(validated.path ?? ""),
  } as {
    accessToken: string;
    namespace?: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    query?: Record<string, string | number | boolean>;
    headers?: Record<string, string>;
    body?: unknown;
    linkedinVersion?: string;
    restliProtocolVersion?: string;
  };

  const query = asQuery(validated.query);
  if (query) {
    request.query = query;
  }
  const headers = asHeaders(validated.headers);
  if (headers) {
    request.headers = headers;
  }
  if (validated.body !== undefined) {
    request.body = validated.body;
  }
  const linkedinVersion = readOptionalString(validated.linkedinVersion);
  if (linkedinVersion) {
    request.linkedinVersion = linkedinVersion;
  }
  const restliProtocolVersion = readOptionalString(validated.restliProtocolVersion);
  if (restliProtocolVersion) {
    request.restliProtocolVersion = restliProtocolVersion;
  }

  return request;
};

export const createLinkedInConnector = (options?: { sdk?: LinkedInSdkPort }): Connector => {
  const sdk = wrapObjectWithCircuitBreaker(
    options?.sdk ?? createRealLinkedInSdk(),
    providerCircuitBreaker,
  );

  class LinkedInConnector extends BaseConnector<
    LinkedInReadDispatchInput,
    LinkedInPrepareDispatchInput,
    LinkedInWriteDispatchInput,
    typeof linkedinToolDefinitions
  > {
    constructor() {
      super({
        provider: "linkedin",
        tools: linkedinToolDefinitions,
        requiredScopesByTool,
        readMap: {
          "linkedin.getProfile": async ({ accessToken, namespace }) => {
            const profile = await sdk.getProfile({
              accessToken,
              ...(namespace ? { namespace } : {}),
            });
            return { profile };
          },
          "linkedin.readApi": async ({ validated, accessToken, namespace }) => {
            const response = await sdk.requestJson(
              buildRequestArgs(
                validated,
                {
                  accessToken,
                  namespace,
                },
                "GET",
              ),
            );
            return {
              path: String(validated.path ?? ""),
              status: response.status,
              data: response.data,
              headers: response.headers,
            };
          },
        } satisfies Record<
          LinkedInReadToolName,
          (input: LinkedInReadDispatchInput) => Promise<Record<string, unknown>>
        >,
        prepareMap: {
          "linkedin.writeApi": async ({ validated }) => ({
            normalized_payload: {
              method: String(validated.method ?? ""),
              path: String(validated.path ?? ""),
              ...(validated.query !== undefined ? { query: validated.query } : {}),
              ...(validated.headers !== undefined ? { headers: validated.headers } : {}),
              ...(validated.linkedinVersion !== undefined
                ? { linkedinVersion: validated.linkedinVersion }
                : {}),
              ...(validated.restliProtocolVersion !== undefined
                ? { restliProtocolVersion: validated.restliProtocolVersion }
                : {}),
              ...(validated.body !== undefined ? { body: validated.body } : {}),
            },
            payload_preview: {
              method: String(validated.method ?? ""),
              path: String(validated.path ?? ""),
              ...(validated.query &&
              typeof validated.query === "object" &&
              !Array.isArray(validated.query)
                ? { query_keys: Object.keys(validated.query as Record<string, unknown>).sort() }
                : {}),
              ...(validated.headers &&
              typeof validated.headers === "object" &&
              !Array.isArray(validated.headers)
                ? { header_names: Object.keys(validated.headers as Record<string, unknown>).sort() }
                : {}),
              ...summarizeBody(validated.body),
            },
          }),
        } satisfies Record<
          LinkedInWriteToolName,
          (input: LinkedInPrepareDispatchInput) => Promise<{
            normalized_payload: Record<string, unknown>;
            payload_preview: Record<string, unknown>;
          }>
        >,
        writeMap: {
          "linkedin.writeApi": async ({ normalizedPayload, accessToken, namespace }) => {
            const response = await sdk.requestJson(
              buildRequestArgs(normalizedPayload, {
                accessToken,
                namespace,
              }),
            );
            return {
              method: String(normalizedPayload.method ?? ""),
              path: String(normalizedPayload.path ?? ""),
              status: response.status,
              data: response.data,
              headers: response.headers,
            };
          },
        } satisfies Record<
          LinkedInWriteToolName,
          (input: LinkedInWriteDispatchInput) => Promise<Record<string, unknown>>
        >,
      });
    }

    protected getToken(context: ConnectorContext): string {
      if (typeof context.access_token === "string" && context.access_token.trim().length > 0) {
        return context.access_token;
      }
      throw new Error("LinkedIn access token missing. Reconnect LinkedIn integration.");
    }

    protected buildReadDispatchInput(
      _toolName: string,
      validated: Record<string, unknown>,
      _context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): LinkedInReadDispatchInput {
      return {
        validated,
        accessToken: runtime.accessToken,
        namespace: runtime.namespace,
      };
    }

    protected buildPrepareDispatchInput(
      _toolName: string,
      validated: Record<string, unknown>,
      _context: ConnectorContext,
    ): LinkedInPrepareDispatchInput {
      return { validated };
    }

    protected buildWriteDispatchInput(
      _toolName: string,
      normalizedPayload: Record<string, unknown>,
      _context: ConnectorContext,
      runtime: { accessToken: string; namespace: string | undefined },
    ): LinkedInWriteDispatchInput {
      return {
        normalizedPayload,
        accessToken: runtime.accessToken,
        namespace: runtime.namespace,
      };
    }
  }

  return new LinkedInConnector();
};

const connector = createLinkedInConnector();

export default connector;
