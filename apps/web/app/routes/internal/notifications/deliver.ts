import { createFileRoute } from "@tanstack/react-router";
import { handleInternalNotificationsDeliverRequest } from "../../../lib/server/operational-api";

export const Route = createFileRoute("/internal/notifications/deliver")({
  server: {
    handlers: {
      POST: ({ request }) => handleInternalNotificationsDeliverRequest(request),
    },
  },
});
