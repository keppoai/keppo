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

    const spawnFn = vi.fn(
      (..._args: Parameters<JsliteSpawn>) => child as unknown as JsliteChildProcess,
    );
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
    expect(spawnFn).toHaveBeenCalledWith(
      "/tmp/jslite-sidecar",
      [],
      expect.objectContaining({
        stdio: ["pipe", "pipe", "pipe"],
        env: expect.objectContaining({
          PATH: expect.stringContaining("/tmp"),
        }),
      }),
    );
    const spawnOptions = (
      spawnFn.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }]
    )[2];
    expect(spawnOptions).toEqual(
      expect.not.objectContaining({
        OPENAI_API_KEY: expect.anything(),
        STRIPE_SECRET_KEY: expect.anything(),
      }),
    );
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

  it("returns a structured runtime failure when JSLite rejects the source with a non-validation error", async () => {
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
              error: "Compile failed unexpectedly",
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
      code: "return 1;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Compile failed unexpectedly");
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "sandbox_runtime_failed",
      reason: "Code execution failed in the sandbox runtime.",
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
    expect(result.error).toContain("KEPPO_JSLITE_PROJECT_PATH");
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "sandbox_unavailable",
      reason: "JSLite sandbox provider is unavailable.",
    });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("serializes cyclic arrays without recursing forever", async () => {
    const child = new FakeJsliteProcess();
    child.stdin.on("data", (chunk: Buffer | string) => {
      const lines = chunk
        .toString("utf8")
        .split("\n")
        .filter((line) => line.length > 0);
      for (const line of lines) {
        const request = JSON.parse(line) as {
          id: number;
          method: string;
          payload?: { type?: string; value?: { Array?: Array<{ String?: string }> } };
        };
        if (request.method === "compile") {
          child.stdout.write(
            `${JSON.stringify({
              id: request.id,
              ok: true,
              result: { kind: "program", program_base64: "program" },
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
                  capability: "__keppo_search_tools",
                  args: [stringValue("cyclic"), { Object: {} }],
                  snapshot_base64: "snapshot-1",
                },
              },
            })}\n`,
          );
          continue;
        }
        if (request.method === "resume") {
          expect(request.payload?.type).toBe("value");
          expect(request.payload?.value).toEqual({
            Array: [{ String: "self" }, { String: "[Circular]" }],
          });
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
                      hasReturnValue: boolValue(false),
                      logs: { Array: [] },
                      toolCallsExecuted: { Array: [] },
                    },
                  },
                },
              },
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

    const cyclic: unknown[] = ["self"];
    cyclic.push(cyclic);

    const result = await sandbox.execute({
      code: "return await searchTools('cyclic');",
      sdkSource:
        "const searchTools = async function (query, options) { return __keppo_execute_search_tools(query, options); };",
      toolCallHandler: async () => null,
      searchToolsHandler: async () => cyclic,
    });

    expect(result.success).toBe(true);
  });

  it("preserves runtime crash messages instead of treating them as missing-binary errors", async () => {
    const child = new FakeJsliteProcess();
    child.stdin.on("data", (chunk: Buffer | string) => {
      const lines = chunk
        .toString("utf8")
        .split("\n")
        .filter((line) => line.length > 0);
      for (const line of lines) {
        const request = JSON.parse(line) as { id: number; method: string };
        if (request.method === "compile") {
          child.stderr.write("sidecar crashed during execution\n");
          child.emit("close", 1, null);
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
      code: "return 1;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("sidecar crashed during execution");
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "sandbox_runtime_failed",
      reason: "Code execution failed in the sandbox runtime.",
    });
  });

  it("flushes the final stdout fragment when the sidecar exits without a trailing newline", async () => {
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
            JSON.stringify({
              id: request.id,
              ok: true,
              result: { kind: "program", program_base64: "program" },
            }),
          );
          child.stdout.end();
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
      code: "return 1;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("closed stdout before returning a response");
  });

  it("keeps the original spawn ENOENT error classification when close fires afterward", async () => {
    const child = new FakeJsliteProcess();
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => {
        child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
        child.emit("close", null, null);
      });
      return child as unknown as JsliteChildProcess;
    });
    const sandbox = new JsliteSandbox({
      spawnProcess: spawnFn as unknown as JsliteSpawn,
      env: {
        KEPPO_JSLITE_SIDECAR_PATH: "/tmp/jslite-sidecar",
      },
      fileExists: async (path) => path === "/tmp/jslite-sidecar",
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
  });

  it("handles stdin stream errors without crashing the host process", async () => {
    const child = new FakeJsliteProcess();
    child.stdin.on("data", (chunk: Buffer | string) => {
      const lines = chunk
        .toString("utf8")
        .split("\n")
        .filter((line) => line.length > 0);
      for (const line of lines) {
        const request = JSON.parse(line) as { id: number; method: string };
        if (request.method === "compile") {
          child.stdin.emit("error", new Error("write EPIPE"));
          child.emit("close", 1, null);
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
      code: "return 1;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("stdin: write EPIPE");
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "sandbox_runtime_failed",
      reason: "Code execution failed in the sandbox runtime.",
    });
  });

  it("swallows abandoned drain promise rejections after the sidecar exits first", async () => {
    const child = new FakeJsliteProcess();
    const originalWrite = child.stdin.write.bind(child.stdin);
    child.stdin.write = ((
      chunk: Buffer | string,
      encoding?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ) => {
      const result =
        typeof encoding === "function"
          ? originalWrite(chunk, encoding)
          : typeof encoding === "string"
            ? originalWrite(chunk, encoding, callback)
            : originalWrite(chunk);
      queueMicrotask(() => {
        child.emit("close", 1, null);
        child.stdin.emit("error", new Error("write after exit"));
      });
      return false;
    }) as typeof child.stdin.write;

    const unhandledRejection = vi.fn();
    process.once("unhandledRejection", unhandledRejection);

    const sandbox = new JsliteSandbox({
      spawnProcess: vi.fn(() => child as unknown as JsliteChildProcess) as unknown as JsliteSpawn,
      env: {
        KEPPO_JSLITE_SIDECAR_PATH: "/tmp/jslite-sidecar",
      },
      fileExists: async (path) => path === "/tmp/jslite-sidecar",
    });

    const result = await sandbox.execute({
      code: "return 1;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", unhandledRejection);

    expect(result.success).toBe(false);
    expect(unhandledRejection).not.toHaveBeenCalled();
  });

  it("waits for drain when stdin backpressure is signaled", async () => {
    const child = new FakeJsliteProcess();
    const originalWrite = child.stdin.write.bind(child.stdin);
    let sawBackpressureWrite = false;
    child.stdin.write = ((
      chunk: Buffer | string,
      encoding?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ) => {
      sawBackpressureWrite = true;
      const result =
        typeof encoding === "function"
          ? originalWrite(chunk, encoding)
          : typeof encoding === "string"
            ? originalWrite(chunk, encoding, callback)
            : originalWrite(chunk);
      queueMicrotask(() => {
        child.stdin.emit("drain");
      });
      return false;
    }) as typeof child.stdin.write;
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
              ok: true,
              result: { kind: "program", program_base64: "program" },
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
                  type: "completed",
                  value: {
                    Object: {
                      success: boolValue(true),
                      hasReturnValue: boolValue(false),
                      logs: { Array: [] },
                      toolCallsExecuted: { Array: [] },
                    },
                  },
                },
              },
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
      code: "return 1;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(true);
    expect(sawBackpressureWrite).toBe(true);
  });

  it("fails fast when a bridge request exceeds the payload limit", async () => {
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
                  capability: "__keppo_search_tools",
                  args: [stringValue("oversized"), { Object: {} }],
                  snapshot_base64: "snapshot-oversized",
                },
              },
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
      code: "return await searchTools('oversized');",
      sdkSource:
        "const searchTools = async function (query, options) { return __keppo_execute_search_tools(query, options); };",
      toolCallHandler: async () => null,
      searchToolsHandler: async () => "x".repeat(8 * 1024 * 1024),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("JSLite bridge request exceeded");
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "sandbox_runtime_failed",
      reason: "Code execution failed in the sandbox runtime.",
    });
  });

  it("rejects reserved structured keys from host values before sending them to the sidecar", async () => {
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
              ok: true,
              result: { kind: "program", program_base64: "program" },
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
                  capability: "__keppo_search_tools",
                  args: [stringValue("danger"), { Object: {} }],
                  snapshot_base64: "snapshot-danger",
                },
              },
            })}\n`,
          );
          continue;
        }
        if (request.method === "resume") {
          expect(request).toMatchObject({
            payload: {
              type: "error",
              error: {
                message: expect.stringContaining('reserved key "__proto__"'),
              },
            },
          });
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
                      success: boolValue(false),
                      error: stringValue(
                        'JSLite structured values may not include the reserved key "__proto__".',
                      ),
                      logs: { Array: [] },
                      toolCallsExecuted: { Array: [] },
                    },
                  },
                },
              },
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
    const dangerous = Object.create(null) as Record<string, unknown>;
    dangerous["__proto__"] = { polluted: true };

    const result = await sandbox.execute({
      code: "return await searchTools('danger');",
      sdkSource:
        "const searchTools = async function (query, options) { return __keppo_execute_search_tools(query, options); };",
      toolCallHandler: async () => null,
      searchToolsHandler: async () => dangerous,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('reserved key "__proto__"');
  });

  it("allows constructor and prototype keys in host values", async () => {
    const child = new FakeJsliteProcess();
    child.stdin.on("data", (chunk: Buffer | string) => {
      const lines = chunk
        .toString("utf8")
        .split("\n")
        .filter((line) => line.length > 0);
      for (const line of lines) {
        const request = JSON.parse(line) as {
          id: number;
          method: string;
          payload?: { type: string; value?: EncodedTestValue };
        };
        if (request.method === "compile") {
          child.stdout.write(
            `${JSON.stringify({
              id: request.id,
              ok: true,
              result: { kind: "program", program_base64: "program" },
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
                  capability: "__keppo_search_tools",
                  args: [stringValue("safe"), { Object: {} }],
                  snapshot_base64: "snapshot-safe",
                },
              },
            })}\n`,
          );
          continue;
        }
        if (request.method === "resume") {
          expect(request.payload).toEqual({
            type: "value",
            value: {
              Object: {
                constructor: stringValue("safe"),
                prototype: stringValue("also-safe"),
              },
            },
          });
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
                      returnValue: {
                        Object: {
                          accepted: boolValue(true),
                        },
                      },
                      logs: { Array: [] },
                      toolCallsExecuted: { Array: [] },
                    },
                  },
                },
              },
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
      code: "return await searchTools('safe');",
      sdkSource:
        "const searchTools = async function (query, options) { return __keppo_execute_search_tools(query, options); };",
      toolCallHandler: async () => null,
      searchToolsHandler: async () => ({
        constructor: "safe",
        prototype: "also-safe",
      }),
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      logs: [],
      returnValue: { accepted: true },
    });
  });

  it("propagates nullish thrown values from host handlers back to the guest", async () => {
    const child = new FakeJsliteProcess();
    child.stdin.on("data", (chunk: Buffer | string) => {
      const lines = chunk
        .toString("utf8")
        .split("\n")
        .filter((line) => line.length > 0);
      for (const line of lines) {
        const request = JSON.parse(line) as {
          id: number;
          method: string;
          payload?: { type: string; error?: { name?: string; message?: string } };
        };
        if (request.method === "compile") {
          child.stdout.write(
            `${JSON.stringify({
              id: request.id,
              ok: true,
              result: { kind: "program", program_base64: "program" },
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
                  capability: "__keppo_search_tools",
                  args: [stringValue("nullish"), { Object: {} }],
                  snapshot_base64: "snapshot-nullish",
                },
              },
            })}\n`,
          );
          continue;
        }
        if (request.method === "resume") {
          expect(request.payload).toEqual({
            type: "error",
            error: {
              name: "Error",
              message: "undefined",
              code: null,
              details: null,
            },
          });
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
                      success: boolValue(false),
                      error: stringValue("undefined"),
                      logs: { Array: [] },
                      toolCallsExecuted: { Array: [] },
                    },
                  },
                },
              },
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
      code: "return await searchTools('nullish');",
      sdkSource:
        "const searchTools = async function (query, options) { return __keppo_execute_search_tools(query, options); };",
      toolCallHandler: async () => null,
      searchToolsHandler: async () => {
        throw undefined;
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("undefined");
  });

  it("returns a structured runtime failure when the sidecar step response is a non-validation error", async () => {
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
              ok: true,
              result: { kind: "program", program_base64: "program" },
            })}\n`,
          );
          continue;
        }
        if (request.method === "start") {
          child.stdout.write(
            `${JSON.stringify({
              id: request.id,
              ok: false,
              error: "sidecar failed after start",
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
      code: "return 1;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("sidecar failed after start");
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "sandbox_runtime_failed",
      reason: "Code execution failed in the sandbox runtime.",
    });
  });

  it("rejects reserved structured keys from sidecar responses before decoding them", async () => {
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
              ok: true,
              result: { kind: "program", program_base64: "program" },
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
                  type: "completed",
                  value: {
                    Object: {
                      success: boolValue(true),
                      hasReturnValue: boolValue(true),
                      returnValue: {
                        Object: {
                          ["__proto__"]: {
                            Object: {
                              polluted: boolValue(true),
                            },
                          },
                        },
                      },
                      logs: { Array: [] },
                      toolCallsExecuted: { Array: [] },
                    },
                  },
                },
              },
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
      code: "return 1;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('reserved key "__proto__"');
  });

  it("allows constructor and prototype keys from sidecar responses", async () => {
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
              ok: true,
              result: { kind: "program", program_base64: "program" },
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
                  type: "completed",
                  value: {
                    Object: {
                      success: boolValue(true),
                      hasReturnValue: boolValue(true),
                      returnValue: {
                        Object: {
                          constructor: stringValue("safe"),
                          prototype: stringValue("also-safe"),
                        },
                      },
                      logs: { Array: [] },
                      toolCallsExecuted: { Array: [] },
                    },
                  },
                },
              },
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
      code: "return 1;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      logs: [],
      returnValue: {
        constructor: "safe",
        prototype: "also-safe",
      },
    });
  });

  it("rejects oversized sidecar response lines before they can exhaust memory", async () => {
    const child = new FakeJsliteProcess();
    child.stdin.on("data", (chunk: Buffer | string) => {
      const lines = chunk
        .toString("utf8")
        .split("\n")
        .filter((line) => line.length > 0);
      for (const line of lines) {
        const request = JSON.parse(line) as { id: number; method: string };
        if (request.method === "compile") {
          child.stdout.write(`${"x".repeat(16 * 1024 * 1024 + 1)}\n`);
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
      code: "return 1;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("response line larger");
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "sandbox_runtime_failed",
      reason: "Code execution failed in the sandbox runtime.",
    });
  });
});
