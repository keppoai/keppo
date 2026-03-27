import type { ProviderSchemasFacet } from "../../registry/types.js";
import { buildSchemasFacetFromTools, getProviderToolDefinitions } from "../shared.js";

const ownedTools = getProviderToolDefinitions("stripe");

export const schemas: ProviderSchemasFacet = buildSchemasFacetFromTools(ownedTools);
