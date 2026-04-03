import { createHash, createHmac, timingSafeEqual, webcrypto } from "node:crypto";
import {
  AI_KEY_CREDENTIAL_KIND,
  AI_KEY_MODE,
  AI_MODEL_PROVIDER,
  AUTOMATION_RUN_CONFIG_KEYS,
  AUTOMATION_RUN_EVENT_TYPE,
  AUTOMATION_RUN_EVENT_TYPES,
  AUTOMATION_RUN_LOG_LEVELS,
  AUTOMATION_ROUTE_ERROR_CODES,
  AUTOMATION_RUNNER_TYPE,
  createAutomationRouteError,
  isAutomationRunStatus,
  isAutomationRunTerminalStatus,
  isAutomationRouteErrorCode,
  normalizeAutomationMemory,
  parseAutomationRouteErrorCode,
  type AiKeyCredentialKind,
  type AiKeyMode,
  type AiModelProvider,
  type AutomationRouteErrorCode,
  type AutomationRunEventType,
  type AutomationRunLogLevel,
  type AutomationRunTerminalStatus,
  type AutomationRunnerType,
  type NetworkAccessMode,
} from "@keppo/shared/automations";
import {
  isJsonRecord,
  parseJsonValue,
  tryParseJsonValue,
} from "@keppo/shared/providers/boundaries/json";
import { getEnv, getRawEnv } from "../env.js";
import type { AutomationSandboxProviderMode } from "../sandbox/index.js";

const VERCEL_PROTECTION_BYPASS_PARAM = "x-vercel-protection-bypass";
const VERCEL_PROTECTION_BYPASS_HEADER = "x-vercel-protection-bypass";
const automationRunLogLevelSet = new Set<AutomationRunLogLevel>(AUTOMATION_RUN_LOG_LEVELS);
const automationRouteErrorCodeSet = new Set<AutomationRouteErrorCode>(AUTOMATION_ROUTE_ERROR_CODES);

type StoredOpenAiOauthPayload = {
  version: 1;
  provider: "openai";
  kind: "oauth";
  credentials: StoredOpenAiOauthCredentials;
};

type ClassifiedEvent = {
  event_type: AutomationRunEventType;
  event_data: Record<string, unknown>;
};

export type StoredOpenAiOauthCredentials = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scopes: string[];
  email: string | null;
  account_id: string | null;
  id_token: string | null;
  token_type: string | null;
  last_refresh: string | null;
};

export type AutomationOpenAiOauthKeyRef = {
  org_id: string;
  created_by: string;
};

export type ParsedLogLine = {
  level: AutomationRunLogLevel;
  content: string;
  event_type?: AutomationRunEventType;
  event_data?: Record<string, unknown>;
};

const TOOL_CALL_PATTERN = /^tool\s+([\w.]+)\((.*)\)$/s;
const TOOL_RESULT_PATTERN = /^([\w.]+)\(.*\)\s+(success|error)\s+in\s+(\d+)ms:/;
const MCP_TOOL_START_PATTERN = /^mcp:\s+keppo\/(search_tools|execute_code)\s+started$/;
const MCP_TOOL_RESULT_PATTERN =
  /^mcp:\s+keppo\/(search_tools|execute_code)\s+\((completed|failed)\)$/;
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CONFIG_KEY_PATTERN = new RegExp(
  `^(${AUTOMATION_RUN_CONFIG_KEYS.map((key) => escapeRegExp(key)).join("|")}):\\s*(.+)$`,
  "i",
);
const MCP_INITIALIZE_PAYLOAD = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: {
      name: "keppo-automation-dispatch",
      version: "0.1.0",
    },
  },
} as const;

const errorToMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

export const extractAutomationRouteError = (
  error: unknown,
): { code: AutomationRouteErrorCode | null; message: string } => {
  const fullMessage = errorToMessage(error);
  const code = parseAutomationRouteErrorCode(fullMessage);
  if (!code || !isAutomationRouteErrorCode(code) || !automationRouteErrorCodeSet.has(code)) {
    return { code: null, message: fullMessage };
  }
  const message = fullMessage.replace(/^([a-z0-9_]+):\s/u, "").trim();
  return {
    code,
    message: message.length > 0 ? message : fullMessage,
  };
};

const isRelaxedEnv = (env = getEnv()): boolean => {
  const mode = env.NODE_ENV?.trim().toLowerCase();
  return mode === "development" || mode === "test" || env.KEPPO_E2E_MODE;
};

const requireNonEmptyEnv = (name: string): string => {
  const value = getRawEnv()[name]?.trim();
  if (!value) {
    throw createAutomationRouteError("missing_env", `Missing ${name}.`);
  }
  return value;
};

export const resolveAutomationCallbackSecret = (env = getEnv()): string => {
  const explicit = env.KEPPO_CALLBACK_HMAC_SECRET;
  if (explicit) {
    return explicit;
  }
  if (isRelaxedEnv(env)) {
    const relaxedFallback = env.BETTER_AUTH_SECRET;
    if (relaxedFallback) {
      return relaxedFallback;
    }
  }
  throw createAutomationRouteError("missing_env", "Missing KEPPO_CALLBACK_HMAC_SECRET.");
};

const resolveEncryptionSecret = (): string => {
  const env = getEnv();
  const explicit = env.KEPPO_MASTER_KEY_INTEGRATION;
  if (explicit) {
    return explicit;
  }
  const fallback = env.KEPPO_MASTER_KEY;
  if (fallback) {
    return fallback;
  }
  if (isRelaxedEnv(env)) {
    const relaxedFallback = env.BETTER_AUTH_SECRET;
    if (relaxedFallback) {
      return relaxedFallback;
    }
  }
  return requireNonEmptyEnv("KEPPO_MASTER_KEY");
};

const hexToBytes = (value: string): Uint8Array => {
  if (value.length % 2 !== 0) {
    throw createAutomationRouteError("invalid_hex", "Invalid hex payload");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    bytes[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
  }
  return bytes;
};

export const decryptStoredKey = async (encrypted: string): Promise<string> => {
  const parts = encrypted.split(".");
  if (parts.length !== 3 || parts[0] !== "keppo-v1") {
    throw createAutomationRouteError("invalid_ciphertext", "Invalid ciphertext payload");
  }
  const iv = hexToBytes(parts[1] ?? "");
  const ciphertext = hexToBytes(parts[2] ?? "");

  const digest = await webcrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(resolveEncryptionSecret()),
  );
  const key = await webcrypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const clear = await webcrypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(clear);
};

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

const asNullableString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const parseJsonRecordOrThrow = (raw: string, message: string): Record<string, unknown> => {
  const parsed = parseJsonValue(raw, { message });
  if (!isJsonRecord(parsed)) {
    throw new Error(message);
  }
  return parsed;
};

const parseJwtPayload = (token: string | null): Record<string, unknown> | null => {
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const padded = parts[1]!.padEnd(Math.ceil(parts[1]!.length / 4) * 4, "=");
    const decoded = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    const parsed = parseJsonValue(decoded);
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const extractOpenAiAccountId = (
  idToken: string | null,
  accessToken: string | null,
): string | null => {
  const payloads = [parseJwtPayload(idToken), parseJwtPayload(accessToken)];
  for (const payload of payloads) {
    if (!payload) {
      continue;
    }
    const nested = payload["https://api.openai.com/auth"];
    if (nested && typeof nested === "object" && nested !== null) {
      const accountId = asNullableString(
        (nested as Record<string, unknown>).chatgpt_account_id ??
          (nested as Record<string, unknown>).chatgpt_account_user_id,
      );
      if (accountId) {
        return accountId;
      }
    }
  }
  return null;
};

const extractOpenAiEmail = (idToken: string | null): string | null => {
  return asNullableString(parseJwtPayload(idToken)?.email);
};

const parseStoredOpenAiOauthPayload = (raw: string): StoredOpenAiOauthPayload => {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonRecordOrThrow(
      raw,
      "Stored OpenAI subscription credential is not valid JSON.",
    );
  } catch {
    throw createAutomationRouteError(
      "automation_route_failed",
      "Stored OpenAI subscription credential is not valid JSON.",
    );
  }
  const credentials = isJsonRecord(parsed.credentials) ? parsed.credentials : null;
  if (
    parsed.version !== 1 ||
    parsed.provider !== "openai" ||
    parsed.kind !== "oauth" ||
    !credentials ||
    typeof credentials.access_token !== "string" ||
    typeof credentials.refresh_token !== "string" ||
    typeof credentials.expires_at !== "string"
  ) {
    throw createAutomationRouteError(
      "automation_route_failed",
      "Stored OpenAI subscription credential is missing required OAuth fields.",
    );
  }
  return {
    version: 1,
    provider: "openai",
    kind: "oauth",
    credentials: {
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      expires_at: credentials.expires_at,
      scopes: asStringArray(credentials.scopes),
      email: asNullableString(credentials.email),
      account_id: asNullableString(credentials.account_id),
      id_token: asNullableString(credentials.id_token),
      token_type: asNullableString(credentials.token_type),
      last_refresh: asNullableString(credentials.last_refresh),
    },
  };
};

const isExpiredOrNearExpiry = (isoTimestamp: string, thresholdMs = 60_000): boolean => {
  const expiresMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(expiresMs)) {
    return true;
  }
  return Date.now() >= expiresMs - thresholdMs;
};

const resolveOpenAiOauthTokenUrl = (): string =>
  getEnv().OPENAI_OAUTH_TOKEN_URL ?? "https://auth.openai.com/oauth/token";

const resolveOpenAiOauthClientId = (): string => {
  const clientId = getEnv().OPENAI_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw createAutomationRouteError("missing_env", "Missing OPENAI_OAUTH_CLIENT_ID.");
  }
  return clientId;
};

const refreshOpenAiOauthToken = async (
  credentials: StoredOpenAiOauthCredentials,
): Promise<StoredOpenAiOauthCredentials> => {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: credentials.refresh_token,
    client_id: resolveOpenAiOauthClientId(),
  });
  const response = await fetch(resolveOpenAiOauthTokenUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  const text = await response.text();
  const parsed = tryParseJsonValue(text);
  if (!response.ok || !isJsonRecord(parsed)) {
    const detail = text.trim();
    throw createAutomationRouteError(
      "automation_route_failed",
      detail.length > 0
        ? `OpenAI OAuth refresh failed with status ${response.status}: ${detail}`
        : `OpenAI OAuth refresh failed with status ${response.status}.`,
    );
  }
  const record = parsed;
  const accessToken = asNullableString(record.access_token);
  const refreshToken = asNullableString(record.refresh_token) ?? credentials.refresh_token;
  const expiresIn =
    typeof record.expires_in === "number" && Number.isFinite(record.expires_in)
      ? record.expires_in
      : null;
  if (!accessToken || !expiresIn) {
    throw createAutomationRouteError(
      "automation_route_failed",
      "OpenAI OAuth refresh returned incomplete credentials.",
    );
  }
  const idToken = asNullableString(record.id_token) ?? credentials.id_token;
  const scope =
    typeof record.scope === "string" && record.scope.trim().length > 0
      ? record.scope.trim().split(/\s+/u)
      : credentials.scopes;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scopes: scope,
    email: extractOpenAiEmail(idToken) ?? credentials.email,
    account_id: extractOpenAiAccountId(idToken, accessToken) ?? credentials.account_id,
    id_token: idToken,
    token_type: asNullableString(record.token_type) ?? credentials.token_type,
    last_refresh: new Date().toISOString(),
  };
};

export const maybeRefreshOpenAiOauthCredentials = async (params: {
  key: AutomationOpenAiOauthKeyRef;
  decryptedKey: string;
  convex: {
    upsertOpenAiOauthKey: (args: {
      orgId: string;
      userId: string;
      credentials: StoredOpenAiOauthCredentials;
    }) => Promise<void>;
  };
}): Promise<StoredOpenAiOauthCredentials> => {
  const payload = parseStoredOpenAiOauthPayload(params.decryptedKey);
  if (!isExpiredOrNearExpiry(payload.credentials.expires_at)) {
    return payload.credentials;
  }
  const refreshed = await refreshOpenAiOauthToken(payload.credentials);
  await params.convex.upsertOpenAiOauthKey({
    orgId: params.key.org_id,
    userId: params.key.created_by,
    credentials: refreshed,
  });
  return refreshed;
};

export const createAutomationCallbackSignature = (
  path: string,
  automationRunId: string,
  expiresMs: number,
  env = getEnv(),
): string => {
  return createHmac("sha256", resolveAutomationCallbackSecret(env))
    .update(`${path}:${automationRunId}:${expiresMs}`)
    .digest("hex");
};

export const resolveAutomationCallbackBaseUrl = (requestUrl: string): string => {
  const explicit = getEnv().KEPPO_API_INTERNAL_BASE_URL;
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  return new URL(requestUrl).origin;
};

const normalizeKeppoEnvironment = (value: string | undefined): string | undefined => {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
};

export const shouldUseVercelAutomationBypassSecret = (
  env: NodeJS.ProcessEnv | { KEPPO_ENVIRONMENT?: string | undefined } = getRawEnv(),
): boolean => normalizeKeppoEnvironment(env.KEPPO_ENVIRONMENT) !== "production";

export const resolveVercelAutomationBypassSecret = (env = getEnv()): string | undefined => {
  if (!shouldUseVercelAutomationBypassSecret(env)) {
    return undefined;
  }
  return env.VERCEL_AUTOMATION_BYPASS_SECRET;
};

export const applyVercelProtectionBypassToUrl = (
  rawUrl: string,
  secret = resolveVercelAutomationBypassSecret(),
): string => {
  if (!secret) {
    return rawUrl;
  }
  try {
    const url = new URL(rawUrl);
    url.searchParams.set(VERCEL_PROTECTION_BYPASS_PARAM, secret);
    return url.toString();
  } catch {
    return rawUrl;
  }
};

export const applyVercelProtectionBypassHeader = (
  headers: Headers,
  secret = resolveVercelAutomationBypassSecret(),
): Headers => {
  if (secret) {
    headers.set(VERCEL_PROTECTION_BYPASS_HEADER, secret);
  }
  return headers;
};

const redactVercelProtectionBypassUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    if (url.searchParams.has(VERCEL_PROTECTION_BYPASS_PARAM)) {
      url.searchParams.set(VERCEL_PROTECTION_BYPASS_PARAM, "[redacted]");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
};

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
};

export const assertSandboxCallbackBaseUrlReachable = (
  baseUrl: string,
  providerMode: AutomationSandboxProviderMode,
): void => {
  if (providerMode !== "vercel") {
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw createAutomationRouteError(
      "automation_route_failed",
      `Invalid KEPPO_API_INTERNAL_BASE_URL for Vercel sandbox callbacks: ${baseUrl}`,
    );
  }
  if (isLoopbackHostname(parsed.hostname)) {
    throw createAutomationRouteError(
      "automation_route_failed",
      `Vercel sandbox callbacks cannot reach ${baseUrl}. Set KEPPO_API_INTERNAL_BASE_URL to a public API URL.`,
    );
  }
};

export const hasValidAutomationCallbackSignature = (
  request: Request,
  automationRunId: string,
): boolean => {
  const url = new URL(request.url);
  const signature = url.searchParams.get("signature")?.trim() ?? "";
  const expiresRaw = url.searchParams.get("expires")?.trim() ?? "";
  const signedRunId = url.searchParams.get("automation_run_id")?.trim() ?? "";
  if (!signature || !expiresRaw || !signedRunId || signedRunId !== automationRunId) {
    return false;
  }
  const expiresMs = Number(expiresRaw);
  if (!Number.isFinite(expiresMs) || Date.now() > expiresMs) {
    return false;
  }
  const expected = createAutomationCallbackSignature(url.pathname, automationRunId, expiresMs);
  const actualBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (actualBytes.length !== expectedBytes.length) {
    return false;
  }
  return timingSafeEqual(actualBytes, expectedBytes);
};

export const buildRunnerCommand = (params: {
  runnerType: AutomationRunnerType;
  aiModelProvider?: AiModelProvider;
  aiKeyMode?: AiKeyMode;
  credentialKind?: AiKeyCredentialKind;
  networkAccess: NetworkAccessMode;
  prompt: string;
  model: string;
}): string => {
  if (params.runnerType === AUTOMATION_RUNNER_TYPE.claudeCode) {
    const toolPermissionFlag =
      params.networkAccess === "mcp_only"
        ? ` --disallowed-tools ${shellQuote("WebFetch,WebSearch")}`
        : "";
    return `claude --model ${shellQuote(params.model)} --mcp-server "$KEPPO_MCP_SERVER_URL"${toolPermissionFlag} -p ${shellQuote(params.prompt)}`;
  }
  const networkFlag =
    params.networkAccess === "mcp_only"
      ? ` --config 'sandbox_mode="workspace-write"' --config 'sandbox_workspace_write={ network_access = false }'`
      : "";
  const automationApprovalBypassFlag = " --dangerously-bypass-approvals-and-sandbox";
  const customOpenAiProviderArgs = shouldUseCodexCustomOpenAiProvider(params)
    ? ` --config 'model_provider="${CODEX_CUSTOM_OPENAI_PROVIDER_ID}"'`
    : "";
  const codexCommand = `codex exec --json --skip-git-repo-check${automationApprovalBypassFlag}${customOpenAiProviderArgs} --model ${shellQuote(params.model)}${networkFlag} ${shellQuote(params.prompt)}`;
  return buildManagedCodexRunnerCommand(codexCommand);
};

export const buildAutomationRunnerPrompt = (prompt: string, memory?: string | null): string => {
  const task = prompt.trim();
  const normalizedMemory = normalizeAutomationMemory(memory);
  return [
    "You are running inside a Keppo automation.",
    ...(normalizedMemory
      ? [
          "Use the automation memory below as durable context from prior runs. It may be incomplete or stale, so verify it when needed and keep it concise.",
          "<memory>",
          normalizedMemory,
          "</memory>",
        ]
      : []),
    "Complete the requested task using the available MCP tools.",
    "If you learn durable context that should persist across runs, use add_memory or edit_memory to maintain automation memory.",
    "Call `record_outcome({ success, summary })` exactly once as your final tool call before you stop.",
    "Call `record_outcome` directly, not through `execute_code`.",
    "Use `success: true` when you accomplished the requested work. Waiting only for a human approval after you finished everything you can still counts as success.",
    "Use `success: false` when the requested work was not accomplished.",
    "The `summary` must be brief plain text. If success is true, say what was accomplished. If success is false, say what was not accomplished.",
    "",
    "Automation task:",
    task,
  ].join("\n");
};

const resolveCodexHomeDir = (providerMode: AutomationSandboxProviderMode): string => {
  return providerMode === "vercel"
    ? "/vercel/sandbox/.keppo-codex-home"
    : "/sandbox/.keppo-codex-home";
};

const CODEX_CUSTOM_OPENAI_PROVIDER_ID = "keppo_openai_api";

const buildCodexSessionArtifactUploadScript = (): string => {
  return [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const callbackUrl = process.env.KEPPO_SESSION_ARTIFACT_CALLBACK_URL ?? "";',
    'const runId = process.env.KEPPO_AUTOMATION_RUN_ID ?? "";',
    'const homeDir = process.env.HOME ?? "";',
    'const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";',
    "const MAX_BYTES = 5 * 1024 * 1024;",
    'const sessionsDir = path.join(homeDir, ".codex", "sessions");',
    "",
    "const walkSessionFiles = (dir, files = []) => {",
    "  if (!dir || !fs.existsSync(dir)) {",
    "    return files;",
    "  }",
    "  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {",
    "    const fullPath = path.join(dir, entry.name);",
    "    if (entry.isDirectory()) {",
    "      walkSessionFiles(fullPath, files);",
    "    } else if (entry.isFile() && /\\.(json|jsonl)$/u.test(entry.name)) {",
    "      files.push(fullPath);",
    "    }",
    "  }",
    "  return files;",
    "};",
    "",
    "(async () => {",
    "  if (!callbackUrl || !runId || !homeDir) {",
    "    return;",
    "  }",
    "  const sessionPath = walkSessionFiles(sessionsDir)",
    "    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];",
    "  if (!sessionPath) {",
    "    return;",
    "  }",
    "  const stat = fs.statSync(sessionPath);",
    "  if (!Number.isFinite(stat.size) || stat.size <= 0 || stat.size > MAX_BYTES) {",
    "    return;",
    "  }",
    '  const relativePath = path.posix.join("sessions", ...path.relative(sessionsDir, sessionPath).split(path.sep));',
    '  const contentBase64 = fs.readFileSync(sessionPath).toString("base64");',
    "  await fetch(callbackUrl, {",
    '    method: "POST",',
    "    headers: {",
    '      "content-type": "application/json",',
    '      ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),',
    "    },",
    "    body: JSON.stringify({",
    "      automation_run_id: runId,",
    "      relative_path: relativePath,",
    "      content_base64: contentBase64,",
    "    }),",
    "  });",
    "})().catch(() => {});",
  ].join("\n");
};

const buildCodexSessionArtifactUploadCommand = (): string => {
  return [
    '_keppo_runner_callback_url="${KEPPO_SESSION_ARTIFACT_CALLBACK_URL:-}"',
    'if [ -n "$_keppo_runner_callback_url" ]; then',
    `  node -e ${shellQuote(buildCodexSessionArtifactUploadScript())} || true`,
    "fi",
  ].join("\n");
};

const buildManagedCodexRunnerCommand = (codexCommand: string): string => {
  return [
    "{",
    "  _keppo_upload_session_artifact() {",
    buildCodexSessionArtifactUploadCommand()
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n"),
    "  }",
    "",
    '  _keppo_runner_child_pid=""',
    '  _keppo_runner_stopping="0"',
    '  _keppo_runner_grace_ms="${KEPPO_TIMEOUT_GRACE_MS:-5000}"',
    '  case "$_keppo_runner_grace_ms" in',
    '    ""|*[!0-9]*) _keppo_runner_grace_ms=5000 ;;',
    "  esac",
    "  _keppo_runner_grace_seconds=$(((_keppo_runner_grace_ms + 999) / 1000))",
    '  if [ "$_keppo_runner_grace_seconds" -lt 1 ]; then',
    "    _keppo_runner_grace_seconds=1",
    "  fi",
    "",
    "  _keppo_wait_for_runner_exit() {",
    '    if [ -z "$_keppo_runner_child_pid" ]; then',
    "      return 0",
    "    fi",
    '    _keppo_runner_remaining="$_keppo_runner_grace_seconds"',
    '    while [ "$_keppo_runner_remaining" -gt 0 ] && kill -0 "$_keppo_runner_child_pid" 2>/dev/null; do',
    "      sleep 1",
    "      _keppo_runner_remaining=$((_keppo_runner_remaining - 1))",
    "    done",
    '    wait "$_keppo_runner_child_pid" >/dev/null 2>&1 || true',
    "  }",
    "",
    "  _keppo_on_term() {",
    '    if [ "$_keppo_runner_stopping" = "1" ]; then',
    "      return",
    "    fi",
    '    _keppo_runner_stopping="1"',
    '    if [ -n "$_keppo_runner_child_pid" ]; then',
    '      kill -TERM "$_keppo_runner_child_pid" 2>/dev/null || true',
    "      _keppo_wait_for_runner_exit",
    "    fi",
    "    _keppo_upload_session_artifact",
    "    exit 143",
    "  }",
    "",
    "  trap '_keppo_on_term' TERM INT",
    `  sh -lc ${shellQuote(codexCommand)} &`,
    '  _keppo_runner_child_pid="$!"',
    '  wait "$_keppo_runner_child_pid"',
    '  _keppo_runner_exit="$?"',
    "  _keppo_upload_session_artifact",
    '  exit "$_keppo_runner_exit"',
    "}",
  ].join("\n");
};

const shouldUseCodexCustomOpenAiProvider = (params: {
  aiModelProvider?: AiModelProvider;
  aiKeyMode?: AiKeyMode;
  credentialKind?: AiKeyCredentialKind;
}): boolean => {
  if (params.aiModelProvider !== AI_MODEL_PROVIDER.openai) {
    return false;
  }
  if (
    params.aiKeyMode === AI_KEY_MODE.subscriptionToken &&
    params.credentialKind === AI_KEY_CREDENTIAL_KIND.openaiOauth
  ) {
    return false;
  }
  const fakeOpenAiBaseUrl = getEnv().KEPPO_E2E_MODE
    ? (getEnv().KEPPO_E2E_OPENAI_BASE_URL?.trim() ?? "")
    : "";
  return params.aiKeyMode === AI_KEY_MODE.bundled || fakeOpenAiBaseUrl.length > 0;
};

export const buildRunnerBootstrapCommand = (params: {
  runnerType: AutomationRunnerType;
  providerMode: AutomationSandboxProviderMode;
}): string => {
  if (params.runnerType === AUTOMATION_RUNNER_TYPE.claudeCode) {
    return "true";
  }
  const codexHomeDir = resolveCodexHomeDir(params.providerMode);
  return [
    `mkdir -p ${shellQuote(codexHomeDir)}`,
    `export HOME=${shellQuote(codexHomeDir)}`,
    `codex mcp add keppo --url "$KEPPO_MCP_SERVER_URL" --bearer-token-env-var KEPPO_MCP_BEARER_TOKEN`,
  ].join(" && ");
};

export const buildRunnerAuthBootstrapCommand = (params: {
  runnerType: AutomationRunnerType;
  providerMode: AutomationSandboxProviderMode;
  aiModelProvider?: AiModelProvider;
  aiKeyMode?: AiKeyMode;
  credentialKind?: AiKeyCredentialKind;
}): string => {
  if (params.runnerType !== AUTOMATION_RUNNER_TYPE.chatgptCodex) {
    return "true";
  }
  const codexHomeDir = resolveCodexHomeDir(params.providerMode);
  const fakeOpenAiBaseUrl = getEnv().KEPPO_E2E_MODE
    ? (getEnv().KEPPO_E2E_OPENAI_BASE_URL?.trim() ?? "")
    : "";
  const usesOpenAiOauth =
    params.aiModelProvider === AI_MODEL_PROVIDER.openai &&
    params.aiKeyMode === AI_KEY_MODE.subscriptionToken &&
    params.credentialKind === AI_KEY_CREDENTIAL_KIND.openaiOauth;
  if (usesOpenAiOauth) {
    return [
      `mkdir -p ${shellQuote(`${codexHomeDir}/.codex`)}`,
      `export HOME=${shellQuote(codexHomeDir)}`,
      `printf '%s' "$OPENAI_CODEX_AUTH_JSON" > "$HOME/.codex/auth.json"`,
      `chmod 600 "$HOME/.codex/auth.json"`,
    ].join(" && ");
  }
  const baseUrlEnvVar =
    params.aiModelProvider === AI_MODEL_PROVIDER.openai && params.aiKeyMode === AI_KEY_MODE.bundled
      ? "OPENAI_BASE_URL"
      : fakeOpenAiBaseUrl.length > 0
        ? "KEPPO_E2E_OPENAI_BASE_URL"
        : null;
  if (baseUrlEnvVar) {
    return [
      `mkdir -p ${shellQuote(`${codexHomeDir}/.codex`)}`,
      `export HOME=${shellQuote(codexHomeDir)}`,
      `touch "$HOME/.codex/config.toml"`,
      `printf '\\n[model_providers.${CODEX_CUSTOM_OPENAI_PROVIDER_ID}]\\nname = "Keppo OpenAI API"\\nbase_url = "%s"\\nenv_key = "OPENAI_API_KEY"\\nwire_api = "responses"\\nrequires_openai_auth = false\\nsupports_websockets = false\\n' "$${baseUrlEnvVar}" >> "$HOME/.codex/config.toml"`,
      `chmod 600 "$HOME/.codex/config.toml"`,
    ].join(" && ");
  }
  return [
    `mkdir -p ${shellQuote(codexHomeDir)}`,
    `export HOME=${shellQuote(codexHomeDir)}`,
    `printenv OPENAI_API_KEY | codex login --with-api-key`,
  ].join(" && ");
};

export const assertRunnerAuthSupported = (params: {
  runnerType: AutomationRunnerType;
  aiModelProvider: AiModelProvider;
  aiKeyMode: AiKeyMode;
}): void => {
  void params;
};

export const resolveAutomationMcpServerUrl = (
  configuredUrl: string | undefined,
  callbackBaseUrl: string,
  workspaceId: string,
): string => {
  const rawUrl = configuredUrl?.trim();
  if (!rawUrl) {
    return applyVercelProtectionBypassToUrl(
      new URL(`/mcp/${workspaceId}`, `${callbackBaseUrl}/`).toString(),
    );
  }

  if (rawUrl.includes(":workspaceId")) {
    return applyVercelProtectionBypassToUrl(rawUrl.replaceAll(":workspaceId", workspaceId));
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (normalizedPath === "/mcp") {
    parsed.pathname = `/mcp/${workspaceId}`;
    return applyVercelProtectionBypassToUrl(parsed.toString());
  }

  return applyVercelProtectionBypassToUrl(parsed.toString());
};

const truncateForError = (value: string, maxLength = 240): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
};

export const preflightMcpServer = async (
  mcpServerUrl: string,
  bearerToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> => {
  const initializeResponse = await fetchFn(mcpServerUrl, {
    method: "POST",
    headers: applyVercelProtectionBypassHeader(
      new Headers({
        accept: "text/event-stream, application/json",
        authorization: `Bearer ${bearerToken}`,
        "content-type": "application/json",
      }),
    ),
    body: JSON.stringify(MCP_INITIALIZE_PAYLOAD),
  });

  const contentType = initializeResponse.headers.get("content-type")?.trim() ?? "<missing>";
  const responseText = truncateForError(await initializeResponse.text());
  const isSupportedContentType =
    contentType.includes("text/event-stream") || contentType.includes("application/json");

  if (!initializeResponse.ok || !isSupportedContentType) {
    throw createAutomationRouteError(
      "automation_route_failed",
      `MCP server preflight failed for ${redactVercelProtectionBypassUrl(mcpServerUrl)}: status ${initializeResponse.status}, content-type ${contentType}, body ${responseText || "<empty>"}`,
    );
  }

  const sessionId = initializeResponse.headers.get("mcp-session-id")?.trim();
  if (!sessionId) {
    return;
  }

  await fetchFn(mcpServerUrl, {
    method: "DELETE",
    headers: applyVercelProtectionBypassHeader(
      new Headers({
        accept: "text/event-stream, application/json",
        authorization: `Bearer ${bearerToken}`,
        "mcp-session-id": sessionId,
      }),
    ),
  }).catch(() => undefined);
};

const parseAutomationRunId = (value: unknown): string => {
  const body = value as Record<string, unknown>;
  const automationRunId =
    typeof body.automation_run_id === "string" ? body.automation_run_id.trim() : "";
  if (automationRunId.length === 0) {
    throw createAutomationRouteError("missing_automation_run_id", "automation_run_id is required");
  }
  return automationRunId;
};

export const parseTerminatePayload = (value: unknown): { automation_run_id: string } => {
  return {
    automation_run_id: parseAutomationRunId(value),
  };
};

export const parseDispatchPayload = (
  value: unknown,
): { automation_run_id: string; dispatch_token: string } => {
  const body = value as Record<string, unknown>;
  const automationRunId = parseAutomationRunId(value);
  const dispatchToken = typeof body.dispatch_token === "string" ? body.dispatch_token.trim() : "";
  if (dispatchToken.length === 0) {
    throw createAutomationRouteError("missing_dispatch_token", "dispatch_token is required");
  }
  return { automation_run_id: automationRunId, dispatch_token: dispatchToken };
};

const parseJsonLikeContent = (content: string): unknown | undefined => {
  const trimmed = content.trim();
  if (
    trimmed.length === 0 ||
    (!(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
      !(trimmed.startsWith("[") && trimmed.endsWith("]")))
  ) {
    return undefined;
  }
  try {
    return parseJsonValue(trimmed);
  } catch {
    return undefined;
  }
};

const normalizeConfigKey = (value: string): string => value.trim().toLowerCase();

const truncateStructuredText = (value: string, maxLength = 4_000): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}...`;
};

const asStructuredJson = (value: unknown, maxLength = 4_000): unknown | undefined => {
  if (value === undefined) {
    return undefined;
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || serialized.length > maxLength) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
};

const classifyCodexJsonLine = (
  level: AutomationRunLogLevel,
  content: string,
): ClassifiedEvent | null => {
  if (level === "system") {
    return null;
  }

  const parsed = tryParseJsonValue(content.trim());
  if (!isJsonRecord(parsed)) {
    return null;
  }

  const eventType = asNullableString(parsed.type);
  if (!eventType) {
    return null;
  }

  const item = isJsonRecord(parsed.item) ? parsed.item : null;
  const itemType = asNullableString(item?.type);

  if (eventType === "thread.started") {
    return {
      event_type: AUTOMATION_RUN_EVENT_TYPE.system,
      event_data: {
        message: "Codex thread started.",
        source: "codex_json",
        ...(typeof parsed.thread_id === "string"
          ? { thread_id: truncateStructuredText(parsed.thread_id, 256) }
          : {}),
      },
    };
  }

  if (eventType === "turn.started") {
    return {
      event_type: AUTOMATION_RUN_EVENT_TYPE.system,
      event_data: {
        message: "Codex turn started.",
        source: "codex_json",
      },
    };
  }

  if (eventType === "turn.completed") {
    const usage = isJsonRecord(parsed.usage)
      ? {
          ...(typeof parsed.usage.input_tokens === "number"
            ? { input_tokens: parsed.usage.input_tokens }
            : {}),
          ...(typeof parsed.usage.cached_input_tokens === "number"
            ? { cached_input_tokens: parsed.usage.cached_input_tokens }
            : {}),
          ...(typeof parsed.usage.output_tokens === "number"
            ? { output_tokens: parsed.usage.output_tokens }
            : {}),
        }
      : undefined;
    return {
      event_type: AUTOMATION_RUN_EVENT_TYPE.system,
      event_data: {
        message: "Codex turn completed.",
        source: "codex_json",
        ...(usage ? { usage } : {}),
      },
    };
  }

  if (itemType === "reasoning" && eventType === "item.completed") {
    return {
      event_type: AUTOMATION_RUN_EVENT_TYPE.thinking,
      event_data: {
        text: truncateStructuredText(asNullableString(item?.text) ?? content),
        source: "codex_json",
      },
    };
  }

  if (itemType === "command_execution") {
    const command = asNullableString(item?.command);
    if (eventType === "item.started") {
      return {
        event_type: AUTOMATION_RUN_EVENT_TYPE.toolCall,
        event_data: {
          tool_name: "command_execution",
          ...(command
            ? {
                args: {
                  command: truncateStructuredText(command, 1_024),
                },
              }
            : {}),
          source: "codex_json",
        },
      };
    }

    if (eventType === "item.completed") {
      const aggregatedOutput = asNullableString(item?.aggregated_output);
      const parsedOutput =
        aggregatedOutput !== null
          ? asStructuredJson(parseJsonLikeContent(aggregatedOutput))
          : undefined;
      const exitCode = typeof item?.exit_code === "number" ? item.exit_code : undefined;
      const status = item?.status === "completed" && exitCode === 0 ? "success" : "error";
      return {
        event_type: AUTOMATION_RUN_EVENT_TYPE.toolCall,
        event_data: {
          tool_name: "command_execution",
          status,
          is_result: true,
          ...(command
            ? {
                args: {
                  command: truncateStructuredText(command, 1_024),
                },
              }
            : {}),
          ...(aggregatedOutput
            ? {
                result_text: truncateStructuredText(aggregatedOutput),
              }
            : {}),
          ...(parsedOutput !== undefined ? { result: parsedOutput } : {}),
          ...(exitCode !== undefined ? { exit_code: exitCode } : {}),
          source: "codex_json",
        },
      };
    }
  }

  if (itemType === "agent_message" && eventType === "item.completed") {
    const text = asNullableString(item?.text) ?? content;
    const parsedOutput = asStructuredJson(parseJsonLikeContent(text));
    return {
      event_type: AUTOMATION_RUN_EVENT_TYPE.output,
      event_data: {
        text: truncateStructuredText(text),
        format: parsedOutput !== undefined ? "json" : "text",
        ...(parsedOutput !== undefined ? { parsed: parsedOutput } : {}),
        source: "codex_json",
      },
    };
  }

  const codexMessage =
    itemType && (eventType === "item.started" || eventType === "item.completed")
      ? `Codex ${itemType} ${eventType === "item.started" ? "started" : "completed"}.`
      : `Codex event: ${eventType}.`;

  return {
    event_type: AUTOMATION_RUN_EVENT_TYPE.system,
    event_data: {
      message: codexMessage,
      source: "codex_json",
      codex_event_type: eventType,
      ...(itemType ? { item_type: itemType } : {}),
    },
  };
};

const classifyLogLine = (level: AutomationRunLogLevel, content: string): ClassifiedEvent | null => {
  const codexJsonEvent = classifyCodexJsonLine(level, content);
  if (codexJsonEvent) {
    return codexJsonEvent;
  }

  if (level === "system") {
    return { event_type: AUTOMATION_RUN_EVENT_TYPE.system, event_data: { message: content } };
  }

  if (level === "stdout") {
    const parsed = parseJsonLikeContent(content);
    return {
      event_type: AUTOMATION_RUN_EVENT_TYPE.output,
      event_data: {
        text: content,
        format: parsed !== undefined ? "json" : "text",
        ...(parsed !== undefined ? { parsed } : {}),
      },
    };
  }

  const trimmed = content.trim();
  const toolMatch = trimmed.match(TOOL_CALL_PATTERN);
  if (toolMatch && toolMatch[1] && toolMatch[2]) {
    let args: Record<string, unknown> | undefined;
    try {
      const parsedArgs = parseJsonValue(toolMatch[2]);
      args = isJsonRecord(parsedArgs) ? parsedArgs : undefined;
    } catch {
      args = undefined;
    }
    return {
      event_type: AUTOMATION_RUN_EVENT_TYPE.toolCall,
      event_data: {
        tool_name: toolMatch[1],
        ...(args !== undefined ? { args } : {}),
      },
    };
  }

  const resultMatch = trimmed.match(TOOL_RESULT_PATTERN);
  if (resultMatch && resultMatch[1] && resultMatch[2] && resultMatch[3]) {
    return {
      event_type: AUTOMATION_RUN_EVENT_TYPE.toolCall,
      event_data: {
        tool_name: resultMatch[1],
        status: resultMatch[2] as "success" | "error",
        duration_ms: parseInt(resultMatch[3], 10),
        is_result: true,
      },
    };
  }

  const mcpToolStartMatch = trimmed.match(MCP_TOOL_START_PATTERN);
  if (mcpToolStartMatch?.[1]) {
    return {
      event_type: AUTOMATION_RUN_EVENT_TYPE.toolCall,
      event_data: {
        tool_name: mcpToolStartMatch[1],
        source: "mcp_lifecycle",
      },
    };
  }

  const mcpToolResultMatch = trimmed.match(MCP_TOOL_RESULT_PATTERN);
  if (mcpToolResultMatch?.[1] && mcpToolResultMatch?.[2]) {
    return {
      event_type: AUTOMATION_RUN_EVENT_TYPE.toolCall,
      event_data: {
        tool_name: mcpToolResultMatch[1],
        status: mcpToolResultMatch[2] === "completed" ? "success" : "error",
        is_result: true,
        source: "mcp_lifecycle",
      },
    };
  }

  const configMatch = trimmed.match(CONFIG_KEY_PATTERN);
  if (configMatch && configMatch[1]) {
    const parsedValue = configMatch[2] ? parseJsonLikeContent(configMatch[2]) : undefined;
    return {
      event_type: AUTOMATION_RUN_EVENT_TYPE.automationConfig,
      event_data: {
        key: normalizeConfigKey(configMatch[1]),
        value: parsedValue ?? configMatch[2],
      },
    };
  }

  if (
    trimmed.toLowerCase().includes("error") &&
    (trimmed.includes("Uncaught") ||
      trimmed.includes("Server Error") ||
      trimmed.startsWith("Error"))
  ) {
    return { event_type: AUTOMATION_RUN_EVENT_TYPE.error, event_data: { message: content } };
  }

  if (
    trimmed === "codex" ||
    trimmed === "claude" ||
    trimmed.startsWith("codex\n") ||
    trimmed.startsWith("claude\n")
  ) {
    const text = trimmed.replace(/^(codex|claude)\n?/, "").trim();
    return {
      event_type: AUTOMATION_RUN_EVENT_TYPE.thinking,
      event_data: { text: text || trimmed },
    };
  }

  if (trimmed.startsWith("mcp:") || trimmed.startsWith("mcp startup:")) {
    return { event_type: AUTOMATION_RUN_EVENT_TYPE.system, event_data: { message: content } };
  }

  return { event_type: AUTOMATION_RUN_EVENT_TYPE.thinking, event_data: { text: content } };
};

export const parseLogPayload = (
  value: unknown,
): {
  automation_run_id: string;
  lines: ParsedLogLine[];
} => {
  const body = value as Record<string, unknown>;
  const automationRunId =
    typeof body.automation_run_id === "string" ? body.automation_run_id.trim() : "";
  if (automationRunId.length === 0) {
    throw createAutomationRouteError("missing_automation_run_id", "automation_run_id is required");
  }
  const lines = Array.isArray(body.lines) ? body.lines : [];
  return {
    automation_run_id: automationRunId,
    lines: lines
      .map((item): ParsedLogLine | null => {
        const row = item as Record<string, unknown>;
        const level = row.level;
        const content = typeof row.content === "string" ? row.content : "";
        if (
          typeof level !== "string" ||
          !automationRunLogLevelSet.has(level as AutomationRunLogLevel)
        ) {
          return null;
        }
        if (content.trim().length === 0) {
          return null;
        }

        const explicitEventType =
          typeof row.event_type === "string" &&
          AUTOMATION_RUN_EVENT_TYPES.includes(row.event_type as AutomationRunEventType)
            ? (row.event_type as AutomationRunEventType)
            : undefined;
        const explicitEventData =
          explicitEventType !== undefined &&
          typeof row.event_data === "object" &&
          row.event_data !== null
            ? (row.event_data as Record<string, unknown>)
            : undefined;

        if (explicitEventType !== undefined) {
          return {
            level: level as AutomationRunLogLevel,
            content,
            event_type: explicitEventType,
            ...(explicitEventData !== undefined ? { event_data: explicitEventData } : {}),
          };
        }

        const classified = classifyLogLine(level as AutomationRunLogLevel, content);
        return {
          level: level as AutomationRunLogLevel,
          content,
          ...(classified !== null
            ? { event_type: classified.event_type, event_data: classified.event_data }
            : {}),
        };
      })
      .filter((row): row is ParsedLogLine => Boolean(row)),
  };
};

const isValidSessionArtifactRelativePath = (value: string): boolean => {
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized.startsWith("sessions/")) {
    return false;
  }
  const segments = normalized.split("/");
  if (segments.length < 2) {
    return false;
  }
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return false;
  }
  return /\.(json|jsonl)$/u.test(normalized);
};

export const parseSessionArtifactPayload = (
  value: unknown,
): {
  automation_run_id: string;
  relative_path: string;
  content_base64: string;
} => {
  const body = value as Record<string, unknown>;
  const automationRunId = parseAutomationRunId(value);
  const relativePath =
    typeof body.relative_path === "string" ? body.relative_path.trim().replace(/\\/g, "/") : "";
  if (!isValidSessionArtifactRelativePath(relativePath)) {
    throw createAutomationRouteError(
      "invalid_payload",
      "relative_path must be a sessions/*.json or sessions/*.jsonl path",
    );
  }
  const contentBase64 = typeof body.content_base64 === "string" ? body.content_base64.trim() : "";
  if (contentBase64.length === 0) {
    throw createAutomationRouteError("invalid_payload", "content_base64 is required");
  }
  return {
    automation_run_id: automationRunId,
    relative_path: relativePath,
    content_base64: contentBase64,
  };
};

export const parseCompletionPayload = (
  value: unknown,
): {
  automation_run_id: string;
  status: AutomationRunTerminalStatus;
  error_message?: string;
} => {
  const body = value as Record<string, unknown>;
  const automationRunId =
    typeof body.automation_run_id === "string" ? body.automation_run_id.trim() : "";
  if (automationRunId.length === 0) {
    throw createAutomationRouteError("missing_automation_run_id", "automation_run_id is required");
  }
  const status = body.status;
  if (!isAutomationRunStatus(status) || !isAutomationRunTerminalStatus(status)) {
    throw createAutomationRouteError(
      "invalid_automation_run_terminal_status",
      "status must be succeeded, failed, cancelled, or timed_out",
    );
  }
  const errorMessage =
    typeof body.error_message === "string" && body.error_message.trim().length > 0
      ? body.error_message.trim()
      : undefined;
  return {
    automation_run_id: automationRunId,
    status,
    ...(errorMessage ? { error_message: errorMessage } : {}),
  };
};
