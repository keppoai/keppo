import { createFileRoute } from "@tanstack/react-router";
import { handleInternalQueueDispatchRequest } from "../../../lib/server/operational-api";

export const Route = createFileRoute("/internal/queue/dispatch-approved-action")({
  server: {
    handlers: {
      POST: ({ request }) => handleInternalQueueDispatchRequest(request),
    },
  },
});
