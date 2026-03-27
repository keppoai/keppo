import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { allTools } from "../packages/shared/src/tool-definitions.js";
import {
  CANONICAL_PROVIDER_IDS,
  type CanonicalProviderId,
} from "../packages/shared/src/provider-ids.js";
import { zodToJsonSchema } from "../packages/shared/src/code-mode/sdk-generator.js";
import { parseJsonRecord } from "../packages/shared/src/providers/boundaries/json.js";
import { TOOL_CAPABILITIES, type ToolCapability } from "./domain_constants";
import { jsonRecordValidator } from "./validators";

const EMBEDDING_DIMENSIONS = 64;
const canonicalProviderSet = new Set<string>(CANONICAL_PROVIDER_IDS);
const toolCapabilitySet = new Set<string>(TOOL_CAPABILITIES);

const normalizeProviderFilter = (
  value: string | undefined,
): { valid: boolean; value?: CanonicalProviderId } => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return { valid: true };
  }
  if (!canonicalProviderSet.has(trimmed)) {
    return { valid: false };
  }
  return { valid: true, value: trimmed as CanonicalProviderId };
};

const normalizeCapabilityFilter = (
  value: string | undefined,
): { valid: boolean; value?: ToolCapability } => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return { valid: true };
  }
  if (!toolCapabilitySet.has(trimmed)) {
    return { valid: false };
  }
  return { valid: true, value: trimmed as ToolCapability };
};

const normalizeText = (value: string): string => value.trim().toLowerCase();

const toEmbedding = (value: string): number[] => {
  const vector: number[] = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  const normalized = normalizeText(value);

  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    const bucket = (code + index * 17) % EMBEDDING_DIMENSIONS;
    vector[bucket] = (vector[bucket] ?? 0) + 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, entry) => sum + entry * entry, 0));
  if (magnitude <= 0) {
    return vector;
  }
  return vector.map((entry) => entry / magnitude);
};

const cosineSimilarity = (left: number[], right: number[]): number => {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  for (let index = 0; index < length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return dot;
};

const parseInputSchema = (json: string): Record<string, unknown> => {
  try {
    return parseJsonRecord(json);
  } catch {
    return {};
  }
};

const buildTypeStub = (toolName: string, description: string, inputSchemaJson: string): string => {
  const inputSchema = parseInputSchema(inputSchemaJson);
  const properties =
    inputSchema && typeof inputSchema.properties === "object" && inputSchema.properties !== null
      ? (inputSchema.properties as Record<string, unknown>)
      : {};
  return `${toolName}(${Object.keys(properties).join(", ")}): ${description}`;
};

const upsertToolIndex = async (ctx: MutationCtx) => {
  const existingRows = await ctx.db.query("code_mode_tool_index").collect();
  const byToolName = new Map(existingRows.map((row) => [row.tool_name, row]));

  let inserted = 0;
  let updated = 0;

  for (const tool of allTools) {
    if (tool.provider === "keppo") {
      continue;
    }

    const schemaJson = JSON.stringify(zodToJsonSchema(tool.input_schema));
    const description = tool.description;
    const embedding = toEmbedding(`${tool.name} ${description} ${tool.action_type}`);

    const existing = byToolName.get(tool.name);
    if (!existing) {
      await ctx.db.insert("code_mode_tool_index", {
        tool_name: tool.name,
        provider: tool.provider,
        capability: tool.capability,
        risk_level: tool.risk_level,
        requires_approval: tool.requires_approval,
        description,
        action_type: tool.action_type,
        input_schema_json: schemaJson,
        embedding,
      });
      inserted += 1;
      continue;
    }

    const hasChanged =
      existing.description !== description ||
      existing.provider !== tool.provider ||
      existing.capability !== tool.capability ||
      existing.risk_level !== tool.risk_level ||
      existing.requires_approval !== tool.requires_approval ||
      existing.action_type !== tool.action_type ||
      existing.input_schema_json !== schemaJson;

    if (!hasChanged) {
      continue;
    }

    await ctx.db.patch(existing._id, {
      provider: tool.provider,
      capability: tool.capability,
      risk_level: tool.risk_level,
      requires_approval: tool.requires_approval,
      description,
      action_type: tool.action_type,
      input_schema_json: schemaJson,
      embedding,
    });
    updated += 1;
  }

  return {
    inserted,
    updated,
    total: inserted + updated,
  };
};

export const seedToolIndex = mutation({
  args: {},
  returns: v.object({
    inserted: v.number(),
    updated: v.number(),
    total: v.number(),
  }),
  handler: async (ctx) => {
    return upsertToolIndex(ctx);
  },
});

export const searchTools = query({
  args: {
    query: v.string(),
    provider: v.optional(v.string()),
    capability: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      name: v.string(),
      provider: v.string(),
      capability: v.string(),
      risk_level: v.string(),
      requires_approval: v.boolean(),
      description: v.string(),
      action_type: v.string(),
      input_schema: jsonRecordValidator,
      type_stub: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const trimmedQuery = args.query.trim();
    const normalizedQuery = normalizeText(trimmedQuery);
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 10)));

    const allRows = await ctx.db.query("code_mode_tool_index").collect();

    const providerFilter = normalizeProviderFilter(args.provider);
    const capabilityFilter = normalizeCapabilityFilter(args.capability);
    if (!providerFilter.valid || !capabilityFilter.valid) {
      return [];
    }

    const filteredRows = allRows.filter((row) => {
      if (providerFilter.value && row.provider !== providerFilter.value) {
        return false;
      }
      if (capabilityFilter.value && row.capability !== capabilityFilter.value) {
        return false;
      }
      return true;
    });

    const ftsRows =
      normalizedQuery.length === 0
        ? []
        : await ctx.db
            .query("code_mode_tool_index")
            .withSearchIndex("search_description", (search) => {
              let cursor = search.search("description", trimmedQuery);
              if (providerFilter.value) {
                cursor = cursor.eq("provider", providerFilter.value);
              }
              if (capabilityFilter.value) {
                cursor = cursor.eq("capability", capabilityFilter.value);
              }
              return cursor;
            })
            .take(Math.max(limit * 2, 20));

    const rankByTool = new Map<string, number>();
    for (const [index, row] of ftsRows.entries()) {
      rankByTool.set(row.tool_name, Math.max(0.05, 1 - index / Math.max(ftsRows.length, 1)));
    }

    const queryEmbedding = toEmbedding(normalizedQuery);
    return filteredRows
      .map((row) => {
        const vectorScore =
          normalizedQuery.length === 0 ? 0 : cosineSimilarity(queryEmbedding, row.embedding);
        const ftsScore = rankByTool.get(row.tool_name) ?? 0;
        const lexicalScore =
          normalizedQuery.length === 0
            ? 0
            : normalizeText(`${row.tool_name} ${row.description}`).includes(normalizedQuery)
              ? 0.25
              : 0;

        return {
          row,
          score: ftsScore * 0.6 + vectorScore * 0.3 + lexicalScore,
        };
      })
      .sort((left, right) => {
        return right.score - left.score || left.row.tool_name.localeCompare(right.row.tool_name);
      })
      .slice(0, limit)
      .map(({ row }) => ({
        name: row.tool_name,
        provider: row.provider,
        capability: row.capability,
        risk_level: row.risk_level,
        requires_approval: row.requires_approval,
        description: row.description,
        action_type: row.action_type,
        input_schema: parseInputSchema(row.input_schema_json),
        type_stub: buildTypeStub(row.tool_name, row.description, row.input_schema_json),
      }));
  },
});
