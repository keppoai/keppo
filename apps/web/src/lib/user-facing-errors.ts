import { type UserFacingErrorEnvelope } from "@keppo/shared/user-facing-errors";
import { parseJsonValue } from "@keppo/shared/providers/boundaries/json";
import { parseUserFacingErrorEnvelope } from "@keppo/shared/user-facing-errors";
import { ApiError } from "./api-errors";

export type UserFacingErrorAudience = "operator" | "public";
export type UserFacingErrorSeverity = "error" | "warning" | "info";

export type UserFacingError = {
  code: string;
  title: string;
  summary: string;
  nextSteps: string[];
  technicalDetails: string | null;
  publicTechnicalDetails: string | null;
  status: number | null;
  severity: UserFacingErrorSeverity;
  publicSafe: boolean;
  metadata: Record<string, unknown> | null;
  rawMessage: string | null;
  sourceMessage: string;
};

type NormalizeOptions = {
  fallback?: string;
  audience?: UserFacingErrorAudience;
  fallbackCode?: string;
};

type Guidance = {
  title: string;
  summary: string;
  nextSteps: string[];
  severity?: UserFacingErrorSeverity;
  publicSafe?: boolean;
};

const SAFE_DETAIL_PATTERN = /^[a-z0-9_.:-]{3,120}$/i;
const NETWORK_PATTERNS = [
  /failed to fetch/i,
  /networkerror/i,
  /network request failed/i,
  /load failed/i,
  /network connection/i,
  /timed out/i,
  /timeout/i,
];
const INVALID_CREDENTIAL_PATTERNS = [
  /invalid email or password/i,
  /invalid credentials/i,
  /incorrect password/i,
];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isUserFacingErrorRecord = (value: unknown): value is UserFacingError => {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    Array.isArray(value.nextSteps) &&
    value.nextSteps.every((step) => typeof step === "string")
  );
};

const normalizeCode = (value: string): string => {
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/\s+/g, "_")
    .toLowerCase();
};

const parseJsonString = (value: string): unknown | null => {
  try {
    return parseJsonValue(value);
  } catch {
    return null;
  }
};

const cleanRawMessage = (value: string): string => {
  const trimmed = value.trim();
  const uncaughtMatch = trimmed.match(/Uncaught (?:Error|ConvexError):\s*([\s\S]*)$/);
  const extracted = uncaughtMatch?.[1] ?? trimmed;
  return extracted
    .replace(/\s+at\s+[^\n]+/g, "")
    .replace(/\s+Called by client\s*$/i, "")
    .trim();
};

const extractRawMessage = (error: unknown): string => {
  if (typeof error === "string") {
    return cleanRawMessage(error);
  }
  if (error instanceof Error) {
    return cleanRawMessage(error.message);
  }
  if (isRecord(error) && typeof error.message === "string") {
    return cleanRawMessage(error.message);
  }
  if (isRecord(error) && typeof error.error === "string") {
    return cleanRawMessage(error.error);
  }
  return "";
};

const extractEnvelope = (error: unknown): UserFacingErrorEnvelope | null => {
  if (error instanceof ApiError) {
    return (
      error.envelope ??
      parseUserFacingErrorEnvelope(error.payload) ??
      parseUserFacingErrorEnvelope(parseJsonString(error.responseText ?? "")) ??
      null
    );
  }

  const direct = parseUserFacingErrorEnvelope(error);
  if (direct) {
    return direct;
  }

  const rawMessage = extractRawMessage(error);
  if (!rawMessage) {
    return null;
  }

  return parseUserFacingErrorEnvelope(parseJsonString(rawMessage));
};

const extractStructuredMessage = (error: unknown): string | null => {
  if (error instanceof ApiError && isRecord(error.payload)) {
    if (typeof error.payload.error === "string" && error.payload.error.trim()) {
      return cleanRawMessage(error.payload.error);
    }
    if (
      isRecord(error.payload.error) &&
      typeof error.payload.error.message === "string" &&
      error.payload.error.message.trim()
    ) {
      return cleanRawMessage(error.payload.error.message);
    }
    if (typeof error.payload.message === "string" && error.payload.message.trim()) {
      return cleanRawMessage(error.payload.message);
    }
  }

  const raw = extractRawMessage(error);
  if (!raw) {
    return null;
  }
  const parsed = parseJsonString(raw);
  if (isRecord(parsed)) {
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return cleanRawMessage(parsed.error);
    }
    if (
      isRecord(parsed.error) &&
      typeof parsed.error.message === "string" &&
      parsed.error.message.trim()
    ) {
      return cleanRawMessage(parsed.error.message);
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return cleanRawMessage(parsed.message);
    }
  }
  return raw;
};

const extractCodeFromMessage = (message: string): string | null => {
  const prefixed = message.match(/^([a-z0-9_.-]+):\s*(.+)$/i);
  if (prefixed?.[1]) {
    return normalizeCode(prefixed[1]);
  }

  if (/^[A-Za-z][A-Za-z0-9_]+$/.test(message)) {
    return normalizeCode(message);
  }

  return null;
};

const buildTechnicalDetails = (params: {
  audience: UserFacingErrorAudience;
  code: string;
  status: number | null;
  message: string | null;
  apiError: ApiError | null;
  envelope: UserFacingErrorEnvelope | null;
  metadata: Record<string, unknown> | null;
}): string | null => {
  const lines = [`code: ${params.code}`];
  if (params.status !== null) {
    lines.push(`status: ${String(params.status)}`);
  }
  if (params.apiError?.path) {
    lines.push(`path: ${params.apiError.path}`);
  }
  if (params.audience === "operator") {
    const detailMessage =
      params.envelope?.technical_details ??
      params.message ??
      params.apiError?.technicalDetailSource ??
      params.apiError?.responseText ??
      null;
    if (detailMessage) {
      lines.push(`message: ${String(detailMessage)}`);
    }
    for (const [key, value] of Object.entries(params.metadata ?? {})) {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        lines.push(`${key}: ${String(value)}`);
      }
    }
  }
  return lines.join("\n");
};

const getGuidance = (params: {
  code: string;
  status: number | null;
  message: string;
  fallback: string;
}): Guidance => {
  if (INVALID_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(params.message))) {
    return {
      title: "Check your credentials",
      summary: "Sign-in failed. Check your credentials and try again.",
      nextSteps: ["Confirm the email and password, then retry."],
      publicSafe: true,
    };
  }

  if (
    params.status === 401 ||
    params.code.startsWith("auth.") ||
    params.code.startsWith("session.") ||
    /session (expired|invalid|not found)/i.test(params.message) ||
    /not authenticated/i.test(params.message) ||
    /unauthorized/i.test(params.message)
  ) {
    return {
      title: "Sign in again",
      summary: "Your session is no longer valid. Sign in again and retry.",
      nextSteps: [
        "Reload the page and sign back in.",
        "Retry the action after your session is restored.",
      ],
      publicSafe: true,
    };
  }

  if (
    params.code === "billing.forbidden" ||
    /only owners and admins can (?:start checkout|buy ai credits|buy automation run top-ups|manage billing|change subscription plans)\./i.test(
      params.message,
    )
  ) {
    return {
      title: "Billing admin access required",
      summary: "Only organization owners and admins can manage billing for this organization.",
      nextSteps: [
        "Ask an owner or admin to complete the billing action.",
        "If you should manage billing, ask an owner to update your role.",
      ],
      severity: "warning",
      publicSafe: true,
    };
  }

  if (
    params.status === 403 ||
    params.code === "forbidden" ||
    params.code.endsWith(".forbidden") ||
    /permission denied/i.test(params.message) ||
    /not allowed/i.test(params.message)
  ) {
    return {
      title: "Access blocked",
      summary: "You do not have access to do that.",
      nextSteps: ["Ask an owner or admin to grant the required access."],
      severity: "warning",
      publicSafe: true,
    };
  }

  if (
    params.status === 429 ||
    params.code.includes("rate") ||
    params.code.includes("limit_reached") ||
    params.code.includes("quota") ||
    /too many/i.test(params.message)
  ) {
    return {
      title: "Rate limited",
      summary: "Keppo is rate limiting that action right now.",
      nextSteps: [
        "Wait a moment and try again.",
        "If this keeps happening, reduce request volume or upgrade the plan.",
      ],
      severity: "warning",
      publicSafe: true,
    };
  }

  if (
    params.code.includes("workspace_limit") ||
    params.code.includes("member_limit") ||
    /workspace limit reached/i.test(params.message) ||
    /member limit reached/i.test(params.message)
  ) {
    return {
      title: "Plan limit reached",
      summary: "Your current plan limit blocked that change.",
      nextSteps: ["Upgrade the plan or remove existing items, then retry."],
      severity: "warning",
      publicSafe: true,
    };
  }

  if (
    params.code.startsWith("billing.") ||
    params.code.includes("subscription_change") ||
    params.code.includes("pending_change") ||
    params.code.includes("checkout") ||
    params.code.includes("portal") ||
    params.code.includes("ai_credit")
  ) {
    return {
      title: "Billing action failed",
      summary: params.fallback,
      nextSteps: [
        "Retry the billing action.",
        "If it keeps failing, copy the technical details and contact support.",
      ],
      publicSafe: true,
    };
  }

  if (
    params.code.startsWith("push.") ||
    params.message.toLowerCase().includes("push notification") ||
    params.message.toLowerCase().includes("push subscription")
  ) {
    return {
      title: "Push notification setup failed",
      summary: "Browser push setup did not complete for this device.",
      nextSteps: [
        "Confirm browser notification permission and retry.",
        "If it keeps failing, copy the technical details and contact support.",
      ],
      publicSafe: true,
    };
  }

  if (
    params.code.startsWith("custom_mcp.") ||
    params.code.includes("custom_server") ||
    params.code.includes("server_not_found") ||
    params.code.includes("tool_not_found")
  ) {
    return {
      title: "Custom MCP server issue",
      summary: "Keppo could not finish that custom MCP action.",
      nextSteps: [
        "Check the server URL, auth settings, and discovery state.",
        "Retry after fixing the server configuration.",
      ],
    };
  }

  if (params.code.startsWith("invite.") || params.message.toLowerCase().includes("invitation")) {
    if (/expired|invalid|no longer available/i.test(params.message)) {
      return {
        title: "Invitation no longer valid",
        summary: "This invite link has expired or is no longer available.",
        nextSteps: ["Ask the workspace owner to send you a new invitation link."],
        publicSafe: true,
      };
    }
    return {
      title: "Invitation issue",
      summary: "That invitation could not be completed.",
      nextSteps: ["Use the latest invite link or ask for a new invitation."],
      publicSafe: true,
    };
  }

  if (
    params.code.startsWith("rule") ||
    params.code.startsWith("policy") ||
    params.message.toLowerCase().includes("cel") ||
    params.message.toLowerCase().includes("expression")
  ) {
    return {
      title: "Rule validation failed",
      summary: "The rule or policy input could not be validated.",
      nextSteps: ["Fix the rule text or test context and retry."],
      severity: "warning",
    };
  }

  if (
    params.code.startsWith("org_ai_keys.") ||
    params.code.includes("invalid_ai_key") ||
    params.code.includes("openai_oauth")
  ) {
    return {
      title: "AI key setup failed",
      summary: "Keppo could not complete the AI key setup flow.",
      nextSteps: [
        "Check the key or OAuth callback details, then retry.",
        "If the OAuth flow keeps failing, copy the details and contact support.",
      ],
    };
  }

  if (
    params.message.toLowerCase().includes("scope") ||
    params.message.toLowerCase().includes("reconnect") ||
    params.message.toLowerCase().includes("access token missing")
  ) {
    return {
      title: "Integration access needs attention",
      summary: "The connected provider does not currently have the required access.",
      nextSteps: ["Reconnect the provider with the required scopes, then retry."],
      severity: "warning",
    };
  }

  if (NETWORK_PATTERNS.some((pattern) => pattern.test(params.message))) {
    return {
      title: "Server connection failed",
      summary: "Keppo could not reach the server. Try again.",
      nextSteps: ["Check your network connection.", "Retry in a moment."],
      publicSafe: true,
    };
  }

  if (
    params.status === 400 ||
    params.code.includes("invalid") ||
    params.code.includes("validation")
  ) {
    return {
      title: "Check the request",
      summary: "Some of the information for that action was invalid.",
      nextSteps: ["Review the fields and retry."],
      severity: "warning",
      publicSafe: true,
    };
  }

  return {
    title: "Something went wrong",
    summary: params.fallback,
    nextSteps: [
      "Retry the action.",
      "If it keeps failing, copy the technical details and contact support.",
    ],
  };
};

export const toUserFacingError = (
  error: unknown,
  options: NormalizeOptions = {},
): UserFacingError => {
  const fallback = options.fallback ?? "Something went wrong. Try again.";
  const audience = options.audience ?? "operator";
  if (isUserFacingErrorRecord(error)) {
    return {
      ...error,
      technicalDetails:
        audience === "public" ? error.publicTechnicalDetails : error.technicalDetails,
    };
  }
  const envelope = extractEnvelope(error);
  const apiError = error instanceof ApiError ? error : null;
  const message =
    envelope?.message ?? extractStructuredMessage(error) ?? extractRawMessage(error) ?? null;
  const status =
    envelope?.status ??
    apiError?.status ??
    (isRecord(error) && typeof error.status === "number" ? error.status : null);
  const code = normalizeCode(
    envelope?.code ??
      extractCodeFromMessage(message ?? "") ??
      options.fallbackCode ??
      "internal_error",
  );
  const metadata = envelope?.metadata ?? null;
  const guidance = getGuidance({
    code,
    status,
    message: message ?? "",
    fallback,
  });
  const publicSafe = envelope?.public_safe ?? guidance.publicSafe ?? false;

  return {
    code,
    title: guidance.title,
    summary: guidance.summary,
    nextSteps: guidance.nextSteps,
    technicalDetails: buildTechnicalDetails({
      audience,
      code,
      status,
      message,
      apiError,
      envelope,
      metadata,
    }),
    status,
    severity: guidance.severity ?? "error",
    publicSafe,
    metadata,
    rawMessage: message,
    sourceMessage: message ?? fallback,
    publicTechnicalDetails:
      publicSafe && typeof envelope?.public_message === "string"
        ? envelope.public_message
        : publicSafe && typeof envelope?.technical_details === "string"
          ? envelope.technical_details
          : publicSafe && SAFE_DETAIL_PATTERN.test(code)
            ? code
            : null,
  };
};

export const normalizeUserFacingError = toUserFacingError;

export const formatUserFacingErrorDetails = (
  error: UserFacingError,
  audience: UserFacingErrorAudience = "operator",
): string | null => {
  if (audience === "public") {
    return error.publicTechnicalDetails;
  }
  return error.technicalDetails;
};

export const toUserFacingErrorMessage = (
  error: unknown,
  fallback = "Something went wrong. Try again.",
): string => {
  return toUserFacingError(error, { fallback }).summary;
};

export const extractSafeErrorDetail = (error: unknown): string | null => {
  const normalized = toUserFacingError(error, { audience: "public" });
  if (SAFE_DETAIL_PATTERN.test(normalized.code)) {
    return normalized.code;
  }
  return null;
};
