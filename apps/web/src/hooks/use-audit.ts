import { useCallback, useMemo, useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import type { AuditActorType, AuditEventType } from "@keppo/shared/domain";
import type { AuditFilters } from "@/components/audit/audit-table";
import { useAuth } from "./use-auth";

type AuditEventRow = {
  id: string;
  org_id: string;
  actor_type: AuditActorType;
  actor_id: string;
  event_type: AuditEventType;
  payload: Record<string, unknown>;
  created_at: string;
};

function toCsvValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export function useAudit() {
  const { isAuthenticated } = useAuth();
  const [filters, setFilters] = useState<AuditFilters>({});
  const [fallbackAuditEvents, setFallbackAuditEvents] = useState<AuditEventRow[]>([]);
  const convex = useConvex();
  const listAuditRef = makeFunctionReference<"query">("audit:listForCurrentOrg");
  const queryArgs = useMemo(
    () => ({
      filters: {
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.actor ? { actor: filters.actor } : {}),
        ...(filters.eventType ? { eventType: filters.eventType } : {}),
        ...(filters.provider ? { provider: filters.provider } : {}),
        ...(filters.actionId ? { actionId: filters.actionId } : {}),
      },
    }),
    [
      filters.actionId,
      filters.actor,
      filters.eventType,
      filters.from,
      filters.provider,
      filters.to,
    ],
  );

  const auditEventsQuery = useQuery(listAuditRef, isAuthenticated ? queryArgs : "skip") as
    | AuditEventRow[]
    | undefined;
  const auditEvents = auditEventsQuery ?? fallbackAuditEvents;

  const refreshAudit = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) {
      setFallbackAuditEvents([]);
      return;
    }
    const nextEvents = (await convex.query(listAuditRef, queryArgs)) as AuditEventRow[];
    setFallbackAuditEvents(nextEvents);
  }, [convex, isAuthenticated, listAuditRef, queryArgs]);

  const exportPayload = useMemo(() => {
    return auditEvents;
  }, [auditEvents]);

  const exportAudit = useCallback(
    async (format: "csv" | "jsonl"): Promise<void> => {
      if (exportPayload.length === 0) {
        return;
      }

      let content = "";
      let filename = "audit";

      if (format === "csv") {
        const headers = [
          "id",
          "org_id",
          "actor_type",
          "actor_id",
          "event_type",
          "payload",
          "created_at",
        ];

        const rows = exportPayload.map((event) =>
          [
            toCsvValue(event.id),
            toCsvValue(event.org_id),
            toCsvValue(event.actor_type),
            toCsvValue(event.actor_id),
            toCsvValue(event.event_type),
            toCsvValue(event.payload),
            toCsvValue(event.created_at),
          ].join(","),
        );

        content = `${headers.join(",")}\n${rows.join("\n")}`;
        filename = "audit.csv";
      } else {
        content = exportPayload.map((event) => JSON.stringify(event)).join("\n");
        filename = "audit.jsonl";
      }

      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    },
    [exportPayload],
  );

  const isLoading =
    isAuthenticated && auditEventsQuery === undefined && fallbackAuditEvents.length === 0;

  return { auditEvents, isLoading, filters, setFilters, refreshAudit, exportAudit };
}
