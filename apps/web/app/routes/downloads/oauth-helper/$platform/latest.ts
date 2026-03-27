import { createFileRoute } from "@tanstack/react-router";
import { handleOAuthHelperLatestDownloadRequest } from "../../../../lib/server/operational-api";

export const Route = createFileRoute("/downloads/oauth-helper/$platform/latest")({
  server: {
    handlers: {
      GET: ({ request }) => handleOAuthHelperLatestDownloadRequest(request),
    },
  },
});
