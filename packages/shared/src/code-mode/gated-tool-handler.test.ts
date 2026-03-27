import { describe, expect, it, vi } from "vitest";
import { CodeModeGatingError, createGatedToolHandler } from "./gated-tool-handler.js";

describe("createGatedToolHandler", () => {
  it("executes pre-approved tools without gating", async () => {
    const executeFn = vi.fn(async () => ({ ok: true }));
    const gatingFn = vi.fn(async () => ({ outcome: "approve" as const }));
    const handler = createGatedToolHandler({
      preApprovedTools: new Set(["gmail.searchThreads"]),
      gatingFn,
      executeFn,
    });

    await expect(handler("gmail.searchThreads", { query: "" })).resolves.toEqual({ ok: true });
    expect(gatingFn).not.toHaveBeenCalled();
  });

  it("blocks tools when gating denies", async () => {
    const handler = createGatedToolHandler({
      preApprovedTools: new Set(),
      gatingFn: async () => ({ outcome: "deny", reason: "blocked" }),
      executeFn: async () => ({ ok: true }),
    });

    await expect(handler("slack.postMessage", {})).rejects.toBeInstanceOf(CodeModeGatingError);
  });
});
