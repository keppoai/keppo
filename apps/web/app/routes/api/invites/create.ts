import { createFileRoute } from "@tanstack/react-router";
import { handleInviteCreateRequest } from "../../../lib/server/internal-api";

export const Route = createFileRoute("/api/invites/create")({
  server: {
    handlers: {
      POST: async ({ request }) => await handleInviteCreateRequest(request),
    },
  },
});
