const START_OWNED_ROOT_PATH_PATTERNS = [
  /^\/billing\/(?:checkout|portal|usage|extra-usage)\/?$/u,
  /^\/billing\/credits\/checkout\/?$/u,
  /^\/mcp\/[^/]+\/?$/u,
  /^\/oauth\/integrations\/[^/]+\/callback\/?$/u,
  /^\/internal\/cron\/maintenance\/?$/u,
  /^\/internal\/automations\/(?:dispatch|terminate|log|complete)\/?$/u,
  /^\/internal\/health\/deep\/?$/u,
  /^\/internal\/notifications\/deliver\/?$/u,
  /^\/internal\/queue\/dispatch-approved-action\/?$/u,
  /^\/internal\/dlq(?:\/[^/]+\/(?:replay|abandon))?\/?$/u,
  /^\/webhooks(?:\/|$)/u,
] as const;

const FAIL_CLOSED_ROOT_PREFIXES = [
  "/billing",
  "/downloads",
  "/internal",
  "/mcp",
  "/oauth",
  "/webhooks",
] as const;

export const isStartOwnedRootPath = (pathname: string): boolean => {
  return START_OWNED_ROOT_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
};

export const isFailClosedRootPath = (pathname: string): boolean => {
  if (isStartOwnedRootPath(pathname)) {
    return false;
  }

  for (const prefix of FAIL_CLOSED_ROOT_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return true;
    }
  }

  return false;
};
