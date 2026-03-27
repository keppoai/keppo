import { describe, expect, it } from "vitest";
import { VercelSandbox } from "./sandbox-vercel.js";

type LogEntry = {
  data: string;
  stream: "stdout" | "stderr";
};

const REQUEST_PREFIX = "__KEPPO_BRIDGE_REQUEST__";
const RESULT_PREFIX = "__KEPPO_BRIDGE_RESULT__";

describe("VercelSandbox", () => {
  it("handles bridge requests and returns structured output", async () => {
    const writes: Array<Array<{ path: string; content: Buffer }>> = [];
    const stopCalls: Array<{ blocking?: boolean; signal?: AbortSignal }> = [];
    const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const searchCalls: Array<{ query: string; options?: Record<string, unknown> }> = [];

    const logs: LogEntry[] = [
      {
        stream: "stdout",
        data:
          `${REQUEST_PREFIX}${JSON.stringify({
            requestId: "req_tool",
            responsePath: "/tmp/keppo-code-mode-responses/req_tool.json",
            kind: "tool",
            toolName: "gmail.searchThreads",
            input: { query: "status:unread" },
          })}\n` +
          `${REQUEST_PREFIX}${JSON.stringify({
            requestId: "req_search",
            responsePath: "/tmp/keppo-code-mode-responses/req_search.json",
            kind: "search",
            query: "send email",
            options: { provider: "google" },
          })}\n` +
          `${RESULT_PREFIX}${JSON.stringify({
            success: true,
            hasReturnValue: true,
            returnValue: { done: true },
            logs: ["done"],
            toolCallsExecuted: [
              {
                toolName: "gmail.searchThreads",
                input: { query: "status:unread" },
                output: { count: 2 },
              },
            ],
          })}\n`,
      },
    ];

    const command = {
      async *logs() {
        for (const line of logs) {
          yield line;
        }
      },
      async wait() {
        return { exitCode: 0 };
      },
      async kill() {},
    };

    const sandbox = {
      async writeFiles(files: Array<{ path: string; content: Buffer }>) {
        writes.push(files);
      },
      async runCommand() {
        return command;
      },
      async stop(options?: { blocking?: boolean; signal?: AbortSignal }) {
        stopCalls.push(options ?? {});
        return {};
      },
    };

    const subject = new VercelSandbox(async () => ({
      Sandbox: {
        async create() {
          return sandbox;
        },
      },
    }));

    const result = await subject.execute({
      code: 'console.log("hello");',
      sdkSource:
        "globalThis.gmail = { searchThreads: (args) => __keppo_call_tool('gmail.searchThreads', args) };",
      toolCallHandler: async (toolName, args) => {
        toolCalls.push({ name: toolName, input: args });
        return { count: 2 };
      },
      searchToolsHandler: async (query, options) => {
        searchCalls.push({
          query,
          ...(options ? { options } : {}),
        });
        return [{ name: "gmail.sendEmail" }];
      },
      timeoutMs: 500,
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      returnValue: { done: true },
      logs: ["done"],
    });
    expect(result.toolCallsExecuted).toEqual([
      {
        toolName: "gmail.searchThreads",
        input: { query: "status:unread" },
        output: { count: 2 },
      },
    ]);
    expect(toolCalls).toEqual([{ name: "gmail.searchThreads", input: { query: "status:unread" } }]);
    expect(searchCalls).toEqual([{ query: "send email", options: { provider: "google" } }]);

    expect(writes).toHaveLength(3);
    expect(writes[0]?.map((entry) => entry.path)).toEqual([
      "/vercel/sandbox/sdk.mjs",
      "/vercel/sandbox/entry.mjs",
    ]);

    expect(JSON.parse(writes[1]?.[0]?.content.toString("utf8") ?? "")).toEqual({
      ok: true,
      value: { count: 2 },
    });
    expect(JSON.parse(writes[2]?.[0]?.content.toString("utf8") ?? "")).toEqual({
      ok: true,
      value: [{ name: "gmail.sendEmail" }],
    });

    expect(stopCalls).toEqual([{ blocking: true }]);
  });

  it("returns timeout error when command log stream aborts", async () => {
    let killCount = 0;
    let stopCount = 0;
    const command = {
      async *logs(options?: { signal?: AbortSignal }) {
        while (true) {
          if (options?.signal?.aborted) {
            const abortError = new Error("aborted");
            (abortError as Error & { name: string }).name = "AbortError";
            throw abortError;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      },
      async wait() {
        return { exitCode: 0 };
      },
      async kill() {
        killCount += 1;
      },
    };

    const sandbox = {
      async writeFiles() {},
      async runCommand() {
        return command;
      },
      async stop() {
        stopCount += 1;
        return {};
      },
    };

    const subject = new VercelSandbox(async () => ({
      Sandbox: {
        async create() {
          return sandbox;
        },
      },
    }));

    const result = await subject.execute({
      code: "console.log('x')",
      sdkSource: "",
      toolCallHandler: async () => null,
      timeoutMs: 20,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Execution timed out");
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "timeout",
      reason: "Code execution timed out.",
    });
    expect(killCount).toBeGreaterThan(0);
    expect(stopCount).toBe(1);
  });
});
