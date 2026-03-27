import { makeFunctionReference } from "convex/server";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";

export type CustomServerSummary = {
  id: string;
  org_id: string;
  slug: string;
  display_name: string;
  url: string;
  status: "connected" | "disconnected" | "error";
  last_discovery_at: string | null;
  last_discovery_error: string | null;
  tool_count: number;
  has_bearer_token: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type CustomServerTool = {
  id: string;
  server_id: string;
  org_id: string;
  tool_name: string;
  remote_tool_name: string;
  description: string;
  input_schema_json: string;
  risk_level: "low" | "medium" | "high" | "critical";
  requires_approval: boolean;
  enabled: boolean;
  discovered_at: string;
};

export type WorkspaceCustomServer = {
  server: CustomServerSummary;
  enabled: boolean;
};

export const useCustomServers = () => {
  const runtime = useDashboardRuntime();
  const servers = runtime.useQuery(makeFunctionReference<"query">("custom_mcp:listServers"), {}) as
    | CustomServerSummary[]
    | undefined;
  return servers ?? [];
};

export const useCustomServer = (serverId: string | null) => {
  const runtime = useDashboardRuntime();
  return runtime.useQuery(
    makeFunctionReference<"query">("custom_mcp:getServer"),
    serverId ? { serverId } : "skip",
  ) as CustomServerSummary | null | undefined;
};

export const useCustomServerTools = (serverId: string | null) => {
  const runtime = useDashboardRuntime();
  return runtime.useQuery(
    makeFunctionReference<"query">("custom_mcp:listServerTools"),
    serverId ? { serverId } : "skip",
  ) as CustomServerTool[] | undefined;
};

export const useWorkspaceCustomServers = (workspaceId: string | null) => {
  const runtime = useDashboardRuntime();
  return runtime.useQuery(
    makeFunctionReference<"query">("custom_mcp:listWorkspaceServers"),
    workspaceId ? { workspaceId } : "skip",
  ) as WorkspaceCustomServer[] | undefined;
};

export const useCustomMcpMutations = () => {
  const runtime = useDashboardRuntime();
  const registerServer = runtime.useMutation(
    makeFunctionReference<"mutation">("custom_mcp:registerServer"),
  );
  const updateServer = runtime.useMutation(
    makeFunctionReference<"mutation">("custom_mcp:updateServer"),
  );
  const deleteServer = runtime.useMutation(
    makeFunctionReference<"mutation">("custom_mcp:deleteServer"),
  );
  const triggerDiscovery = runtime.useMutation(
    makeFunctionReference<"mutation">("custom_mcp:triggerDiscovery"),
  );
  const updateToolConfig = runtime.useMutation(
    makeFunctionReference<"mutation">("custom_mcp:updateToolConfig"),
  );
  const bulkUpdateToolConfig = runtime.useMutation(
    makeFunctionReference<"mutation">("custom_mcp:bulkUpdateToolConfig"),
  );
  const setWorkspaceServerEnabled = runtime.useMutation(
    makeFunctionReference<"mutation">("custom_mcp:setWorkspaceServerEnabled"),
  );

  return {
    registerServer,
    updateServer,
    deleteServer,
    triggerDiscovery,
    updateToolConfig,
    bulkUpdateToolConfig,
    setWorkspaceServerEnabled,
  };
};
