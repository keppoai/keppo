import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { pickFields } from "./field_mapper";
import {
  defaultActionBehaviorValidator,
  policyModeValidator,
  workspaceStatusValidator,
} from "./validators";

export const RESERVED_WORKSPACE_SLUGS = new Set([
  "settings",
  "admin",
  "login",
  "invites",
  "health",
]);

const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

export const workspaceValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  slug: v.string(),
  name: v.string(),
  status: workspaceStatusValidator,
  policy_mode: policyModeValidator,
  default_action_behavior: defaultActionBehaviorValidator,
  code_mode_enabled: v.boolean(),
  created_at: v.string(),
});

export const workspaceViewFields = [
  "id",
  "org_id",
  "slug",
  "name",
  "status",
  "policy_mode",
  "default_action_behavior",
  "created_at",
] as const satisfies readonly (keyof Doc<"workspaces">)[];

export const toWorkspaceView = (workspace: Doc<"workspaces">) => ({
  ...pickFields(workspace, workspaceViewFields),
  code_mode_enabled: workspace.code_mode_enabled ?? true,
  slug: getWorkspaceSlug(workspace),
});

export const toWorkspaceBoundary = (
  workspace: Pick<
    Doc<"workspaces">,
    | "id"
    | "org_id"
    | "slug"
    | "name"
    | "status"
    | "policy_mode"
    | "default_action_behavior"
    | "code_mode_enabled"
    | "created_at"
  >,
) => ({
  id: workspace.id,
  org_id: workspace.org_id,
  slug: getWorkspaceSlug(workspace),
  name: workspace.name,
  status: workspace.status,
  policy_mode: workspace.policy_mode,
  default_action_behavior: workspace.default_action_behavior,
  code_mode_enabled: workspace.code_mode_enabled ?? true,
  created_at: workspace.created_at,
});

export const slugifyWorkspaceName = (value: string): string => {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length > 0 ? base : "workspace";
};

export const normalizeWorkspaceSlug = (value: string): string => {
  const normalized = slugifyWorkspaceName(value);
  if (normalized.length < 3) {
    throw new Error("workspace.invalid_slug: Slug must be at least 3 characters.");
  }
  if (!WORKSPACE_SLUG_PATTERN.test(normalized)) {
    throw new Error("workspace.invalid_slug: Slug must match /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.");
  }
  if (RESERVED_WORKSPACE_SLUGS.has(normalized)) {
    throw new Error("workspace.invalid_slug: Slug is reserved.");
  }
  return normalized;
};

export const getWorkspaceSlug = (workspace: Pick<Doc<"workspaces">, "id" | "name" | "slug">) => {
  const storedSlug = typeof workspace.slug === "string" ? workspace.slug.trim() : "";
  if (storedSlug.length > 0) {
    return storedSlug;
  }
  return normalizeWorkspaceSlug(workspace.name);
};
