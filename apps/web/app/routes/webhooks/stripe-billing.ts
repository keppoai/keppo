import { createFileRoute } from "@tanstack/react-router";
import { handleStripeBillingWebhookRequest } from "../../lib/server/billing-api";

export const Route = createFileRoute("/webhooks/stripe-billing")({
  server: {
    handlers: {
      POST: ({ request }) => handleStripeBillingWebhookRequest(request),
    },
  },
});
