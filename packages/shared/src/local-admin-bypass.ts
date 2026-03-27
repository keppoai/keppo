type LocalAdminBypassEnv = {
  KEPPO_LOCAL_ADMIN_BYPASS?: string | boolean | null | undefined;
  NODE_ENV?: string | null | undefined;
  KEPPO_URL?: string | null | undefined;
  CONVEX_DEPLOYMENT?: string | null | undefined;
  CONVEX_SITE_URL?: string | null | undefined;
  CONVEX_CLOUD_URL?: string | null | undefined;
  CONVEX_URL?: string | null | undefined;
  CONVEX_SELF_HOSTED_URL?: string | null | undefined;
};

const toNormalizedString = (value: string | boolean | null | undefined): string => {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return typeof value === "string" ? value.trim().toLowerCase() : "";
};

const isLoopbackUrl = (value: string | boolean | null | undefined): boolean => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const hasLocalRuntimeSignal = (env: LocalAdminBypassEnv): boolean => {
  const deployment = toNormalizedString(env.CONVEX_DEPLOYMENT);
  if (deployment.startsWith("local:") || deployment.startsWith("anonymous:")) {
    return true;
  }

  const mode = toNormalizedString(env.NODE_ENV);
  if ((mode === "development" || mode === "test") && isLoopbackUrl(env.KEPPO_URL)) {
    return true;
  }

  return (
    isLoopbackUrl(env.CONVEX_SITE_URL) ||
    isLoopbackUrl(env.CONVEX_CLOUD_URL) ||
    isLoopbackUrl(env.CONVEX_URL) ||
    isLoopbackUrl(env.CONVEX_SELF_HOSTED_URL)
  );
};

export const isLocalAdminBypassEnabled = (env: LocalAdminBypassEnv): boolean => {
  return toNormalizedString(env.KEPPO_LOCAL_ADMIN_BYPASS) === "true" && hasLocalRuntimeSignal(env);
};
