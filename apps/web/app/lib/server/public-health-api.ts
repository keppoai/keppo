const SECURITY_HEADER_VALUES = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
} as const;

export type PublicHealthPayload = {
  ok: true;
  runtime: "tanstack-start";
  app: "@keppo/web";
};

export const createPublicHealthPayload = (): PublicHealthPayload => {
  return {
    ok: true,
    runtime: "tanstack-start",
    app: "@keppo/web",
  };
};

export const createPublicHealthResponse = (request: Request): Response => {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });

  for (const [key, value] of Object.entries(SECURITY_HEADER_VALUES)) {
    headers.set(key, value);
  }

  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return new Response(JSON.stringify(createPublicHealthPayload()), {
    status: 200,
    headers,
  });
};
