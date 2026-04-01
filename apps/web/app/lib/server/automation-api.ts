import { createHash, randomBytes } from "node:crypto";
import OpenAI from "openai";
import {
  automationMermaidJsonSchema,
  automationClarificationQuestionsJsonSchema,
  automationGenerationJsonSchema,
  buildAutomationEditGenerationMetaPrompt,
  buildAutomationEditQuestionGenerationMetaPrompt,
  buildAutomationMermaidGenerationMetaPrompt,
  buildAutomationGenerationMetaPrompt,
  buildAutomationQuestionGenerationMetaPrompt,
  parseAutomationClarificationQuestionsPayload,
  parseGenerationResponse,
  parseMermaidGenerationResponse,
  parseQuestionGenerationResponse,
  type AutomationClarificationAnswer,
  type AutomationClarificationQuestion,
  type AutomationContextSnapshot,
  type AutomationGenerationAction,
} from "@keppo/shared/ai_generation";
import { AI_CREDIT_ERROR_CODE, parseAiCreditErrorCode } from "@keppo/shared/ai-credit-errors";
import {
  type DefaultActionBehavior,
  type PolicyMode,
  type UserRole,
  type WorkspaceStatus,
} from "@keppo/shared/domain";
import {
  AUTOMATION_ROUTE_ERROR_CODES,
  AUTOMATION_ROUTE_STATUS,
  createAutomationRouteError,
  isAutomationRouteErrorCode,
  parseAutomationRouteErrorCode,
  toAutomationRouteError,
  type AutomationRouteErrorCode,
} from "@keppo/shared/automations";
import {
  isJsonRecord,
  parseJsonValue,
  tryParseJsonValue,
} from "@keppo/shared/providers/boundaries/json";
import {
  parseJsonPayload,
  readBetterAuthSessionToken,
  safeReturnToPath,
  signOAuthStatePayload,
  verifyAndDecodeOAuthStatePayload,
} from "./api-runtime/app-helpers.ts";
import { createDurableRateLimiter } from "./api-runtime/rate-limit.ts";
import { ConvexInternalClient } from "./api-runtime/convex.ts";
import { getEnv } from "./api-runtime/env.ts";

type ApiSessionIdentity = {
  userId: string;
  orgId: string;
  role: UserRole;
};

type OpenAiOauthState = {
  kind: "openai_automation_key";
  org_id: string;
  user_id: string;
  return_to: string;
  verifier: string;
  issued_at: number;
};

type StoredOpenAiOauthCredentials = {
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

type StartOwnedAutomationApiConvex = Pick<
  ConvexInternalClient,
  | "deductAiCredit"
  | "checkRateLimit"
  | "claimApiDedupeKey"
  | "completeApiDedupeKey"
  | "getApiDedupeKey"
  | "getWorkspaceCodeModeContext"
  | "listToolCatalogForWorkspace"
  | "releaseApiDedupeKey"
  | "resolveApiSessionFromToken"
  | "setApiDedupePayload"
  | "upsertOpenAiOauthKey"
>;

type StartOwnedAutomationApiDeps = {
  convex: StartOwnedAutomationApiConvex;
  generateAutomationQuestions?: (args: {
    userDescription: string;
    availableActions: AutomationGenerationAction[];
    automationContext?: AutomationContextSnapshot;
  }) => Promise<AutomationClarificationQuestion[]>;
  generateAutomationPrompt?: (args: {
    userDescription: string;
    availableActions: AutomationGenerationAction[];
    clarificationQuestions?: AutomationClarificationQuestion[];
    clarificationAnswers?: AutomationClarificationAnswer[];
    automationContext?: AutomationContextSnapshot;
  }) => Promise<{
    prompt: string;
    description: string;
    mermaid_content: string;
    name: string;
    ai_model_provider: "openai" | "anthropic";
    ai_model_name: string;
    network_access: "mcp_only" | "mcp_and_web";
    trigger_type: "schedule" | "event" | "manual";
    schedule_cron?: string;
    event_provider?: string;
    event_type?: string;
    provider_recommendations: Array<{
      provider: string;
      reason: string;
      confidence: "required" | "recommended";
    }>;
  }>;
  generateAutomationMermaid?: (args: { prompt: string }) => Promise<{
    mermaid_content: string;
  }>;
  getEnv: typeof getEnv;
  parseJsonPayload: typeof parseJsonPayload;
  readBetterAuthSessionToken: typeof readBetterAuthSessionToken;
  safeReturnToPath: typeof safeReturnToPath;
  signOAuthStatePayload: typeof signOAuthStatePayload;
  verifyAndDecodeOAuthStatePayload: typeof verifyAndDecodeOAuthStatePayload;
};

const OPENAI_OAUTH_ALLOWED_ROLES = new Set<UserRole>(["owner", "admin"]);
const OPENAI_AUTOMATION_CONNECT_PATH = "/api/automations/openai/connect";
const OPENAI_AUTOMATION_CALLBACK_PATH = "/api/automations/openai/callback";
const OPENAI_OAUTH_SCOPE = ["openid", "profile", "email", "offline_access"].join(" ");
const OPENAI_OAUTH_ORIGINATOR = "pi";
const OPENAI_OAUTH_STATE_TTL_MS = 15 * 60_000;
const OPENAI_LOCALHOST_REDIRECT_URI = "http://localhost:1455/auth/callback";
const AUTOMATION_QUESTION_RATE_LIMIT_WINDOW_MS = 60_000;
const AUTOMATION_QUESTION_BILLING = {
  stage: "questions",
  charged_credits: 0,
  cycle_total_credits: 1,
  summary:
    "Clarifying questions do not deduct a credit. Keppo charges 1 credit only when it generates the final automation draft.",
} as const;
const OPENAI_LOCALHOST_CALLBACK_COMMAND =
  `node --input-type=module --eval 'import http from "node:http";` +
  `const PORT=1455,HOST="127.0.0.1",SUCCESS="<!doctype html><html><body><p>Callback captured. Return to Keppo and paste the full localhost callback URL.</p></body></html>";` +
  `http.createServer((req,res)=>{try{const url=new URL(req.url||"/",\`http://\${HOST}:\${PORT}\`);` +
  `if(url.pathname!=="/auth/callback"){res.statusCode=404;res.end("Not found");return}` +
  `const fullUrl=\`http://\${HOST}:\${PORT}\${url.pathname}\${url.search}\`;` +
  `process.stdout.write("\\nCaptured localhost callback URL:\\n"+fullUrl+"\\n\\nPaste that full URL into Keppo and then press Ctrl+C here.\\n");` +
  `res.statusCode=200;res.setHeader("Content-Type","text/html; charset=utf-8");res.end(SUCCESS)}` +
  `catch{res.statusCode=500;res.end("Internal error")}}).listen(PORT,HOST,()=>process.stdout.write(\`Listening for OpenAI OAuth callback on http://\${HOST}:\${PORT}/auth/callback\\n\`));'`;
const SECURITY_HEADER_VALUES = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
} as const;

let convexClient: ConvexInternalClient | null = null;
let automationQuestionRateLimiter: ReturnType<typeof createDurableRateLimiter> | null = null;
let automationQuestionRateLimiterClient: StartOwnedAutomationApiConvex["checkRateLimit"] | null =
  null;

const automationRouteErrorCodeSet = new Set<AutomationRouteErrorCode>(AUTOMATION_ROUTE_ERROR_CODES);

const payloadErrorCodeSet = new Set<AutomationRouteErrorCode>([
  "invalid_payload",
  "missing_workspace_id",
  "missing_user_description",
  "user_description_too_long",
]);

const getDefaultDeps = (): StartOwnedAutomationApiDeps => ({
  convex: (convexClient ??= new ConvexInternalClient()),
  getEnv,
  parseJsonPayload,
  readBetterAuthSessionToken,
  safeReturnToPath,
  signOAuthStatePayload,
  verifyAndDecodeOAuthStatePayload,
});

const getAutomationQuestionRateLimiter = (convex: StartOwnedAutomationApiConvex) => {
  if (
    automationQuestionRateLimiter &&
    automationQuestionRateLimiterClient === convex.checkRateLimit
  ) {
    return automationQuestionRateLimiter;
  }
  automationQuestionRateLimiter = createDurableRateLimiter(
    { checkRateLimit: convex.checkRateLimit.bind(convex) },
    "automation_question_requests",
  );
  automationQuestionRateLimiterClient = convex.checkRateLimit;
  return automationQuestionRateLimiter;
};

const withSecurityHeaders = (request: Request, init?: ResponseInit): ResponseInit => {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADER_VALUES)) {
    headers.set(key, value);
  }
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return {
    ...init,
    headers,
  };
};

const jsonResponse = (request: Request, payload: unknown, status = 200): Response => {
  return Response.json(payload, withSecurityHeaders(request, { status }));
};

const canManageOpenAiOauthKey = (sessionIdentity: ApiSessionIdentity): boolean => {
  return OPENAI_OAUTH_ALLOWED_ROLES.has(sessionIdentity.role);
};

const errorToMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const extractAutomationRouteError = (
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

const mapInvalidPayloadError = (error: unknown): Record<string, unknown> | null => {
  const typedError = toAutomationRouteError(error, "invalid_payload");
  const { code, message } = extractAutomationRouteError(typedError);
  if (!code || !payloadErrorCodeSet.has(code)) {
    return null;
  }
  return {
    ok: false,
    status: AUTOMATION_ROUTE_STATUS.invalidPayload,
    error: message,
    ...(code ? { error_code: code } : {}),
  };
};

const resolveSessionFromRequest = async (
  request: Request,
  deps: StartOwnedAutomationApiDeps,
): Promise<ApiSessionIdentity | null> => {
  const sessionToken =
    deps.readBetterAuthSessionToken(request.headers.get("cookie") ?? undefined) ??
    deps.readBetterAuthSessionToken(request.headers.get("better-auth-cookie") ?? undefined);
  if (!sessionToken) {
    return null;
  }
  return await deps.convex.resolveApiSessionFromToken(sessionToken);
};

const parseGeneratePromptPayload = (
  value: unknown,
): {
  workspace_id: string;
  user_description: string;
  clarification_questions: AutomationClarificationQuestion[];
  clarification_answers: AutomationClarificationAnswer[];
  automation_context?: AutomationContextSnapshot;
  generation_mode: "create" | "edit" | "mermaid_only";
} => {
  const body = value as Record<string, unknown>;
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";
  const userDescription =
    typeof body.user_description === "string" ? body.user_description.trim() : "";
  if (workspaceId.length === 0) {
    throw createAutomationRouteError("missing_workspace_id", "workspace_id is required");
  }
  if (userDescription.length === 0) {
    throw createAutomationRouteError("missing_user_description", "user_description is required");
  }
  if (userDescription.length > 8_000) {
    throw createAutomationRouteError("user_description_too_long", "user_description is too long");
  }
  const generationMode =
    body.generation_mode === "edit"
      ? "edit"
      : body.generation_mode === "mermaid_only"
        ? "mermaid_only"
        : "create";
  const clarificationQuestions = parseAutomationClarificationQuestionsPayload(
    body.clarification_questions ?? [],
  );
  const clarificationAnswers = parseUntrustedClarificationAnswersPayload(
    body.clarification_answers ?? [],
  );
  const automationContext = parseAutomationContextSnapshot(body.automation_context);
  return {
    workspace_id: workspaceId,
    user_description: userDescription,
    clarification_questions: clarificationQuestions,
    clarification_answers: clarificationAnswers,
    ...(automationContext ? { automation_context: automationContext } : {}),
    generation_mode: generationMode,
  };
};

const parseAutomationContextSnapshot = (value: unknown): AutomationContextSnapshot | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const mermaidContent =
    typeof record.mermaid_content === "string" ? record.mermaid_content.trim() : "";
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  const aiModelProvider = record.ai_model_provider === "anthropic" ? "anthropic" : "openai";
  const networkAccess = record.network_access === "mcp_and_web" ? "mcp_and_web" : "mcp_only";
  const triggerType =
    record.trigger_type === "schedule" || record.trigger_type === "event"
      ? record.trigger_type
      : "manual";
  const aiModelName = typeof record.ai_model_name === "string" ? record.ai_model_name.trim() : "";
  if (!name || !prompt || !aiModelName) {
    return undefined;
  }
  return {
    ...(typeof record.automation_id === "string" && record.automation_id.trim().length > 0
      ? { automation_id: record.automation_id.trim() }
      : {}),
    name,
    description,
    mermaid_content: mermaidContent,
    trigger_type: triggerType,
    schedule_cron:
      typeof record.schedule_cron === "string" && record.schedule_cron.trim().length > 0
        ? record.schedule_cron.trim()
        : null,
    event_provider:
      typeof record.event_provider === "string" && record.event_provider.trim().length > 0
        ? record.event_provider.trim()
        : null,
    event_type:
      typeof record.event_type === "string" && record.event_type.trim().length > 0
        ? record.event_type.trim()
        : null,
    ai_model_provider: aiModelProvider,
    ai_model_name: aiModelName,
    network_access: networkAccess,
    prompt,
  };
};

const parseUntrustedClarificationAnswersPayload = (
  value: unknown,
): AutomationClarificationAnswer[] => {
  const rawEntries = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>).map(([questionId, answerValue]) => ({
          question_id: questionId,
          value: answerValue,
        }))
      : [];

  if (!Array.isArray(rawEntries)) {
    throw createAutomationRouteError(
      "invalid_payload",
      "clarification_answers must be an array or object",
    );
  }

  const answers: AutomationClarificationAnswer[] = [];
  for (const entry of rawEntries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const questionId = typeof record.question_id === "string" ? record.question_id.trim() : "";
    if (questionId.length === 0) {
      continue;
    }
    if (answers.some((candidate) => candidate.question_id === questionId)) {
      continue;
    }
    if (typeof record.value === "string") {
      const answer = record.value.trim();
      if (answer.length > 0) {
        answers.push({ question_id: questionId, value: answer });
      }
      continue;
    }
    if (Array.isArray(record.value)) {
      const answer = record.value
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim())
        .filter((option) => option.length > 0)
        .slice(0, 10);
      if (answer.length > 0) {
        answers.push({ question_id: questionId, value: answer });
      }
      continue;
    }
    throw createAutomationRouteError(
      "invalid_payload",
      `clarification_answers.${questionId} must be a string or string array`,
    );
  }

  return answers;
};

const parseOpenAiOauthCompletePayload = (
  value: unknown,
): {
  callback_url: string;
} => {
  const body = value as Record<string, unknown>;
  const callbackUrl = typeof body.callback_url === "string" ? body.callback_url.trim() : "";
  if (callbackUrl.length === 0) {
    throw createAutomationRouteError("invalid_payload", "callback_url is required");
  }
  return {
    callback_url: callbackUrl,
  };
};

const parseJsonRecordOrThrow = (raw: string, message: string): Record<string, unknown> => {
  const parsed = parseJsonValue(raw, { message });
  if (!isJsonRecord(parsed)) {
    throw new Error(message);
  }
  return parsed;
};

const parseOpenAiOauthState = (
  stateRaw: string,
  deps: StartOwnedAutomationApiDeps,
): OpenAiOauthState => {
  try {
    const parsed = parseJsonRecordOrThrow(stateRaw, "Invalid OpenAI OAuth state payload.");
    if (
      parsed.kind !== "openai_automation_key" ||
      typeof parsed.org_id !== "string" ||
      typeof parsed.user_id !== "string" ||
      typeof parsed.return_to !== "string" ||
      typeof parsed.verifier !== "string" ||
      typeof parsed.issued_at !== "number"
    ) {
      throw new Error("Invalid OpenAI OAuth state payload.");
    }
    if (Date.now() - parsed.issued_at > OPENAI_OAUTH_STATE_TTL_MS) {
      throw createAutomationRouteError(
        "automation_route_failed",
        "OpenAI OAuth state has expired.",
      );
    }
    return parsed as OpenAiOauthState;
  } catch (error) {
    if (error instanceof Error && error.message === "OpenAI OAuth state has expired.") {
      throw error;
    }
    void deps;
    throw createAutomationRouteError(
      "automation_route_failed",
      "Invalid OpenAI OAuth state payload.",
    );
  }
};

const toBase64Url = (value: Buffer): string =>
  value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");

const buildPkceChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier, "utf8").digest("base64url");

const resolveOpenAiOauthAuthUrl = (deps: StartOwnedAutomationApiDeps): string =>
  deps.getEnv().OPENAI_OAUTH_AUTH_URL ?? "https://auth.openai.com/oauth/authorize";

const resolveOpenAiOauthTokenUrl = (deps: StartOwnedAutomationApiDeps): string =>
  deps.getEnv().OPENAI_OAUTH_TOKEN_URL ?? "https://auth.openai.com/oauth/token";

const resolveOpenAiOauthClientId = (deps: StartOwnedAutomationApiDeps): string => {
  const clientId = deps.getEnv().OPENAI_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw createAutomationRouteError("missing_env", "Missing OPENAI_OAUTH_CLIENT_ID.");
  }
  return clientId;
};

const resolveOpenAiOauthRedirectUri = (
  requestUrl: string,
  deps: StartOwnedAutomationApiDeps,
): string => {
  const explicit = deps.getEnv().OPENAI_OAUTH_REDIRECT_URI;
  if (explicit) {
    return explicit;
  }
  void requestUrl;
  return OPENAI_LOCALHOST_REDIRECT_URI;
};

const resolveDashboardOrigin = (requestUrl: string, deps: StartOwnedAutomationApiDeps): string => {
  return deps.getEnv().KEPPO_DASHBOARD_ORIGIN ?? new URL(requestUrl).origin;
};

const buildDashboardRedirectUrl = (
  requestUrl: string,
  returnTo: string,
  params: Record<string, string>,
  deps: StartOwnedAutomationApiDeps,
): string => {
  const url = new URL(deps.safeReturnToPath(returnTo), resolveDashboardOrigin(requestUrl, deps));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

const buildOpenAiOauthAuthorizationUrl = (params: {
  requestUrl: string;
  verifier: string;
  signedState: string;
  deps: StartOwnedAutomationApiDeps;
}): string => {
  const authUrl = new URL(resolveOpenAiOauthAuthUrl(params.deps));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", resolveOpenAiOauthClientId(params.deps));
  authUrl.searchParams.set(
    "redirect_uri",
    resolveOpenAiOauthRedirectUri(params.requestUrl, params.deps),
  );
  authUrl.searchParams.set("scope", OPENAI_OAUTH_SCOPE);
  authUrl.searchParams.set("code_challenge", buildPkceChallenge(params.verifier));
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", params.signedState);
  authUrl.searchParams.set("id_token_add_organizations", "true");
  authUrl.searchParams.set("codex_cli_simplified_flow", "true");
  authUrl.searchParams.set("originator", OPENAI_OAUTH_ORIGINATOR);
  return authUrl.toString();
};

const parseOpenAiOauthCallbackInput = (value: string): { code: string; state: string } => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw createAutomationRouteError("invalid_payload", "callback_url is required");
  }
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    parsedUrl = null;
  }
  const code = parsedUrl?.searchParams.get("code")?.trim() ?? "";
  const state = parsedUrl?.searchParams.get("state")?.trim() ?? "";
  const error = parsedUrl?.searchParams.get("error")?.trim() ?? "";
  const errorDescription = parsedUrl?.searchParams.get("error_description")?.trim() ?? "";
  if (error) {
    throw createAutomationRouteError(
      "automation_route_failed",
      errorDescription.length > 0 ? errorDescription : `OpenAI OAuth failed with ${error}.`,
    );
  }
  if (!code || !state) {
    throw createAutomationRouteError(
      "invalid_payload",
      "callback_url must include code and state query params",
    );
  }
  return { code, state };
};

const asNullableString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const extractOpenAiEmail = (idToken: string | null): string | null => {
  if (!idToken) {
    return null;
  }
  const parts = idToken.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const padded = parts[1]!.padEnd(Math.ceil(parts[1]!.length / 4) * 4, "=");
    const decoded = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    const parsed = parseJsonValue(decoded);
    if (!isJsonRecord(parsed)) {
      return null;
    }
    return asNullableString(parsed.email);
  } catch {
    return null;
  }
};

const exchangeOpenAiOauthToken = async (params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  deps: StartOwnedAutomationApiDeps;
}): Promise<StoredOpenAiOauthCredentials> => {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    client_id: resolveOpenAiOauthClientId(params.deps),
  });
  const response = await fetch(resolveOpenAiOauthTokenUrl(params.deps), {
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
        ? `OpenAI OAuth token exchange failed with status ${response.status}: ${detail}`
        : `OpenAI OAuth token exchange failed with status ${response.status}.`,
    );
  }
  const accessToken = asNullableString(parsed.access_token);
  const refreshToken = asNullableString(parsed.refresh_token);
  const expiresIn =
    typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in)
      ? parsed.expires_in
      : null;
  if (!accessToken || !refreshToken || !expiresIn) {
    throw createAutomationRouteError(
      "automation_route_failed",
      "OpenAI OAuth token exchange returned incomplete credentials.",
    );
  }
  const idToken = asNullableString(parsed.id_token);
  const scope =
    typeof parsed.scope === "string" && parsed.scope.trim().length > 0
      ? parsed.scope.trim().split(/\s+/u)
      : [];
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scopes: scope,
    email: extractOpenAiEmail(idToken),
    account_id: null,
    id_token: idToken,
    token_type: asNullableString(parsed.token_type),
    last_refresh: new Date().toISOString(),
  };
};

const completeOpenAiOauthCredentialUpsert = async (params: {
  convex: Pick<StartOwnedAutomationApiConvex, "upsertOpenAiOauthKey">;
  orgId: string;
  userId: string;
  code: string;
  verifier: string;
  redirectUri: string;
  deps: StartOwnedAutomationApiDeps;
}) => {
  const credentials = await exchangeOpenAiOauthToken({
    code: params.code,
    codeVerifier: params.verifier,
    redirectUri: params.redirectUri,
    deps: params.deps,
  });
  await params.convex.upsertOpenAiOauthKey({
    orgId: params.orgId,
    userId: params.userId,
    credentials,
  });
};

const readResponseOutputText = (response: unknown): string => {
  const record = response as Record<string, unknown>;
  if (typeof record.output_text === "string" && record.output_text.trim().length > 0) {
    return record.output_text.trim();
  }

  const output = Array.isArray(record.output) ? record.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const outputItem = item as Record<string, unknown>;
    const content = Array.isArray(outputItem.content) ? outputItem.content : [];
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const contentBlock = block as Record<string, unknown>;
      if (typeof contentBlock.text === "string" && contentBlock.text.trim().length > 0) {
        chunks.push(contentBlock.text.trim());
      }
    }
  }
  return chunks.join("\n").trim();
};

const generateAutomationPromptWithOpenAi = async (args: {
  userDescription: string;
  availableActions: AutomationGenerationAction[];
  clarificationQuestions?: AutomationClarificationQuestion[];
  clarificationAnswers?: AutomationClarificationAnswer[];
  automationContext?: AutomationContextSnapshot;
  deps: StartOwnedAutomationApiDeps;
}): Promise<{
  prompt: string;
  description: string;
  mermaid_content: string;
  name: string;
  ai_model_provider: "openai" | "anthropic";
  ai_model_name: string;
  network_access: "mcp_only" | "mcp_and_web";
  trigger_type: "schedule" | "event" | "manual";
  schedule_cron?: string;
  event_provider?: string;
  event_type?: string;
  provider_recommendations: Array<{
    provider: string;
    reason: string;
    confidence: "required" | "recommended";
  }>;
}> => {
  const apiKey = args.deps.getEnv().OPENAI_API_KEY;
  if (!apiKey) {
    throw createAutomationRouteError("missing_openai_api_key", "Missing OPENAI_API_KEY");
  }
  const client = new OpenAI({ apiKey });
  const input = args.automationContext
    ? buildAutomationEditGenerationMetaPrompt({
        userDescription: args.userDescription,
        availableActions: args.availableActions,
        automationContext: args.automationContext,
        clarificationQuestions: args.clarificationQuestions ?? [],
        clarificationAnswers: args.clarificationAnswers ?? [],
      })
    : buildAutomationGenerationMetaPrompt({
        userDescription: args.userDescription,
        availableActions: args.availableActions,
        clarificationQuestions: args.clarificationQuestions ?? [],
        clarificationAnswers: args.clarificationAnswers ?? [],
      });
  const response = await client.responses.create({
    model: "gpt-5.2",
    input,
    text: {
      format: {
        type: "json_schema",
        name: "automation_generation",
        schema: automationGenerationJsonSchema,
        strict: true,
      },
    },
  });
  const outputText = readResponseOutputText(response);
  const parsed = parseGenerationResponse(outputText, {
    userDescription: args.userDescription,
    availableActions: args.availableActions,
  });
  return {
    prompt: parsed.prompt,
    description: parsed.description,
    mermaid_content: parsed.mermaid_content,
    name: parsed.name,
    ai_model_provider: parsed.ai_model_provider,
    ai_model_name: parsed.ai_model_name,
    network_access: parsed.network_access,
    trigger_type: parsed.trigger_type,
    ...(parsed.schedule_cron ? { schedule_cron: parsed.schedule_cron } : {}),
    ...(parsed.event_provider ? { event_provider: parsed.event_provider } : {}),
    ...(parsed.event_type ? { event_type: parsed.event_type } : {}),
    provider_recommendations: parsed.provider_recommendations,
  };
};

const generateAutomationQuestionsWithOpenAi = async (args: {
  userDescription: string;
  availableActions: AutomationGenerationAction[];
  automationContext?: AutomationContextSnapshot;
  deps: StartOwnedAutomationApiDeps;
}): Promise<AutomationClarificationQuestion[]> => {
  const apiKey = args.deps.getEnv().OPENAI_API_KEY;
  if (!apiKey) {
    throw createAutomationRouteError("missing_openai_api_key", "Missing OPENAI_API_KEY");
  }
  const client = new OpenAI({ apiKey });
  const input = args.automationContext
    ? buildAutomationEditQuestionGenerationMetaPrompt({
        userDescription: args.userDescription,
        availableActions: args.availableActions,
        automationContext: args.automationContext,
      })
    : buildAutomationQuestionGenerationMetaPrompt(args.userDescription, args.availableActions);
  const response = await client.responses.create({
    model: "gpt-5.2",
    input,
    text: {
      format: {
        type: "json_schema",
        name: "automation_clarification_questions",
        schema: automationClarificationQuestionsJsonSchema,
        strict: true,
      },
    },
  });
  const outputText = readResponseOutputText(response);
  return parseQuestionGenerationResponse(outputText);
};

const generateAutomationMermaidWithOpenAi = async (args: {
  prompt: string;
  deps: StartOwnedAutomationApiDeps;
}): Promise<{ mermaid_content: string }> => {
  const apiKey = args.deps.getEnv().OPENAI_API_KEY;
  if (!apiKey) {
    throw createAutomationRouteError("missing_openai_api_key", "Missing OPENAI_API_KEY");
  }
  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: "gpt-5.2",
    input: buildAutomationMermaidGenerationMetaPrompt({ prompt: args.prompt }),
    text: {
      format: {
        type: "json_schema",
        name: "automation_mermaid_generation",
        schema: automationMermaidJsonSchema,
        strict: true,
      },
    },
  });
  return {
    mermaid_content: parseMermaidGenerationResponse(readResponseOutputText(response)),
  };
};

const buildDraftBillingPayload = (): {
  stage: "draft";
  charged_credits: number;
  cycle_total_credits: number;
  summary: string;
} => ({
  stage: "draft",
  charged_credits: 1,
  cycle_total_credits: 1,
  summary: "Keppo deducted 1 credit to generate the final automation draft.",
});

const buildMermaidBillingPayload = (): {
  stage: "draft";
  charged_credits: number;
  cycle_total_credits: number;
  summary: string;
} => ({
  stage: "draft",
  charged_credits: 1,
  cycle_total_credits: 1,
  summary: "Keppo deducted 1 credit to regenerate the workflow diagram.",
});

const resolveAutomationWorkspaceContext = async (
  request: Request,
  deps: StartOwnedAutomationApiDeps,
  workspaceId: string,
  options?: {
    includeAvailableActions?: boolean;
  },
): Promise<
  | Response
  | {
      sessionIdentity: ApiSessionIdentity;
      workspaceContext: {
        workspace: {
          id: string;
          org_id: string;
          name: string;
          status: WorkspaceStatus;
          policy_mode: PolicyMode;
          default_action_behavior: DefaultActionBehavior;
          code_mode_enabled: boolean;
          created_at: string;
        };
        enabled_providers: string[];
      };
      availableActions: AutomationGenerationAction[];
    }
> => {
  const sessionIdentity = await resolveSessionFromRequest(request, deps);
  if (!sessionIdentity) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.unauthorized,
      },
      401,
    );
  }

  let workspaceContext: {
    workspace: {
      id: string;
      org_id: string;
      name: string;
      status: WorkspaceStatus;
      policy_mode: PolicyMode;
      default_action_behavior: DefaultActionBehavior;
      code_mode_enabled: boolean;
      created_at: string;
    };
    enabled_providers: string[];
  } | null = null;

  try {
    workspaceContext = await deps.convex.getWorkspaceCodeModeContext(workspaceId);
  } catch {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.workspaceForbidden,
      },
      403,
    );
  }

  if (!workspaceContext) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.workspaceNotFound,
      },
      404,
    );
  }

  if (workspaceContext.workspace.org_id !== sessionIdentity.orgId) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.workspaceForbidden,
      },
      403,
    );
  }

  const includeAvailableActions = options?.includeAvailableActions ?? true;
  const availableTools = includeAvailableActions
    ? await deps.convex.listToolCatalogForWorkspace(workspaceId)
    : [];
  return {
    sessionIdentity,
    workspaceContext,
    availableActions: availableTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  };
};

export const handleGenerateAutomationQuestionsRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  let payload: {
    workspace_id: string;
    user_description: string;
    clarification_questions: AutomationClarificationQuestion[];
    clarification_answers: AutomationClarificationAnswer[];
    automation_context?: AutomationContextSnapshot;
    generation_mode: "create" | "edit" | "mermaid_only";
  };
  try {
    payload = parseGeneratePromptPayload(deps.parseJsonPayload(await request.text()));
  } catch (error) {
    const invalidPayload = mapInvalidPayloadError(error);
    if (invalidPayload) {
      return jsonResponse(request, invalidPayload, 400);
    }
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.invalidPayload,
        error: "Invalid clarification payload.",
        error_code: "invalid_payload",
      },
      400,
    );
  }

  const generationContext = await resolveAutomationWorkspaceContext(
    request,
    deps,
    payload.workspace_id,
    {
      includeAvailableActions: payload.generation_mode !== "mermaid_only",
    },
  );
  if (generationContext instanceof Response) {
    return generationContext;
  }

  const env = deps.getEnv();
  const rateLimitResult = await getAutomationQuestionRateLimiter(deps.convex).check(
    generationContext.workspaceContext.workspace.org_id,
    env.KEPPO_RATE_LIMIT_AUTOMATION_QUESTIONS_PER_ORG_PER_MINUTE,
    AUTOMATION_QUESTION_RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimitResult.allowed) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.rateLimited,
        retry_after_ms: rateLimitResult.retryAfterMs,
      },
      429,
    );
  }

  const generator =
    deps.generateAutomationQuestions ??
    (async (args: {
      userDescription: string;
      availableActions: AutomationGenerationAction[];
      automationContext?: AutomationContextSnapshot;
    }) => await generateAutomationQuestionsWithOpenAi({ ...args, deps }));

  try {
    const questions = await generator({
      userDescription: payload.user_description,
      availableActions: generationContext.availableActions,
      ...(payload.automation_context ? { automationContext: payload.automation_context } : {}),
    });
    return jsonResponse(request, {
      ok: true,
      questions,
      billing: AUTOMATION_QUESTION_BILLING,
    });
  } catch (error) {
    const { code } = extractAutomationRouteError(error);
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.generationFailed,
        ...(code ? { error_code: code } : {}),
      },
      500,
    );
  }
};

export const handleGenerateAutomationPromptRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  let payload: {
    workspace_id: string;
    user_description: string;
    clarification_questions: AutomationClarificationQuestion[];
    clarification_answers: AutomationClarificationAnswer[];
    automation_context?: AutomationContextSnapshot;
    generation_mode: "create" | "edit" | "mermaid_only";
  };
  try {
    payload = parseGeneratePromptPayload(deps.parseJsonPayload(await request.text()));
  } catch (error) {
    const invalidPayload = mapInvalidPayloadError(error);
    if (invalidPayload) {
      return jsonResponse(request, invalidPayload, 400);
    }
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.invalidPayload,
        error: "Invalid clarification payload.",
        error_code: "invalid_payload",
      },
      400,
    );
  }

  const generationContext = await resolveAutomationWorkspaceContext(
    request,
    deps,
    payload.workspace_id,
  );
  if (generationContext instanceof Response) {
    return generationContext;
  }

  if (payload.generation_mode !== "mermaid_only") {
    const answeredQuestionIds = new Set(
      payload.clarification_answers.map((answer) => answer.question_id),
    );
    const missingRequiredQuestion = payload.clarification_questions.find(
      (question) => question.required && !answeredQuestionIds.has(question.id),
    );
    if (missingRequiredQuestion) {
      return jsonResponse(
        request,
        {
          ok: false,
          status: AUTOMATION_ROUTE_STATUS.invalidPayload,
          error: `Missing required clarification answer for ${missingRequiredQuestion.id}`,
          error_code: "invalid_payload",
        },
        400,
      );
    }
  }

  let balance: {
    org_id: string;
    period_start: string;
    period_end: string;
    allowance_total: number;
    allowance_used: number;
    allowance_remaining: number;
    purchased_remaining: number;
    total_available: number;
  } | null = null;

  try {
    balance = await deps.convex.deductAiCredit({
      orgId: generationContext.workspaceContext.workspace.org_id,
    });
  } catch (error) {
    if (parseAiCreditErrorCode(error) === AI_CREDIT_ERROR_CODE.limitReached) {
      return jsonResponse(
        request,
        {
          ok: false,
          status: AUTOMATION_ROUTE_STATUS.aiCreditLimitReached,
        },
        402,
      );
    }
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.creditDeductionFailed,
      },
      500,
    );
  }

  const generator =
    deps.generateAutomationPrompt ??
    (async (args: {
      userDescription: string;
      availableActions: AutomationGenerationAction[];
      clarificationQuestions?: AutomationClarificationQuestion[];
      clarificationAnswers?: AutomationClarificationAnswer[];
      automationContext?: AutomationContextSnapshot;
    }) => await generateAutomationPromptWithOpenAi({ ...args, deps }));
  const mermaidGenerator =
    deps.generateAutomationMermaid ??
    (async (args: { prompt: string }) =>
      await generateAutomationMermaidWithOpenAi({ ...args, deps }));

  try {
    if (payload.generation_mode === "mermaid_only") {
      const generated = await mermaidGenerator({
        prompt: payload.automation_context?.prompt ?? payload.user_description,
      });
      return jsonResponse(request, {
        ok: true,
        mermaid_content: generated.mermaid_content,
        credit_balance: {
          allowance_remaining: balance.allowance_remaining,
          purchased_remaining: balance.purchased_remaining,
          total_available: balance.total_available,
        },
        billing: buildMermaidBillingPayload(),
      });
    }
    const generated = await generator({
      userDescription: payload.user_description,
      availableActions: generationContext.availableActions,
      clarificationQuestions: payload.clarification_questions,
      clarificationAnswers: payload.clarification_answers,
      ...(payload.automation_context ? { automationContext: payload.automation_context } : {}),
    });
    return jsonResponse(request, {
      ok: true,
      prompt: generated.prompt,
      description: generated.description,
      mermaid_content: generated.mermaid_content,
      name: generated.name,
      ai_model_provider: generated.ai_model_provider,
      ai_model_name: generated.ai_model_name,
      network_access: generated.network_access,
      trigger_type: generated.trigger_type,
      ...(generated.schedule_cron ? { schedule_cron: generated.schedule_cron } : {}),
      ...(generated.event_provider ? { event_provider: generated.event_provider } : {}),
      ...(generated.event_type ? { event_type: generated.event_type } : {}),
      provider_recommendations: generated.provider_recommendations,
      credit_balance: {
        allowance_remaining: balance.allowance_remaining,
        purchased_remaining: balance.purchased_remaining,
        total_available: balance.total_available,
      },
      billing: buildDraftBillingPayload(),
    });
  } catch (error) {
    const { code } = extractAutomationRouteError(error);
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.generationFailed,
        ...(code ? { error_code: code } : {}),
      },
      502,
    );
  }
};

export const handleOpenAiConnectRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const sessionIdentity = await resolveSessionFromRequest(request, deps);
  if (!sessionIdentity) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.unauthorized,
      },
      401,
    );
  }
  if (!canManageOpenAiOauthKey(sessionIdentity)) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.workspaceForbidden,
      },
      403,
    );
  }

  const verifier = toBase64Url(randomBytes(32));
  const statePayload: OpenAiOauthState = {
    kind: "openai_automation_key",
    org_id: sessionIdentity.orgId,
    user_id: sessionIdentity.userId,
    return_to: deps.safeReturnToPath(
      new URL(request.url).searchParams.get("return_to") ?? "/settings",
    ),
    verifier,
    issued_at: Date.now(),
  };
  const authUrl = buildOpenAiOauthAuthorizationUrl({
    requestUrl: request.url,
    verifier,
    signedState: deps.signOAuthStatePayload(JSON.stringify(statePayload)),
    deps,
  });
  const acceptHeader = request.headers.get("accept") ?? "";
  if (acceptHeader.includes("application/json")) {
    return jsonResponse(request, {
      ok: true,
      oauth_start_url: authUrl,
      localhost_callback_command: OPENAI_LOCALHOST_CALLBACK_COMMAND,
      localhost_redirect_uri: resolveOpenAiOauthRedirectUri(request.url, deps),
    });
  }
  return new Response(
    null,
    withSecurityHeaders(request, { status: 302, headers: { Location: authUrl } }),
  );
};

export const handleCompleteOpenAiOauthRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const sessionIdentity = await resolveSessionFromRequest(request, deps);
  if (!sessionIdentity) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.unauthorized,
      },
      401,
    );
  }
  if (!canManageOpenAiOauthKey(sessionIdentity)) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.workspaceForbidden,
      },
      403,
    );
  }

  try {
    const payload = parseOpenAiOauthCompletePayload(deps.parseJsonPayload(await request.text()));
    const parsed = parseOpenAiOauthCallbackInput(payload.callback_url);
    const decodedState = deps.verifyAndDecodeOAuthStatePayload(parsed.state);
    if ("reason" in decodedState) {
      throw createAutomationRouteError("automation_route_failed", "Invalid OpenAI OAuth state.");
    }
    const state = parseOpenAiOauthState(decodedState.payloadRaw, deps);
    if (state.org_id !== sessionIdentity.orgId || state.user_id !== sessionIdentity.userId) {
      throw createAutomationRouteError(
        "automation_route_failed",
        "OpenAI OAuth state does not match the current session.",
      );
    }
    await completeOpenAiOauthCredentialUpsert({
      convex: deps.convex,
      orgId: state.org_id,
      userId: state.user_id,
      code: parsed.code,
      verifier: state.verifier,
      redirectUri: resolveOpenAiOauthRedirectUri(request.url, deps),
      deps,
    });
    return jsonResponse(request, {
      ok: true,
      status: "connected",
    });
  } catch (error) {
    const payloadError = mapInvalidPayloadError(error);
    if (payloadError) {
      return jsonResponse(request, payloadError, 400);
    }
    const { code, message } = extractAutomationRouteError(error);
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.dispatchFailed,
        error: message,
        ...(code ? { error_code: code } : {}),
      },
      400,
    );
  }
};

export const handleOpenAiCallbackRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const url = new URL(request.url);
  const decodedState = deps.verifyAndDecodeOAuthStatePayload(url.searchParams.get("state"));
  let returnTo = "/settings";
  try {
    if ("reason" in decodedState) {
      throw createAutomationRouteError("automation_route_failed", "Invalid OpenAI OAuth state.");
    }
    const state = parseOpenAiOauthState(decodedState.payloadRaw, deps);
    returnTo = state.return_to;
    const code = url.searchParams.get("code")?.trim() ?? "";
    if (!code) {
      throw createAutomationRouteError("automation_route_failed", "Missing OpenAI OAuth code.");
    }
    await completeOpenAiOauthCredentialUpsert({
      convex: deps.convex,
      orgId: state.org_id,
      userId: state.user_id,
      code,
      verifier: state.verifier,
      redirectUri: resolveOpenAiOauthRedirectUri(request.url, deps),
      deps,
    });
    return new Response(
      null,
      withSecurityHeaders(request, {
        status: 302,
        headers: {
          Location: buildDashboardRedirectUrl(
            request.url,
            returnTo,
            {
              ai_key_status: "connected",
              ai_key_provider: "openai",
              ai_key_mode: "subscription_token",
            },
            deps,
          ),
        },
      }),
    );
  } catch (error) {
    const { message } = extractAutomationRouteError(error);
    return new Response(
      null,
      withSecurityHeaders(request, {
        status: 302,
        headers: {
          Location: buildDashboardRedirectUrl(
            request.url,
            returnTo,
            {
              ai_key_status: "error",
              ai_key_provider: "openai",
              ai_key_error: message,
            },
            deps,
          ),
        },
      }),
    );
  }
};

export const dispatchStartOwnedAutomationApiRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response | null> => {
  const pathname = new URL(request.url).pathname;

  if (request.method === "POST" && pathname === "/api/automations/generate-questions") {
    return await handleGenerateAutomationQuestionsRequest(request, deps);
  }
  if (request.method === "POST" && pathname === "/api/automations/generate-prompt") {
    return await handleGenerateAutomationPromptRequest(request, deps);
  }
  if (request.method === "GET" && pathname === OPENAI_AUTOMATION_CONNECT_PATH) {
    return await handleOpenAiConnectRequest(request, deps);
  }
  if (request.method === "GET" && pathname === OPENAI_AUTOMATION_CALLBACK_PATH) {
    return await handleOpenAiCallbackRequest(request, deps);
  }
  if (request.method === "POST" && pathname === "/api/automations/openai/complete") {
    return await handleCompleteOpenAiOauthRequest(request, deps);
  }

  return null;
};
