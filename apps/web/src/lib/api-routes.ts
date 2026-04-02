const START_OWNED_API_PREFIXES = [
  "/api/health",
  "/api/invites",
  "/api/search",
  "/api/billing",
  "/api/automations/generate-questions",
  "/api/automations/generate-prompt",
  "/api/mcp/test",
  "/api/oauth/integrations",
  "/api/notifications/push/subscribe",
] as const;

export const isStartOwnedApiPath = (pathname: string): boolean => {
  return START_OWNED_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
};
