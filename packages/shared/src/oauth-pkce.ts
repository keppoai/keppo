import { createHash, randomBytes } from "node:crypto";

/** RFC 7636: 43–128 character URL-safe verifier for OAuth 2.0 PKCE. */
export const generateOAuthPkceCodeVerifier = (): string => {
  return randomBytes(32).toString("base64url");
};

/** PKCE `S256` code challenge: BASE64URL(SHA256(verifier)) (no padding). */
export const buildOAuthPkceCodeChallengeS256 = (verifier: string): string => {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
};
