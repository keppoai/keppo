import { createFileRoute } from "@tanstack/react-router";
import { handleGenerateAutomationQuestionsRequest } from "../../../lib/server/automation-api";

export const Route = createFileRoute("/api/automations/generate-questions")({
  server: {
    handlers: {
      POST: ({ request }) => handleGenerateAutomationQuestionsRequest(request),
    },
  },
});
