import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const trim = (value) => (typeof value === "string" ? value.trim() : "");

const managedConvexEnv = [
  { key: "NODE_ENV", modes: ["local"], defaultByMode: { local: "development" } },
  { key: "BETTER_AUTH_SECRET", modes: ["local", "hosted"] },
  { key: "KEPPO_URL", modes: ["local", "hosted"] },
  {
    key: "ENABLE_EMAIL_PASSWORD",
    modes: ["local", "hosted"],
    defaultByMode: { local: "true", hosted: "false" },
  },
  {
    key: "KEPPO_ENVIRONMENT",
    modes: ["hosted"],
    hostedEnvironments: ["preview", "staging", "production"],
  },
  { key: "KEPPO_ADMIN_USER_IDS", modes: ["local", "hosted"] },
  {
    key: "KEPPO_LOCAL_ADMIN_BYPASS",
    modes: ["local", "hosted"],
    defaultByMode: { local: "false", hosted: "false" },
  },
  { key: "KEPPO_ACTION_TTL_MINUTES", modes: ["local", "hosted"] },
  { key: "KEPPO_RUN_INACTIVITY_MINUTES", modes: ["local", "hosted"] },
  { key: "BETTER_AUTH_TRUSTED_ORIGINS", modes: ["local", "hosted"] },
  { key: "MAILGUN_API_KEY", modes: ["local", "hosted"] },
  { key: "MAILGUN_DOMAIN", modes: ["local", "hosted"] },
  { key: "MAILGUN_FROM_EMAIL", modes: ["local", "hosted"] },
  { key: "ALLOWED_EMAIL_DOMAINS", modes: ["local", "hosted"] },
  { key: "KEPPO_CALLBACK_HMAC_SECRET", modes: ["local", "hosted"] },
  { key: "KEPPO_OAUTH_STATE_SECRET", modes: ["local"] },
  { key: "KEPPO_CRON_SECRET", modes: ["local", "hosted"] },
  { key: "KEPPO_API_INTERNAL_BASE_URL", modes: ["local", "hosted"] },
  { key: "KEPPO_MASTER_KEY", modes: ["local", "hosted"] },
  { key: "KEPPO_MASTER_KEY_INTEGRATION", modes: ["local"] },
  { key: "KEPPO_MASTER_KEY_ACTION", modes: ["local"] },
  { key: "KEPPO_MASTER_KEY_BLOB", modes: ["local"] },
  { key: "KEPPO_LLM_GATEWAY_URL", modes: ["local", "hosted"] },
  { key: "KEPPO_LOCAL_QUEUE_CONSUMER_URL", modes: ["local"] },
  {
    key: "VERCEL_AUTOMATION_BYPASS_SECRET",
    modes: ["hosted"],
    hostedEnvironments: ["preview", "staging"],
  },
];

export const managedConvexEnvEntries = managedConvexEnv;
export const managedConvexEnvKeys = managedConvexEnv.map((entry) => entry.key);

export const unmanagedConvexEnvKeys = [
  "CONVEX_CLOUD_URL",
  "CONVEX_DEPLOYMENT",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SITE_URL",
  "CONVEX_URL",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "KEPPO_ALLOW_DANGEROUS_DROP_ALL",
  "KEPPO_ALLOW_INSECURE_CUSTOM_MCP_HTTP",
  "KEPPO_E2E_MODE",
  "KEPPO_E2E_PORT_BASE",
  "KEPPO_E2E_PORT_BLOCK_SIZE",
  "KEPPO_E2E_RUNTIME_SIGNAL",
  "KEPPO_E2E_WORKER_INDEX",
  "KEPPO_ENABLE_TEST_ONLY_DECRYPT",
  "KEPPO_NOTIFICATIONS_DELIVERY_URL",
  "KEPPO_PROCESS_APPROVED_ACTIONS_INLINE",
  "KEPPO_QUEUE_ENQUEUE_SWEEP_LIMIT",
  "KEPPO_QUEUE_SECRET",
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
  "STRIPE_CLIENT_ID",
  "STRIPE_SECRET_KEY",
  "VERCEL_CRON_SECRET",
];

const normalizeEnvironment = (value) => trim(value).toLowerCase();

const appliesToMode = (entry, mode, environment) => {
  if (!entry.modes.includes(mode)) {
    return false;
  }
  if (mode !== "hosted" || !Array.isArray(entry.hostedEnvironments)) {
    return true;
  }
  const normalizedEnvironment = normalizeEnvironment(environment);
  if (!normalizedEnvironment) {
    return true;
  }
  return entry.hostedEnvironments.includes(normalizedEnvironment);
};

const resolveDefaultValue = (entry, mode) => trim(entry.defaultByMode?.[mode]);

export const listManagedConvexEnvKeys = (mode, environment = process.env.KEPPO_ENVIRONMENT) =>
  managedConvexEnv
    .filter((entry) => appliesToMode(entry, mode, environment))
    .map((entry) => entry.key);

export const collectManagedConvexEnvValues = ({ mode, env = process.env }) => {
  const values = {};
  for (const entry of managedConvexEnv) {
    if (!appliesToMode(entry, mode, env.KEPPO_ENVIRONMENT)) {
      continue;
    }
    const hasExplicitValue = Object.prototype.hasOwnProperty.call(env, entry.key);
    const raw = trim(env[entry.key]);
    if (hasExplicitValue) {
      values[entry.key] = raw;
      continue;
    }
    const defaultValue = resolveDefaultValue(entry, mode);
    if (defaultValue) {
      values[entry.key] = defaultValue;
    }
  }
  return values;
};

export const deriveFromBaseUrl = (baseUrl, pathname) => {
  const normalized = trim(baseUrl);
  if (!normalized) {
    return "";
  }
  try {
    const parsed = new URL(normalized);
    const resolved = new URL(pathname, parsed);
    return resolved.toString();
  } catch {
    return "";
  }
};

export const deriveOriginFromVercelUrls = (branchUrl, deploymentUrl) => {
  const normalized = trim(branchUrl) || trim(deploymentUrl);
  if (!normalized) {
    return "";
  }
  const withProtocol = /^https?:\/\//u.test(normalized) ? normalized : `https://${normalized}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.origin;
  } catch {
    return "";
  }
};

const readEnvFile = (envFile) => {
  if (!trim(envFile)) {
    return {};
  }
  return parseEnv(readFileSync(envFile, "utf8"));
};

const overlayProcessEnv = (source, env) => {
  const merged = { ...source };
  for (const [key, value] of Object.entries(env)) {
    const normalized = trim(value);
    if (normalized) {
      merged[key] = normalized;
    }
  }
  return merged;
};

export const buildHostedConvexEnvValues = ({ mode, envFile, env = process.env }) => {
  const fileValues = mode === "preview" ? {} : readEnvFile(envFile);
  const values =
    mode === "preview" ? overlayProcessEnv({}, env) : overlayProcessEnv(fileValues, env);

  const keppoUrl =
    trim(values.KEPPO_URL) || deriveOriginFromVercelUrls(values.VERCEL_BRANCH_URL, values.VERCEL_URL);
  if (keppoUrl) {
    values.KEPPO_URL = keppoUrl;
    values.KEPPO_DASHBOARD_ORIGIN = keppoUrl;
  }

  if (mode === "preview" && !trim(values.ENABLE_EMAIL_PASSWORD)) {
    values.ENABLE_EMAIL_PASSWORD = "true";
  }

  const apiBase =
    trim(values.KEPPO_API_INTERNAL_BASE_URL) || deriveFromBaseUrl(keppoUrl, "/api");
  if (apiBase) {
    values.KEPPO_API_INTERNAL_BASE_URL = apiBase;
  }

  if (!trim(values.BETTER_AUTH_TRUSTED_ORIGINS) && keppoUrl) {
    values.BETTER_AUTH_TRUSTED_ORIGINS = keppoUrl;
  }

  if (!trim(values.CORS_ALLOWED_ORIGINS) && keppoUrl) {
    values.CORS_ALLOWED_ORIGINS = keppoUrl;
  }

  if (!trim(values.CONVEX_URL) && trim(values.VITE_CONVEX_URL)) {
    values.CONVEX_URL = trim(values.VITE_CONVEX_URL);
  }

  return values;
};

export const collectHostedManagedConvexEnvValues = ({ mode, envFile, env = process.env }) =>
  collectManagedConvexEnvValues({
    mode: "hosted",
    env: buildHostedConvexEnvValues({ mode, envFile, env }),
  });
