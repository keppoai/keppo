import { createFileRoute } from "@tanstack/react-router";
import { handleBillingCheckoutRequest } from "../../lib/server/billing-api";

export const Route = createFileRoute("/billing/checkout")({
  server: {
    handlers: {
      POST: ({ request }) => handleBillingCheckoutRequest(request),
    },
  },
});
