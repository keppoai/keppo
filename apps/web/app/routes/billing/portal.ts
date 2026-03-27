import { createFileRoute } from "@tanstack/react-router";
import { handleBillingPortalRequest } from "../../lib/server/billing-api";

export const Route = createFileRoute("/billing/portal")({
  server: {
    handlers: {
      POST: ({ request }) => handleBillingPortalRequest(request),
    },
  },
});
