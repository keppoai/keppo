import { timingSafeEqual } from "node:crypto";
import {
  isBoundaryParseError,
  parseCronAuthorizationHeader,
} from "@keppo/shared/providers/boundaries/error-boundary";
import { getEnv } from "./env.js";

export const resolveCronSecret = (): string | null => {
  const env = getEnv();
  const secret = env.KEPPO_CRON_SECRET ?? env.KEPPO_QUEUE_SECRET ?? env.VERCEL_CRON_SECRET;
  if (!secret) {
    return null;
  }
  const trimmed = secret.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const isInternalBearerAuthorized = (params: {
  authorizationHeader: string | undefined;
  allowWhenSecretMissing?: boolean;
}): { ok: boolean; reason?: string } => {
  const secret = resolveCronSecret();
  const allowWhenSecretMissing = params.allowWhenSecretMissing ?? false;
  if (!secret) {
    return {
      ok: allowWhenSecretMissing,
      ...(allowWhenSecretMissing ? {} : { reason: "missing_secret" }),
    };
  }

  let parsedHeader: string;
  try {
    parsedHeader = parseCronAuthorizationHeader(params.authorizationHeader ?? "");
  } catch (error) {
    if (isBoundaryParseError(error)) {
      return {
        ok: false,
        reason: error.code,
      };
    }
    return {
      ok: false,
      reason: "invalid_authorization_header",
    };
  }

  const expected = `Bearer ${secret}`;
  const receivedBuffer = Buffer.from(parsedHeader, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (receivedBuffer.length !== expectedBuffer.length) {
    return {
      ok: false,
      reason: "invalid_secret",
    };
  }
  const authorized = timingSafeEqual(receivedBuffer, expectedBuffer);

  return {
    ok: authorized,
    ...(authorized ? {} : { reason: "invalid_secret" }),
  };
};
