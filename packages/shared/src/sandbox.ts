export interface SandboxConfig {
  runner_command: string;
  env: Record<string, string>;
  network_access: "mcp_only" | "mcp_and_web";
  timeout_ms: number;
  log_callback_url: string;
  complete_callback_url: string;
}

export interface SandboxDispatchResult {
  sandbox_id: string;
}

export interface SandboxProvider {
  dispatch(config: SandboxConfig): Promise<SandboxDispatchResult>;
  terminate(sandbox_id: string): Promise<void>;
}
