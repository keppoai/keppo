import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { magicLinkClient, organizationClient } from "better-auth/client/plugins";

export const resolveAuthClientBaseUrl = (params?: {
  windowOrigin?: string | undefined;
  envOrigin?: string | undefined;
}): string | undefined => {
  return params?.windowOrigin ?? params?.envOrigin;
};

const deriveLocalSiteUrl = (convexUrl: string | undefined): string | undefined => {
  if (!convexUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(convexUrl);
    const defaultPort = parsed.protocol === "https:" ? 443 : 80;
    const convexPort = Number.parseInt(parsed.port || String(defaultPort), 10);
    if (!Number.isFinite(convexPort)) {
      return undefined;
    }
    parsed.port = String(convexPort + 1);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
};

const sameSiteBaseUrl =
  import.meta.env.VITE_KEPPO_URL ??
  import.meta.env.VITE_CONVEX_SITE_URL ??
  deriveLocalSiteUrl(import.meta.env.VITE_CONVEX_URL);

export const authBaseUrl = resolveAuthClientBaseUrl({
  windowOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
  envOrigin: sameSiteBaseUrl,
});

export const authClient = createAuthClient({
  ...(authBaseUrl ? { baseURL: authBaseUrl } : {}),
  plugins: [convexClient(), magicLinkClient(), organizationClient()],
});
