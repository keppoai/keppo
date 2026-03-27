import Stripe from "stripe";
import { createErrorTextSignals, hasErrorCode, hasErrorCodePrefix } from "../error-signals.js";
import { ProviderSdkError, type ProviderSdkErrorShape } from "../port.js";

export const toProviderSdkError = (method: string, error: unknown): ProviderSdkError => {
  if (error instanceof ProviderSdkError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const messageSignals = createErrorTextSignals(message);
  const shape: ProviderSdkErrorShape = {
    category: "unknown",
    code: "provider_error",
    message,
    retryable: false,
  };

  if (error instanceof Stripe.errors.StripeError) {
    const status = typeof error.statusCode === "number" ? error.statusCode : undefined;
    const code = error.code ?? "provider_error";

    shape.code = code;
    if (status) {
      shape.status = status;
    }

    if (
      error.type === "StripeAuthenticationError" ||
      status === 401 ||
      code === "invalid_api_key"
    ) {
      shape.category = "auth";
      shape.code = code === "provider_error" ? "invalid_token" : code;
      shape.status = 401;
    } else if (error.type === "StripeRateLimitError" || status === 429) {
      shape.category = "rate_limit";
      shape.code = code === "provider_error" ? "rate_limited" : code;
      shape.status = 429;
      shape.retryable = true;
    } else if (code === "resource_missing" || status === 404) {
      shape.category = "not_found";
      shape.code = code;
      shape.status = 404;
    } else if (error.type === "StripeInvalidRequestError" || status === 400) {
      shape.category = "validation";
      shape.code = code === "provider_error" ? "invalid_request" : code;
      shape.status = 400;
    } else if (
      error.type === "StripeConnectionError" ||
      hasErrorCode(messageSignals, "timeout", "gateway_timeout")
    ) {
      shape.category = "timeout";
      shape.code = code === "provider_error" ? "timeout" : code;
      shape.status = status ?? 504;
      shape.retryable = true;
    } else if (status !== undefined && status >= 500) {
      shape.retryable = true;
    }
  } else if (hasErrorCode(messageSignals, "invalid_token", "missing_access_token")) {
    shape.category = "auth";
    shape.code = "invalid_token";
    shape.status = 401;
  } else if (hasErrorCode(messageSignals, "rate_limited")) {
    shape.category = "rate_limit";
    shape.code = "rate_limited";
    shape.status = 429;
    shape.retryable = true;
  } else if (hasErrorCode(messageSignals, "timeout", "gateway_timeout")) {
    shape.category = "timeout";
    shape.code = "timeout";
    shape.status = 504;
    shape.retryable = true;
  } else if (hasErrorCode(messageSignals, "not_found")) {
    shape.category = "not_found";
    shape.code = "not_found";
    shape.status = 404;
  } else if (hasErrorCodePrefix(messageSignals, "invalid_", "missing_")) {
    shape.category = "validation";
    shape.code = "invalid_request";
    shape.status = 400;
  }

  return new ProviderSdkError({
    providerId: "stripe",
    method,
    shape,
    causeData: error,
  });
};
