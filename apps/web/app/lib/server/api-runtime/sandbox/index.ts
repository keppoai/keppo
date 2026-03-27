import type { SandboxProvider } from "./types.js";
import { DockerSandboxProvider } from "./docker.js";
import { UnikraftSandboxProvider } from "./unikraft.js";
import { VercelSandboxProvider } from "../../../../../../../cloud/api/sandbox/vercel.js";
import { getEnv } from "../env.js";

export type AutomationSandboxProviderMode = "docker" | "vercel" | "unikraft";

export const resolveAutomationSandboxProviderMode = (): AutomationSandboxProviderMode => {
  return getEnv().KEPPO_SANDBOX_PROVIDER;
};

const isLocalDevEnvironment = (): boolean => {
  const env = getEnv();
  const nodeEnv = env.NODE_ENV?.toLowerCase();
  return nodeEnv === "development" || nodeEnv === "test" || env.KEPPO_E2E_MODE === true;
};

export const createAutomationSandboxProvider = (
  mode: AutomationSandboxProviderMode = resolveAutomationSandboxProviderMode(),
): SandboxProvider => {
  if (mode === "docker" && !isLocalDevEnvironment()) {
    throw new Error(
      "Docker sandbox provider is not allowed in production. Set KEPPO_SANDBOX_PROVIDER=vercel or unikraft for non-local deployments.",
    );
  }
  if (mode === "vercel") {
    return new VercelSandboxProvider();
  }
  if (mode === "unikraft") {
    return new UnikraftSandboxProvider();
  }
  return new DockerSandboxProvider();
};
