import { afterEach, describe, expect, it } from "vitest";
import {
  getBetterAuthCookieHeader,
  hasBetterAuthSessionCookie,
  hasSessionHint,
} from "./better-auth-cookie";

describe("better-auth-cookie", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-has-session");
  });

  it("treats the SSR html attribute as a session hint", () => {
    document.documentElement.setAttribute("data-has-session", "");

    expect(hasSessionHint()).toBe(true);
  });

  it("does not treat persisted localStorage cookies as a session hint in same-site mode", () => {
    window.localStorage.setItem(
      "better-auth_cookie",
      JSON.stringify({
        "better-auth.session_token": {
          value: "token_123",
          expires: "2999-01-01T00:00:00.000Z",
        },
      }),
    );
    expect(hasSessionHint()).toBe(false);
    expect(getBetterAuthCookieHeader(undefined)).toBeUndefined();
  });

  it("matches supported session cookie names in request headers", () => {
    expect(hasBetterAuthSessionCookie("better-auth.session_token=token_123; theme=light")).toBe(
      true,
    );
    expect(hasBetterAuthSessionCookie("__Secure-better-auth.session_token=token_123")).toBe(true);
    expect(hasBetterAuthSessionCookie("session_token=token_123")).toBe(true);
    expect(hasBetterAuthSessionCookie("helper_session_token=token_123")).toBe(false);
    expect(hasBetterAuthSessionCookie("csrf_session_token=abc")).toBe(false);
    expect(hasBetterAuthSessionCookie("theme=session_token=abc")).toBe(false);
  });
});
