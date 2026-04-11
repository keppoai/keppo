import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { allTools } from "../tool-definitions.js";
import { generateCodeModeSDK } from "./sdk-generator.js";

describe("generateCodeModeSDK", () => {
  it("produces executable JavaScript namespaces", async () => {
    const source = generateCodeModeSDK(allTools);
    const context = vm.createContext({
      globalThis: {},
      __keppo_call_tool: async () => ({ ok: true }),
      __keppo_search_tools: async () => [],
    });

    const script = new vm.Script(source);
    script.runInContext(context);

    const globals = context.globalThis as Record<string, unknown>;
    expect(typeof globals.gmail).toBe("object");
    expect(typeof globals.search_tools).toBe("function");
  });

  it("produces a jslite-compatible SDK target", () => {
    const source = `${generateCodeModeSDK(allTools, { target: "jslite" })}
globalThis.__capture = { gmail, search_tools };`;
    const context = vm.createContext({
      globalThis: {},
      __keppo_execute_tool: async () => ({ ok: true }),
      __keppo_execute_search_tools: async () => [],
    });

    const script = new vm.Script(source);
    script.runInContext(context);

    expect(source).not.toContain("Object.freeze");
    expect(source).not.toContain("globalThis.gmail");
    const globals = (context.globalThis as { __capture?: Record<string, unknown> }).__capture ?? {};
    expect(typeof globals.gmail).toBe("object");
    expect(typeof globals.search_tools).toBe("function");
  });
});
