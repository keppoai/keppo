import { Client } from "@notionhq/client";
import { safeFetch } from "../../network.js";
import { resolveProviderApiBaseUrl, trimTrailingSlash } from "../fake-routing.js";
import type { CreateNotionClient, NotionClient, NotionClientOptions } from "./client-interface.js";

const DEFAULT_NOTION_API_BASE_URL = "https://api.notion.com/v1";
const normalizeNotionClientBaseUrl = (value: string): string => {
  const normalized = trimTrailingSlash(value);
  return normalized.endsWith("/v1") ? normalized.slice(0, -"/v1".length) : normalized;
};

const resolveNotionApiBaseUrl = (accessToken: string, namespace?: string): string => {
  return resolveProviderApiBaseUrl({
    accessToken,
    namespace,
    fakeTokenPrefix: "fake_notion_",
    configuredBaseUrl: process.env.NOTION_API_BASE_URL,
    defaultBaseUrl: DEFAULT_NOTION_API_BASE_URL,
    formatFakeBaseUrl: (baseUrl) => normalizeNotionClientBaseUrl(`${baseUrl}/notion/v1`),
    formatRealBaseUrl: normalizeNotionClientBaseUrl,
  });
};

const toRequestUrl = (input: string | URL | Request): string => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
};

const createNotionSdkClient = (
  accessToken: string,
  namespace: string | undefined,
  options?: NotionClientOptions,
): Client => {
  return new Client({
    auth: accessToken,
    baseUrl: resolveNotionApiBaseUrl(accessToken, namespace),
    notionVersion: "2022-06-28",
    retry: false,
    fetch: async (input, init) => {
      const url = toRequestUrl(input);
      return safeFetch(
        url,
        init,
        options?.requestContext ?? "notion.sdk.request",
        namespace
          ? {
              namespace,
              ...(options?.idempotencyKey
                ? {
                    headers: {
                      "x-idempotency-key": options.idempotencyKey,
                    },
                  }
                : {}),
            }
          : undefined,
      );
    },
  });
};

const requestNotionJson = async (
  accessToken: string,
  namespace: string | undefined,
  options: {
    requestContext: string;
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    body?: Record<string, unknown> | undefined;
    idempotencyKey?: string | undefined;
  },
): Promise<Record<string, unknown>> => {
  const baseUrl = resolveNotionApiBaseUrl(accessToken, namespace);
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(
    options.path.startsWith("/") ? options.path.slice(1) : options.path,
    normalizedBase,
  );
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "notion-version": "2022-06-28",
  };
  if (options.body) {
    headers["content-type"] = "application/json";
  }
  if (options.idempotencyKey) {
    headers["x-idempotency-key"] = options.idempotencyKey;
  }

  const response = await safeFetch(
    url.toString(),
    {
      method: options.method,
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    },
    options.requestContext,
    namespace ? { namespace } : undefined,
  );
  const text = await response.text();
  const payload = text.length > 0 ? JSON.parse(text) : {};
  if (!response.ok) {
    const asPayload =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const topLevelCode = asPayload.code;
    const nestedError =
      asPayload.error && typeof asPayload.error === "object" && !Array.isArray(asPayload.error)
        ? (asPayload.error as Record<string, unknown>)
        : null;
    const nestedCode = nestedError?.code;
    const statusCodeFallback =
      response.status === 401
        ? "invalid_token"
        : response.status === 404
          ? "object_not_found"
          : response.status === 429
            ? "rate_limited"
            : response.status === 400
              ? "invalid_request"
              : "provider_error";
    const errorCode =
      (typeof topLevelCode === "string" && topLevelCode) ||
      (typeof nestedCode === "string" && nestedCode) ||
      statusCodeFallback;
    throw new Error(errorCode);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
};

export const createRealNotionClient: CreateNotionClient = (
  accessToken,
  namespace,
  options,
): NotionClient => {
  const notion = createNotionSdkClient(accessToken, namespace, options);

  return {
    search: async (params) => {
      return await notion.search(params as Parameters<Client["search"]>[0]);
    },
    pages: {
      retrieve: async (params) => {
        return await notion.pages.retrieve(params as Parameters<Client["pages"]["retrieve"]>[0]);
      },
      create: async (params) => {
        return await notion.pages.create(params as Parameters<Client["pages"]["create"]>[0]);
      },
      update: async (params) => {
        return await notion.pages.update(params as Parameters<Client["pages"]["update"]>[0]);
      },
      move: async (params) => {
        return await requestNotionJson(accessToken, namespace, {
          requestContext: options?.requestContext ?? "notion.sdk.move_page",
          method: "POST",
          path: `/v1/pages/${encodeURIComponent(params.page_id)}/move`,
          body: {
            parent_page_id: params.parent_page_id,
          },
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      properties: {
        retrieve: async (params) => {
          return await requestNotionJson(accessToken, namespace, {
            requestContext: options?.requestContext ?? "notion.sdk.get_page_property",
            method: "GET",
            path: `/v1/pages/${encodeURIComponent(params.page_id)}/properties/${encodeURIComponent(params.property_id)}`,
          });
        },
      },
    },
    databases: {
      retrieve: async (params) => {
        return await notion.databases.retrieve(
          params as Parameters<Client["databases"]["retrieve"]>[0],
        );
      },
      query: async (params) => {
        const response = await requestNotionJson(accessToken, namespace, {
          requestContext: options?.requestContext ?? "notion.sdk.query_database",
          method: "POST",
          path: `/v1/databases/${encodeURIComponent(params.database_id)}/query`,
          body: {
            page_size: params.page_size,
            ...(typeof params.query === "string" && params.query.trim().length > 0
              ? { query: params.query }
              : {}),
          },
        });
        const results = Array.isArray(response.results) ? response.results : [];
        return { results };
      },
      create: async (params) => {
        return await requestNotionJson(accessToken, namespace, {
          requestContext: options?.requestContext ?? "notion.sdk.create_database",
          method: "POST",
          path: "/v1/databases",
          body: params,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      update: async (params) => {
        const databaseId = String(params.database_id ?? "").trim();
        const body: Record<string, unknown> = { ...params };
        delete body.database_id;
        return await requestNotionJson(accessToken, namespace, {
          requestContext: options?.requestContext ?? "notion.sdk.update_database",
          method: "PATCH",
          path: `/v1/databases/${encodeURIComponent(databaseId)}`,
          body,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
    },
    blocks: {
      retrieve: async (params) => {
        return await notion.blocks.retrieve(params as Parameters<Client["blocks"]["retrieve"]>[0]);
      },
      update: async (params) => {
        const blockId = String(params.block_id ?? "").trim();
        const body: Record<string, unknown> = { ...params };
        delete body.block_id;
        return await requestNotionJson(accessToken, namespace, {
          requestContext: options?.requestContext ?? "notion.sdk.update_block",
          method: "PATCH",
          path: `/v1/blocks/${encodeURIComponent(blockId)}`,
          body,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      delete: async (params) => {
        return await requestNotionJson(accessToken, namespace, {
          requestContext: options?.requestContext ?? "notion.sdk.delete_block",
          method: "DELETE",
          path: `/v1/blocks/${encodeURIComponent(params.block_id)}`,
          ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });
      },
      children: {
        list: async (params) => {
          return await notion.blocks.children.list(
            params as Parameters<Client["blocks"]["children"]["list"]>[0],
          );
        },
        append: async (params) => {
          return await notion.blocks.children.append(
            params as Parameters<Client["blocks"]["children"]["append"]>[0],
          );
        },
      },
    },
    comments: {
      list: async (params) => {
        return await notion.comments.list(params as Parameters<Client["comments"]["list"]>[0]);
      },
      retrieve: async (params) => {
        return await requestNotionJson(accessToken, namespace, {
          requestContext: options?.requestContext ?? "notion.sdk.get_comment",
          method: "GET",
          path: `/v1/comments/${encodeURIComponent(params.comment_id)}`,
        });
      },
      create: async (params) => {
        return await notion.comments.create(params as Parameters<Client["comments"]["create"]>[0]);
      },
    },
    users: {
      list: async (params) => {
        const response = await notion.users.list(params as Parameters<Client["users"]["list"]>[0]);
        const results = Array.isArray(response.results) ? response.results : [];
        return { results };
      },
      retrieve: async (params) => {
        return await notion.users.retrieve(params as Parameters<Client["users"]["retrieve"]>[0]);
      },
      me: async () => {
        return await notion.users.me({} as Parameters<Client["users"]["me"]>[0]);
      },
    },
  };
};
