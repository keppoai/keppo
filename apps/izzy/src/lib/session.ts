import { cookies, headers } from "next/headers";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { getAuthOptions, hasAuthConfiguration } from "./auth";
import { getServerEnv } from "./env";
import { getPreviewGithubLogin, previewEnabled } from "./preview";

export const getIzzySession = async () => {
  const previewGithubLogin = getPreviewGithubLogin();
  if (previewGithubLogin) {
    return {
      accessToken: "preview-access-token",
      errorCode: undefined,
      user: {
        githubLogin: previewGithubLogin,
      },
    };
  }
  if (!hasAuthConfiguration()) {
    return null;
  }
  return await getServerSession(getAuthOptions());
};

const getIzzyJwt = async () => {
  if (!hasAuthConfiguration()) {
    return null;
  }
  const [requestHeaders, requestCookies] = await Promise.all([headers(), cookies()]);
  return await getToken({
    req: {
      headers: requestHeaders,
      cookies: requestCookies,
    } as unknown as NextRequest,
    secret: getServerEnv().NEXTAUTH_SECRET,
  });
};

export const requireIzzySession = async (): Promise<{
  accessToken: string;
  githubLogin: string;
}> => {
  const [session, token] = await Promise.all([getIzzySession(), getIzzyJwt()]);
  if (!session) {
    throw new Error("unauthorized_session");
  }
  if (previewEnabled() && session.user?.githubLogin) {
    return {
      accessToken: "preview-access-token",
      githubLogin: session.user.githubLogin,
    };
  }
  const accessToken = token?.accessToken?.trim();
  const githubLogin = session?.user?.githubLogin?.trim();
  if (
    !accessToken ||
    !githubLogin ||
    session.errorCode === "github_not_allowed" ||
    token?.errorCode === "github_not_allowed"
  ) {
    throw new Error("unauthorized_session");
  }
  return {
    accessToken,
    githubLogin,
  };
};
