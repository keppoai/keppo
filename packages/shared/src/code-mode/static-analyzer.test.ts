import { describe, expect, it } from "vitest";
import { extractToolReferences } from "./static-analyzer.js";

describe("extractToolReferences", () => {
  it("finds namespace and bridge tool references", () => {
    const tools = new Set(["gmail.searchThreads", "slack.postMessage"]);
    const code = `
      await gmail.searchThreads({ query: "inbox" });
      await __keppo_call_tool("slack.postMessage", { channel: "C1" });
    `;

    expect(extractToolReferences(code, tools)).toEqual([
      "gmail.searchThreads",
      "slack.postMessage",
    ]);
  });
});
