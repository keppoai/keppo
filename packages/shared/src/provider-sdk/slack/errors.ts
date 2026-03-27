import {
  ErrorCode,
  type WebAPICallError,
  type WebAPIHTTPError,
  type WebAPIPlatformError,
  type WebAPIRateLimitedError,
  type WebAPIRequestError,
} from "@slack/web-api";
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

  const slackError = error as Partial<WebAPICallError>;
  if (slackError.code === ErrorCode.PlatformError) {
    const platformError = slackError as WebAPIPlatformError;
    const providerCode = platformError.data.error ?? "provider_error";

    shape.code = providerCode;
    if (
      providerCode === "invalid_auth" ||
      providerCode === "not_authed" ||
      providerCode === "account_inactive"
    ) {
      shape.category = "auth";
      shape.code = "invalid_token";
      shape.status = 401;
    } else if (providerCode.endsWith("_not_found") || providerCode === "not_found") {
      shape.category = "not_found";
      shape.status = 404;
    } else if (providerCode === "rate_limited" || providerCode === "ratelimited") {
      shape.category = "rate_limit";
      shape.code = "rate_limited";
      shape.status = 429;
      shape.retryable = true;
    } else if (providerCode.includes("invalid") || providerCode.includes("missing")) {
      shape.category = "validation";
      shape.code = providerCode;
      shape.status = 400;
    }
  } else if (slackError.code === ErrorCode.RateLimitedError) {
    const rateLimitError = slackError as WebAPIRateLimitedError;
    shape.category = "rate_limit";
    shape.code = "rate_limited";
    shape.message = `Rate limited, retry after ${String(rateLimitError.retryAfter)}s`;
    shape.status = 429;
    shape.retryable = true;
  } else if (slackError.code === ErrorCode.HTTPError) {
    const httpError = slackError as WebAPIHTTPError;
    shape.code = "http_error";
    shape.status = httpError.statusCode;
    shape.message = httpError.statusMessage || message;

    if (httpError.statusCode === 401) {
      shape.category = "auth";
      shape.code = "invalid_token";
    } else if (httpError.statusCode === 404) {
      shape.category = "not_found";
      shape.code = "not_found";
    } else if (httpError.statusCode === 429) {
      shape.category = "rate_limit";
      shape.code = "rate_limited";
      shape.retryable = true;
    } else if (httpError.statusCode === 400 || httpError.statusCode === 422) {
      shape.category = "validation";
      shape.code = "invalid_request";
    } else if (httpError.statusCode >= 500) {
      shape.category = "transient";
      shape.code = "http_error";
      shape.retryable = true;
    }
  } else if (slackError.code === ErrorCode.RequestError) {
    const requestError = slackError as WebAPIRequestError;
    const requestMessage = requestError.original?.message ?? message;
    const requestMessageSignals = createErrorTextSignals(requestMessage);
    shape.message = requestMessage;
    if (hasErrorCode(requestMessageSignals, "timeout", "gateway_timeout")) {
      shape.category = "timeout";
      shape.code = "timeout";
      shape.status = 504;
      shape.retryable = true;
    } else {
      shape.category = "transient";
      shape.code = "request_error";
      shape.retryable = true;
    }
  } else if (hasErrorCode(messageSignals, "invalid_auth", "missing_access_token")) {
    shape.category = "auth";
    shape.code = "invalid_token";
    shape.status = 401;
  } else if (hasErrorCode(messageSignals, "not_found", "channel_not_found")) {
    shape.category = "not_found";
    shape.code = "not_found";
    shape.status = 404;
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
  } else if (hasErrorCodePrefix(messageSignals, "invalid_", "missing_")) {
    shape.category = "validation";
    shape.code = "invalid_request";
    shape.status = 400;
  }

  return new ProviderSdkError({
    providerId: "slack",
    method,
    shape,
    causeData: error,
  });
};
