import { Link, Outlet, createLazyRoute } from "@tanstack/react-router";
import { ArrowLeftIcon, ShieldAlertIcon } from "lucide-react";

import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { useAdmin } from "@/hooks/use-admin";
import { buildWorkspacePath } from "@/hooks/use-route-params";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { adminLayoutRoute } from "./_admin";

export const adminLayoutRouteLazy = createLazyRoute(adminLayoutRoute.id)({
  component: AdminLayout,
});

function AdminLayout() {
  const { canAccessAdminPage } = useAdmin();
  const { getOrgSlug } = useAuth();
  const { selectedWorkspace } = useWorkspace();
  const orgSlug = getOrgSlug();
  const backToDashboardHref =
    orgSlug && selectedWorkspace?.slug ? buildWorkspacePath(orgSlug, selectedWorkspace.slug) : "/";

  if (canAccessAdminPage === undefined) {
    return (
      <div className="flex min-h-svh items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Loading admin access...</p>
      </div>
    );
  }

  if (canAccessAdminPage !== true) {
    return (
      <div className="grid min-h-svh place-items-center bg-[radial-gradient(circle_at_top,rgba(164,180,123,0.12),transparent_42%),linear-gradient(180deg,rgba(245,245,244,0.96),rgba(255,255,255,1))] px-4 py-10 dark:bg-[radial-gradient(circle_at_top,rgba(164,180,123,0.14),transparent_40%),linear-gradient(180deg,rgba(28,25,23,0.98),rgba(10,10,9,1))]">
        <Card className="w-full max-w-4xl border-border/70 bg-background/95 shadow-lg">
          <CardHeader className="space-y-8 p-8 sm:p-10">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <div className="flex size-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <ShieldAlertIcon className="size-6" />
              </div>
              <div className="space-y-3">
                <Badge
                  variant="outline"
                  className="border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200"
                >
                  Restricted
                </Badge>
                <div className="space-y-2">
                  <h1 className="text-3xl font-semibold tracking-tight">
                    Platform admin access required
                  </h1>
                  <CardDescription className="max-w-2xl text-base leading-7 text-foreground/80">
                    This panel exposes platform-wide rollout, health, usage, and abuse controls. You
                    can keep using your workspace normally, but only configured platform admins can
                    open this surface.
                  </CardDescription>
                </div>
              </div>
            </div>

            <div className="grid gap-4 rounded-2xl border border-border/70 bg-muted/35 p-5 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">What to do next</p>
                <p className="text-sm leading-6 text-muted-foreground">
                  Return to the dashboard to keep working, or ask a platform admin to verify that
                  your account is listed in{" "}
                  <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">
                    KEPPO_ADMIN_USER_IDS
                  </code>
                  .
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">Local development path</p>
                <p className="text-sm leading-6 text-muted-foreground">
                  For local-only testing, add{" "}
                  <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">
                    KEPPO_LOCAL_ADMIN_BYPASS=true
                  </code>{" "}
                  to{" "}
                  <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">
                    .env.local
                  </code>
                  , then restart the local Convex and API runtimes so the admin gate rehydrates.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button render={<Link to={backToDashboardHref} />}>
                <ArrowLeftIcon className="mr-1.5 size-4" />
                Return to dashboard
              </Button>
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-12 items-center border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1 flex min-h-[44px] min-w-[44px] items-center justify-center" />
          <div className="ml-2">
            <p className="text-sm font-medium tracking-tight">Admin Panel</p>
          </div>
        </header>
        <div className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-[1320px]">
            <Outlet />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
