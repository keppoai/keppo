import { createFileRoute } from "@tanstack/react-router";
import { handleDlqListRequest } from "../../../lib/server/admin-health-api";

export const Route = createFileRoute("/api/health/dlq")({
  server: {
    handlers: {
      GET: async ({ request }) => await handleDlqListRequest(request),
    },
  },
});
