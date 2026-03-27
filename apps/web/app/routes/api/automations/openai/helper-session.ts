import { createFileRoute } from "@tanstack/react-router";
import { handleOpenAiHelperSessionRequest } from "../../../../lib/server/automation-api";

export const Route = createFileRoute("/api/automations/openai/helper-session")({
  server: {
    handlers: {
      GET: ({ request }) => handleOpenAiHelperSessionRequest(request),
    },
  },
});
