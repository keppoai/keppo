import { createFileRoute } from "@tanstack/react-router";
import { handleDocsSearchRequest, searchDocs } from "../../lib/server/search-api";

export { searchDocs };

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: async ({ request }) => await handleDocsSearchRequest(request),
    },
  },
});
