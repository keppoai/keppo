import { createFileRoute } from "@tanstack/react-router";
import { handleOpenAiHelperCallbackRequest } from "../../../../../lib/server/automation-api";

export const Route = createFileRoute("/api/automations/openai/helper/callback")({
  server: {
    handlers: {
      POST: ({ request }) => handleOpenAiHelperCallbackRequest(request),
    },
  },
});
