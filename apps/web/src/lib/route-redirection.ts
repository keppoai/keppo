type WorkspaceLike = {
  slug: string;
};

const WORKSPACE_ROUTE_SEGMENTS = new Set([
  "approvals",
  "automations",
  "integrations",
  "rules",
  "prompt-builder",
  "servers",
]);

const joinPath = (...parts: Array<string | null | undefined>) => {
  const cleaned = parts
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .flatMap((part) => part.split("/"))
    .filter(Boolean);
  return cleaned.length === 0 ? "/" : `/${cleaned.join("/")}`;
};

const buildWorkspacePath = (orgSlug: string, workspaceSlug: string, subpath = "") =>
  joinPath(orgSlug, workspaceSlug, subpath);

const stripScopedPrefix = (
  pathname: string,
  orgSlug: string | null,
  workspaceSlug: string | null,
) => {
  const segments = pathname.split("/").filter(Boolean);
  if (orgSlug && segments[0] === orgSlug) {
    if (workspaceSlug && segments[1] === workspaceSlug) {
      return `/${segments.slice(2).join("/")}` || "/";
    }
    return `/${segments.slice(1).join("/")}` || "/";
  }
  return pathname || "/";
};

export const lastWorkspaceStorageKey = (orgSlug: string) => `keppo:lastWorkspaceSlug:${orgSlug}`;

export const pickPreferredWorkspaceSlug = <TWorkspace extends WorkspaceLike>(
  workspaces: readonly TWorkspace[],
  preferredWorkspaceSlug: string | null,
): string | null => {
  if (preferredWorkspaceSlug) {
    const preferredWorkspace = workspaces.find(
      (workspace) => workspace.slug === preferredWorkspaceSlug,
    );
    if (preferredWorkspace) {
      return preferredWorkspace.slug;
    }
  }
  return workspaces[0]?.slug ?? null;
};

export const resolveHomeRedirectPath = <TWorkspace extends WorkspaceLike>(params: {
  orgSlug: string | null;
  workspaces: readonly TWorkspace[];
  storedWorkspaceSlug: string | null;
}): string | null => {
  const targetWorkspaceSlug = params.orgSlug
    ? pickPreferredWorkspaceSlug(params.workspaces, params.storedWorkspaceSlug)
    : null;
  if (!params.orgSlug || !targetWorkspaceSlug) {
    return null;
  }
  return buildWorkspacePath(params.orgSlug, targetWorkspaceSlug);
};

export const resolveOrgRedirectHref = (params: {
  pathname: string;
  requestedOrgSlug: string;
  sessionOrgSlug: string | null;
  search?: string;
  hash?: string;
}): string | null => {
  if (!params.sessionOrgSlug || params.requestedOrgSlug === params.sessionOrgSlug) {
    return null;
  }

  const requestedPrefix = `/${params.requestedOrgSlug}`;
  const nextPath =
    params.pathname === requestedPrefix
      ? `/${params.sessionOrgSlug}`
      : params.pathname.startsWith(`${requestedPrefix}/`)
        ? `/${params.sessionOrgSlug}${params.pathname.slice(requestedPrefix.length)}`
        : params.pathname;

  return `${nextPath}${params.search ?? ""}${params.hash ?? ""}`;
};

export const resolveWorkspaceRedirectPath = <TWorkspace extends WorkspaceLike>(params: {
  pathname: string;
  orgSlug: string | null;
  requestedWorkspaceSlug: string | null;
  workspaces: readonly TWorkspace[];
  storedWorkspaceSlug: string | null;
}): string | null => {
  if (!params.orgSlug || !params.requestedWorkspaceSlug) {
    return null;
  }

  const targetWorkspaceSlug = pickPreferredWorkspaceSlug(
    params.workspaces,
    params.storedWorkspaceSlug,
  );
  if (!targetWorkspaceSlug || targetWorkspaceSlug === params.requestedWorkspaceSlug) {
    return null;
  }

  const pathnameSegments = params.pathname.split("/").filter(Boolean);
  const requestedPathIsMissingWorkspaceRoute =
    pathnameSegments.length === 2 &&
    pathnameSegments[0] === params.orgSlug &&
    WORKSPACE_ROUTE_SEGMENTS.has(params.requestedWorkspaceSlug);
  const relativePath = requestedPathIsMissingWorkspaceRoute
    ? `/${params.requestedWorkspaceSlug}`
    : stripScopedPrefix(params.pathname, params.orgSlug, params.requestedWorkspaceSlug);

  return buildWorkspacePath(
    params.orgSlug,
    targetWorkspaceSlug,
    relativePath === "/" ? "" : relativePath,
  );
};
