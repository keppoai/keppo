import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fullTimestamp } from "@/lib/format";
import { Input } from "@/components/ui/input";
import type { AuditEvent } from "@/lib/types";

export type AuditFilters = {
  from?: string | undefined;
  to?: string | undefined;
  actor?: string | undefined;
  eventType?: string | undefined;
  provider?: string | undefined;
  actionId?: string | undefined;
};

interface AuditTableProps {
  events: AuditEvent[];
  filters: AuditFilters;
  onFiltersChange: (value: AuditFilters) => void;
  onRefresh: () => void;
  onExport: (format: "csv" | "jsonl") => void;
}

export function AuditTable({
  events,
  filters,
  onFiltersChange,
  onRefresh,
  onExport,
}: AuditTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit Logs</CardTitle>
        <CardAction>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onExport("csv")}>
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => onExport("jsonl")}>
              Export JSONL
            </Button>
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <Input
            type="datetime-local"
            value={filters.from ?? ""}
            onChange={(event) =>
              onFiltersChange({ ...filters, from: event.currentTarget.value || undefined })
            }
          />
          <Input
            type="datetime-local"
            value={filters.to ?? ""}
            onChange={(event) =>
              onFiltersChange({ ...filters, to: event.currentTarget.value || undefined })
            }
          />
          <Input
            placeholder="Actor"
            value={filters.actor ?? ""}
            onChange={(event) =>
              onFiltersChange({ ...filters, actor: event.currentTarget.value || undefined })
            }
          />
          <Input
            placeholder="Event type"
            value={filters.eventType ?? ""}
            onChange={(event) =>
              onFiltersChange({ ...filters, eventType: event.currentTarget.value || undefined })
            }
          />
          <Input
            placeholder="Provider"
            value={filters.provider ?? ""}
            onChange={(event) =>
              onFiltersChange({ ...filters, provider: event.currentTarget.value || undefined })
            }
          />
          <Input
            placeholder="Action ID"
            value={filters.actionId ?? ""}
            onChange={(event) =>
              onFiltersChange({ ...filters, actionId: event.currentTarget.value || undefined })
            }
          />
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audit events recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Event Type</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event, index) => (
                <TableRow key={event.id ?? index}>
                  <TableCell>
                    {event.created_at ? fullTimestamp(event.created_at) : "N/A"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{event.event_type ?? "unknown"}</Badge>
                  </TableCell>
                  <TableCell>{`${event.actor_type}:${event.actor_id}`}</TableCell>
                  <TableCell
                    className="max-w-[300px] truncate"
                    title={JSON.stringify(event.payload ?? {})}
                  >
                    {JSON.stringify(event.payload ?? {})}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
