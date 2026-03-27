import type { ToolDefinition } from "../../tool-definitions.js";
import type { ProviderModuleV2, ProviderSchemasFacet } from "./types.js";

export const buildProviderSchemasFacet = (tools: Array<ToolDefinition>): ProviderSchemasFacet => {
  return {
    toolInputSchemas: Object.fromEntries(
      tools.map((tool) => [tool.name, tool.input_schema]),
    ) as ProviderSchemasFacet["toolInputSchemas"],
  };
};

export const createProviderModuleV2 = <TModule extends ProviderModuleV2>(
  module: TModule,
): TModule => {
  return module;
};
