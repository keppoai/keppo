import type { AuditEventType } from "@keppo/shared/domain";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const chartConfig = {
  auditEvents: {
    label: "Audit events",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

type ActivityChartProps = {
  auditEvents: Array<{
    id: string;
    created_at: string;
    event_type: AuditEventType;
  }>;
};

function buildAuditSeries(
  auditEvents: ActivityChartProps["auditEvents"],
): Array<{ day: string; auditEvents: number; fullDate: string }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = new Map<string, { day: string; auditEvents: number; fullDate: string }>();

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, {
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      auditEvents: 0,
      fullDate: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    });
  }

  for (const event of auditEvents) {
    const parsed = new Date(event.created_at);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }
    parsed.setHours(0, 0, 0, 0);
    const key = parsed.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.auditEvents += 1;
    }
  }

  return Array.from(buckets.values());
}

export function ActivityChart({ auditEvents }: ActivityChartProps) {
  const data = buildAuditSeries(auditEvents);
  const totalEvents = data.reduce((sum, bucket) => sum + bucket.auditEvents, 0);
  const latestActiveDay = [...data].reverse().find((bucket) => bucket.auditEvents > 0) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Workspace Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {totalEvents === 0 ? (
          <div className="flex min-h-[250px] flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/30 px-6 text-center">
            <p className="text-sm font-medium">No workspace activity captured yet</p>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              This panel only reflects real audit events from the last 7 days. It will fill in as
              operators run automations, review approvals, and manage integrations.
            </p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[250px] w-full">
            <BarChart data={data}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate}
                  />
                }
              />
              <Bar dataKey="auditEvents" fill="var(--color-auditEvents)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {latestActiveDay
            ? `Latest activity landed on ${latestActiveDay.fullDate}.`
            : "No activity in the last 7 days."}
        </p>
      </CardContent>
    </Card>
  );
}
