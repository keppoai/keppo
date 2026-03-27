import { createFileRoute } from "@tanstack/react-router";
import { handleDeepHealthRequest } from "../../../lib/server/admin-health-api";

export const Route = createFileRoute("/api/health/deep")({
  server: {
    handlers: {
      GET: async ({ request }) => await handleDeepHealthRequest(request),
    },
  },
});
