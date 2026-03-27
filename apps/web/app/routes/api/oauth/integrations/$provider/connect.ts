import { createFileRoute } from "@tanstack/react-router";
import { handleOAuthProviderConnectRequest } from "../../../../../lib/server/oauth-api";

export const Route = createFileRoute("/api/oauth/integrations/$provider/connect")({
  server: {
    handlers: {
      POST: ({ request }) => handleOAuthProviderConnectRequest(request),
    },
  },
});
