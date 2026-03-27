import { createFileRoute } from "@tanstack/react-router";
import { handleInternalAutomationLogRequest } from "../../../lib/server/automation-runtime";

export const Route = createFileRoute("/internal/automations/log")({
  server: {
    handlers: {
      POST: ({ request }) => handleInternalAutomationLogRequest(request),
    },
  },
});
