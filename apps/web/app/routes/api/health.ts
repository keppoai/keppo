import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          runtime: "tanstack-start",
          app: "@keppo/web",
        }),
    },
  },
});
