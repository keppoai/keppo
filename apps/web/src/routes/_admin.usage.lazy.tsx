import { useEffect, useMemo, useState } from "react";
import { createLazyRoute } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronUpIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { SUBSCRIPTION_TIERS } from "@keppo/shared/subscriptions";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdmin } from "@/hooks/use-admin";
import { cn } from "@/lib/utils";
import { adminUsageRoute } from "./_admin.usage";

type SortKey = "orgName" | "tier" | "toolCalls" | "aiCredits" | "automationRuns" | "status";

export const adminUsageRouteLazy = createLazyRoute(adminUsageRoute.id)({
  component: AdminUsagePage,
});

function AdminUsagePage() {
  const { usage, usageLoaded, getOrgUsageDetail } = useAdmin();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("toolCalls");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getOrgUsageDetail>> | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const rows = usage.filter((row) => {
      if (!normalizedSearch) {
        return true;
      }
      return (
        row.orgName.toLowerCase().includes(normalizedSearch) ||
        row.orgSlug.toLowerCase().includes(normalizedSearch)
      );
    });

    rows.sort((left, right) => {
      const direction = sortDirection === "asc" ? 1 : -1;
      switch (sortKey) {
        case "orgName":
          return left.orgName.localeCompare(right.orgName) * direction;
        case "tier":
          return left.tier.localeCompare(right.tier) * direction;
        case "toolCalls":
          return (left.toolCalls - right.toolCalls) * direction;
        case "aiCredits":
          return (
            (left.aiCreditsUsed / Math.max(left.aiCreditsTotal, 1) -
              right.aiCreditsUsed / Math.max(right.aiCreditsTotal, 1)) *
            direction
          );
        case "automationRuns":
          return (left.automationRuns - right.automationRuns) * direction;
        case "status":
          return (
            (Number(left.isSuspended) - Number(right.isSuspended) ||
              left.subscriptionStatus.localeCompare(right.subscriptionStatus)) * direction
          );
      }
    });

    return rows;
  }, [search, sortDirection, sortKey, usage]);

  useEffect(() => {
    if (!selectedOrgId) {
      setDetail(null);
      return;
    }
    setIsLoadingDetail(true);
    void getOrgUsageDetail(selectedOrgId)
      .then((nextDetail) => {
        setDetail(nextDetail);
      })
      .finally(() => {
        setIsLoadingDetail(false);
      });
  }, [getOrgUsageDetail, selectedOrgId]);

  const toggleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "orgName" || nextKey === "tier" ? "asc" : "desc");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Usage</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Review organization-level usage, identify outliers, and inspect recent billing-period
          activity.
        </p>
      </div>

      <Card>
        <CardHeader className="gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <CardTitle>Organizations</CardTitle>
            <CardDescription>
              Sortable platform usage table with live suspension context.
            </CardDescription>
          </div>
          <div className="relative w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              className="pl-9"
              placeholder="Search organizations"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {!usageLoaded ? (
            <div className="flex min-h-[180px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Loading usage data...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead
                      label="Org Name"
                      sortKey="orgName"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableHead
                      label="Tier"
                      sortKey="tier"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableHead
                      label="Tool Calls"
                      sortKey="toolCalls"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableHead
                      label="AI Credits"
                      sortKey="aiCredits"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableHead
                      label="Automation Runs"
                      sortKey="automationRuns"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableHead
                      label="Status"
                      sortKey="status"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={toggleSort}
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-muted-foreground">
                        No organizations match the current search.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRows.map((row) => {
                      const ratio = Math.max(
                        row.toolCalls /
                          Math.max(
                            SUBSCRIPTION_TIERS[row.tier as keyof typeof SUBSCRIPTION_TIERS]
                              ?.max_tool_calls_per_month ?? 1,
                            1,
                          ),
                        row.aiCreditsUsed / Math.max(row.aiCreditsTotal, 1),
                      );
                      const isWarned = ratio >= 0.8;
                      const isSelected = selectedOrgId === row.orgId;
                      return (
                        <TableRow
                          key={row.orgId}
                          className={cn(
                            "cursor-pointer transition-colors",
                            row.isSuspended && "bg-red-500/8 hover:bg-red-500/12",
                            !row.isSuspended && isWarned && "bg-amber-500/8 hover:bg-amber-500/12",
                            isSelected && "ring-1 ring-inset ring-border",
                          )}
                          onClick={() => {
                            setSelectedOrgId((current) =>
                              current === row.orgId ? null : row.orgId,
                            );
                          }}
                        >
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium">{row.orgName}</p>
                              <p className="font-mono text-xs text-muted-foreground">
                                {row.orgSlug}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="capitalize">{row.tier}</TableCell>
                          <TableCell>{row.toolCalls.toLocaleString()}</TableCell>
                          <TableCell>
                            {row.aiCreditsUsed.toLocaleString()} /{" "}
                            {row.aiCreditsTotal.toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {row.automationRuns.toLocaleString()}
                            {row.activeAutomationRuns > 0 ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {row.activeAutomationRuns} active
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant={row.isSuspended ? "destructive" : "outline"}>
                                {row.isSuspended ? "Suspended" : row.subscriptionStatus}
                              </Badge>
                              {isWarned && !row.isSuspended ? (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                >
                                  &gt;80% of limit
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {selectedOrgId ? (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle>Organization Detail</CardTitle>
                <CardDescription>
                  {detail?.orgName ?? "Loading organization details"} ·{" "}
                  {detail?.orgSlug ?? selectedOrgId}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {isLoadingDetail || !detail ? (
                  <div className="flex min-h-[160px] items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    Loading organization detail...
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <DetailStat
                        label="Subscription"
                        value={`${detail.subscription.tier} · ${detail.subscription.status}`}
                      />
                      <DetailStat label="Members" value={detail.memberCount.toLocaleString()} />
                      <DetailStat
                        label="Workspaces"
                        value={detail.workspaceCount.toLocaleString()}
                      />
                      <DetailStat
                        label="AI Credits"
                        value={`${detail.aiCredits.allowanceUsed.toLocaleString()} / ${detail.aiCredits.allowanceTotal.toLocaleString()}`}
                      />
                    </div>

                    <div className="grid gap-6 xl:grid-cols-2">
                      <div className="space-y-3">
                        <h3 className="text-sm font-medium">Last 3 periods</h3>
                        <div className="space-y-2">
                          {detail.usageHistory.map((period) => (
                            <div key={period.periodStart} className="rounded-xl border p-3 text-sm">
                              <p className="font-medium">
                                {new Date(period.periodStart).toLocaleDateString()} to{" "}
                                {new Date(period.periodEnd).toLocaleDateString()}
                              </p>
                              <p className="mt-1 text-muted-foreground">
                                {period.toolCalls.toLocaleString()} tool calls ·{" "}
                                {period.aiCreditsUsed.toLocaleString()} /{" "}
                                {period.aiCreditsTotal.toLocaleString()} AI credits
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h3 className="text-sm font-medium">Active runs</h3>
                        {detail.activeRuns.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No active automation runs for this organization.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {detail.activeRuns.map((run) => (
                              <div key={run.id} className="rounded-xl border p-3 text-sm">
                                <p className="font-medium">{run.workspaceName}</p>
                                <p className="font-mono text-xs text-muted-foreground">{run.id}</p>
                                <p className="mt-1 text-muted-foreground">
                                  {run.status} · started {new Date(run.startedAt).toLocaleString()}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-sm font-medium">Suspension history</h3>
                      {detail.suspensionHistory.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No suspensions recorded for this organization.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {detail.suspensionHistory.map((entry) => (
                            <div key={entry.id} className="rounded-xl border p-3 text-sm">
                              <p className="font-medium">{entry.reason}</p>
                              <p className="mt-1 text-muted-foreground">
                                Suspended {new Date(entry.suspendedAt).toLocaleString()} by{" "}
                                {entry.suspendedBy}
                              </p>
                              <p className="text-muted-foreground">
                                {entry.liftedAt
                                  ? `Lifted ${new Date(entry.liftedAt).toLocaleString()} by ${entry.liftedBy ?? "unknown"}`
                                  : "Still suspended"}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function SortableHead({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: "asc" | "desc";
  onSort: (sortKey: SortKey) => void;
}) {
  const isActive = sortKey === activeKey;
  return (
    <TableHead>
      <button
        type="button"
        className="inline-flex min-h-[44px] items-center gap-1 text-left"
        onClick={() => onSort(sortKey)}
      >
        {label}
        {isActive ? (
          direction === "asc" ? (
            <ChevronUpIcon className="size-4" />
          ) : (
            <ChevronDownIcon className="size-4" />
          )
        ) : null}
      </button>
    </TableHead>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}
