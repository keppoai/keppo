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

  if (hasErrorCode(messageSignals, "invalid_token", "missing_access_token")) {
    shape.category = "auth";
    shape.code = "invalid_token";
    shape.status = 401;
    shape.retryable = false;
  } else if (
    hasErrorCode(
      messageSignals,
      "subreddit_not_found",
      "post_not_found",
      "comment_not_found",
      "message_not_found",
      "not_found",
    )
  ) {
    shape.category = "not_found";
    shape.code = "not_found";
    shape.status = 404;
    shape.retryable = false;
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
  } else if (hasErrorCode(messageSignals, "invalid_provider_response")) {
    shape.category = "transient";
    shape.code = "invalid_provider_response";
    shape.status = 502;
    shape.retryable = true;
  } else if (hasErrorCodePrefix(messageSignals, "invalid_", "missing_")) {
    shape.category = "validation";
    shape.code = "invalid_request";
    shape.status = 400;
    shape.retryable = false;
  }

  return new ProviderSdkError({
    providerId: "reddit",
    method,
    shape,
    causeData: error,
  });
};
