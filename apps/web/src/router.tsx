import { createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/__root";
import { homeRoute } from "./routes/home";
import { loginRoute } from "./routes/login";
import { indexRoute } from "./routes/index";
import { approvalsRoute } from "./routes/approvals";
import { rulesRoute } from "./routes/rules";
import { integrationsRoute } from "./routes/integrations";
import { automationsRoute } from "./routes/automations";
import { automationBuildRoute } from "./routes/automations.build";
import { automationCreateRoute } from "./routes/automations.create";
import { automationDetailRoute } from "./routes/automations.$automationId";
import { runDetailRoute } from "./routes/automations.$automationId.runs.$runId";
import { auditRoute } from "./routes/audit";
import { workspacesRoute } from "./routes/workspaces";
import { settingsRoute } from "./routes/settings";
import { billingRoute } from "./routes/billing";
import { membersRoute } from "./routes/members";
import { promptBuilderRoute } from "./routes/prompt-builder";
import { integrationDetailRoute } from "./routes/integrations.$provider";
import { inviteAcceptRoute } from "./routes/invites.accept";
import { serversRoute } from "./routes/servers";
import { serverDetailRoute } from "./routes/servers.$serverId";
import { docsRoute } from "./routes/docs";
import { docsHomeRoute } from "./routes/docs.index";
import { docsArticleRoute } from "./routes/docs.$";
import { docsSectionPageRoute } from "./routes/docs.$section.$page";
import { docsNestedArticleRoute } from "./routes/docs.$section.$category.$page";
import { orgLayoutRoute } from "./routes/_org";
import { workspaceLayoutRoute } from "./routes/_org._workspace";
import { adminLayoutRoute } from "./routes/_admin";
import { adminIndexRoute } from "./routes/_admin.index";
import { adminFlagsRoute } from "./routes/_admin.flags";
import { adminInviteCodesRoute } from "./routes/_admin.invite-codes";
import { adminHealthRoute } from "./routes/_admin.health";
import { adminUsageRoute } from "./routes/_admin.usage";
import { adminAbuseRoute } from "./routes/_admin.abuse";

export const routeTree = rootRoute.addChildren([
  loginRoute,
  homeRoute,
  docsRoute.addChildren([
    docsHomeRoute,
    docsArticleRoute,
    docsSectionPageRoute,
    docsNestedArticleRoute,
  ]),
  orgLayoutRoute.addChildren([
    settingsRoute,
    membersRoute,
    billingRoute,
    auditRoute,
    workspacesRoute,
    workspaceLayoutRoute.addChildren([
      indexRoute,
      approvalsRoute,
      rulesRoute,
      promptBuilderRoute,
      automationsRoute,
      automationBuildRoute,
      automationCreateRoute,
      automationDetailRoute,
      runDetailRoute,
      integrationsRoute,
      integrationDetailRoute,
      serversRoute,
      serverDetailRoute,
    ]),
  ]),
  inviteAcceptRoute,
  adminLayoutRoute.addChildren([
    adminIndexRoute,
    adminFlagsRoute,
    adminInviteCodesRoute,
    adminHealthRoute,
    adminUsageRoute,
    adminAbuseRoute,
  ]),
]);

export const createAppRouter = () =>
  createRouter({
    routeTree,
    defaultPreload: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 250,
  });

let clientRouter: ReturnType<typeof createAppRouter> | null = null;

export function getRouter() {
  if (import.meta.env.SSR) {
    return createAppRouter();
  }

  clientRouter ??= createAppRouter();
  return clientRouter;
}

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
