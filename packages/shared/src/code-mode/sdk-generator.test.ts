import vm from "node:vm";
import { z } from "zod";
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

  it("keeps reserved namespaces reachable on the jslite target without emitting invalid bindings", () => {
    const source = `${generateCodeModeSDK(
      [
        {
          name: "default.run",
          provider: "gmail",
          capability: "read",
          risk_level: "low",
          requires_approval: false,
          output_sensitivity: "internal",
          action_type: "read",
          description: "Run the default tool",
          redaction_policy: [],
          input_schema: z.object({}),
        },
      ] as never,
      { target: "jslite" },
    )}
globalThis.__capture = { provider: globalThis["default"] };`;
    const context = vm.createContext({
      globalThis: {},
      __keppo_execute_tool: async () => ({ ok: true }),
      __keppo_execute_search_tools: async () => [],
    });

    const script = new vm.Script(source);
    script.runInContext(context);

    expect(source).not.toContain("const default =");
    const globals = (context.globalThis as { __capture?: { provider?: Record<string, unknown> } })
      .__capture;
    expect(typeof globals?.provider).toBe("object");
    expect(typeof globals?.provider?.run).toBe("function");
  });

  it("keeps __proto__ tool names callable on the jslite target", async () => {
    const source = `${generateCodeModeSDK(
      [
        {
          name: "gmail.__proto__",
          provider: "gmail",
          capability: "read",
          risk_level: "low",
          requires_approval: false,
          output_sensitivity: "internal",
          action_type: "read",
          description: "Call the proto-named tool",
          redaction_policy: [],
          input_schema: z.object({ query: z.string() }),
        },
      ] as never,
      { target: "jslite" },
    )}
globalThis.__capture = globalThis.gmail["__proto__"];`;
    const toolCalls: Array<{ name: string; args: unknown }> = [];
    const context = vm.createContext({
      globalThis: {},
      __keppo_execute_tool: async (name: string, args: unknown) => {
        toolCalls.push({ name, args });
        return { ok: true };
      },
      __keppo_execute_search_tools: async () => [],
    });

    const script = new vm.Script(source);
    script.runInContext(context);

    const fn = (context.globalThis as { __capture?: (args: { query: string }) => Promise<unknown> })
      .__capture;
    expect(typeof fn).toBe("function");
    await fn?.({ query: "status:unread" });
    expect(toolCalls).toEqual([
      {
        name: "gmail.__proto__",
        args: { query: "status:unread" },
      },
    ]);
  });
});
