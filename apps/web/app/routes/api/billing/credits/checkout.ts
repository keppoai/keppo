import { createFileRoute } from "@tanstack/react-router";
import { handleBillingCreditsCheckoutRequest } from "../../../../lib/server/billing-api";

export const Route = createFileRoute("/api/billing/credits/checkout")({
  server: {
    handlers: {
      POST: ({ request }) => handleBillingCreditsCheckoutRequest(request),
    },
  },
});
