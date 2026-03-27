import type { GaxiosError } from "gaxios";
import { createErrorTextSignals, hasErrorCode, hasErrorCodePrefix } from "../error-signals.js";
import { ProviderSdkError, type ProviderSdkErrorShape } from "../port.js";

const getStatusCode = (error: unknown): number | undefined => {
  const maybeError = error as Partial<GaxiosError<unknown>>;
  const status = maybeError.response?.status;
  return typeof status === "number" ? status : undefined;
};

const getGmailErrorCode = (error: unknown): string | undefined => {
  const maybeError = error as Partial<GaxiosError<unknown>>;
  const responseData = maybeError.response?.data as
    | { error?: { status?: string; errors?: Array<{ reason?: string }> } }
    | undefined;

  const reason = responseData?.error?.errors?.[0]?.reason;
  if (reason) {
    return reason;
  }

  return responseData?.error?.status?.toLowerCase();
};

export const toProviderSdkError = (method: string, error: unknown): ProviderSdkError => {
  if (error instanceof ProviderSdkError) {
    return error;
  }

  const status = getStatusCode(error);
  const providerCode = getGmailErrorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  const messageSignals = createErrorTextSignals(message);

  const shape: ProviderSdkErrorShape = {
    category: "unknown",
    code: providerCode ?? "provider_error",
    message,
    retryable: false,
    ...(status ? { status } : {}),
  };

  if (
    status === 401 ||
    hasErrorCode(
      messageSignals,
      "missing_access_token",
      "invalid_token",
      "invalid_grant",
      "invalid_access_token",
      "expired_access_token",
    ) ||
    providerCode === "autherror" ||
    hasErrorCode(
      messageSignals,
      "missing_access_token",
      "invalid_access_token",
      "expired_access_token",
    )
  ) {
    shape.category = "auth";
    shape.code = providerCode ?? "invalid_token";
    shape.status = 401;
  } else if (
    status === 429 ||
    providerCode?.includes("rate") ||
    providerCode === "userratelimitexceeded" ||
    message === "rate_limited"
  ) {
    shape.category = "rate_limit";
    shape.code = providerCode ?? "rate_limited";
    shape.status = 429;
    shape.retryable = true;
  } else if (
    status === 504 ||
    hasErrorCode(messageSignals, "timeout", "gateway_timeout") ||
    (error instanceof Error &&
      "code" in error &&
      /TIME/i.test(String((error as { code?: string }).code ?? "")))
  ) {
    shape.category = "timeout";
    shape.code = providerCode ?? "timeout";
    shape.status = 504;
    shape.retryable = true;
  } else if (
    status === 404 ||
    providerCode === "notfound" ||
    hasErrorCode(messageSignals, "not_found")
  ) {
    shape.category = "not_found";
    shape.code = providerCode ?? "not_found";
    shape.status = 404;
  } else if (status === 400 || hasErrorCodePrefix(messageSignals, "invalid_", "missing_")) {
    shape.category = "validation";
    shape.code = providerCode ?? "invalid_request";
    shape.status = 400;
  } else if (status !== undefined && status >= 500) {
    shape.retryable = true;
  }

  return new ProviderSdkError({
    providerId: "google",
    method,
    shape,
    causeData: error,
  });
};
