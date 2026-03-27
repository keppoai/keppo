import { createFileRoute } from "@tanstack/react-router";
import { handleOpenAiCallbackRequest } from "../../../../lib/server/automation-api";

export const Route = createFileRoute("/api/automations/openai/callback")({
  server: {
    handlers: {
      GET: ({ request }) => handleOpenAiCallbackRequest(request),
    },
  },
});
