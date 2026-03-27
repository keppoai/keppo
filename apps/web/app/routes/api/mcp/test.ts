import { createFileRoute } from "@tanstack/react-router";
import { handleWorkspaceMcpTestRequest } from "../../../lib/server/internal-api";

export const Route = createFileRoute("/api/mcp/test")({
  server: {
    handlers: {
      GET: async ({ request }) => await handleWorkspaceMcpTestRequest(request),
    },
  },
});
