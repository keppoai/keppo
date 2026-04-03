/**
 * Canonical flag: `ENABLE_EMAIL_PASSWORD` (Convex + repo env).
 * Injects `import.meta.env.VITE_ENABLE_EMAIL_PASSWORD` (`"true"` | `"false"`).
 * Legacy: `VITE_ENABLE_EMAIL_PASSWORD` when `ENABLE_EMAIL_PASSWORD` is unset.
 */
export function resolveEnableEmailPasswordForViteClient(): "true" | "false" {
  const raw = process.env["ENABLE_EMAIL_PASSWORD"] ?? process.env["VITE_ENABLE_EMAIL_PASSWORD"];
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return "true";
  }
  return "false";
}

export function getEnableEmailPasswordDefine(): Record<string, string> {
  const value = resolveEnableEmailPasswordForViteClient();
  return {
    "import.meta.env.VITE_ENABLE_EMAIL_PASSWORD": JSON.stringify(value),
  };
}

export function resolveClientBuildIdForViteClient(): string {
  return (
    process.env["VERCEL_DEPLOYMENT_ID"] ??
    process.env["KEPPO_RELEASE_VERSION"] ??
    process.env["VERCEL_GIT_COMMIT_SHA"] ??
    ""
  )
    .trim()
    .slice(0, 256);
}

export function getClientBuildIdDefine(): Record<string, string> {
  const value = resolveClientBuildIdForViteClient();
  return {
    "import.meta.env.VITE_KEPPO_CLIENT_BUILD_ID": JSON.stringify(value),
  };
}

export function getKeppoClientEnvDefine(): Record<string, string> {
  return {
    ...getEnableEmailPasswordDefine(),
    ...getClientBuildIdDefine(),
  };
}
