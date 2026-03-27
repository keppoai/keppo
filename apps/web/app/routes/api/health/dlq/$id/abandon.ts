import { createFileRoute } from "@tanstack/react-router";
import { handleDlqAbandonRequest } from "../../../../../lib/server/admin-health-api";

export const Route = createFileRoute("/api/health/dlq/$id/abandon")({
  server: {
    handlers: {
      POST: async ({ request }) => await handleDlqAbandonRequest(request),
    },
  },
});
