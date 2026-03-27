import { getServerSession } from "next-auth";
import { getAuthOptions, hasAuthConfiguration } from "./auth";
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

export const requireIzzySession = async (): Promise<{
  accessToken: string;
  githubLogin: string;
}> => {
  const session = await getIzzySession();
  if (!session) {
    throw new Error("unauthorized_session");
  }
  if (previewEnabled() && session.user?.githubLogin) {
    return {
      accessToken: "preview-access-token",
      githubLogin: session.user.githubLogin,
    };
  }
  const accessToken = session?.accessToken?.trim();
  const githubLogin = session?.user?.githubLogin?.trim();
  if (!accessToken || !githubLogin || session.errorCode === "github_not_allowed") {
    throw new Error("unauthorized_session");
  }
  return {
    accessToken,
    githubLogin,
  };
};
