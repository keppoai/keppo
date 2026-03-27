const trimTrailingSlash = (value: string): string => value.replace(/\/$/, "");

/** Dashboard auth is always same-origin (`/api/auth/*`); cross-domain Better Auth is not supported. */
export const isSameSiteAuthEnabled = (): boolean => true;

export const resolveAuthBaseUrl = (params: { dashboardBaseUrl: string }): string => {
  return trimTrailingSlash(params.dashboardBaseUrl);
};
