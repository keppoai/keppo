import { createFileRoute } from "@tanstack/react-router";
import { handleDlqReplayRequest } from "../../../../../lib/server/admin-health-api";

export const Route = createFileRoute("/api/health/dlq/$id/replay")({
  server: {
    handlers: {
      POST: async ({ request }) => await handleDlqReplayRequest(request),
    },
  },
});
