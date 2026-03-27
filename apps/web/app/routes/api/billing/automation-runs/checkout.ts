import { createFileRoute } from "@tanstack/react-router";
import { handleBillingAutomationRunCheckoutRequest } from "../../../../lib/server/billing-api";

export const Route = createFileRoute("/api/billing/automation-runs/checkout")({
  server: {
    handlers: {
      POST: ({ request }) => handleBillingAutomationRunCheckoutRequest(request),
    },
  },
});
