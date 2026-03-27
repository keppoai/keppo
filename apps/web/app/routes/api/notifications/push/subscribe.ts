import { createFileRoute } from "@tanstack/react-router";
import { handlePushSubscribeRequest } from "../../../../lib/server/internal-api";

export const Route = createFileRoute("/api/notifications/push/subscribe")({
  server: {
    handlers: {
      POST: async ({ request }) => await handlePushSubscribeRequest(request),
    },
  },
});
