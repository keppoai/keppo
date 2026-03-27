import { createMemoryHistory } from "@tanstack/react-router";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { AuthState } from "@/hooks/use-auth";

export function createTestRouter({
  auth,
  initialEntries,
  getChildren,
}: {
  auth: AuthState;
  initialEntries: string[];
  getChildren: () => ReactNode;
}) {
  const rootRoute = createRootRouteWithContext<{ auth: AuthState }>()({
    component: () => <Outlet />,
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{getChildren()}</>,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: () => <>{getChildren()}</>,
  });
  const inviteRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/invites/accept",
    component: () => <>{getChildren()}</>,
  });
  const docsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/docs",
    component: () => <Outlet />,
  });
  const docsIndexRoute = createRoute({
    getParentRoute: () => docsRoute,
    path: "/",
    component: () => <>{getChildren()}</>,
  });
  const docsSectionRoute = createRoute({
    getParentRoute: () => docsRoute,
    path: "$section",
    component: () => <>{getChildren()}</>,
  });
  const docsSectionChildRoute = createRoute({
    getParentRoute: () => docsSectionRoute,
    path: "$category",
    component: () => <>{getChildren()}</>,
  });
  const docsNestedArticleRoute = createRoute({
    getParentRoute: () => docsSectionChildRoute,
    path: "$page",
    component: () => <>{getChildren()}</>,
  });
  const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin",
    component: () => <>{getChildren()}</>,
  });
  const adminSectionRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: "$section",
    component: () => <>{getChildren()}</>,
  });
  const orgRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/$orgSlug",
    component: () => <Outlet />,
  });
  const orgSettingsRoute = createRoute({
    getParentRoute: () => orgRoute,
    path: "settings",
    component: () => <Outlet />,
  });
  const orgSettingsSectionRoute = createRoute({
    getParentRoute: () => orgSettingsRoute,
    path: "$section",
    component: () => <>{getChildren()}</>,
  });
  const orgSectionRoute = createRoute({
    getParentRoute: () => orgRoute,
    path: "$section",
    component: () => <>{getChildren()}</>,
  });
  const workspaceRoute = createRoute({
    getParentRoute: () => orgRoute,
    path: "$workspaceSlug",
    component: () => <>{getChildren()}</>,
  });
  const workspaceIntegrationsRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "integrations",
    component: () => <>{getChildren()}</>,
  });
  const workspaceIntegrationProviderRoute = createRoute({
    getParentRoute: () => workspaceIntegrationsRoute,
    path: "$provider",
    component: () => <>{getChildren()}</>,
  });
  const workspaceSectionRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "$section",
    component: () => <>{getChildren()}</>,
  });
  const workspaceSectionChildRoute = createRoute({
    getParentRoute: () => workspaceSectionRoute,
    path: "$item",
    component: () => <>{getChildren()}</>,
  });
  const workspaceSectionGrandchildRoute = createRoute({
    getParentRoute: () => workspaceSectionChildRoute,
    path: "$subitem",
    component: () => <>{getChildren()}</>,
  });
  const routeTree = rootRoute.addChildren([
    homeRoute,
    loginRoute,
    inviteRoute,
    docsRoute.addChildren([
      docsIndexRoute,
      docsSectionRoute.addChildren([docsSectionChildRoute.addChildren([docsNestedArticleRoute])]),
    ]),
    adminRoute.addChildren([adminSectionRoute]),
    orgRoute.addChildren([
      orgSettingsRoute.addChildren([orgSettingsSectionRoute]),
      orgSectionRoute,
      workspaceRoute.addChildren([
        workspaceIntegrationsRoute.addChildren([workspaceIntegrationProviderRoute]),
        workspaceSectionRoute.addChildren([
          workspaceSectionChildRoute.addChildren([workspaceSectionGrandchildRoute]),
        ]),
      ]),
    ]),
  ]);

  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
    context: { auth },
    defaultPreload: false,
  });
}
