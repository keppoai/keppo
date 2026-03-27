import {
  APIErrorCode,
  APIResponseError,
  ClientErrorCode,
  RequestTimeoutError,
  UnknownHTTPResponseError,
} from "@notionhq/client";
import {
  createErrorTextSignals,
  hasAnyWord,
  hasErrorCode,
  hasErrorCodePrefix,
} from "../error-signals.js";
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

  if (error instanceof APIResponseError) {
    shape.code = error.code;
    shape.status = error.status;

    if (error.code === APIErrorCode.Unauthorized) {
      shape.category = "auth";
      shape.code = "invalid_token";
      shape.status = 401;
    } else if (error.code === APIErrorCode.RestrictedResource) {
      shape.category = "permission";
      shape.status = 403;
    } else if (error.code === APIErrorCode.ObjectNotFound) {
      shape.category = "not_found";
      shape.status = 404;
    } else if (error.code === APIErrorCode.RateLimited) {
      shape.category = "rate_limit";
      shape.code = "rate_limited";
      shape.status = 429;
      shape.retryable = true;
    } else if (
      error.code === APIErrorCode.InvalidRequest ||
      error.code === APIErrorCode.ValidationError ||
      error.code === APIErrorCode.InvalidRequestURL
    ) {
      shape.category = "validation";
      shape.code = "invalid_request";
      shape.status = 400;
    } else if (
      error.code === APIErrorCode.InternalServerError ||
      error.code === APIErrorCode.ServiceUnavailable
    ) {
      shape.category = "transient";
      shape.retryable = true;
      shape.status = error.status;
    }
  } else if (error instanceof RequestTimeoutError) {
    shape.category = "timeout";
    shape.code = "timeout";
    shape.status = 504;
    shape.retryable = true;
  } else if (error instanceof UnknownHTTPResponseError) {
    shape.status = error.status;
    shape.code = ClientErrorCode.ResponseError;
    if (error.status === 401) {
      shape.category = "auth";
      shape.code = "invalid_token";
    } else if (error.status === 404) {
      shape.category = "not_found";
      shape.code = "not_found";
    } else if (error.status === 429) {
      shape.category = "rate_limit";
      shape.code = "rate_limited";
      shape.retryable = true;
    } else if (error.status >= 500) {
      shape.category = "transient";
      shape.retryable = true;
    }
  } else if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === ClientErrorCode.RequestTimeout
  ) {
    shape.category = "timeout";
    shape.code = "timeout";
    shape.status = 504;
    shape.retryable = true;
  } else if (
    hasAnyWord(messageSignals, "unauthorized", "forbidden") ||
    hasErrorCode(messageSignals, "invalid_access_token", "invalid_token", "missing_access_token")
  ) {
    shape.category = "auth";
    shape.code = "invalid_token";
    shape.status = 401;
  } else if (
    hasErrorCode(
      messageSignals,
      "object_not_found",
      "not_found",
      "page_not_found",
      "database_not_found",
      "block_not_found",
    )
  ) {
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
  } else if (
    hasAnyWord(messageSignals, "validation") ||
    hasErrorCodePrefix(messageSignals, "invalid_")
  ) {
    shape.category = "validation";
    shape.code = "invalid_request";
    shape.status = 400;
  }

  return new ProviderSdkError({
    providerId: "notion",
    method,
    shape,
    causeData: error,
  });
};
