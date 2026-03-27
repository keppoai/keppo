import type { SandboxProvider } from "../sandbox.js";

export const defaultSandboxProvider: SandboxProvider = {
  async dispatch(_config) {
    throw new Error("Sandbox dispatch is not available in the OSS default provider.");
  },
  async terminate(_sandboxId: string): Promise<void> {},
};
