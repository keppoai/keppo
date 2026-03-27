import { ConvexReactClient } from "convex/react";
import { resolveConvexUrl } from "./convex-url";
export { api } from "../../../../convex/_generated/api";

export const convex = new ConvexReactClient(
  resolveConvexUrl({
    VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL,
  }),
  {
    expectAuth: true,
  },
);
