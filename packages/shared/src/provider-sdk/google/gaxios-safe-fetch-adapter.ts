import type { GaxiosOptionsPrepared, GaxiosResponse } from "gaxios";
import { safeFetch } from "../../network.js";

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

export const createGaxiosSafeFetchAdapter = (context: string, namespace?: string) => {
  return createGaxiosSafeFetchAdapterWithHeaders(context, namespace);
};

export const createGaxiosSafeFetchAdapterWithHeaders = (
  context: string,
  namespace?: string,
  additionalHeaders?: Record<string, string>,
) => {
  const adapter = async <T = unknown>(
    options: GaxiosOptionsPrepared,
    _defaultAdapter: (options: GaxiosOptionsPrepared) => Promise<GaxiosResponse<T>>,
  ): Promise<GaxiosResponse<T>> => {
    if (!options.url) {
      throw new Error("Gaxios request is missing URL");
    }

    const headers = new Headers(options.headers as HeadersInit | undefined);
    if (additionalHeaders) {
      for (const [key, value] of Object.entries(additionalHeaders)) {
        if (value.trim().length > 0) {
          headers.set(key, value);
        }
      }
    }
    let body: string | undefined;

    if (typeof options.data === "string") {
      body = options.data;
    } else if (options.data !== undefined) {
      body = JSON.stringify(options.data);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    }

    const response = await safeFetch(
      options.url,
      {
        ...(options.method ? { method: options.method } : {}),
        headers,
        ...(body !== undefined ? { body } : {}),
      },
      context,
      namespace ? { namespace } : undefined,
    );

    const parsedBody = await parseResponseBody(response);

    const gaxiosResponse = response as GaxiosResponse<T>;
    gaxiosResponse.config = options;
    gaxiosResponse.data = parsedBody as T;
    return gaxiosResponse;
  };

  if (additionalHeaders && Object.keys(additionalHeaders).length > 0) {
    Object.defineProperty(adapter, "keppoAdditionalHeaders", {
      value: additionalHeaders,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }

  return adapter;
};
