import { createFileRoute } from "@tanstack/react-router";
import { handleOAuthProviderCallbackRequest } from "../../../../lib/server/oauth-api";

export const Route = createFileRoute("/oauth/integrations/$provider/callback" as never)({
  server: {
    handlers: {
      GET: ({ request }) => handleOAuthProviderCallbackRequest(request),
    },
  },
});
