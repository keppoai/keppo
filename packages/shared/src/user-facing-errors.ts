export type UserFacingErrorMetadataValue = string | number | boolean | null;

export type UserFacingErrorMetadata = Record<string, UserFacingErrorMetadataValue>;

export type UserFacingErrorEnvelope = {
  code: string;
  message: string;
  status?: number;
  metadata?: UserFacingErrorMetadata;
  technical_details?: string | null;
  technical_details_safe_for_public?: boolean;
  public_message?: string | null;
  public_safe?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isMetadataValue = (value: unknown): value is UserFacingErrorMetadataValue => {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
};

const readEnvelope = (value: unknown): UserFacingErrorEnvelope | null => {
  if (!isRecord(value)) {
    return null;
  }

  const code = typeof value.code === "string" ? value.code.trim() : "";
  const message = typeof value.message === "string" ? value.message.trim() : "";
  if (!code || !message) {
    return null;
  }

  const metadata = isRecord(value.metadata)
    ? (Object.fromEntries(
        Object.entries(value.metadata).filter(([, entry]) => isMetadataValue(entry)),
      ) as UserFacingErrorMetadata)
    : undefined;

  return {
    code,
    message,
    ...(typeof value.status === "number" ? { status: value.status } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(typeof value.technical_details === "string" || value.technical_details === null
      ? { technical_details: value.technical_details }
      : {}),
    ...(typeof value.technical_details_safe_for_public === "boolean"
      ? { technical_details_safe_for_public: value.technical_details_safe_for_public }
      : typeof value.technical_details_public === "boolean"
        ? { technical_details_safe_for_public: value.technical_details_public }
        : {}),
    ...(typeof value.public_message === "string" || value.public_message === null
      ? { public_message: value.public_message }
      : {}),
    ...(typeof value.public_safe === "boolean" ? { public_safe: value.public_safe } : {}),
  };
};

export const isUserFacingErrorEnvelope = (value: unknown): value is UserFacingErrorEnvelope => {
  return readEnvelope(value) !== null;
};

export const parseUserFacingErrorEnvelope = (value: unknown): UserFacingErrorEnvelope | null => {
  const direct = readEnvelope(value);
  if (direct) {
    return direct;
  }
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.error_code === "string" && typeof value.error === "string") {
    return readEnvelope({
      code: value.error_code,
      message: value.error,
      ...(typeof value.status === "number" ? { status: value.status } : {}),
      ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
      ...(typeof value.technical_details === "string"
        ? { technical_details: value.technical_details }
        : {}),
      ...(typeof value.technical_details_safe_for_public === "boolean"
        ? { technical_details_safe_for_public: value.technical_details_safe_for_public }
        : {}),
    });
  }

  return readEnvelope(value.error);
};
