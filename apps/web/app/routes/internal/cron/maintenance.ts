import { createFileRoute } from "@tanstack/react-router";
import { handleInternalCronMaintenanceRequest } from "../../../lib/server/operational-api";

export const Route = createFileRoute("/internal/cron/maintenance")({
  server: {
    handlers: {
      GET: ({ request }) => handleInternalCronMaintenanceRequest(request),
      POST: ({ request }) => handleInternalCronMaintenanceRequest(request),
    },
  },
});
