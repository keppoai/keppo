import { createFileRoute } from "@tanstack/react-router";
import { handleInternalAutomationDispatchRequest } from "../../../lib/server/automation-runtime";

export const Route = createFileRoute("/internal/automations/dispatch")({
  server: {
    handlers: {
      POST: ({ request }) => handleInternalAutomationDispatchRequest(request),
    },
  },
});
