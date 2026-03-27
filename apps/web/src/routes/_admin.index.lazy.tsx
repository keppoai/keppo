import type { ReactNode } from "react";
import { createLazyRoute, Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  ArrowRightIcon,
  BarChart3Icon,
  FlagIcon,
  ShieldAlertIcon,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminIndexRoute } from "./_admin.index";
import { useAdmin } from "@/hooks/use-admin";

export const adminIndexRouteLazy = createLazyRoute(adminIndexRoute.id)({
  component: AdminOverviewPage,
});

function AdminOverviewPage() {
  const { platformOverview } = useAdmin();

  const cards = [
    {
      label: "Organizations",
      value: platformOverview?.totalOrganizations ?? "—",
      description: "Better Auth organizations across the platform.",
    },
    {
      label: "Users",
      value: platformOverview?.totalUsers ?? "—",
      description: "Registered platform users.",
    },
    {
      label: "Active automation runs",
      value: platformOverview?.activeAutomationRuns ?? "—",
      description: "Currently running automation executions.",
    },
    {
      label: "Suspended orgs",
      value: platformOverview?.suspendedOrganizations ?? "—",
      description: "Organizations currently blocked for abuse or policy reasons.",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Platform-wide counts and fast paths into rollout controls, system health, usage review,
          and abuse operations.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="space-y-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-3xl tracking-tight">{card.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{card.description}</CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <QuickActionCard
          title="Feature Flags"
          description="Seed defaults, verify rollout switches, and manage dogfood organizations."
          to="/admin/flags"
          icon={<FlagIcon className="size-4" />}
        />
        <QuickActionCard
          title="System Health"
          description="Inspect subsystem status, DLQ records, circuit breakers, and cron health."
          to="/admin/health"
          icon={<ActivityIcon className="size-4" />}
        />
        <QuickActionCard
          title="Usage"
          description="Spot outlier organizations by subscription limits, AI credits, and active runs."
          to="/admin/usage"
          icon={<BarChart3Icon className="size-4" />}
        />
        <QuickActionCard
          title="Abuse"
          description="Suspend or restore organizations and review recent suspension history."
          to="/admin/abuse"
          icon={<ShieldAlertIcon className="size-4" />}
        />
      </div>
    </div>
  );
}

function QuickActionCard({
  title,
  description,
  to,
  icon,
}: {
  title: string;
  description: string;
  to: string;
  icon: ReactNode;
}) {
  return (
    <Card className="justify-between">
      <CardHeader className="space-y-3">
        <div className="flex size-10 items-center justify-center rounded-xl border bg-secondary/35 text-foreground">
          {icon}
        </div>
        <div className="space-y-2">
          <CardTitle className="text-xl tracking-tight">{title}</CardTitle>
          <CardDescription className="leading-6">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Link
          to={to}
          className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Open section
          <ArrowRightIcon className="size-4" />
        </Link>
      </CardContent>
    </Card>
  );
}
