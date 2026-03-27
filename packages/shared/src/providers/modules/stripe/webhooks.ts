import type {
  ProviderWebhookEvent,
  ProviderWebhookVerificationRequest,
  ProviderWebhookVerificationResult,
  ProviderRuntimeContext,
} from "../../../providers.js";
import { WEBHOOK_VERIFICATION_REASON } from "../../../domain.js";
import {
  getHeaderValue,
  hmacSha256Hex,
  parseStripeSignatureHeader,
  timingSafeEqualHex,
  WEBHOOK_TIMESTAMP_TOLERANCE_MS,
} from "../webhooks-shared.js";

const verifyWebhook = async (
  request: ProviderWebhookVerificationRequest,
  runtime: ProviderRuntimeContext,
): Promise<ProviderWebhookVerificationResult> => {
  const parsed = parseStripeSignatureHeader(getHeaderValue(request.headers, "stripe-signature"));
  if (!parsed) {
    return { verified: false, reason: WEBHOOK_VERIFICATION_REASON.missingOrMalformedSignature };
  }

  const timestampSeconds = Number.parseInt(parsed.timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) {
    return { verified: false, reason: WEBHOOK_VERIFICATION_REASON.invalidSignatureTimestamp };
  }
  if (Math.abs(runtime.clock.now() - timestampSeconds * 1000) > WEBHOOK_TIMESTAMP_TOLERANCE_MS) {
    return {
      verified: false,
      reason: WEBHOOK_VERIFICATION_REASON.signatureTimestampOutOfTolerance,
    };
  }

  const secret =
    runtime.secrets.STRIPE_PROVIDER_WEBHOOK_SECRET ?? runtime.secrets.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return { verified: false, reason: WEBHOOK_VERIFICATION_REASON.missingWebhookSecret };
  }

  const expected = await hmacSha256Hex(secret, `${parsed.timestamp}.${request.rawBody}`);
  if (!timingSafeEqualHex(expected, parsed.signature)) {
    return { verified: false, reason: WEBHOOK_VERIFICATION_REASON.invalidSignature };
  }
  return { verified: true };
};

const extractWebhookEvent = (
  payload: Record<string, unknown>,
  _request: ProviderWebhookVerificationRequest,
  runtime: ProviderRuntimeContext,
): ProviderWebhookEvent => {
  const deliveryId =
    typeof payload.id === "string" && payload.id.trim()
      ? payload.id.trim()
      : runtime.idGenerator.randomId("whd");
  const eventType = typeof payload.type === "string" ? payload.type : "stripe.event";
  const externalAccountId = typeof payload.account === "string" ? payload.account : null;
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
