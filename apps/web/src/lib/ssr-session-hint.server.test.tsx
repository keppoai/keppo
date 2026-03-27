// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getStartContextMock } = vi.hoisted(() => ({
  getStartContextMock: vi.fn(),
}));

vi.mock("@tanstack/start-storage-context", () => ({
  getStartContext: getStartContextMock,
}));

import { getRootDocumentSessionAttributes } from "./ssr-session-hint.server";

describe("ssr-session-hint server rendering", () => {
  beforeEach(() => {
    getStartContextMock.mockReset();
  });

  it("serializes the html session attribute when the current request has a session cookie", () => {
    getStartContextMock.mockReturnValue({
      request: new Request("https://keppo.test/", {
        headers: {
          cookie: "better-auth.session_token=token_123; theme=light",
        },
      }),
    });

    const html = renderToStaticMarkup(
      <html lang="en" {...getRootDocumentSessionAttributes()}>
        <body />
      </html>,
    );

    expect(html).toContain('data-has-session=""');
  });

  it("serializes the html session attribute for secure session cookie variants", () => {
    getStartContextMock.mockReturnValue({
      request: new Request("https://keppo.test/", {
        headers: {
          cookie: "__Secure-better-auth.session_token=token_123; theme=light",
        },
      }),
    });

    const html = renderToStaticMarkup(
      <html lang="en" {...getRootDocumentSessionAttributes()}>
        <body />
      </html>,
    );

    expect(html).toContain('data-has-session=""');
  });

  it("omits the html session attribute when the current request does not have a session cookie", () => {
    getStartContextMock.mockReturnValue({
      request: new Request("https://keppo.test/", {
        headers: {
          cookie: "csrf_token=abc",
        },
      }),
    });

    const html = renderToStaticMarkup(
      <html lang="en" {...getRootDocumentSessionAttributes()}>
        <body />
      </html>,
    );

    expect(html).not.toContain("data-has-session");
  });
});
