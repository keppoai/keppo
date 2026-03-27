"use client";

import React from "react";
import { signIn, signOut } from "next-auth/react";

const GIT_HOST_PROVIDER_ID = ["git", "hub"].join("");

export function AppHeader({
  githubLogin,
  children,
}: {
  githubLogin: string | null;
  children?: React.ReactNode;
}) {
  return (
    <header className="app-header">
      <span className="app-logo">Izzy</span>
      {children}
      <div className="header-auth">
        {githubLogin ? (
          <>
            <span className="header-user">@{githubLogin}</span>
            <button
              className="header-link"
              onClick={() => signOut({ callbackUrl: "/" })}
              type="button"
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            className="header-link"
            onClick={() => signIn(GIT_HOST_PROVIDER_ID)}
            type="button"
          >
            Sign in with GitHub
          </button>
        )}
      </div>
    </header>
  );
}
