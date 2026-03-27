import { RequestError } from "@octokit/request-error";
import {
  createErrorTextSignals,
  hasAllWords,
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

  if (error instanceof RequestError) {
    const status = typeof error.status === "number" ? error.status : undefined;
    const responseData = error.response?.data as { message?: string } | undefined;
    const responseSignals = createErrorTextSignals(responseData?.message ?? "");

    if (status) {
      shape.status = status;
    }

    if (status === 401 || hasAllWords(responseSignals, "bad", "credentials")) {
      shape.category = "auth";
      shape.code = "invalid_token";
      shape.status = 401;
    } else if (
      status === 429 ||
      (status === 403 && hasAllWords(responseSignals, "rate", "limit"))
    ) {
      shape.category = "rate_limit";
      shape.code = "rate_limited";
      shape.status = status;
      shape.retryable = true;
    } else if (status === 404) {
      shape.category = "not_found";
      shape.code = "not_found";
      shape.status = 404;
    } else if (status === 422 || status === 409 || status === 400) {
      shape.category = "validation";
      shape.code = "invalid_request";
      shape.status = status;
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
  } else if (hasErrorCode(messageSignals, "not_found")) {
    shape.category = "not_found";
    shape.code = "not_found";
    shape.status = 404;
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
    providerId: "github",
    method,
    shape,
    causeData: error,
  });
};
