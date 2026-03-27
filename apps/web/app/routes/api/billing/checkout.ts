import { createFileRoute } from "@tanstack/react-router";
import { handleBillingCheckoutRequest } from "../../../lib/server/billing-api";

export const Route = createFileRoute("/api/billing/checkout")({
  server: {
    handlers: {
      POST: ({ request }) => handleBillingCheckoutRequest(request),
    },
  },
});
