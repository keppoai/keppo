import { maybeLoadApiRuntimeEnv } from "../../app/lib/server/api-runtime/runtime-env";

const SECURITY_HEADER_VALUES = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
} as const;

const deriveLocalSiteUrl = (convexUrl: string | undefined): string | null => {
  if (!convexUrl) {
    return null;
  }
  try {
    const parsed = new URL(convexUrl);
    const defaultPort = parsed.protocol === "https:" ? 443 : 80;
    const convexPort = Number.parseInt(parsed.port || String(defaultPort), 10);
    if (!Number.isFinite(convexPort)) {
      return null;
    }
    parsed.port = String(convexPort + 1);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

export const isAuthApiPath = (pathname: string): boolean => {
  return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
};

type AuthProxyEnv = {
  VITE_CONVEX_SITE_URL?: string | null | undefined;
  CONVEX_SITE_URL?: string | null | undefined;
  AUTH_BASE_URL?: string | null | undefined;
  VITE_CONVEX_URL?: string | null | undefined;
  CONVEX_URL?: string | null | undefined;
};

export const resolveAuthProxyBaseUrlFromEnv = (
  runtimeEnv: AuthProxyEnv,
  buildEnv: AuthProxyEnv,
): string | null => {
  const explicitSiteUrl =
    runtimeEnv.VITE_CONVEX_SITE_URL ??
    runtimeEnv.CONVEX_SITE_URL ??
    runtimeEnv.AUTH_BASE_URL ??
    buildEnv.VITE_CONVEX_SITE_URL ??
    null;
  if (explicitSiteUrl) {
    return explicitSiteUrl.replace(/\/$/, "");
  }

  return deriveLocalSiteUrl(
    runtimeEnv.VITE_CONVEX_URL ?? runtimeEnv.CONVEX_URL ?? buildEnv.VITE_CONVEX_URL ?? undefined,
  );
};

export const resolveAuthProxyBaseUrl = (): string | null => {
  maybeLoadApiRuntimeEnv();
  return resolveAuthProxyBaseUrlFromEnv(
    {
      VITE_CONVEX_SITE_URL: process.env.VITE_CONVEX_SITE_URL,
      CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
      AUTH_BASE_URL: process.env.AUTH_BASE_URL,
      VITE_CONVEX_URL: process.env.VITE_CONVEX_URL,
      CONVEX_URL: process.env.CONVEX_URL,
    },
    {
      VITE_CONVEX_SITE_URL: import.meta.env.VITE_CONVEX_SITE_URL,
      VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL,
    },
  );
};

const createUnavailableAuthProxyResponse = (request: Request): Response => {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
  });
  for (const [key, value] of Object.entries(SECURITY_HEADER_VALUES)) {
    headers.set(key, value);
  }
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(
    JSON.stringify({
      error: {
        code: "auth_proxy_unavailable",
        message: "Authentication proxy is unavailable.",
      },
    }),
    {
      status: 503,
      headers,
    },
  );
};

const normalizeAuthProxyResponse = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const proxyAuthApiRequest = async (
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> => {
  const authBaseUrl = resolveAuthProxyBaseUrl();
  if (!authBaseUrl) {
    return createUnavailableAuthProxyResponse(request);
  }

  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, `${authBaseUrl}/`);
  const headers = new Headers(request.headers);
  headers.delete("accept-encoding");
  headers.delete("host");
  headers.delete("content-length");

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  return normalizeAuthProxyResponse(await fetchImpl(targetUrl, init));
};
