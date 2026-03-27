import { createFileRoute } from "@tanstack/react-router";
import { handleGenerateAutomationPromptRequest } from "../../../lib/server/automation-api";

export const Route = createFileRoute("/api/automations/generate-prompt")({
  server: {
    handlers: {
      POST: ({ request }) => handleGenerateAutomationPromptRequest(request),
    },
  },
});
