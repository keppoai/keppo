import type {
  ProviderWebhookEvent,
  ProviderWebhookVerificationRequest,
  ProviderWebhookVerificationResult,
  ProviderRuntimeContext,
} from "../../../providers.js";
import { WEBHOOK_VERIFICATION_REASON } from "../../../domain.js";
import { getHeaderValue, hmacSha256Hex, timingSafeEqualHex } from "../webhooks-shared.js";

const verifyWebhook = async (
  request: ProviderWebhookVerificationRequest,
  runtime: ProviderRuntimeContext,
): Promise<ProviderWebhookVerificationResult> => {
  const signatureHeader = getHeaderValue(request.headers, "x-hub-signature-256");
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return { verified: false, reason: WEBHOOK_VERIFICATION_REASON.missingOrMalformedSignature };
  }

  const signature = signatureHeader.slice("sha256=".length);
  const secret = runtime.secrets.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return { verified: false, reason: WEBHOOK_VERIFICATION_REASON.missingWebhookSecret };
  }

  const expected = await hmacSha256Hex(secret, request.rawBody);
  if (!timingSafeEqualHex(expected, signature)) {
    return { verified: false, reason: WEBHOOK_VERIFICATION_REASON.invalidSignature };
  }
  return { verified: true };
};

const extractWebhookEvent = (
  payload: Record<string, unknown>,
  request: ProviderWebhookVerificationRequest,
  runtime: ProviderRuntimeContext,
): ProviderWebhookEvent => {
  const deliveryId =
    getHeaderValue(request.headers, "x-github-delivery") ?? runtime.idGenerator.randomId("whd");
  const eventType = getHeaderValue(request.headers, "x-github-event") ?? "github.event";

  const installation = payload.installation;
  const installationObject =
    installation && typeof installation === "object" && !Array.isArray(installation)
      ? (installation as Record<string, unknown>)
      : null;

  let externalAccountId: string | null = null;
  if (installationObject) {
    const installationId = installationObject.id;
    if (typeof installationId === "string" && installationId.trim()) {
      externalAccountId = installationId;
    } else if (typeof installationId === "number") {
      externalAccountId = String(installationId);
    }
  }

  return {
    deliveryId,
    eventType,
    externalAccountId,
  };
};

export const webhooks = {
  verifyWebhook,
  extractWebhookEvent,
};
