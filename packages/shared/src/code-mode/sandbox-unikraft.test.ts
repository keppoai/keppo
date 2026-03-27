import { describe, expect, it, vi } from "vitest";
import { UnikraftSandbox } from "./sandbox-unikraft.js";
import { RESULT_PREFIX } from "./sandbox-bridge.js";

const extractBridgeUrlFromEnv = (env: Record<string, string> | undefined): string => {
  const encoded = env?.["KEPPO_ENTRY_SOURCE_B64"];
  expect(encoded).toBeTypeOf("string");
  const source = Buffer.from(encoded ?? "", "base64").toString("utf8");
  const match = source.match(/const BRIDGE_CALLBACK_URL = "([^"]+)";/u);
  expect(match?.[1]).toBeTypeOf("string");
  return match?.[1] ?? "";
};

const extractBridgeAuthTokenFromEnv = (env: Record<string, string> | undefined): string => {
  expect(env?.["KEPPO_BRIDGE_AUTH_TOKEN"]).toBeTypeOf("string");
  return env?.["KEPPO_BRIDGE_AUTH_TOKEN"] ?? "";
};

describe("UnikraftSandbox", () => {
  it("executes code successfully and serves tool calls over the HTTP bridge", async () => {
    const createInstance = vi.fn().mockResolvedValue({
      uuid: "inst_success",
      state: "running",
    });
    const getInstanceLogs = vi.fn().mockImplementation(async () => {
      const bridgeUrl = extractBridgeUrlFromEnv(createInstance.mock.calls[0]?.[0]?.env);
      const response = await fetch(bridgeUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${extractBridgeAuthTokenFromEnv(
            createInstance.mock.calls[0]?.[0]?.env,
          )}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          requestId: "req_1",
          kind: "tool",
          toolName: "gmail.searchThreads",
          input: { query: "is:unread" },
        }),
      });
      await expect(response.json()).resolves.toEqual({
        ok: true,
        value: { count: 2 },
      });
      return {
        output: `${RESULT_PREFIX}${JSON.stringify({
          success: true,
          hasReturnValue: true,
          returnValue: { done: true },
          logs: ["done"],
          toolCallsExecuted: [
            {
              toolName: "gmail.searchThreads",
              input: { query: "is:unread" },
              output: { count: 2 },
            },
          ],
        })}\n`,
        next_offset: 1,
      };
    });
    const stopInstance = vi.fn().mockResolvedValue(undefined);
    const deleteInstance = vi.fn().mockResolvedValue(undefined);

    const sandbox = new UnikraftSandbox({
      createInstance,
      getInstanceLogs,
      getInstance: vi.fn(),
      stopInstance,
      deleteInstance,
    });

    const result = await sandbox.execute({
      code: 'return await gmail.searchThreads({ query: "is:unread" });',
      sdkSource:
        "globalThis.gmail = { searchThreads(args){ return __keppo_call_tool('gmail.searchThreads', args); } };",
      toolCallHandler: async (toolName, args) => {
        expect(toolName).toBe("gmail.searchThreads");
        expect(args).toEqual({ query: "is:unread" });
        return { count: 2 };
      },
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      returnValue: { done: true },
      logs: ["done"],
    });
    expect(result.toolCallsExecuted).toEqual([
      {
        toolName: "gmail.searchThreads",
        input: { query: "is:unread" },
        output: { count: 2 },
      },
    ]);
    expect(stopInstance).toHaveBeenCalledWith("inst_success", { drainTimeoutMs: 1_000 });
    expect(deleteInstance).toHaveBeenCalledWith("inst_success");
  });

  it("rejects unauthenticated HTTP bridge requests", async () => {
    const createInstance = vi.fn().mockResolvedValue({
      uuid: "inst_auth",
      state: "running",
    });
    const getInstanceLogs = vi.fn().mockImplementation(async () => {
      const env = createInstance.mock.calls[0]?.[0]?.env;
      const response = await fetch(extractBridgeUrlFromEnv(env), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          requestId: "req_auth",
          kind: "tool",
          toolName: "gmail.searchThreads",
          input: { query: "is:unread" },
        }),
      });
      expect(response.status).toBe(401);
      return {
        output: `${RESULT_PREFIX}${JSON.stringify({
          success: true,
          hasReturnValue: true,
          returnValue: { ok: true },
          logs: [],
          toolCallsExecuted: [],
        })}\n`,
        next_offset: 1,
      };
    });

    const sandbox = new UnikraftSandbox({
      createInstance,
      getInstanceLogs,
      getInstance: vi.fn(),
      stopInstance: vi.fn().mockResolvedValue(undefined),
      deleteInstance: vi.fn().mockResolvedValue(undefined),
    });

    const result = await sandbox.execute({
      code: "return true;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(true);
  });

  it("returns a timeout failure and still cleans up the instance", async () => {
    const stopInstance = vi.fn().mockResolvedValue(undefined);
    const deleteInstance = vi.fn().mockResolvedValue(undefined);
    const sandbox = new UnikraftSandbox({
      createInstance: vi.fn().mockResolvedValue({
        uuid: "inst_timeout",
        state: "running",
      }),
      getInstanceLogs: vi.fn().mockResolvedValue({
        output: "",
        next_offset: 0,
      }),
      getInstance: vi.fn().mockResolvedValue({
        uuid: "inst_timeout",
        state: "running",
      }),
      stopInstance,
      deleteInstance,
    });

    const result = await sandbox.execute({
      code: "return 1;",
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
    expect(stopInstance).toHaveBeenCalledWith("inst_timeout", { drainTimeoutMs: 1_000 });
    expect(deleteInstance).toHaveBeenCalledWith("inst_timeout");
  });

  it("returns a provider error when instance creation fails", async () => {
    const sandbox = new UnikraftSandbox({
      createInstance: vi.fn().mockRejectedValue(new Error("bad request")),
      getInstanceLogs: vi.fn(),
      getInstance: vi.fn(),
      stopInstance: vi.fn(),
      deleteInstance: vi.fn(),
    });

    const result = await sandbox.execute({
      code: "return 1;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "The remote sandbox could not execute your request. Please try again.",
    );
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "sandbox_unavailable",
      reason: "The remote sandbox could not execute your request. Please try again.",
    });
  });

  it("returns a failure when the instance stops without producing a result", async () => {
    const stopInstance = vi.fn().mockResolvedValue(undefined);
    const deleteInstance = vi.fn().mockResolvedValue(undefined);
    const sandbox = new UnikraftSandbox({
      createInstance: vi.fn().mockResolvedValue({
        uuid: "inst_failed",
        state: "running",
      }),
      getInstanceLogs: vi.fn().mockResolvedValue({
        output: "",
        next_offset: 0,
      }),
      getInstance: vi.fn().mockResolvedValue({
        uuid: "inst_failed",
        state: "failed",
      }),
      stopInstance,
      deleteInstance,
    });

    const result = await sandbox.execute({
      code: "throw new Error('x');",
      sdkSource: "",
      toolCallHandler: async () => null,
      timeoutMs: 200,
    });

    expect(result.success).toBe(false);
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "sandbox_runtime_failed",
      reason: "The remote sandbox stopped with an execution error.",
    });
    expect(stopInstance).toHaveBeenCalledWith("inst_failed", { drainTimeoutMs: 1_000 });
    expect(deleteInstance).toHaveBeenCalledWith("inst_failed");
  });

  it("returns structured failure metadata when the bridge reports a runtime error", async () => {
    const stopInstance = vi.fn().mockResolvedValue(undefined);
    const deleteInstance = vi.fn().mockResolvedValue(undefined);

    const sandbox = new UnikraftSandbox({
      createInstance: vi.fn().mockResolvedValue({
        uuid: "inst_bridge_failure",
        state: "running",
      }),
      getInstanceLogs: vi.fn().mockResolvedValue({
        output: `${RESULT_PREFIX}${JSON.stringify({
          success: false,
          error: "User code failed",
          logs: ["before failure"],
          toolCallsExecuted: [],
        })}\n`,
        next_offset: 1,
      }),
      getInstance: vi.fn(),
      stopInstance,
      deleteInstance,
    });

    const result = await sandbox.execute({
      code: "throw new Error('boom');",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("User code failed");
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "sandbox_runtime_failed",
      reason: "User code failed",
    });
    expect(result.output).toEqual({
      logs: ["before failure"],
    });
    expect(stopInstance).toHaveBeenCalledWith("inst_bridge_failure", { drainTimeoutMs: 1_000 });
    expect(deleteInstance).toHaveBeenCalledWith("inst_bridge_failure");
  });

  it("preserves partial result log lines across log polls", async () => {
    const stopInstance = vi.fn().mockResolvedValue(undefined);
    const deleteInstance = vi.fn().mockResolvedValue(undefined);
    const resultPayload = `${RESULT_PREFIX}${JSON.stringify({
      success: true,
      hasReturnValue: true,
      returnValue: { merged: true },
      logs: ["ok"],
      toolCallsExecuted: [],
    })}\n`;

    const sandbox = new UnikraftSandbox({
      createInstance: vi.fn().mockResolvedValue({
        uuid: "inst_partial",
        state: "running",
      }),
      getInstanceLogs: vi
        .fn()
        .mockResolvedValueOnce({
          output: resultPayload.slice(0, 24),
          next_offset: 24,
        })
        .mockResolvedValueOnce({
          output: resultPayload.slice(24),
          next_offset: resultPayload.length,
        }),
      getInstance: vi.fn().mockResolvedValue({
        uuid: "inst_partial",
        state: "running",
      }),
      stopInstance,
      deleteInstance,
    });

    const result = await sandbox.execute({
      code: "return 1;",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      returnValue: { merged: true },
      logs: ["ok"],
    });
  });
});
