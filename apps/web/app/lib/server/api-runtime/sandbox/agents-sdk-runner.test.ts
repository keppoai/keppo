import { describe, expect, it } from "vitest";
import {
  buildAutomationRunTraceId,
  buildSandboxRunnerContract,
  resolveSandboxRunnerEntrypointPath,
} from "./agents-sdk-runner.js";

describe("agents-sdk-runner", () => {
  it("resolves provider-specific entrypoint paths inside the managed runner directory", () => {
    expect(resolveSandboxRunnerEntrypointPath("docker")).toBe(
      "/sandbox/.keppo-automation-runner/keppo-automation-runner.mjs",
    );
    expect(resolveSandboxRunnerEntrypointPath("vercel")).toBe(
      "/vercel/sandbox/.keppo-automation-runner/keppo-automation-runner.mjs",
    );
  });

  it("builds an explicit runner contract with a pinned Agents SDK dependency", () => {
    const contract = buildSandboxRunnerContract("docker");

    expect(contract.install_packages).toEqual(["@openai/agents@0.8.2"]);
    expect(contract.entrypoint_path).toBe(
      "/sandbox/.keppo-automation-runner/keppo-automation-runner.mjs",
    );
    expect(contract.source_text).toContain('from "@openai/agents"');
    expect(contract.source_text).toContain("new Agent({");
    expect(contract.source_text).toContain("new MCPServerStreamableHttp({");
    expect(contract.source_text).toContain("new OpenAIProvider({");
    expect(contract.source_text).toContain("KEPPO_TRACE_CALLBACK_URL");
  });

  it("derives deterministic OpenAI trace ids from automation run ids", () => {
    expect(buildAutomationRunTraceId("arun_test")).toBe(buildAutomationRunTraceId("arun_test"));
    expect(buildAutomationRunTraceId("arun_test")).not.toBe(buildAutomationRunTraceId("arun_2"));
    expect(buildAutomationRunTraceId("arun_test")).toMatch(/^[0-9a-f]{32}$/u);
  });
});
