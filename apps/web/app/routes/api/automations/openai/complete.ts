import { createFileRoute } from "@tanstack/react-router";
import { handleCompleteOpenAiOauthRequest } from "../../../../lib/server/automation-api";

export const Route = createFileRoute("/api/automations/openai/complete")({
  server: {
    handlers: {
      POST: ({ request }) => handleCompleteOpenAiOauthRequest(request),
    },
  },
});
