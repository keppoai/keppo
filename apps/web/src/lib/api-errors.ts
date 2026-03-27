import { type UserFacingErrorEnvelope } from "@keppo/shared/user-facing-errors";
import { parseJsonValue } from "@keppo/shared/providers/boundaries/json";
import { parseUserFacingErrorEnvelope } from "@keppo/shared/user-facing-errors";

export type SerializedApiError = {
  message: string;
  status: number;
  path?: string | undefined;
  payload?: Record<string, NonNullable<unknown>> | null | undefined;
  responseText?: string | undefined;
  envelope?: UserFacingErrorEnvelope | null;
  technicalDetailSource?: string | null;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: SerializedApiError };

export class ApiError extends Error {
  status: number;
  path?: string;
  payload?: unknown;
  responseText?: string;
  envelope?: UserFacingErrorEnvelope | null;
  technicalDetailSource?: string | null;

  constructor(
    message: string,
    status: number,
    options?: Omit<SerializedApiError, "message" | "status">,
  ) {
    super(message);
    this.status = status;
    if (options?.path !== undefined) {
      this.path = options.path;
    }
    if (options?.payload !== undefined) {
      this.payload = options.payload;
    }
    if (options?.responseText !== undefined) {
      this.responseText = options.responseText;
    }
    this.envelope = options?.envelope ?? null;
    this.technicalDetailSource = options?.technicalDetailSource ?? null;
  }
}

export const readApiResponseBody = async (
  response: Response,
): Promise<{
  payload: unknown | null;
  responseText: string;
  envelope: UserFacingErrorEnvelope | null;
}> => {
  const responseText = await response.text();
  if (!responseText) {
    return { payload: null, responseText: "", envelope: null };
  }

  try {
    const payload = parseJsonValue(responseText);
    const record =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, NonNullable<unknown>>)
        : null;
    const envelope =
      parseUserFacingErrorEnvelope(payload) ??
      parseUserFacingErrorEnvelope(record?.error) ??
      parseUserFacingErrorEnvelope(
        record && typeof record.error_code === "string" && typeof record.error === "string"
          ? {
              code: record.error_code,
              message: record.error,
              ...(typeof record.status === "number" ? { status: record.status } : {}),
              ...(record.metadata &&
              typeof record.metadata === "object" &&
              !Array.isArray(record.metadata)
                ? { metadata: record.metadata }
                : {}),
            }
          : null,
      );
    return { payload, responseText, envelope };
  } catch {
    return { payload: null, responseText, envelope: null };
  }
};

export const toSerializedApiError = async (
  response: Response,
  path?: string,
): Promise<SerializedApiError> => {
  const { payload, responseText, envelope } = await readApiResponseBody(response);
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, NonNullable<unknown>>)
      : null;
  const message =
    envelope?.message ??
    (typeof record?.error === "string"
      ? record.error
      : typeof record?.message === "string"
        ? record.message
        : responseText || `Request failed with ${response.status}`);

  const serializedError: SerializedApiError = {
    message,
    status: response.status,
    payload: record,
    responseText,
    envelope,
    technicalDetailSource:
      envelope?.technical_details ??
      (typeof record?.details === "string"
        ? record.details
        : responseText && responseText !== message
          ? responseText
          : null),
  };

  if (path !== undefined) {
    serializedError.path = path;
  }

  return serializedError;
};

export const unwrapApiResult = <T>(result: ApiResult<T>): T => {
  if (result.ok) {
    return result.data;
  }

  const { error } = result;
  throw new ApiError(error.message, error.status, error);
};
