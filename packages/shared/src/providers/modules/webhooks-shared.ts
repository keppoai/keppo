export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60_000;

export const getHeaderValue = (
  headers: Record<string, string | undefined>,
  headerName: string,
): string | undefined => {
  const direct = headers[headerName];
  if (direct) {
    return direct;
  }
  const normalized = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (value && key.toLowerCase() === normalized) {
      return value;
    }
  }
  return undefined;
};

const toHex = (buffer: ArrayBuffer): string => {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const timingSafeEqualHex = (left: string, right: string): boolean => {
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
};

export const hmacSha256Hex = async (secret: string, payload: string): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("global crypto.subtle is unavailable for webhook verification.");
  }
  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(signature);
};

export const parseStripeSignatureHeader = (
  signatureHeader: string | undefined,
): { timestamp: string; signature: string } | null => {
  if (!signatureHeader) {
    return null;
  }
  const parts = signatureHeader
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const timestamp = parts.find((entry) => entry.startsWith("t="))?.slice(2) ?? "";
  const signature = parts.find((entry) => entry.startsWith("v1="))?.slice(3) ?? "";
  if (!timestamp || !signature) {
    return null;
  }
  return { timestamp, signature };
};
