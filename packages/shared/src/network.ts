const DEFAULT_EXTERNAL_FETCH_ALLOWLIST = [
  "accounts.google.com:443",
  "oauth2.googleapis.com:443",
  "gmail.googleapis.com:443",
  "api.stripe.com:443",
  "api.github.com:443",
  "github.com:443",
  "api.x.com:443",
  "www.linkedin.com:443",
  "api.linkedin.com:443",
] as const;

export type SafeFetchErrorCode = "network_blocked" | "network_request_failed";
const MAX_SAFE_FETCH_REDIRECTS = 5;

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly details: Record<string, unknown>;

  constructor(params: {
    code: SafeFetchErrorCode;
    message: string;
    details: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "SafeFetchError";
    this.code = params.code;
    this.details = params.details;
  }
}

const normalizeHostPort = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const prefixed =
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed
        : `https://${trimmed}`;
    const parsed = new URL(prefixed);
    const port = parsed.port || (parsed.protocol === "http:" ? "80" : "443");
    return `${parsed.hostname}:${port}`.toLowerCase();
  } catch {
    return null;
  }
};

const resolveDerivedAllowlistEntries = (): string[] => {
  const candidates = [
    process.env.KEPPO_FAKE_EXTERNAL_BASE_URL,
    process.env.GMAIL_API_BASE_URL,
    process.env.GOOGLE_OAUTH_AUTH_URL,
    process.env.GOOGLE_OAUTH_TOKEN_URL,
    process.env.STRIPE_API_BASE_URL,
    process.env.STRIPE_OAUTH_AUTH_URL,
    process.env.STRIPE_OAUTH_TOKEN_URL,
    process.env.GITHUB_API_BASE_URL,
    process.env.GITHUB_OAUTH_AUTH_URL,
    process.env.GITHUB_OAUTH_TOKEN_URL,
    process.env.X_API_BASE_URL,
    process.env.LINKEDIN_API_BASE_URL,
    process.env.LINKEDIN_OAUTH_AUTH_URL,
    process.env.LINKEDIN_OAUTH_TOKEN_URL,
  ]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0);

  const fakePort = process.env.KEPPO_E2E_FAKE_EXTERNAL_PORT?.trim();
  if (fakePort && /^\d+$/.test(fakePort)) {
    candidates.push(`127.0.0.1:${fakePort}`);
  }

  const fakeModeEnabled = Boolean(
    process.env.KEPPO_FAKE_EXTERNAL_BASE_URL || process.env.KEPPO_E2E_FAKE_EXTERNAL_PORT,
  );
  if (fakeModeEnabled) {
    candidates.push("127.0.0.1:9901", "localhost:9901");
  }

  return candidates;
};

export const resolveExternalFetchAllowlist = (
  rawAllowlist = process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST,
  extraEntries: string[] = [],
): Set<string> => {
  const rawValues =
    rawAllowlist
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const source = rawValues.length > 0 ? rawValues : [...DEFAULT_EXTERNAL_FETCH_ALLOWLIST];
  const derived = resolveDerivedAllowlistEntries();
  const normalized = source
    .concat(derived, extraEntries)
    .map((entry) => normalizeHostPort(entry))
    .filter((entry): entry is string => entry !== null);
  return new Set(normalized);
};

const normalizeTargetHostPort = (url: URL): string => {
  const port = url.port || (url.protocol === "http:" ? "80" : "443");
  return `${url.hostname}:${port}`.toLowerCase();
};

const assertAllowedTarget = (
  target: URL,
  context: string,
  namespace: string,
  workerIndex: string,
  allowlist: Set<string>,
  namespaceTargets: Set<string>,
): void => {
  const normalizedTarget = normalizeTargetHostPort(target);
  if (allowlist.has(normalizedTarget) || namespaceTargets.has(normalizedTarget)) {
    return;
  }

  const allowed = [...allowlist].sort().join(", ");
  const details = {
    namespace,
    workerIndex,
    context,
    attemptedUrl: target.toString(),
    allowedHosts: allowed || "none",
  };
  throw new SafeFetchError({
    code: "network_blocked",
    message: `Blocked outbound network request: ${JSON.stringify(details)}`,
    details,
  });
};

const isRedirectStatus = (status: number): boolean =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

const canReplayRequestBody = (body: RequestInit["body"] | undefined): boolean => {
  return body === undefined || typeof body === "string" || body instanceof URLSearchParams;
};

const buildRedirectInit = (
  currentInit: RequestInit,
  status: number,
): RequestInit | "unsupported_redirect_body" => {
  const method = (currentInit.method ?? "GET").toUpperCase();
  const shouldSwitchToGet =
    status === 303 || ((status === 301 || status === 302) && method !== "GET" && method !== "HEAD");

  if (shouldSwitchToGet) {
    const headers = new Headers(currentInit.headers ?? {});
    headers.delete("content-length");
    headers.delete("content-type");
    return {
      ...currentInit,
      method: "GET",
      body: null,
      headers,
    };
  }

  if (!canReplayRequestBody(currentInit.body)) {
    return "unsupported_redirect_body";
  }

  return currentInit;
};

const DEFAULT_E2E_PORT_BASE = 9900;
const DEFAULT_E2E_PORT_BLOCK_SIZE = 20;

const parseWorkerIndexFromNamespace = (namespace?: string): number | null => {
  if (!namespace) {
    return null;
  }
  const segments = namespace.split(".");
  if (segments.length < 4) {
    return null;
  }
  const workerIndex = Number(segments[1]);
  if (!Number.isInteger(workerIndex) || workerIndex < 0) {
    return null;
  }
  return workerIndex;
};

const resolveNamespaceFakeGatewayTargets = (namespace?: string): Set<string> => {
  const targets = new Set<string>();
  const workerIndex = parseWorkerIndexFromNamespace(namespace);
  if (workerIndex === null) {
    return targets;
  }

  const base = Number.parseInt(process.env.KEPPO_E2E_PORT_BASE ?? "", 10);
  const blockSize = Number.parseInt(process.env.KEPPO_E2E_PORT_BLOCK_SIZE ?? "", 10);
  const safeBase = Number.isInteger(base) && base >= 1024 ? base : DEFAULT_E2E_PORT_BASE;
  const safeBlockSize =
    Number.isInteger(blockSize) && blockSize >= 5 ? blockSize : DEFAULT_E2E_PORT_BLOCK_SIZE;
  const fakeGatewayPort = safeBase + workerIndex * safeBlockSize + 1;

  targets.add(`127.0.0.1:${fakeGatewayPort}`);
  targets.add(`localhost:${fakeGatewayPort}`);
  return targets;
};

export const safeFetch = async (
  input: string | URL,
  init: RequestInit | undefined,
  context: string,
  options?: {
    namespace?: string;
    workerIndex?: string | number;
    headers?: Record<string, string>;
    extraAllowedHosts?: string[];
  },
): Promise<Response> => {
  const initialTarget = input instanceof URL ? input : new URL(input);
  const allowlist = resolveExternalFetchAllowlist(
    process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST,
    options?.extraAllowedHosts ?? [],
  );
  const namespace = options?.namespace ?? process.env.KEPPO_E2E_NAMESPACE ?? "n/a";
  const namespaceTargets = resolveNamespaceFakeGatewayTargets(namespace);
  const workerIndex = String(options?.workerIndex ?? process.env.KEPPO_E2E_WORKER_INDEX ?? "n/a");

  const mergedHeaders = new Headers(init?.headers ?? {});
  for (const [key, value] of Object.entries(options?.headers ?? {})) {
    mergedHeaders.set(key, value);
  }
  if (options?.namespace && options.namespace !== "n/a") {
    mergedHeaders.set("x-keppo-e2e-namespace", options.namespace);
  }

  try {
    let currentTarget = initialTarget;
    let currentInit: RequestInit = {
      ...init,
      headers: mergedHeaders,
    };
    const redirectMode = init?.redirect ?? "follow";

    for (let redirectCount = 0; ; redirectCount += 1) {
      assertAllowedTarget(
        currentTarget,
        context,
        namespace,
        workerIndex,
        allowlist,
        namespaceTargets,
      );

      const response = await fetch(currentTarget, {
        ...currentInit,
        redirect: "manual",
      });

      if (!isRedirectStatus(response.status)) {
        return response;
      }
      if (redirectMode === "manual") {
        return response;
      }
      if (redirectMode === "error") {
        throw new SafeFetchError({
          code: "network_blocked",
          message: `Blocked outbound redirect: ${JSON.stringify({
            namespace,
            workerIndex,
            context,
            attemptedUrl: currentTarget.toString(),
            location: response.headers.get("location"),
          })}`,
          details: {
            namespace,
            workerIndex,
            context,
            attemptedUrl: currentTarget.toString(),
            location: response.headers.get("location"),
          },
        });
      }
      if (redirectCount >= MAX_SAFE_FETCH_REDIRECTS) {
        throw new SafeFetchError({
          code: "network_blocked",
          message: `Blocked outbound redirect chain: ${JSON.stringify({
            namespace,
            workerIndex,
            context,
            attemptedUrl: currentTarget.toString(),
            maxRedirects: MAX_SAFE_FETCH_REDIRECTS,
          })}`,
          details: {
            namespace,
            workerIndex,
            context,
            attemptedUrl: currentTarget.toString(),
            maxRedirects: MAX_SAFE_FETCH_REDIRECTS,
          },
        });
      }

      const location = response.headers.get("location");
      if (!location) {
        return response;
      }
      const nextInit = buildRedirectInit(currentInit, response.status);
      if (nextInit === "unsupported_redirect_body") {
        throw new SafeFetchError({
          code: "network_request_failed",
          message: `Network request failed: ${JSON.stringify({
            namespace,
            context,
            attemptedUrl: currentTarget.toString(),
            reason: "Cannot safely replay request body across redirect.",
          })}`,
          details: {
            namespace,
            context,
            attemptedUrl: currentTarget.toString(),
            reason: "Cannot safely replay request body across redirect.",
          },
        });
      }
      currentTarget = new URL(location, currentTarget);
      currentInit = nextInit;
    }
  } catch (error) {
    if (error instanceof SafeFetchError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const details = {
      namespace,
      context,
      attemptedUrl: initialTarget.toString(),
      reason: message,
    };
    throw new SafeFetchError({
      code: "network_request_failed",
      message: `Network request failed: ${JSON.stringify(details)}`,
      details,
    });
  }
};
