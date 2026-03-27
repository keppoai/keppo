import { createFileRoute } from "@tanstack/react-router";
import { handleStartOwnedMcpRequest } from "../../lib/server/mcp-api";

export const Route = createFileRoute("/mcp/$workspaceId" as never)({
  server: {
    handlers: {
      GET: ({ request }) => handleStartOwnedMcpRequest(request),
      POST: ({ request }) => handleStartOwnedMcpRequest(request),
      DELETE: ({ request }) => handleStartOwnedMcpRequest(request),
    },
  },
});
