import { createFileRoute } from "@tanstack/react-router";
import { handleBuildVersionRequest } from "../../lib/server/internal-api";

export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: async ({ request }) => await handleBuildVersionRequest(request),
    },
  },
});
