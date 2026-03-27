import { createFileRoute } from "@tanstack/react-router";
import { handleInternalAutomationCompleteRequest } from "../../../lib/server/automation-runtime";

export const Route = createFileRoute("/internal/automations/complete")({
  server: {
    handlers: {
      POST: ({ request }) => handleInternalAutomationCompleteRequest(request),
    },
  },
});
