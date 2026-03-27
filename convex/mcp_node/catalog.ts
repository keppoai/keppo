"use node";

import { type FunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { allTools, CODE_MODE_TOOLS, createWorkerExecutionError } from "../mcp_node_shared";
import { safeParsePayload, safeRunQuery, validationMessage } from "../safe_convex";

type AnyInternalQueryReference = FunctionReference<"query", "internal">;

type CatalogTool = {
  name: string;
  description: string;
};

type CatalogActionDeps = {
  getWorkspaceCodeModeContextRef: AnyInternalQueryReference;
  listCustomToolsForWorkspaceRef: AnyInternalQueryReference;
};

const parseCustomTools = (workspaceId: string, customToolsRaw: unknown): CatalogTool[] =>
  safeParsePayload("mcp_node.listCustomToolsForWorkspace", () => {
    if (!Array.isArray(customToolsRaw)) {
      throw createWorkerExecutionError(
        "execution_failed",
        validationMessage(
          "mcp_node.listCustomToolsForWorkspace",
          `Custom tools payload for workspace ${workspaceId} failed validation.`,
        ),
      );
    }
    return customToolsRaw.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }
      const candidate = entry as {
        name?: unknown;
        description?: unknown;
      };
      if (typeof candidate.name !== "string" || typeof candidate.description !== "string") {
        return [];
      }
      return [
        {
          name: candidate.name,
          description: candidate.description,
        },
      ];
    });
  });

export const createCatalogActions = (deps: CatalogActionDeps) => ({
  listToolCatalog: internalAction({
    args: {},
    returns: v.array(
      v.object({
        name: v.string(),
        description: v.string(),
      }),
    ),
    handler: async () => {
      return allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      }));
    },
  }),

  listToolCatalogForWorkspace: internalAction({
    args: {
      workspaceId: v.string(),
    },
    returns: v.array(
      v.object({
        name: v.string(),
        description: v.string(),
      }),
    ),
    handler: async (ctx, args) => {
      const workspaceContext = await safeRunQuery("mcp_node.getWorkspaceCodeModeContext", () =>
        ctx.runQuery(deps.getWorkspaceCodeModeContextRef, {
          workspaceId: args.workspaceId,
        }),
      );

      const workspace =
        workspaceContext && typeof workspaceContext === "object" && !Array.isArray(workspaceContext)
          ? (workspaceContext as { workspace?: { code_mode_enabled?: boolean | null } }).workspace
          : undefined;

      const customToolsRaw = await safeRunQuery("mcp_node.listCustomToolsForWorkspace", () =>
        ctx.runQuery(deps.listCustomToolsForWorkspaceRef, {
          workspaceId: args.workspaceId,
        }),
      );
      const customTools = parseCustomTools(args.workspaceId, customToolsRaw);

      const baseTools = (workspace?.code_mode_enabled ?? true) ? CODE_MODE_TOOLS : allTools;
      const merged = [
        ...baseTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
        ...customTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
      ];

      const deduped = new Map<string, { name: string; description: string }>();
      for (const tool of merged) {
        if (!deduped.has(tool.name)) {
          deduped.set(tool.name, tool);
        }
      }
      return [...deduped.values()];
    },
  }),
});
