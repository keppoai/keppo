import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockerSandbox, type DockerChildProcess, type DockerSpawn } from "./sandbox-docker.js";
import { REQUEST_PREFIX, RESULT_PREFIX } from "./sandbox-bridge.js";

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
}

describe("DockerSandbox", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("executes code through the Docker bridge protocol", async () => {
    const spawnFn = vi.fn((command: string, args: ReadonlyArray<string>) => {
      expect(command).toBe("docker");

      if (args[0] === "image" && args[1] === "inspect") {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write("sha256:local-node-image\n");
          child.stdout.end();
          child.stderr.end();
          child.emit("close", 0, null);
        });
        return child as unknown as DockerChildProcess;
      }

      expect(args).toContain("run");
      expect(args).toContain("sha256:local-node-image");

      const volumeArgIndex = args.findIndex((entry) => entry === "--volume");
      const volumeArg = volumeArgIndex >= 0 ? (args[volumeArgIndex + 1] ?? "") : "";
      const hostWorkspace = volumeArg.split(":")[0] ?? "";
      const child = new FakeChildProcess();

      void (async () => {
        child.stdout.write(
          `${REQUEST_PREFIX}${JSON.stringify({
            requestId: "req_1",
            responsePath: "/workspace/responses/req_1.json",
            kind: "tool",
            toolName: "gmail.sendEmail",
            input: { to: "will@example.com" },
          })}\n`,
        );

        let responseValue: unknown = null;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          try {
            const raw = await readFile(`${hostWorkspace}/responses/req_1.json`, "utf8");
            responseValue = JSON.parse(raw).value;
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }

        child.stdout.write(
          `${RESULT_PREFIX}${JSON.stringify({
            success: true,
            logs: ["sent"],
            toolCallsExecuted: [
              {
                toolName: "gmail.sendEmail",
                input: { to: "will@example.com" },
                output: responseValue,
              },
            ],
          })}\n`,
        );
        child.stdout.end();
        child.stderr.end();
        child.emit("close", 0, null);
      })();

      return child as unknown as DockerChildProcess;
    });

    const sandbox = new DockerSandbox(spawnFn as unknown as DockerSpawn);
    const result = await sandbox.execute({
      code: 'const response = await gmail.sendEmail({ to: "will@example.com" }); console.log("sent"); return response.id;',
      sdkSource:
        "globalThis.gmail = { sendEmail(args){ return __keppo_call_tool('gmail.sendEmail', args); } };",
      toolCallHandler: async () => ({ id: "msg_1" }),
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      returnValue: undefined,
      logs: ["sent"],
    });
    expect(result.toolCallsExecuted).toEqual([
      {
        toolName: "gmail.sendEmail",
        input: { to: "will@example.com" },
        output: { id: "msg_1" },
      },
    ]);
  });

  it("returns a clear error when docker is unavailable", async () => {
    const spawnFn = vi.fn(() => {
      const child = new FakeChildProcess();
      queueMicrotask(() => {
        child.emit("error", Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" }));
      });
      return child as unknown as DockerChildProcess;
    });

    const sandbox = new DockerSandbox(spawnFn as unknown as DockerSpawn);
    const result = await sandbox.execute({
      code: "return 1",
      sdkSource: "",
      toolCallHandler: async () => null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Docker sandbox provider is unavailable. Install Docker Desktop or set KEPPO_CODE_MODE_SANDBOX_PROVIDER=vercel.",
    );
    expect(result.failure).toEqual({
      type: "execution_failed",
      errorCode: "sandbox_unavailable",
      reason: "Docker sandbox provider is unavailable.",
    });
  });

  it("rejects bridge response paths that escape the workspace", async () => {
    const spawnFn = vi.fn((_: string, args: ReadonlyArray<string>) => {
      // Handle the `docker image inspect` call from resolveDockerImageRef.
      if (args[0] === "image" && args[1] === "inspect") {
        const child = new FakeChildProcess();
        queueMicrotask(() => {
          child.stdout.write("sha256:local-node-image\n");
          child.stdout.end();
          child.stderr.end();
          child.emit("close", 0, null);
        });
        return child as unknown as DockerChildProcess;
      }

      const volumeArgIndex = args.findIndex((entry) => entry === "--volume");
      const volumeArg = volumeArgIndex >= 0 ? (args[volumeArgIndex + 1] ?? "") : "";
      const hostWorkspace = volumeArg.split(":")[0] ?? "";
      expect(hostWorkspace.length).toBeGreaterThan(0);

      const child = new FakeChildProcess();

      // When kill() is called by the fail-closed handler, emit close so
      // the execute() promise settles — this validates the full end-to-end
      // fail-closed path rather than relying on an independent timer.
      child.kill.mockImplementation(() => {
        queueMicrotask(() => {
          child.stdout.end();
          child.stderr.end();
          child.emit("close", 137, "SIGKILL");
        });
        return true;
      });

      // Use queueMicrotask so the async stdout handler has time to process
      // the bridge request and set requestHandlingError before close fires.
      queueMicrotask(() => {
        child.stdout.write(
          `${REQUEST_PREFIX}${JSON.stringify({
            requestId: "req_escape",
            responsePath: "/workspace/../../tmp/evil.json",
            kind: "tool",
            toolName: "gmail.sendEmail",
            input: { to: "will@example.com" },
          })}\n`,
        );
      });

      return child as unknown as DockerChildProcess;
    });

    const sandbox = new DockerSandbox(spawnFn as unknown as DockerSpawn);
    const result = await sandbox.execute({
      code: 'await gmail.sendEmail({ to: "will@example.com" });',
      sdkSource:
        "globalThis.gmail = { sendEmail(args){ return __keppo_call_tool('gmail.sendEmail', args); } };",
      toolCallHandler: async () => ({ id: "msg_1" }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Bridge requested path outside workspace: /workspace/../../tmp/evil.json",
    );
    // Verify the container was killed as part of fail-closed behavior
    const runChild = spawnFn.mock.results.find(
      (r, i) => spawnFn.mock.calls[i]?.[1]?.[0] !== "image",
    );
    expect(runChild?.value.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
