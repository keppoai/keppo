import { settingsRoute } from "./settings";
import { createLazyRoute } from "@tanstack/react-router";
import { PaintbrushIcon, BellRingIcon, KeyRoundIcon, UserRoundIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationPreferences } from "@/components/notifications/notification-preferences";
import { AiKeyManager } from "@/components/automations/ai-key-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const settingsRouteLazy = createLazyRoute(settingsRoute.id)({
  component: SettingsPage,
});

export function SettingsPage() {
  const navigate = settingsRoute.useNavigate();
  const { session, getOrgId } = useAuth();
  const search = settingsRoute.useSearch();
  const orgId = getOrgId();
  const email = session?.user?.email ?? "Unknown";
  const activeTab = search.tab ?? "account";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Account and organization settings</p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          void navigate({
            search: (prev) => ({
              ...prev,
              tab: value === "account" ? undefined : value,
            }),
          });
        }}
        className="gap-4"
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="account">
            <UserRoundIcon className="size-4" />
            Account
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <PaintbrushIcon className="size-4" />
            Appearance
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <BellRingIcon className="size-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="ai">
            <KeyRoundIcon className="size-4" />
            AI Configuration
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>
                Confirm which identity and organization this dashboard session is operating under.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Email</dt>
                <dd>{email}</dd>
                <dt className="text-muted-foreground">Organization ID</dt>
                <dd className="font-mono text-xs">{orgId ?? "N/A"}</dd>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Adjust the dashboard theme without leaving the settings surface.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Theme picker</p>
                <p className="text-sm text-muted-foreground">
                  Choose light, dark, or system and the dashboard will update immediately.
                </p>
              </div>
              <ThemeToggle />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationPreferences />
        </TabsContent>

        <TabsContent value="ai">
          <AiKeyManager orgId={orgId} userEmail={email} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
