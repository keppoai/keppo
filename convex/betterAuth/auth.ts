import { convex } from "@convex-dev/better-auth/plugins";
import { convexAdapter, type GenericCtx } from "@convex-dev/better-auth";
import { magicLink, organization } from "better-auth/plugins";
import type { BetterAuthOptions } from "better-auth/minimal";
import { authAccessControl, authAccessControlRoles } from "./access_control";

const isTruthyEnvFlag = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const isLoopbackSiteUrl = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(value.trim());
};

const CONVEX_ANALYSIS_SECRET = "convex-analysis-placeholder-secret-0123456789";
type ConvexAdapterApi = Parameters<typeof convexAdapter>[1];

const resolveBetterAuthSecret = (options?: { allowAnalysisPlaceholder?: boolean }): string => {
  const value = process.env.BETTER_AUTH_SECRET?.trim();
  if (value) {
    return value;
  }
  if (options?.allowAnalysisPlaceholder) {
    // `createApi()` evaluates auth options during Convex module analysis before runtime env exists.
    return CONVEX_ANALYSIS_SECRET;
  }
  throw new Error("Missing BETTER_AUTH_SECRET.");
};

export const createAuthOptions = (ctx: GenericCtx): BetterAuthOptions => {
  const analysisApi = {} as unknown as ConvexAdapterApi;
  const emailPasswordEnabled =
    isTruthyEnvFlag(process.env.ENABLE_EMAIL_PASSWORD) || isLoopbackSiteUrl(process.env.KEPPO_URL);
  return {
    database: convexAdapter(ctx, analysisApi),
    secret: resolveBetterAuthSecret({ allowAnalysisPlaceholder: true }),
    rateLimit: {
      storage: "database",
    },
    ...(emailPasswordEnabled
      ? {
          emailAndPassword: {
            enabled: true,
            requireEmailVerification: false,
          },
        }
      : {}),
    plugins: [
      magicLink({
        sendMagicLink: async () => {},
      }),
      organization({
        ac: authAccessControl as NonNullable<Parameters<typeof organization>[0]>["ac"],
        roles: authAccessControlRoles,
        creatorRole: "owner",
      }),
      convex({
        authConfig: { providers: [{ applicationID: "convex", domain: "" }] },
      }),
    ],
  };
};
