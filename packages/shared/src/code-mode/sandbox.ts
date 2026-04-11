import { DockerSandbox } from "./sandbox-docker.js";

import type { CodeModeStructuredExecutionErrorPayload } from "./structured-execution-error.js";

export type SandboxToolCall = {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
};

export type SandboxExecutionFailure = Pick<
  CodeModeStructuredExecutionErrorPayload,
  "type" | "errorCode" | "reason"
>;

export interface SandboxExecutionResult {
  success: boolean;
  output: unknown;
  error?: string;
  failure?: SandboxExecutionFailure;
  toolCallsExecuted: Array<SandboxToolCall>;
  durationMs: number;
}

export interface SandboxProvider {
  execute(params: {
    code: string;
    sdkSource: string;
    toolCallHandler: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
    searchToolsHandler?: (query: string, options?: Record<string, unknown>) => Promise<unknown>;
    timeoutMs?: number;
  }): Promise<SandboxExecutionResult>;
}

export type SandboxMode = "docker" | "vercel" | "unikraft" | "jslite";

const isLocalDevRuntime = (): boolean => {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();
  const e2eMode = process.env.KEPPO_E2E_MODE?.toLowerCase();
  return nodeEnv === "development" || nodeEnv === "test" || e2eMode === "true";
};

export const createSandboxProvider = async (mode: SandboxMode): Promise<SandboxProvider> => {
  if (mode === "docker" && !isLocalDevRuntime()) {
    throw new Error(
      "Docker sandbox provider is not allowed in production. Set KEPPO_CODE_MODE_SANDBOX_PROVIDER=vercel or unikraft for non-local deployments.",
    );
  }
  if (mode === "jslite" && !isLocalDevRuntime()) {
    throw new Error(
      "JSLite sandbox provider is not allowed in production. See JSLITE_BLOCKERS.md and use KEPPO_CODE_MODE_SANDBOX_PROVIDER=vercel or unikraft for non-local deployments.",
    );
  }
  if (mode === "vercel") {
    const { VercelSandbox } = await import("./sandbox-vercel.js");
    return new VercelSandbox();
  }
  if (mode === "unikraft") {
    const { UnikraftSandbox } = await import("./sandbox-unikraft.js");
    const { UnikraftCloudClient } = await import("../unikraft/client.js");
    const metro = process.env["UNIKRAFT_METRO"]?.trim();
    const token = process.env["UNIKRAFT_API_TOKEN"]?.trim();
    if (!metro || !token) {
      throw new Error("Unikraft sandbox provider requires UNIKRAFT_API_TOKEN and UNIKRAFT_METRO.");
    }
    return new UnikraftSandbox(new UnikraftCloudClient({ token, metro }));
  }
  if (mode === "jslite") {
    const { JsliteSandbox } = await import("./sandbox-jslite.js");
    return new JsliteSandbox();
  }
  return new DockerSandbox();
};
