import type { ConvexInternalClient } from "./convex.js";
import {
  API_DEDUPE_SCOPE,
  IDEMPOTENCY_RESOLUTION_STATUS,
  OAUTH_DEDUPE_RESOLUTION_STATUS,
  assertNever,
  type ApiDedupeScope,
  type OAuthDedupeResolutionStatus,
} from "@keppo/shared/domain";
import { waitForIdempotencyResolution } from "./idempotency.js";
export type { ApiDedupeScope };
export { OAUTH_DEDUPE_RESOLUTION_STATUS };

export type OAuthCallbackDedupePayload = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  externalAccountId: string;
  scopes: string[];
};

type OAuthDedupeResolutionWithoutPayloadStatus = Exclude<
  OAuthDedupeResolutionStatus,
  typeof OAUTH_DEDUPE_RESOLUTION_STATUS.payloadReady
>;

export type OAuthDedupeResolution =
  | {
      status: OAuthDedupeResolutionWithoutPayloadStatus;
    }
  | {
      status: typeof OAUTH_DEDUPE_RESOLUTION_STATUS.payloadReady;
      payload: OAuthCallbackDedupePayload;
    };

type OAuthDedupeConvexClient = Pick<ConvexInternalClient, "getApiDedupeKey">;

export const parseOAuthCallbackDedupePayload = (
  payload: Record<string, unknown> | null,
): OAuthCallbackDedupePayload | null => {
  if (!payload) {
    return null;
  }
  const accessToken = payload.accessToken;
  const refreshToken = payload.refreshToken;
  const expiresAt = payload.expiresAt;
  const externalAccountId = payload.externalAccountId;
  const scopes = payload.scopes;
  if (
    typeof accessToken !== "string" ||
    !(typeof refreshToken === "string" || refreshToken === null) ||
    !(typeof expiresAt === "string" || expiresAt === null) ||
    typeof externalAccountId !== "string" ||
    !Array.isArray(scopes) ||
    scopes.some((scope) => typeof scope !== "string")
  ) {
    return null;
  }
  return {
    accessToken,
    refreshToken,
    expiresAt,
    externalAccountId,
    scopes,
  };
};

export const waitForOAuthDedupeResolution = async (params: {
  convex: OAuthDedupeConvexClient;
  dedupeKey: string;
  waitMs: number;
  pollIntervalMs: number;
}): Promise<OAuthDedupeResolution> => {
  const resolution = await waitForIdempotencyResolution({
    client: params.convex,
    scope: API_DEDUPE_SCOPE.oauthCallback,
    dedupeKey: params.dedupeKey,
    waitMs: params.waitMs,
    pollIntervalMs: params.pollIntervalMs,
    parsePayload: parseOAuthCallbackDedupePayload,
  });
  switch (resolution.status) {
    case IDEMPOTENCY_RESOLUTION_STATUS.completed:
      return { status: OAUTH_DEDUPE_RESOLUTION_STATUS.completed };
    case IDEMPOTENCY_RESOLUTION_STATUS.payloadReady:
      return {
        status: OAUTH_DEDUPE_RESOLUTION_STATUS.payloadReady,
        payload: resolution.payload,
      };
    case IDEMPOTENCY_RESOLUTION_STATUS.unresolved:
      return { status: OAUTH_DEDUPE_RESOLUTION_STATUS.unresolved };
    default:
      return assertNever(resolution, "oauth dedupe resolution");
  }
};
