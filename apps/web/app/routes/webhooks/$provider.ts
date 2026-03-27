import { createFileRoute } from "@tanstack/react-router";
import { handleProviderWebhookRequest } from "../../lib/server/webhook-api";

export const Route = createFileRoute("/webhooks/$provider")({
  server: {
    handlers: {
      POST: ({ request }) => handleProviderWebhookRequest(request),
    },
  },
});
