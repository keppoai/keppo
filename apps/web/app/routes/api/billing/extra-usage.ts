import { createFileRoute } from "@tanstack/react-router";
import { handleBillingExtraUsageRequest } from "../../../lib/server/billing-api";

export const Route = createFileRoute("/api/billing/extra-usage")({
  server: {
    handlers: {
      POST: ({ request }) => handleBillingExtraUsageRequest(request),
    },
  },
});
