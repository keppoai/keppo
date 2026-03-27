import { createFileRoute } from "@tanstack/react-router";
import { handleInviteAcceptRequest } from "../../../lib/server/internal-api";

export const Route = createFileRoute("/api/invites/accept")({
  server: {
    handlers: {
      POST: async ({ request }) => await handleInviteAcceptRequest(request),
    },
  },
});
