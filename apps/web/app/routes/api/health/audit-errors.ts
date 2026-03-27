import { createFileRoute } from "@tanstack/react-router";
import { handleAuditErrorsRequest } from "../../../lib/server/admin-health-api";

export const Route = createFileRoute("/api/health/audit-errors")({
  server: {
    handlers: {
      GET: async ({ request }) => await handleAuditErrorsRequest(request),
    },
  },
});
