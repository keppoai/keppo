import type { ProviderSchemasFacet } from "../../registry/types.js";
import { buildSchemasFacetFromTools, getProviderToolDefinitions } from "../shared.js";

const ownedTools = getProviderToolDefinitions("slack");

export const schemas: ProviderSchemasFacet = buildSchemasFacetFromTools(ownedTools);
