import { createFileRoute } from "@tanstack/react-router";
import { handleOpenAiConnectRequest } from "../../../../lib/server/automation-api";

export const Route = createFileRoute("/api/automations/openai/connect")({
  server: {
    handlers: {
      GET: ({ request }) => handleOpenAiConnectRequest(request),
    },
  },
});
