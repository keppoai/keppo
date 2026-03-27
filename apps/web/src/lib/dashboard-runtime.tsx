import { createContext, useContext, type PropsWithChildren } from "react";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { authBaseUrl, authClient } from "@/lib/auth-client";
import { convex } from "@/lib/convex";

export type DashboardRuntime = {
  authBaseUrl: string | undefined;
  authClient: typeof authClient;
  convexClient: typeof convex;
  fetch: typeof fetch;
  navigateTo: (href: string) => void;
  useConvex: typeof useConvex;
  useConvexAuth: typeof useConvexAuth;
  useMutation: typeof useMutation;
  useQuery: typeof useQuery;
};

export const defaultDashboardRuntime: DashboardRuntime = {
  authBaseUrl,
  authClient,
  convexClient: convex,
  fetch: (...args) => fetch(...args),
  navigateTo: (href) => {
    window.location.assign(href);
  },
  useConvex,
  useConvexAuth,
  useMutation,
  useQuery,
};

const DashboardRuntimeContext = createContext<DashboardRuntime>(defaultDashboardRuntime);

export function DashboardRuntimeProvider({
  children,
  runtime,
}: PropsWithChildren<{ runtime?: DashboardRuntime }>) {
  return (
    <DashboardRuntimeContext.Provider value={runtime ?? defaultDashboardRuntime}>
      {children}
    </DashboardRuntimeContext.Provider>
  );
}

export function useDashboardRuntime(): DashboardRuntime {
  return useContext(DashboardRuntimeContext);
}
