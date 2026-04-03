import type { NetworkAccessMode } from "@keppo/shared/automations";

export type SandboxBootstrapNetworkPolicy = "package_registry_only";

export interface SandboxStageConfig {
  command: string;
  env: Record<string, string>;
}

export interface SandboxRunnerConfig {
  entrypoint_path: string;
  install_packages: string[];
  source_text: string;
}

export interface SandboxRuntimeCallbacks {
  log_url: string;
  complete_url: string;
  trace_url: string;
}

export interface SandboxConfig {
  bootstrap: SandboxStageConfig & {
    network_access: SandboxBootstrapNetworkPolicy;
  };
  runtime: SandboxStageConfig & {
    bootstrap_command?: string;
    network_access: NetworkAccessMode;
    callbacks: SandboxRuntimeCallbacks;
    runner: SandboxRunnerConfig;
  };
  timeout_ms: number;
}

export interface SandboxDispatchResult {
  sandbox_id: string;
}

export interface SandboxProvider {
  dispatch(config: SandboxConfig): Promise<SandboxDispatchResult>;
  terminate(sandbox_id: string): Promise<void>;
}
