import { maybeLoadApiRuntimeEnv } from "./runtime-env";
import { parseApiEnv, type ApiEnv } from "./env-schema";

export { API_ENV_KEYS, parseApiEnv, type ApiEnv, type ApiEnvMode } from "./env-schema";

const getLoadedProcessEnv = (): NodeJS.ProcessEnv => {
  maybeLoadApiRuntimeEnv();
  return process.env;
};

export const getEnv = (): ApiEnv => parseApiEnv(getLoadedProcessEnv(), { validateRequired: false });

export const validateApiEnvForBoot = (): ApiEnv =>
  parseApiEnv(getLoadedProcessEnv(), { validateRequired: true });

export const getRawEnv = (): NodeJS.ProcessEnv => getLoadedProcessEnv();
