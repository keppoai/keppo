import Stripe from "stripe";

const normalizePathPrefix = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
};

const rewriteStripeUrl = (input: string, pathPrefix: string): string => {
  if (!pathPrefix) {
    return input;
  }

  const url = new URL(input);
  if (url.pathname.startsWith(`${pathPrefix}/v1/`) || url.pathname === `${pathPrefix}/v1`) {
    return input;
  }

  if (url.pathname === "/v1" || url.pathname.startsWith("/v1/")) {
    url.pathname = `${pathPrefix}${url.pathname}`;
  }

  return url.toString();
};

export const createStripeFetchHttpClient = (
  pathPrefix: string,
  namespace?: string,
): Stripe.HttpClient => {
  const normalizedPrefix = normalizePathPrefix(pathPrefix);

  const mergeHeaders = (...sources: Array<HeadersInit | undefined>): Headers => {
    const merged = new Headers();
    for (const source of sources) {
      if (!source) {
        continue;
      }
      const headers = new Headers(source);
      headers.forEach((value, key) => {
        merged.set(key, value);
      });
    }
    if (namespace) {
      merged.set("x-keppo-e2e-namespace", namespace);
    }
    return merged;
  };

  const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (typeof input === "string") {
      return globalThis.fetch(rewriteStripeUrl(input, normalizedPrefix), {
        ...init,
        headers: mergeHeaders(init?.headers),
      });
    }

    if (input instanceof URL) {
      return globalThis.fetch(rewriteStripeUrl(input.toString(), normalizedPrefix), {
        ...init,
        headers: mergeHeaders(init?.headers),
      });
    }

    const rewritten = rewriteStripeUrl(input.url, normalizedPrefix);
    if (init) {
      return globalThis.fetch(rewritten, {
        ...init,
        headers: mergeHeaders(input.headers, init.headers),
      });
    }
    if (!namespace) {
      return globalThis.fetch(new Request(rewritten, input));
    }
    return globalThis.fetch(new Request(rewritten, input), {
      headers: mergeHeaders(input.headers),
    });
  };

  return Stripe.createFetchHttpClient(fetchFn);
};
