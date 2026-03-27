import { safeFetch } from "../../network.js";

type SlackAdapterRequestConfig = {
  url?: string;
  baseURL?: string;
  method?: string;
  headers?: unknown;
  data?: unknown;
};

type SlackAdapterResponse = {
  data: unknown;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: SlackAdapterRequestConfig;
  request: {
    url: string;
  };
};

type SlackAdapter = (config: SlackAdapterRequestConfig) => Promise<SlackAdapterResponse>;

const normalizeHeaderEntries = (headers: unknown): Array<[string, string]> => {
  if (!headers || typeof headers !== "object") {
    return [];
  }

  if ("toJSON" in headers && typeof headers.toJSON === "function") {
    const jsonValue = headers.toJSON() as Record<string, unknown>;
    return Object.entries(jsonValue)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]);
  }

  return Object.entries(headers as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)]);
};

const resolveRequestUrl = (config: SlackAdapterRequestConfig): string => {
  const rawUrl = typeof config.url === "string" ? config.url : "";
  if (!rawUrl) {
    throw new Error("Slack request missing URL");
  }

  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    return rawUrl;
  }

  const baseUrl = typeof config.baseURL === "string" ? config.baseURL : "";
  if (!baseUrl) {
    throw new Error("Slack request missing base URL");
  }

  return new URL(
    rawUrl.replace(/^\/+/, ""),
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();
};

const resolveRequestBody = (data: unknown): string | undefined => {
  if (data === undefined || data === null) {
    return undefined;
  }
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof URLSearchParams) {
    return data.toString();
  }
  return JSON.stringify(data);
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const raw = await response.text();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};

const toHeaderRecord = (headers: Headers): Record<string, string> => {
  const normalized: Record<string, string> = {};
  headers.forEach((value, key) => {
    normalized[key] = value;
  });
  return normalized;
};

export const createSlackSafeFetchAdapter = (context: string, namespace?: string): SlackAdapter => {
  const adapter: SlackAdapter = async (config: SlackAdapterRequestConfig) => {
    const requestUrl = resolveRequestUrl(config);
    const headers = new Headers(normalizeHeaderEntries(config.headers));
    const body = resolveRequestBody(config.data);

    try {
      const response = await safeFetch(
        requestUrl,
        {
          method: (config.method ?? "GET").toUpperCase(),
          headers,
          ...(body !== undefined ? { body } : {}),
        },
        context,
        namespace ? { namespace } : undefined,
      );
      const responseData = await parseResponseBody(response);

      return {
        data: responseData,
        status: response.status,
        statusText: response.statusText,
        headers: toHeaderRecord(response.headers),
        config,
        request: {
          url: requestUrl,
        },
      };
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      (wrapped as Error & { request?: { url: string } }).request = {
        url: requestUrl,
      };
      throw wrapped;
    }
  };
  return adapter;
};
