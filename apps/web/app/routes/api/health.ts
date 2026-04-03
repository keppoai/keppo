import { createFileRoute } from "@tanstack/react-router";
import { createPublicHealthResponse } from "../../lib/server/public-health-api";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: ({ request }) => createPublicHealthResponse(request),
    },
  },
});
