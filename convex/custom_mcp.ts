import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { nowIso, randomIdFor, requireOrgMember, requireWorkspaceRole } from "./_auth";
import { decryptSecretValue, encryptSecretValue, isEncryptedValue } from "./crypto_helpers";
import {
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  CUSTOM_MCP_SERVER_STATUS,
  USER_ROLE,
  type CustomMcpServerStatus,
} from "./domain_constants";
import { actionRiskValidator, customMcpServerStatusValidator } from "./validators";
import { CANONICAL_PROVIDER_IDS } from "../packages/shared/src/provider-ids.js";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const KEY_VERSION = "convex_first_v1";
const CUSTOM_MCP_DISCOVERY_TOOL_LIMIT = 200;
const refs = {
  discoverTools: makeFunctionReference<"action">("custom_mcp_node:discoverTools"),
};

const reservedSlugSet = new Set<string>([...CANONICAL_PROVIDER_IDS, "keppo"]);

const customMcpServerPublicValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  slug: v.string(),
  display_name: v.string(),
  url: v.string(),
  status: customMcpServerStatusValidator,
  last_discovery_at: v.union(v.string(), v.null()),
  last_discovery_error: v.union(v.string(), v.null()),
  tool_count: v.number(),
  has_bearer_token: v.boolean(),
  created_by: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
});

const customMcpToolValidator = v.object({
  id: v.string(),
  server_id: v.string(),
  org_id: v.string(),
  tool_name: v.string(),
  remote_tool_name: v.string(),
  description: v.string(),
  input_schema_json: v.string(),
  risk_level: actionRiskValidator,
  requires_approval: v.boolean(),
  enabled: v.boolean(),
  discovered_at: v.string(),
});

const workspaceCustomServerValidator = v.object({
  id: v.string(),
  workspace_id: v.string(),
  server_id: v.string(),
  enabled: v.boolean(),
  created_by: v.string(),
  created_at: v.string(),
});

const listToolCatalogItemValidator = v.object({
  name: v.string(),
  description: v.string(),
  input_schema_json: v.string(),
});

const discoveryToolValidator = v.object({
  remote_tool_name: v.string(),
  description: v.string(),
  input_schema_json: v.string(),
});

const blockedCustomMcpHostnames = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.google.internal.",
]);

const toServerPublic = (server: {
  id: string;
  org_id: string;
  slug: string;
  display_name: string;
  url: string;
  bearer_token_enc: string | null;
  status: CustomMcpServerStatus;
  last_discovery_at: string | null;
  last_discovery_error: string | null;
  tool_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}) => ({
  id: server.id,
  org_id: server.org_id,
  slug: server.slug,
  display_name: server.display_name,
  url: server.url,
  status: server.status,
  last_discovery_at: server.last_discovery_at,
  last_discovery_error: server.last_discovery_error,
  tool_count: server.tool_count,
  has_bearer_token:
    typeof server.bearer_token_enc === "string" && server.bearer_token_enc.length > 0,
  created_by: server.created_by,
  created_at: server.created_at,
  updated_at: server.updated_at,
});

const toToolPublic = (tool: {
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
}) => ({
  id: tool.id,
  server_id: tool.server_id,
  org_id: tool.org_id,
  tool_name: tool.tool_name,
  remote_tool_name: tool.remote_tool_name,
  description: tool.description,
  input_schema_json: tool.input_schema_json,
  risk_level: tool.risk_level,
  requires_approval: tool.requires_approval,
  enabled: tool.enabled,
  discovered_at: tool.discovered_at,
});

const toIPv4Octets = (value: string): number[] | null => {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const parsed = Number.parseInt(part, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
      return null;
    }
    octets.push(parsed);
  }
  return octets;
};

const isLoopbackHost = (hostname: string): boolean => {
  if (hostname === "localhost" || hostname === "::1") {
    return true;
  }
  const octets = toIPv4Octets(hostname);
  return octets !== null && octets[0] === 127;
};

const isBlockedIPv4Host = (hostname: string): boolean => {
  const octets = toIPv4Octets(hostname);
  if (!octets) {
    return false;
  }
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  return a >= 224;
};

const isBlockedIPv6Host = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  return false;
};

const parseAndNormalizeServerUrl = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("custom_mcp.invalid_url: URL is required.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("custom_mcp.invalid_url: URL must be valid.");
  }
  const hostname = parsed.hostname.trim().toLowerCase();
  const loopbackHost = isLoopbackHost(hostname);
  const allowInsecureLocalHttp =
    process.env.KEPPO_ALLOW_INSECURE_CUSTOM_MCP_HTTP === "true" ||
    process.env.KEPPO_E2E_MODE === "true";
  if (parsed.protocol === "http:") {
    if (!allowInsecureLocalHttp || !loopbackHost) {
      throw new Error(
        "custom_mcp.invalid_url: URL must use https. Local http is only allowed in e2e/insecure-local mode.",
      );
    }
  } else if (parsed.protocol !== "https:") {
    throw new Error("custom_mcp.invalid_url: URL must use https.");
  }
  if (blockedCustomMcpHostnames.has(hostname)) {
    throw new Error("custom_mcp.invalid_url: Hostname is blocked.");
  }
  if (!allowInsecureLocalHttp && loopbackHost) {
    throw new Error("custom_mcp.invalid_url: Loopback hosts are blocked.");
  }
  if (isBlockedIPv4Host(hostname) || isBlockedIPv6Host(hostname)) {
    if (!allowInsecureLocalHttp || !loopbackHost) {
      throw new Error(
        "custom_mcp.invalid_url: Private, loopback, and link-local hosts are blocked.",
      );
    }
  }
  return parsed.toString();
};

const validateSlug = (slug: string): string => {
  const normalized = slug.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 40) {
    throw new Error("custom_mcp.invalid_slug: Slug must be 3-40 characters.");
  }
  if (!SLUG_PATTERN.test(normalized)) {
    throw new Error("custom_mcp.invalid_slug: Slug must match /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.");
  }
  if (reservedSlugSet.has(normalized)) {
    throw new Error("custom_mcp.invalid_slug: Slug collides with a reserved provider id.");
  }
  return normalized;
};

const normalizeDisplayName = (displayName: string): string => {
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new Error("custom_mcp.invalid_display_name: Display name is required.");
  }
  return trimmed;
};

const normalizeBearerToken = (token: string | undefined): string | null => {
  if (token === undefined) {
    return null;
  }
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const encryptBearerToken = async (token: string | null): Promise<string | null> => {
  if (token === null) {
    return null;
  }
  return await encryptSecretValue(token, "sensitive_blob");
};

const decryptBearerToken = async (token: string | null): Promise<string | null> => {
  if (token === null) {
    return null;
  }
  return await decryptSecretValue(token, "sensitive_blob");
};

type DbCtx = MutationCtx | QueryCtx;

const loadServerById = async (ctx: DbCtx, serverId: string) => {
  return await ctx.db
    .query("custom_mcp_servers")
    .withIndex("by_custom_id", (q) => q.eq("id", serverId))
    .unique();
};

const loadWorkspaceById = async (ctx: DbCtx, workspaceId: string) => {
  return await ctx.db
    .query("workspaces")
    .withIndex("by_custom_id", (q) => q.eq("id", workspaceId))
    .unique();
};

export const registerServer = mutation({
  args: {
    url: v.string(),
    display_name: v.string(),
    slug: v.string(),
    bearer_token: v.optional(v.string()),
  },
  returns: v.object({ id: v.string() }),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [USER_ROLE.owner, USER_ROLE.admin]);

    const normalizedUrl = parseAndNormalizeServerUrl(args.url);
    const slug = validateSlug(args.slug);
    const displayName = normalizeDisplayName(args.display_name);
    const bearerToken = normalizeBearerToken(args.bearer_token);
    const encryptedBearerToken = await encryptBearerToken(bearerToken);

    const existing = await ctx.db
      .query("custom_mcp_servers")
      .withIndex("by_org_slug", (q) => q.eq("org_id", auth.orgId).eq("slug", slug))
      .unique();
    if (existing) {
      throw new Error("custom_mcp.slug_conflict: This slug already exists in the organization.");
    }

    const now = nowIso();
    const id = randomIdFor("cmcp");

    await ctx.db.insert("custom_mcp_servers", {
      id,
      org_id: auth.orgId,
      slug,
      display_name: displayName,
      url: normalizedUrl,
      bearer_token_enc: encryptedBearerToken,
      key_version: KEY_VERSION,
      status: CUSTOM_MCP_SERVER_STATUS.disconnected,
      last_discovery_at: null,
      last_discovery_error: null,
      tool_count: 0,
      created_by: auth.userId,
      created_at: now,
      updated_at: now,
    });

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.customMcpServerRegistered,
      payload: {
        server_id: id,
        slug,
        url: normalizedUrl,
      },
      created_at: now,
    });

    return { id };
  },
});

export const updateServer = mutation({
  args: {
    serverId: v.string(),
    display_name: v.optional(v.string()),
    url: v.optional(v.string()),
    bearer_token: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [USER_ROLE.owner, USER_ROLE.admin]);
    const server = await loadServerById(ctx, args.serverId);
    if (!server || server.org_id !== auth.orgId) {
      throw new Error("custom_mcp.server_not_found: Server not found.");
    }

    const nextDisplayName =
      args.display_name !== undefined
        ? normalizeDisplayName(args.display_name)
        : server.display_name;
    const nextUrl = args.url !== undefined ? parseAndNormalizeServerUrl(args.url) : server.url;
    const urlChanged = nextUrl !== server.url;
    const patch: {
      display_name?: string;
      url?: string;
      bearer_token_enc?: string | null;
      key_version?: string;
      status?: CustomMcpServerStatus;
      last_discovery_at?: string | null;
      last_discovery_error?: string | null;
      updated_at: string;
    } = {
      updated_at: nowIso(),
    };

    if (nextDisplayName !== server.display_name) {
      patch.display_name = nextDisplayName;
    }
    if (urlChanged) {
      patch.url = nextUrl;
      patch.status = CUSTOM_MCP_SERVER_STATUS.disconnected;
      patch.last_discovery_at = null;
      patch.last_discovery_error = null;
    }
    if (args.bearer_token !== undefined) {
      patch.bearer_token_enc = await encryptBearerToken(normalizeBearerToken(args.bearer_token));
      patch.key_version = KEY_VERSION;
    }

    await ctx.db.patch(server._id, patch);

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.customMcpServerUpdated,
      payload: {
        server_id: server.id,
        url_changed: urlChanged,
      },
      created_at: nowIso(),
    });

    return null;
  },
});

export const deleteServer = mutation({
  args: {
    serverId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [USER_ROLE.owner, USER_ROLE.admin]);
    const server = await loadServerById(ctx, args.serverId);
    if (!server || server.org_id !== auth.orgId) {
      throw new Error("custom_mcp.server_not_found: Server not found.");
    }

    const tools = await ctx.db
      .query("custom_mcp_tools")
      .withIndex("by_server", (q) => q.eq("server_id", server.id))
      .collect();
    for (const tool of tools) {
      await ctx.db.delete(tool._id);
    }

    const workspaceRows = await ctx.db
      .query("workspace_custom_servers")
      .withIndex("by_server", (q) => q.eq("server_id", server.id))
      .collect();
    for (const row of workspaceRows) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.delete(server._id);

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.customMcpServerDeleted,
      payload: {
        server_id: server.id,
        slug: server.slug,
      },
      created_at: nowIso(),
    });

    return null;
  },
});

export const listServers = query({
  args: {},
  returns: v.array(customMcpServerPublicValidator),
  handler: async (ctx) => {
    const auth = await requireOrgMember(ctx);
    const rows = await ctx.db
      .query("custom_mcp_servers")
      .withIndex("by_org", (q) => q.eq("org_id", auth.orgId))
      .collect();
    return rows
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((row) => toServerPublic(row));
  },
});

export const getServer = query({
  args: {
    serverId: v.string(),
  },
  returns: v.union(customMcpServerPublicValidator, v.null()),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx);
    const server = await loadServerById(ctx, args.serverId);
    if (!server || server.org_id !== auth.orgId) {
      return null;
    }
    return toServerPublic(server);
  },
});

export const listServerTools = query({
  args: {
    serverId: v.string(),
  },
  returns: v.array(customMcpToolValidator),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx);
    const server = await loadServerById(ctx, args.serverId);
    if (!server || server.org_id !== auth.orgId) {
      return [];
    }

    const rows = await ctx.db
      .query("custom_mcp_tools")
      .withIndex("by_server", (q) => q.eq("server_id", args.serverId))
      .collect();

    return rows
      .sort((a, b) => a.tool_name.localeCompare(b.tool_name))
      .map((row) => toToolPublic(row));
  },
});

export const updateToolConfig = mutation({
  args: {
    toolId: v.string(),
    risk_level: v.optional(actionRiskValidator),
    requires_approval: v.optional(v.boolean()),
    enabled: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [USER_ROLE.owner, USER_ROLE.admin]);
    const tool = await ctx.db
      .query("custom_mcp_tools")
      .withIndex("by_custom_id", (q) => q.eq("id", args.toolId))
      .unique();
    if (!tool || tool.org_id !== auth.orgId) {
      throw new Error("custom_mcp.tool_not_found: Tool not found.");
    }

    await ctx.db.patch(tool._id, {
      ...(args.risk_level !== undefined ? { risk_level: args.risk_level } : {}),
      ...(args.requires_approval !== undefined
        ? { requires_approval: args.requires_approval }
        : {}),
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
    });

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.customMcpToolConfigured,
      payload: {
        tool_id: tool.id,
        tool_name: tool.tool_name,
      },
      created_at: nowIso(),
    });

    return null;
  },
});

export const bulkUpdateToolConfig = mutation({
  args: {
    serverId: v.string(),
    risk_level: v.optional(actionRiskValidator),
    requires_approval: v.optional(v.boolean()),
    enabled: v.optional(v.boolean()),
  },
  returns: v.object({ updated_count: v.number() }),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [USER_ROLE.owner, USER_ROLE.admin]);
    const server = await loadServerById(ctx, args.serverId);
    if (!server || server.org_id !== auth.orgId) {
      throw new Error("custom_mcp.server_not_found: Server not found.");
    }

    const rows = await ctx.db
      .query("custom_mcp_tools")
      .withIndex("by_server", (q) => q.eq("server_id", args.serverId))
      .collect();

    for (const row of rows) {
      await ctx.db.patch(row._id, {
        ...(args.risk_level !== undefined ? { risk_level: args.risk_level } : {}),
        ...(args.requires_approval !== undefined
          ? { requires_approval: args.requires_approval }
          : {}),
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
      });
    }

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.customMcpBulkToolConfigured,
      payload: {
        server_id: server.id,
        updated_count: rows.length,
      },
      created_at: nowIso(),
    });

    return { updated_count: rows.length };
  },
});

export const setWorkspaceServerEnabled = mutation({
  args: {
    workspaceId: v.string(),
    serverId: v.string(),
    enabled: v.boolean(),
  },
  returns: workspaceCustomServerValidator,
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);
    const server = await loadServerById(ctx, args.serverId);
    if (!server || server.org_id !== auth.orgId) {
      throw new Error("custom_mcp.server_not_found: Server not found.");
    }

    const existing = await ctx.db
      .query("workspace_custom_servers")
      .withIndex("by_workspace_server", (q) =>
        q.eq("workspace_id", args.workspaceId).eq("server_id", args.serverId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { enabled: args.enabled });
    } else {
      await ctx.db.insert("workspace_custom_servers", {
        id: randomIdFor("wcms"),
        workspace_id: args.workspaceId,
        server_id: args.serverId,
        enabled: args.enabled,
        created_by: auth.userId,
        created_at: nowIso(),
      });
    }

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.customMcpWorkspaceServerToggled,
      payload: {
        workspace_id: args.workspaceId,
        server_id: args.serverId,
        enabled: args.enabled,
      },
      created_at: nowIso(),
    });

    const row = await ctx.db
      .query("workspace_custom_servers")
      .withIndex("by_workspace_server", (q) =>
        q.eq("workspace_id", args.workspaceId).eq("server_id", args.serverId),
      )
      .unique();

    if (!row) {
      throw new Error("custom_mcp.workspace_toggle_failed: Failed to update workspace server row.");
    }

    return {
      id: row.id,
      workspace_id: row.workspace_id,
      server_id: row.server_id,
      enabled: row.enabled,
      created_by: row.created_by,
      created_at: row.created_at,
    };
  },
});

export const listWorkspaceServers = query({
  args: {
    workspaceId: v.string(),
  },
  returns: v.array(
    v.object({
      server: customMcpServerPublicValidator,
      enabled: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId);

    const servers = await ctx.db
      .query("custom_mcp_servers")
      .withIndex("by_org", (q) => q.eq("org_id", auth.orgId))
      .collect();

    const workspaceRows = await ctx.db
      .query("workspace_custom_servers")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .collect();
    const enabledByServerId = new Map(workspaceRows.map((row) => [row.server_id, row.enabled]));

    return servers
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
      .map((server) => ({
        server: toServerPublic(server),
        enabled: enabledByServerId.get(server.id) ?? true,
      }));
  },
});

export const triggerDiscovery = mutation({
  args: {
    serverId: v.string(),
  },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx, [USER_ROLE.owner, USER_ROLE.admin]);
    const server = await loadServerById(ctx, args.serverId);
    if (!server || server.org_id !== auth.orgId) {
      throw new Error("custom_mcp.server_not_found: Server not found.");
    }

    await ctx.scheduler.runAfter(0, refs.discoverTools, {
      serverId: args.serverId,
    });

    return { scheduled: true };
  },
});

export const listToolsForWorkspace = internalQuery({
  args: {
    workspaceId: v.string(),
  },
  returns: v.array(listToolCatalogItemValidator),
  handler: async (ctx, args) => {
    const workspace = await loadWorkspaceById(ctx, args.workspaceId);
    if (!workspace) {
      return [];
    }

    const servers = await ctx.db
      .query("custom_mcp_servers")
      .withIndex("by_org", (q) => q.eq("org_id", workspace.org_id))
      .collect();
    if (servers.length === 0) {
      return [];
    }

    const workspaceRows = await ctx.db
      .query("workspace_custom_servers")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .collect();
    const enabledByServerId = new Map(workspaceRows.map((row) => [row.server_id, row.enabled]));
    const enabledServerIds = new Set(
      servers
        .filter((server) => (enabledByServerId.get(server.id) ?? true) === true)
        .map((server) => server.id),
    );
    if (enabledServerIds.size === 0) {
      return [];
    }

    const tools = await ctx.db
      .query("custom_mcp_tools")
      .withIndex("by_org", (q) => q.eq("org_id", workspace.org_id))
      .collect();

    return tools
      .filter((tool) => tool.enabled && enabledServerIds.has(tool.server_id))
      .map((tool) => ({
        name: tool.tool_name,
        description: tool.description,
        input_schema_json: tool.input_schema_json,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const resolveCustomTool = internalQuery({
  args: {
    orgId: v.string(),
    toolName: v.string(),
  },
  returns: v.union(customMcpToolValidator, v.null()),
  handler: async (ctx, args) => {
    const tool = await ctx.db
      .query("custom_mcp_tools")
      .withIndex("by_tool_name", (q) => q.eq("org_id", args.orgId).eq("tool_name", args.toolName))
      .unique();
    if (!tool) {
      return null;
    }
    return toToolPublic(tool);
  },
});

export const loadCustomToolContext = internalQuery({
  args: {
    workspaceId: v.string(),
    serverId: v.string(),
  },
  returns: v.union(
    v.object({
      server_id: v.string(),
      org_id: v.string(),
      server_url: v.string(),
      bearer_token_enc: v.union(v.string(), v.null()),
      key_version: v.string(),
      server_slug: v.string(),
      server_status: customMcpServerStatusValidator,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const workspace = await loadWorkspaceById(ctx, args.workspaceId);
    if (!workspace) {
      return null;
    }

    const server = await loadServerById(ctx, args.serverId);
    if (!server || server.org_id !== workspace.org_id) {
      return null;
    }

    const workspaceOverride = await ctx.db
      .query("workspace_custom_servers")
      .withIndex("by_workspace_server", (q) =>
        q.eq("workspace_id", args.workspaceId).eq("server_id", args.serverId),
      )
      .unique();
    const enabled = workspaceOverride ? workspaceOverride.enabled : true;
    if (!enabled) {
      return null;
    }
    const bearerToken = await decryptBearerToken(server.bearer_token_enc);

    return {
      server_id: server.id,
      org_id: server.org_id,
      server_url: server.url,
      bearer_token_enc: bearerToken,
      key_version: server.key_version,
      server_slug: server.slug,
      server_status: server.status,
    };
  },
});

export const getServerForDiscovery = internalQuery({
  args: {
    serverId: v.string(),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      org_id: v.string(),
      slug: v.string(),
      display_name: v.string(),
      url: v.string(),
      bearer_token_enc: v.union(v.string(), v.null()),
      key_version: v.string(),
      status: customMcpServerStatusValidator,
      last_discovery_at: v.union(v.string(), v.null()),
      last_discovery_error: v.union(v.string(), v.null()),
      tool_count: v.number(),
      created_by: v.string(),
      created_at: v.string(),
      updated_at: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const server = await loadServerById(ctx, args.serverId);
    if (!server) {
      return null;
    }
    const bearerToken = await decryptBearerToken(server.bearer_token_enc);
    return {
      id: server.id,
      org_id: server.org_id,
      slug: server.slug,
      display_name: server.display_name,
      url: server.url,
      bearer_token_enc: bearerToken,
      key_version: server.key_version,
      status: server.status,
      last_discovery_at: server.last_discovery_at,
      last_discovery_error: server.last_discovery_error,
      tool_count: server.tool_count,
      created_by: server.created_by,
      created_at: server.created_at,
      updated_at: server.updated_at,
    };
  },
});

export const migrateLegacyCustomMcpBearerTokens = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    updated: v.number(),
    nextCursor: v.union(v.string(), v.null()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const pageSize = Math.max(1, Math.min(args.limit ?? 100, 250));
    const page = await ctx.db.query("custom_mcp_servers").paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
    });

    let updated = 0;
    for (const server of page.page) {
      if (typeof server.bearer_token_enc !== "string" || server.bearer_token_enc.length === 0) {
        continue;
      }
      if (isEncryptedValue(server.bearer_token_enc)) {
        continue;
      }
      await ctx.db.patch(server._id, {
        bearer_token_enc: await encryptSecretValue(server.bearer_token_enc, "sensitive_blob"),
        key_version: KEY_VERSION,
      });
      updated += 1;
    }

    return {
      scanned: page.page.length,
      updated,
      nextCursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});

export const recordDiscoverySuccess = internalMutation({
  args: {
    serverId: v.string(),
    discoveredAt: v.string(),
    tools: v.array(discoveryToolValidator),
  },
  returns: v.object({ tool_count: v.number() }),
  handler: async (ctx, args) => {
    const server = await loadServerById(ctx, args.serverId);
    if (!server) {
      throw new Error("custom_mcp.server_not_found: Server not found.");
    }

    const existingTools = await ctx.db
      .query("custom_mcp_tools")
      .withIndex("by_server", (q) => q.eq("server_id", server.id))
      .collect();
    for (const row of existingTools) {
      await ctx.db.delete(row._id);
    }

    const limitedTools = args.tools.slice(0, CUSTOM_MCP_DISCOVERY_TOOL_LIMIT);
    for (const tool of limitedTools) {
      const remoteToolName = tool.remote_tool_name.trim();
      if (!remoteToolName) {
        continue;
      }
      await ctx.db.insert("custom_mcp_tools", {
        id: randomIdFor("cmcpt"),
        server_id: server.id,
        org_id: server.org_id,
        tool_name: `${server.slug}.${remoteToolName}`,
        remote_tool_name: remoteToolName,
        description: tool.description.trim() || `Custom MCP tool ${remoteToolName}`,
        input_schema_json: tool.input_schema_json,
        risk_level: "high",
        requires_approval: true,
        enabled: true,
        discovered_at: args.discoveredAt,
      });
    }

    const refreshedCount = (
      await ctx.db
        .query("custom_mcp_tools")
        .withIndex("by_server", (q) => q.eq("server_id", server.id))
        .collect()
    ).length;

    await ctx.db.patch(server._id, {
      status: CUSTOM_MCP_SERVER_STATUS.connected,
      last_discovery_at: args.discoveredAt,
      last_discovery_error: null,
      tool_count: refreshedCount,
      updated_at: nowIso(),
    });

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: server.org_id,
      actor_type: AUDIT_ACTOR_TYPE.system,
      actor_id: "custom_mcp.discovery",
      event_type: AUDIT_EVENT_TYPES.customMcpDiscoverySucceeded,
      payload: {
        server_id: server.id,
        tool_count: refreshedCount,
        capped: args.tools.length > CUSTOM_MCP_DISCOVERY_TOOL_LIMIT,
      },
      created_at: nowIso(),
    });

    return { tool_count: refreshedCount };
  },
});

export const recordDiscoveryFailure = internalMutation({
  args: {
    serverId: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const server = await loadServerById(ctx, args.serverId);
    if (!server) {
      return null;
    }

    await ctx.db.patch(server._id, {
      status: CUSTOM_MCP_SERVER_STATUS.error,
      last_discovery_error: args.error,
      updated_at: nowIso(),
    });

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: server.org_id,
      actor_type: AUDIT_ACTOR_TYPE.system,
      actor_id: "custom_mcp.discovery",
      event_type: AUDIT_EVENT_TYPES.customMcpDiscoveryFailed,
      payload: {
        server_id: server.id,
        error: args.error,
      },
      created_at: nowIso(),
    });

    return null;
  },
});
