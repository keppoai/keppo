import { describe, expect, it } from "vitest";
import {
  clearDocumentSessionHint,
  hasDocumentSessionHint,
  resolveSessionHintForRender,
} from "./ssr-session-hint";

describe("ssr-session-hint", () => {
  it("reads the browser html session attribute on the client", () => {
    document.documentElement.setAttribute("data-has-session", "");

    expect(hasDocumentSessionHint()).toBe(true);
    expect(resolveSessionHintForRender()).toBe(true);

    clearDocumentSessionHint();

    expect(hasDocumentSessionHint()).toBe(false);
  });
});
