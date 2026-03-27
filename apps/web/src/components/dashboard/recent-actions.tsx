import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRiskBadgeVariant } from "@/lib/action-badges";
import { relativeTime } from "@/lib/format";
import { useRouteParams } from "@/hooks/use-route-params";
import type { Action } from "@/lib/types";

interface RecentActionsProps {
  actions: Action[];
  emptyState?: {
    title: string;
    description: string;
    href?: string;
    ctaLabel?: string;
  };
}

export function RecentActions({ actions, emptyState }: RecentActionsProps) {
  const pending = actions.slice(0, 5);
  const { buildWorkspacePath } = useRouteParams();
  const hasPending = pending.length > 0;

  return (
    <Card className={hasPending ? undefined : "border-border/60 bg-muted/15"}>
      <CardHeader className={hasPending ? undefined : "pb-3"}>
        <CardTitle>{hasPending ? "Recent Pending Actions" : "Approval queue"}</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasPending ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/80 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Quiet window
            </p>
            <p className="text-sm font-medium">{emptyState?.title ?? "No pending actions"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {emptyState?.description ??
                "New approvals will surface here as soon as operators or automations request them."}
            </p>
            {emptyState?.href && emptyState.ctaLabel ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                nativeButton={false}
                render={<Link to={emptyState.href} />}
              >
                {emptyState.ctaLabel}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="divide-y">
            {pending.map((action) => (
              <Link
                key={action.id}
                to={buildWorkspacePath("/approvals")}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{action.action_type}</span>
                  <Badge variant={getRiskBadgeVariant(action.risk_level)}>
                    {action.risk_level}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {relativeTime(action.created_at)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
