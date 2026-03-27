import { createFileRoute } from "@tanstack/react-router";
import { handleFeatureFlagsRequest } from "../../../lib/server/admin-health-api";

export const Route = createFileRoute("/api/health/flags")({
  server: {
    handlers: {
      GET: async ({ request }) => await handleFeatureFlagsRequest(request),
    },
  },
});
