import { createFileRoute } from "@tanstack/react-router";
import { handleBillingUsageRequest } from "../../lib/server/billing-api";

export const Route = createFileRoute("/billing/usage")({
  server: {
    handlers: {
      GET: ({ request }) => handleBillingUsageRequest(request),
    },
  },
});
