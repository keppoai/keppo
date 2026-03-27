import type { ProviderDeprecation } from "../../provider-deprecations.js";
import { providerDeprecations } from "../../provider-deprecations.js";
import { allTools, toolMap, type ToolDefinition } from "../../tool-definitions.js";
import type { Connector, ConnectorContext, PreparedWrite } from "../../connectors/base.js";
import type { CanonicalProviderId, ProviderExecuteToolRequest } from "../../providers.js";
import type { ProviderSchemasFacet, ProviderToolsFacet } from "../registry/types.js";

export const PROVIDER_MODULE_SCHEMA_VERSION = 1 as const;

const CONNECTOR_TOOLS_CONTEXT: ConnectorContext = {
  workspaceId: "module-registry",
  orgId: "module-registry",
  scopes: [],
};

const executeToolWithConnector = async (
  connector: Connector,
  request: ProviderExecuteToolRequest,
): Promise<Record<string, unknown> | PreparedWrite> => {
  const tool = toolMap.get(request.toolName);
  if (!tool) {
    throw new Error(`Unknown provider tool "${request.toolName}".`);
  }

  if (request.mode === "read") {
    if (tool.capability !== "read") {
      throw new Error(`Tool "${request.toolName}" is not a read capability.`);
    }
    return connector.executeRead(request.toolName, request.input, request.context);
  }

  if (request.mode === "prepare_write") {
    if (tool.capability !== "write") {
      throw new Error(`Tool "${request.toolName}" is not a write capability.`);
    }
    return connector.prepareWrite(request.toolName, request.input, request.context);
  }

  if (tool.capability !== "write") {
    throw new Error(`Tool "${request.toolName}" is not a write capability.`);
  }
  return connector.executeWrite(request.toolName, request.input, request.context);
};

export const createConnectorToolsFacet = (
  providerId: CanonicalProviderId,
  connector: Connector,
): ProviderToolsFacet => {
  return {
    tools: connector.listTools(CONNECTOR_TOOLS_CONTEXT),
    executeTool: (request) => executeToolWithConnector(connector, request),
    healthcheck: async (context) => {
      const totalTools = connector.listTools(context).length;
      return {
        ok: totalTools > 0,
        detail: `${providerId} module loaded with ${String(totalTools)} tool(s).`,
      };
    },
  };
};

export const listProviderToolOwnership = (providerId: CanonicalProviderId): Array<string> => {
  return allTools.filter((tool) => tool.provider === providerId).map((tool) => tool.name);
};

export const getProviderToolDefinitions = (
  providerId: CanonicalProviderId,
): Array<ToolDefinition> => {
  return listProviderToolOwnership(providerId).map((toolName) => {
    const tool = toolMap.get(toolName);
    if (!tool) {
      throw new Error(`Provider "${providerId}" owns unknown tool "${toolName}".`);
    }
    return tool;
  });
};

export const buildSchemasFacetFromTools = (tools: Array<ToolDefinition>): ProviderSchemasFacet => {
  return {
    toolInputSchemas: Object.fromEntries(
      tools.map((tool) => [tool.name, tool.input_schema]),
    ) as ProviderSchemasFacet["toolInputSchemas"],
  };
};

const getProviderDeprecation = (
  providerId: CanonicalProviderId,
): ProviderDeprecation | undefined => {
  return providerDeprecations[providerId];
};

export const withProviderDeprecation = (
  providerId: CanonicalProviderId,
): { deprecation: ProviderDeprecation } | Record<string, never> => {
  const deprecation = getProviderDeprecation(providerId);
  if (!deprecation) {
    return {};
  }
  return { deprecation };
};
