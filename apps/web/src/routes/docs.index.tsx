import { createRoute } from "@tanstack/react-router";
import { DocsHomePage } from "./docs.lazy";
import { docsRoute } from "./docs";

export const docsHomeRoute = createRoute({
  getParentRoute: () => docsRoute,
  path: "/",
  component: DocsHomePage,
});
