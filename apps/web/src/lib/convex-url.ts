export const resolveConvexUrl = (env: { VITE_CONVEX_URL?: string | undefined }): string => {
  const convexUrl = env.VITE_CONVEX_URL?.trim();
  if (convexUrl) {
    return convexUrl;
  }

  throw new Error(
    "Missing VITE_CONVEX_URL. Hosted builds must provide a Convex deployment URL instead of falling back to localhost.",
  );
};
