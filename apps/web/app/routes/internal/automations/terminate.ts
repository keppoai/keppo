import { createFileRoute } from "@tanstack/react-router";
import { handleInternalAutomationTerminateRequest } from "../../../lib/server/automation-runtime";

export const Route = createFileRoute("/internal/automations/terminate")({
  server: {
    handlers: {
      POST: ({ request }) => handleInternalAutomationTerminateRequest(request),
    },
  },
});
