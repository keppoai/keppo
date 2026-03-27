import { hasDocumentSessionHint } from "./document-session-hint";

export const BETTER_AUTH_SESSION_COOKIE_NAME = "better-auth.session_token";
const DIRECT_SESSION_COOKIE_NAMES = new Set([
  "__Secure-better-auth.session_token",
  BETTER_AUTH_SESSION_COOKIE_NAME,
  "__Secure-session_token",
  "session_token",
]);

export const hasBetterAuthSessionCookie = (cookieHeader: string | null | undefined): boolean => {
  const trimmed = cookieHeader?.trim();
  if (!trimmed) {
    return false;
  }

  return trimmed.split(";").some((cookie) => {
    const segment = cookie.trim();
    if (segment.length === 0) {
      return false;
    }

    const dividerIndex = segment.indexOf("=");
    if (dividerIndex <= 0) {
      return false;
    }

    const name = segment.slice(0, dividerIndex).trim();
    return DIRECT_SESSION_COOKIE_NAMES.has(name);
  });
};

export const hasSessionHint = (): boolean => {
  return hasDocumentSessionHint();
};

export const getBetterAuthCookieHeader = (
  _currentCookie: string | null | undefined,
): string | undefined => {
  return undefined;
};

/** Same-site auth: never forward `betterAuthCookie`; rely on browser cookies. */
export const getRuntimeBetterAuthCookieHeader = (
  _readCookie?: (() => string | null | undefined) | undefined,
): string | undefined => undefined;
