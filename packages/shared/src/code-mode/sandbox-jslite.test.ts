import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsliteSandbox, type JsliteChildProcess, type JsliteSpawn } from "./sandbox-jslite.js";

class FakeJsliteProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn((_: NodeJS.Signals | undefined) => {
    queueMicrotask(() => {
      this.stdout.end();
      this.stderr.end();
      this.emit("close", 0, null);
    });
    return true;
  });
}

type EncodedTestValue =
  | "Undefined"
  | { String: string }
  | { Bool: boolean }
  | { Number: { Finite: number } }
  | { Array: EncodedTestValue[] }
  | { Object: Record<string, EncodedTestValue> };

const stringValue = (value: string): EncodedTestValue => ({ String: value });
const boolValue = (value: boolean): EncodedTestValue => ({ Bool: value });
const numberValue = (value: number): EncodedTestValue => ({ Number: { Finite: value } });
const objectValue = (value: Record<string, unknown>): EncodedTestValue => ({
  Object: Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (typeof entry === "string") {
        return [key, stringValue(entry)];
      }
      if (typeof entry === "boolean") {
        return [key, boolValue(entry)];
      }
      if (typeof entry === "number") {
        return [key, numberValue(entry)];
      }
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        return [key, objectValue(entry as Record<string, unknown>)];
      }
      return [key, "Undefined"];
    }),
  ),
});

describe("JsliteSandbox", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("executes code through the JSLite sidecar bridge protocol", async () => {
    const child = new FakeJsliteProcess();
    const toolCalls: Array<{ toolName: string; input: Record<string, unknown> }> = [];
    const bufferedLines: string[] = [];

    child.stdin.on("data", (chunk: Buffer | string) => {
      bufferedLines.push(
        ...chunk
          .toString("utf8")
          .split("\n")
          .filter((line) => line.length > 0),
      );
      while (bufferedLines.length > 0) {
        const line = bufferedLines.shift();
        if (!line) {
          continue;
        }
        const request = JSON.parse(line) as {
          id: number;
          method: string;
          payload?: { type: string };
        };
        if (request.method === "compile") {
          child.stdout.write(
            `${JSON.stringify({
              id: request.id,
              ok: true,
              result: {
                kind: "program",
                program_base64: "program",
              },
            })}\n`,
          );
          continue;
        }
        if (request.method === "start") {
          child.stdout.write(
            `${JSON.stringify({
              id: request.id,
              ok: true,
              result: {
                kind: "step",
                step: {
                  type: "suspended",
                  capability: "__keppo_call_tool",
                  args: [
                    stringValue("gmail.searchThreads"),
                    {
                      Object: {
                        query: stringValue("status:unread"),
                      },
                    },
                  ],
                  snapshot_base64: "snapshot-1",
                },
              },
            })}\n`,
          );
          continue;
        }
        if (request.method === "resume") {
          expect(request.payload?.type).toBe("value");
          child.stdout.write(
            `${JSON.stringify({
              id: request.id,
              ok: true,
              result: {
                kind: "step",
                step: {
                  type: "completed",
                  value: {
                    Object: {
                      success: boolValue(true),
                      hasReturnValue: boolValue(true),
                      returnValue: objectValue({ done: true }),
                      logs: {
                        Array: [stringValue("done")],
                      },
                      toolCallsExecuted: {
                        Array: [
                          objectValue({
                            toolName: "gmail.searchThreads",
                            input: { query: "status:unread" },
                            output: { count: 2 },
                          }),
                        ],
                      },
                    },
                  },
                },
              },
            })}\n`,
          );
        }
      }
    });

    const spawnFn = vi.fn(() => child as unknown as JsliteChildProcess);
    const sandbox = new JsliteSandbox({
      spawnProcess: spawnFn as unknown as JsliteSpawn,
      env: {
        KEPPO_JSLITE_SIDECAR_PATH: "/tmp/jslite-sidecar",
      },
      fileExists: async (path) => path === "/tmp/jslite-sidecar",
    });

    const result = await sandbox.execute({
      code: 'return await gmail.searchThreads({ query: "status:unread" });',
      sdkSource:
        'const gmail = { "searchThreads": async function (args) { return __keppo_execute_tool("gmail.searchThreads", args); } };',
      toolCallHandler: async (toolName, input) => {
        toolCalls.push({ toolName, input });
        return { count: 2 };
      },
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      logs: ["done"],
      returnValue: { done: true },
    });
    expect(result.toolCallsExecuted).toEqual([
      {
        toolName: "gmail.searchThreads",
        input: { query: "status:unread" },
        output: { count: 2 },
      },
    ]);
    expect(toolCalls).toEqual([
      {
        toolName: "gmail.searchThreads",
        input: { query: "status:unread" },
      },
    ]);
    expect(spawnFn).toHaveBeenCalledWith("/tmp/jslite-sidecar", [], expect.any(Object));
  });

  it("returns a structured validation failure when JSLite rejects the source", async () => {
    const child = new FakeJsliteProcess();
    child.stdin.on("data", (chunk: Buffer | string) => {
      const lines = chunk
        .toString("utf8")
        .split("\n")
        .filter((line) => line.length > 0);
      for (const line of lines) {
        const request = JSON.parse(line) as { id: number; method: string };
        if (request.method === "compile") {
          child.stdout.write(
            `${JSON.stringify({
              id: request.id,
              ok: false,
              error: "Validation: module syntax is not supported [0..18]",
            })}\n`,
          );
        }
      }
    });

    const sandbox = new JsliteSandbox({
      spawnProcess: vi.fn(() => child as unknown as JsliteChildProcess) as unknown as JsliteSpawn,
      env: {
        KEPPO_JSLITE_SIDECAR_PATH: "/tmp/jslite-sidecar",
      },
      fileExists: async (path) => path === "/tmp/jslite-sidecar",
    });

    const result = await sandbox.execute({
      code: "import x from 'y';",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Validation: module syntax is not supported [0..18]");
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "validation_failed",
      reason: "Validation: module syntax is not supported [0..18]",
    });
  });

  it("returns a clear error when the sidecar cannot be resolved", async () => {
    const spawnFn = vi.fn();
    const sandbox = new JsliteSandbox({
      spawnProcess: spawnFn as unknown as JsliteSpawn,
      env: {},
      cwd: "/tmp/keppo",
      fileExists: async () => false,
    });

    const result = await sandbox.execute({
      code: "return 1;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("JSLite sandbox provider is unavailable");
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "sandbox_unavailable",
      reason: "JSLite sandbox provider is unavailable.",
    });
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
