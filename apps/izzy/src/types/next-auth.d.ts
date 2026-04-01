import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    errorCode?: string | undefined;
    user: DefaultSession["user"] & {
      githubLogin?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string | undefined;
    refreshToken?: string | undefined;
    githubLogin?: string | undefined;
    errorCode?: string | undefined;
    accessTokenExpiresAt?: number | undefined;
    refreshTokenExpiresAt?: number | undefined;
  }
}
