import { isAuthApiPath } from "./auth-api-proxy";
import { isStartOwnedApiPath } from "./api-routes";
import { isFailClosedRootPath } from "./root-routes";

const SECURITY_HEADER_VALUES = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
} as const;

export const isFailClosedProtocolPath = (pathname: string): boolean => {
  if (isStartOwnedApiPath(pathname) || isAuthApiPath(pathname)) {
    return false;
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return true;
  }

  return isFailClosedRootPath(pathname);
};

export const createProtocolNotFoundResponse = (request: Request): Response => {
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
        code: "route_not_found",
        message: "Route not found.",
      },
    }),
    {
      status: 404,
      headers,
    },
  );
};
