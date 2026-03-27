export const asRecord = (value: unknown): Record<string, unknown> => {
  if (
    value &&
    (typeof value === "object" || typeof value === "function") &&
    !Array.isArray(value)
  ) {
    return value as Record<string, unknown>;
  }
  return {};
};

export const asString = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

export const asNumber = (value: unknown, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

export const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
};

export const toDataRecord = (value: unknown): Record<string, unknown> => {
  return asRecord(value);
};

export const extractHeaderIdempotencyKey = (
  headers?: Record<string, string | undefined>,
): string | undefined => {
  if (!headers) {
    return undefined;
  }

  return (
    headers["x-idempotency-key"] ??
    headers["X-Idempotency-Key"] ??
    headers["idempotency-key"] ??
    headers["Idempotency-Key"]
  );
};

export const withHeaderIdempotencyKey = (
  headers?: Record<string, string | undefined>,
): { idempotencyKey?: string } => {
  const idempotencyKey = extractHeaderIdempotencyKey(headers);
  return idempotencyKey ? { idempotencyKey } : {};
};

export const extractRequestIdempotencyKey = (options?: unknown): string | undefined => {
  const optionRecord = asRecord(options);
  const direct = extractHeaderIdempotencyKey(
    asRecord(optionRecord.headers) as Record<string, string | undefined>,
  );
  if (direct) {
    return direct;
  }

  return extractHeaderIdempotencyKey(
    asRecord(asRecord(optionRecord.adapter).keppoAdditionalHeaders) as Record<
      string,
      string | undefined
    >,
  );
};

export const withRequestIdempotencyKey = (options?: unknown): { idempotencyKey?: string } => {
  const idempotencyKey = extractRequestIdempotencyKey(options);
  return idempotencyKey ? { idempotencyKey } : {};
};
