import { describe, expect, it } from "vitest";
import {
  buildAutomationTraceGroupId,
  buildAutomationRunTraceId,
  buildSandboxRunnerContract,
  resolveSandboxRunnerEntrypointPath,
} from "./agents-sdk-runner.js";

describe("agents-sdk-runner", () => {
  it("resolves provider-specific entrypoint paths inside the managed runner directory", () => {
    expect(resolveSandboxRunnerEntrypointPath("docker")).toBe(
      "/sandbox/.keppo-automation-runner/keppo-automation-runner.mjs",
    );
    expect(resolveSandboxRunnerEntrypointPath("fly")).toBe(
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
    expect(contract.source_text).toContain("traceIncludeSensitiveData: false");
    expect(contract.source_text).toContain("const LOG_BATCH_SIZE = 10;");
    expect(contract.source_text).toContain("Automation reached the maximum turn budget");
  });

  it("derives deterministic OpenAI trace ids from automation run ids", () => {
    expect(buildAutomationRunTraceId("arun_test")).toBe(buildAutomationRunTraceId("arun_test"));
    expect(buildAutomationRunTraceId("arun_test")).not.toBe(buildAutomationRunTraceId("arun_2"));
    expect(buildAutomationRunTraceId("arun_test")).toMatch(/^[0-9a-f]{32}$/u);
  });

  it("derives stable hashed trace group ids from automation ids", () => {
    expect(buildAutomationTraceGroupId("automation_test")).toBe(
      buildAutomationTraceGroupId("automation_test"),
    );
    expect(buildAutomationTraceGroupId("automation_test")).not.toBe(
      buildAutomationTraceGroupId("automation_other"),
    );
    expect(buildAutomationTraceGroupId("automation_test")).toMatch(/^automation:[0-9a-f]{16}$/u);
  });
});
