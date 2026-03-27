import { auditRoute } from "./audit";
import { createLazyRoute } from "@tanstack/react-router";
import { useAudit } from "@/hooks/use-audit";
import { AuditTable } from "@/components/audit/audit-table";
import { Skeleton } from "@/components/ui/skeleton";

export const auditRouteLazy = createLazyRoute(auditRoute.id)({
  component: AuditPage,
});

function AuditPage() {
  const { auditEvents, isLoading, filters, setFilters, refreshAudit, exportAudit } = useAudit();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground">
          Track all actions and events across your organization
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <AuditTable
          events={auditEvents}
          filters={filters}
          onFiltersChange={setFilters}
          onRefresh={refreshAudit}
          onExport={(format) => {
            void exportAudit(format);
          }}
        />
      )}
    </div>
  );
}
