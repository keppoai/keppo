type CryptoPurpose = "integration_credentials" | "sensitive_blob";

const CIPHERTEXT_PREFIX = "keppo-v1";

const toHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const fromHex = (value: string): Uint8Array => {
  if (value.length % 2 !== 0) {
    throw new Error("InvalidHex");
  }
  const out = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    out[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return out;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
};

const resolveEncryptionSecret = (purpose: CryptoPurpose): string => {
  if (purpose === "integration_credentials") {
    const explicit = process.env.KEPPO_MASTER_KEY_INTEGRATION?.trim();
    if (explicit) {
      return explicit;
    }
  }
  if (purpose === "sensitive_blob") {
    const explicit = process.env.KEPPO_MASTER_KEY_BLOB?.trim();
    if (explicit) {
      return explicit;
    }
  }
  const shared = process.env.KEPPO_MASTER_KEY?.trim();
  if (shared) {
    return shared;
  }
  throw new Error(`Missing encryption key for ${purpose}`);
};

const deriveAesKey = async (purpose: CryptoPurpose): Promise<CryptoKey> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(resolveEncryptionSecret(purpose)),
  );
  return await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
};

export const isEncryptedValue = (value: string): boolean => {
  return value.startsWith(`${CIPHERTEXT_PREFIX}.`);
};

export const encryptSecretValue = async (
  rawValue: string,
  purpose: CryptoPurpose,
): Promise<string> => {
  const key = await deriveAesKey(purpose);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(rawValue),
  );
  return `${CIPHERTEXT_PREFIX}.${toHex(iv)}.${toHex(new Uint8Array(encrypted))}`;
};

export const decryptSecretValue = async (
  storedValue: string,
  purpose: CryptoPurpose,
): Promise<string> => {
  if (!isEncryptedValue(storedValue)) {
    return storedValue;
  }
  const [prefix, ivRaw, ciphertextRaw] = storedValue.split(".");
  if (prefix !== CIPHERTEXT_PREFIX || !ivRaw || !ciphertextRaw) {
    throw new Error("InvalidCiphertext");
  }
  const key = await deriveAesKey(purpose);
  const clear = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(toArrayBuffer(fromHex(ivRaw))),
    },
    key,
    toArrayBuffer(fromHex(ciphertextRaw)),
  );
  return new TextDecoder().decode(clear);
};
