import { vi } from "vitest";
import { type DashboardRuntime, defaultDashboardRuntime } from "@/lib/dashboard-runtime";

const getRefName = (ref: unknown): string => {
  if (typeof ref === "string") {
    return ref;
  }
  if (ref && typeof ref === "object" && "name" in ref && typeof ref.name === "string") {
    return ref.name;
  }
  if (ref && typeof ref === "object") {
    for (const symbol of Object.getOwnPropertySymbols(ref)) {
      const value = ref[symbol as keyof typeof ref];
      if (typeof value === "string" && symbol.toString().includes("functionName")) {
        return value;
      }
    }
  }
  return String(ref);
};

export type FakeDashboardRuntimeOptions = {
  authBaseUrl?: string;
  queryHandlers?: Record<string, (args: unknown) => unknown>;
  mutationHandlers?: Record<string, ReturnType<typeof vi.fn>>;
  convexQueryHandlers?: Record<string, (args: unknown) => Promise<unknown> | unknown>;
  convexAuthState?: ReturnType<DashboardRuntime["useConvexAuth"]>;
  sessionState?: ReturnType<DashboardRuntime["authClient"]["useSession"]>;
  fetchImpl?: typeof fetch;
};

type FakeMutation = ReturnType<typeof vi.fn> & {
  withOptimisticUpdate: ReturnType<typeof vi.fn>;
};

const attachOptimisticUpdate = (mutation: ReturnType<typeof vi.fn>): FakeMutation => {
  const existing = mutation as FakeMutation;
  if (typeof existing.withOptimisticUpdate === "function") {
    return existing;
  }

  existing.withOptimisticUpdate = vi.fn(() => existing);
  return existing;
};

export function createFakeDashboardRuntime(
  options: FakeDashboardRuntimeOptions = {},
): DashboardRuntime & {
  convexQuery: ReturnType<typeof vi.fn>;
  navigateTo: ReturnType<typeof vi.fn>;
} {
  const queryHandlers = options.queryHandlers ?? {};
  const mutationHandlers = options.mutationHandlers ?? {};
  const convexQueryHandlers = options.convexQueryHandlers ?? {};
  const convexQuery = vi.fn(async (ref: unknown, args: unknown) => {
    const handler = convexQueryHandlers[getRefName(ref)];
    return handler ? await handler(args) : [];
  });
  const useQuerySpy = vi.fn((ref: unknown, args: unknown) => {
    if (args === "skip") {
      return undefined;
    }
    const handler = queryHandlers[getRefName(ref)];
    return handler ? handler(args) : undefined;
  });
  const useMutationSpy = vi.fn((ref: unknown) => {
    return attachOptimisticUpdate(
      mutationHandlers[getRefName(ref)] ?? vi.fn(async () => undefined),
    );
  });
  const navigateTo = vi.fn();
  const fetchImpl = options.fetchImpl ?? vi.fn(defaultDashboardRuntime.fetch);
  const convexClient = {
    query: convexQuery,
  } as unknown as DashboardRuntime["convexClient"];
  const authClient = {
    ...defaultDashboardRuntime.authClient,
    useSession: () =>
      options.sessionState ?? {
        data: null,
        error: null,
        isPending: false,
        isRefetching: false,
        refetch: async () => undefined,
      },
    organization: {
      ...defaultDashboardRuntime.authClient.organization,
      list: vi.fn(async () => ({ data: [] })),
      create: vi.fn(async () => ({ data: null, error: null })),
      setActive: vi.fn(async () => ({ data: null, error: null })),
    },
    signIn: {
      ...defaultDashboardRuntime.authClient.signIn,
      magicLink: vi.fn(async () => ({ data: null, error: null })),
      email: vi.fn(async () => ({ data: null, error: null })),
      social: vi.fn(async () => ({ data: null, error: null })),
    },
    signUp: {
      ...defaultDashboardRuntime.authClient.signUp,
      email: vi.fn(async () => ({ data: null, error: null })),
    },
    signOut: vi.fn(async () => ({ data: null, error: null })),
  } as unknown as DashboardRuntime["authClient"];

  return {
    ...defaultDashboardRuntime,
    authBaseUrl: options.authBaseUrl ?? defaultDashboardRuntime.authBaseUrl,
    authClient,
    convexClient,
    fetch: fetchImpl,
    navigateTo,
    useConvex: (() => convexClient) as unknown as DashboardRuntime["useConvex"],
    useConvexAuth: (() =>
      options.convexAuthState ?? {
        isAuthenticated: true,
        isLoading: false,
      }) as unknown as DashboardRuntime["useConvexAuth"],
    useQuery: useQuerySpy as unknown as DashboardRuntime["useQuery"],
    useMutation: useMutationSpy as unknown as DashboardRuntime["useMutation"],
    convexQuery,
  };
}
