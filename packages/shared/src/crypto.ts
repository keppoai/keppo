import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algo = "aes-256-gcm";
const ciphertextPrefix = "keppo-v2";

export type CryptoPurpose =
  | "integration_credentials"
  | "action_payload"
  | "sensitive_blob"
  | "default";

const purposeEnvPrefix = (purpose: CryptoPurpose): string => {
  if (purpose === "integration_credentials") {
    return "KEPPO_MASTER_KEY_INTEGRATION";
  }
  if (purpose === "action_payload") {
    return "KEPPO_MASTER_KEY_ACTION";
  }
  if (purpose === "sensitive_blob") {
    return "KEPPO_MASTER_KEY_BLOB";
  }
  return "KEPPO_MASTER_KEY";
};

const normalizeVersionForEnv = (version: string): string => {
  return version.toUpperCase().replace(/[^A-Z0-9]/g, "_");
};

const isRelaxedEnv = (): boolean => {
  const mode = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  return mode === "development" || mode === "test" || process.env.KEPPO_E2E_MODE === "true";
};

const resolveDevFallbackKey = (): string | null => {
  if (!isRelaxedEnv()) {
    return null;
  }
  const fallback = process.env.BETTER_AUTH_SECRET?.trim();
  return fallback && fallback.length > 0 ? fallback : null;
};

const resolveVersion = (purpose: CryptoPurpose): string => {
  const prefix = purposeEnvPrefix(purpose);
  const scoped = process.env[`${prefix}_VERSION`];
  if (scoped && scoped.trim()) {
    return scoped.trim();
  }
  const global = process.env.KEPPO_MASTER_KEY_VERSION;
  if (global && global.trim()) {
    return global.trim();
  }
  return "v1";
};

const resolveMasterKeySource = (purpose: CryptoPurpose, version: string): string => {
  const prefix = purposeEnvPrefix(purpose);
  const versioned = process.env[`${prefix}_${normalizeVersionForEnv(version)}`];
  if (versioned && versioned.trim()) {
    return versioned.trim();
  }

  if (purpose === "integration_credentials") {
    const integrationKey = process.env.KEPPO_MASTER_KEY_INTEGRATION?.trim();
    if (integrationKey) {
      return integrationKey;
    }
    const defaultKey = process.env.KEPPO_MASTER_KEY?.trim();
    if (defaultKey) {
      return defaultKey;
    }
    const relaxedFallback = resolveDevFallbackKey();
    if (relaxedFallback) {
      return relaxedFallback;
    }
    throw new Error("Missing encryption key for integration_credentials");
  }
  if (purpose === "action_payload") {
    const actionKey = process.env.KEPPO_MASTER_KEY_ACTION?.trim();
    if (actionKey) {
      return actionKey;
    }
    const defaultKey = process.env.KEPPO_MASTER_KEY?.trim();
    if (defaultKey) {
      return defaultKey;
    }
    const relaxedFallback = resolveDevFallbackKey();
    if (relaxedFallback) {
      return relaxedFallback;
    }
    throw new Error("Missing encryption key for action_payload");
  }
  if (purpose === "sensitive_blob") {
    const blobKey = process.env.KEPPO_MASTER_KEY_BLOB?.trim();
    if (blobKey) {
      return blobKey;
    }
    const defaultKey = process.env.KEPPO_MASTER_KEY?.trim();
    if (defaultKey) {
      return defaultKey;
    }
    const relaxedFallback = resolveDevFallbackKey();
    if (relaxedFallback) {
      return relaxedFallback;
    }
    throw new Error("Missing encryption key for sensitive_blob");
  }
  const defaultKey = process.env.KEPPO_MASTER_KEY?.trim();
  if (defaultKey) {
    return defaultKey;
  }
  const relaxedFallback = resolveDevFallbackKey();
  if (relaxedFallback) {
    return relaxedFallback;
  }
  throw new Error("Missing encryption key for default purpose");
};

const getMasterKey = (purpose: CryptoPurpose, version: string): Buffer => {
  const source = resolveMasterKeySource(purpose, version);
  return createHash("sha256").update(source).digest();
};

export const getCryptoKeyVersion = (purpose: CryptoPurpose): string => {
  return resolveVersion(purpose);
};

export const getCiphertextKeyVersion = (value: string, purpose: CryptoPurpose): string => {
  const [first, second] = value.split(".");
  if (first === ciphertextPrefix && second) {
    return second;
  }
  return getCryptoKeyVersion(purpose);
};

export const encryptJsonWithPurpose = (
  value: unknown,
  purpose: CryptoPurpose,
  keyVersionOverride?: string,
): string => {
  const keyVersion = keyVersionOverride ?? resolveVersion(purpose);
  const iv = randomBytes(12);
  const cipher = createCipheriv(algo, getMasterKey(purpose, keyVersion), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    ciphertextPrefix,
    keyVersion,
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
};

export const decryptJsonWithPurpose = <T>(value: string, purpose: CryptoPurpose): T => {
  const segments = value.split(".");
  const isV2Envelope = segments[0] === ciphertextPrefix;
  const keyVersion = isV2Envelope
    ? (segments[1] ?? resolveVersion(purpose))
    : resolveVersion(purpose);
  const ivRaw = isV2Envelope ? segments[2] : segments[0];
  const tagRaw = isV2Envelope ? segments[3] : segments[1];
  const encRaw = isV2Envelope ? segments[4] : segments[2];
  if (!ivRaw || !tagRaw || !encRaw) {
    throw new Error("Invalid ciphertext format");
  }
  const decipher = createDecipheriv(
    algo,
    getMasterKey(purpose, keyVersion),
    Buffer.from(ivRaw, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encRaw, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
};

export const encryptJson = (value: unknown): string => {
  return encryptJsonWithPurpose(value, "default");
};

export const decryptJson = <T>(value: string): T => {
  return decryptJsonWithPurpose<T>(value, "default");
};
