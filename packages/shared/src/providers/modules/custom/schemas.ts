import type { ProviderSchemasFacet } from "../../registry/types.js";
import { buildSchemasFacetFromTools, getProviderToolDefinitions } from "../shared.js";

const ownedTools = getProviderToolDefinitions("custom");

export const schemas: ProviderSchemasFacet = buildSchemasFacetFromTools(ownedTools);
