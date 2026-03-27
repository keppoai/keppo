import { useMemo } from "react";
import { useLocation, useMatchRoute, useMatches } from "@tanstack/react-router";

type PathScope = "workspace" | "org" | "global";

const lastWorkspaceStorageKey = (orgSlug: string) => `keppo:lastWorkspaceSlug:${orgSlug}`;

const ORG_SCOPED_PREFIXES = new Set([
  "/settings",
  "/settings/members",
  "/settings/billing",
  "/settings/audit",
  "/settings/workspaces",
]);

export const joinPath = (...parts: Array<string | null | undefined>) => {
  const cleaned = parts
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .flatMap((part) => part.split("/"))
    .filter(Boolean);
  return cleaned.length === 0 ? "/" : `/${cleaned.join("/")}`;
};

export const buildOrgPath = (orgSlug: string, subpath = "") => joinPath(orgSlug, subpath);

export const buildWorkspacePath = (orgSlug: string, workspaceSlug: string, subpath = "") =>
  joinPath(orgSlug, workspaceSlug, subpath);

export const normalizeDashboardPath = (pathname: string): string => {
  if (pathname === "/custom-servers") return "/servers";
  if (pathname.startsWith("/custom-servers/")) {
    return pathname.replace("/custom-servers/", "/servers/");
  }
  if (pathname === "/members") return "/settings/members";
  if (pathname === "/billing") return "/settings/billing";
  if (pathname === "/audit") return "/settings/audit";
  if (pathname === "/workspaces") return "/settings/workspaces";
  if (pathname === "/health") return "/admin/health";
  return pathname;
};

export const resolvePathScope = (path: string): PathScope => {
  if (
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/login" ||
    path.startsWith("/invites/")
  ) {
    return "global";
  }
  if (ORG_SCOPED_PREFIXES.has(path)) {
    return "org";
  }
  return "workspace";
};

export const resolveCurrentPathScope = (
  orgSlug: string | null,
  matchedWorkspaceSlug: string | null,
): PathScope => {
  if (matchedWorkspaceSlug) {
    return "workspace";
  }
  if (orgSlug) {
    return "org";
  }
  return "global";
};

type DeriveRouteContextInput = {
  pathname: string;
  matchedParams: Record<string, string>;
  storedWorkspaceSlug: string | null;
};

export const deriveRouteContext = ({
  pathname,
  matchedParams,
  storedWorkspaceSlug,
}: DeriveRouteContextInput) => {
  const segments = pathname.split("/").filter(Boolean);
  const pathnameOrgSlug = segments[0] ?? null;
  const orgSlug = matchedParams.orgSlug ?? pathnameOrgSlug;
  const matchedWorkspaceSlug = matchedParams.workspaceSlug ?? null;
  const workspaceSlug = matchedWorkspaceSlug ?? storedWorkspaceSlug;
  const relativePath = stripScopedPrefix(pathname, orgSlug, matchedWorkspaceSlug);
  const relativeSegments = relativePath.split("/").filter(Boolean);
  const section = relativeSegments[0] ?? null;

  return {
    pathname,
    orgSlug,
    workspaceSlug,
    matchedWorkspaceSlug,
    currentPathScope: resolveCurrentPathScope(orgSlug, matchedWorkspaceSlug),
    relativePath,
    relativeSegments,
    section,
    automationLookup: section === "automations" ? (relativeSegments[1] ?? null) : null,
    runId:
      section === "automations" && relativeSegments[2] === "runs"
        ? (relativeSegments[3] ?? null)
        : null,
    integrationProvider: section === "integrations" ? (relativeSegments[1] ?? null) : null,
    customServerId: section === "servers" ? (relativeSegments[1] ?? null) : null,
  };
};

export const scopePath = (
  path: string,
  orgSlug: string | null,
  workspaceSlug: string | null,
): string => {
  const normalizedPath = normalizeDashboardPath(path);
  if (!normalizedPath.startsWith("/")) {
    return normalizedPath;
  }
  const scope = resolvePathScope(normalizedPath);
  if (scope === "global" || !orgSlug) {
    return normalizedPath;
  }
  if (scope === "org") {
    return buildOrgPath(orgSlug, normalizedPath);
  }
  if (!workspaceSlug) {
    return buildOrgPath(orgSlug, normalizedPath);
  }
  return buildWorkspacePath(orgSlug, workspaceSlug, normalizedPath);
};

export const stripScopedPrefix = (
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

export function useRouteParams() {
  const matches = useMatches();
  const pathname = useLocation({ select: (location) => location.pathname });
  const matchRoute = useMatchRoute();

  const mergedParams = useMemo(() => {
    return matches.reduce<Record<string, string>>((acc, match) => {
      for (const [key, value] of Object.entries(match.params)) {
        if (typeof value === "string" && value.length > 0) {
          acc[key] = value;
        }
      }
      return acc;
    }, {});
  }, [matches, pathname]);

  const storedWorkspaceSlug =
    mergedParams.workspaceSlug || !mergedParams.orgSlug || typeof window === "undefined"
      ? null
      : window.localStorage.getItem(lastWorkspaceStorageKey(mergedParams.orgSlug));

  const params = useMemo(() => {
    const routeContext = deriveRouteContext({
      pathname,
      matchedParams: mergedParams,
      storedWorkspaceSlug,
    });

    const pathMatchesRoute = (to: string) =>
      Boolean(
        matchRoute({
          to,
          fuzzy: false,
          pending: true,
        }),
      );

    const scopeResolvedPath = (path: string) => {
      const normalizedPath = normalizeDashboardPath(path);
      if (!normalizedPath.startsWith("/")) {
        return normalizedPath;
      }

      if (pathMatchesRoute(normalizedPath)) {
        return normalizedPath;
      }

      if (routeContext.orgSlug) {
        const orgPath = buildOrgPath(routeContext.orgSlug, normalizedPath);
        if (pathMatchesRoute(orgPath)) {
          return orgPath;
        }
      }

      if (routeContext.orgSlug && routeContext.workspaceSlug) {
        const workspacePath = buildWorkspacePath(
          routeContext.orgSlug,
          routeContext.workspaceSlug,
          normalizedPath,
        );
        if (pathMatchesRoute(workspacePath)) {
          return workspacePath;
        }
      }

      return scopePath(path, routeContext.orgSlug, routeContext.workspaceSlug);
    };

    return {
      ...routeContext,
      buildOrgPath: (subpath = "") =>
        routeContext.orgSlug ? buildOrgPath(routeContext.orgSlug, subpath) : subpath || "/",
      buildWorkspacePath: (subpath = "") =>
        routeContext.orgSlug && routeContext.workspaceSlug
          ? buildWorkspacePath(routeContext.orgSlug, routeContext.workspaceSlug, subpath)
          : routeContext.orgSlug
            ? buildOrgPath(routeContext.orgSlug, subpath)
            : subpath || "/",
      scopePath: scopeResolvedPath,
      stripScopedPrefix: (path: string) =>
        stripScopedPrefix(path, routeContext.orgSlug, routeContext.matchedWorkspaceSlug),
    };
  }, [matchRoute, mergedParams, pathname, storedWorkspaceSlug]);

  return params;
}
