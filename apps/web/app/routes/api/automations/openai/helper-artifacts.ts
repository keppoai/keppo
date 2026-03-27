import { createFileRoute } from "@tanstack/react-router";
import { handleOpenAiHelperArtifactsRequest } from "../../../../lib/server/automation-api";

export const Route = createFileRoute("/api/automations/openai/helper-artifacts")({
  server: {
    handlers: {
      GET: ({ request }) => handleOpenAiHelperArtifactsRequest(request),
    },
  },
});
