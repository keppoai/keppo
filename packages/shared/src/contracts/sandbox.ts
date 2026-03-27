import type { SandboxConfig, SandboxDispatchResult } from "../sandbox.js";

export type { SandboxConfig, SandboxDispatchResult };

export interface SandboxProvider {
  dispatch(config: SandboxConfig): Promise<SandboxDispatchResult>;
  terminate(sandboxId: string): Promise<void>;
}
