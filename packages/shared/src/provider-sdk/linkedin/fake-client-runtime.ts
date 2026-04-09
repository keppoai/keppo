import { BaseFakeClient } from "../base-fake-client.js";
import { createFakeProviderSdkErrorFactory, matchErrorCodes } from "../fake-error.js";
import type { ProviderSdkCallLog } from "../port.js";
import type { CreateLinkedInClient, LinkedInClient } from "./client-interface.js";
import type {
  LinkedInJsonResponse,
  LinkedInQueryValue,
  LinkedInRequestJsonArgs,
  LinkedInSdkContext,
} from "./types.js";

type LinkedInNamespaceState = {
  profile: Record<string, unknown>;
  organizations: Array<Record<string, unknown>>;
  posts: Array<Record<string, unknown>>;
  resources: Map<string, unknown>;
  nextPostId: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const toResourceKey = (path: string, query?: Record<string, LinkedInQueryValue>): string => {
  const entries = Object.entries(query ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return path;
  }
  return `${path}?${entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&")}`;
};

const toProviderSdkError = createFakeProviderSdkErrorFactory("linkedin", [
  {
    match: matchErrorCodes("missing_access_token", "invalid_access_token"),
    category: "auth",
    code: "invalid_token",
    status: 401,
    retryable: false,
  },
  {
    match: matchErrorCodes("permission_denied"),
    category: "permission",
    code: "permission_denied",
    status: 403,
    retryable: false,
  },
  {
    match: matchErrorCodes("not_found"),
    category: "not_found",
    code: "not_found",
    status: 404,
    retryable: false,
  },
  {
    match: matchErrorCodes("rate_limited"),
    category: "rate_limit",
    code: "rate_limited",
    status: 429,
    retryable: true,
  },
  {
    match: matchErrorCodes("timeout", "gateway_timeout"),
    category: "timeout",
    code: "timeout",
    status: 504,
    retryable: true,
  },
]);

export class InMemoryLinkedInEngine extends BaseFakeClient<LinkedInNamespaceState> {
  constructor(options?: { callLog?: ProviderSdkCallLog }) {
    super({
      providerId: "linkedin",
      ...(options?.callLog ? { callLog: options.callLog } : {}),
    });
  }

  async getProfile(args: LinkedInSdkContext): Promise<Record<string, unknown>> {
    return this.runProviderOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "linkedin.members.getProfile",
      args: {
        namespace: args.namespace,
      },
      mapError: toProviderSdkError,
      execute: (state) => ({ ...state.profile }),
    });
  }

  async requestJson(args: LinkedInRequestJsonArgs): Promise<LinkedInJsonResponse> {
    const normalizedArgs = {
      namespace: args.namespace,
      method: args.method,
      path: args.path,
      ...(args.query ? { query: { ...args.query } } : {}),
      hasBody: args.body !== undefined,
    };

    return this.runProviderOperation({
      namespace: args.namespace,
      accessToken: args.accessToken,
      method: "linkedin.api.requestJson",
      args: normalizedArgs,
      mapError: toProviderSdkError,
      execute: (state) => {
        const resourceKey = toResourceKey(args.path, args.query);
        if (args.method === "GET") {
          return this.handleRead(state, resourceKey, args.path);
        }
        return this.handleWrite(state, resourceKey, args);
      },
    });
  }

  override reset(namespace?: string): void {
    super.reset(namespace);
  }

  seed(namespace: string, seedData: Record<string, unknown>): void {
    const state = this.getState(namespace);

    if (isRecord(seedData.profile)) {
      state.profile = { ...seedData.profile };
    }
    if (Array.isArray(seedData.organizations)) {
      state.organizations = seedData.organizations.filter(isRecord).map((entry) => ({ ...entry }));
    }
    if (Array.isArray(seedData.posts)) {
      state.posts = seedData.posts.filter(isRecord).map((entry) => ({ ...entry }));
      state.nextPostId = state.posts.length + 1;
    }
    if (isRecord(seedData.resources)) {
      for (const [key, value] of Object.entries(seedData.resources)) {
        state.resources.set(key, value);
      }
    }
  }

  protected createDefaultState(): LinkedInNamespaceState {
    return {
      profile: {
        sub: "member_100",
        name: "Taylor Riley",
        given_name: "Taylor",
        family_name: "Riley",
        email: "taylor.riley@example.com",
        locale: "en_US",
      },
      organizations: [
        {
          id: "urn:li:organization:1",
          localizedName: "Keppo Labs",
          vanityName: "keppo-labs",
        },
      ],
      posts: [
        {
          id: "urn:li:share:1",
          commentary: "Shipping a LinkedIn provider test surface.",
          author: "urn:li:person:member_100",
        },
      ],
      resources: new Map<string, unknown>(),
      nextPostId: 2,
    };
  }

  private handleRead(
    state: LinkedInNamespaceState,
    resourceKey: string,
    path: string,
  ): LinkedInJsonResponse {
    if (path === "/v2/userinfo" || path === "/v2/me" || path === "/rest/me") {
      return {
        status: 200,
        data: { ...state.profile },
        headers: {},
      };
    }

    const seeded = state.resources.get(resourceKey);
    if (seeded !== undefined) {
      return {
        status: 200,
        data: seeded,
        headers: {},
      };
    }

    if (path.includes("organization")) {
      return {
        status: 200,
        data: {
          elements: state.organizations.map((entry) => ({ ...entry })),
        },
        headers: {},
      };
    }

    if (path.includes("post")) {
      return {
        status: 200,
        data: {
          elements: state.posts.map((entry) => ({ ...entry })),
        },
        headers: {},
      };
    }

    return {
      status: 200,
      data: {
        ok: true,
        path,
      },
      headers: {},
    };
  }

  private handleWrite(
    state: LinkedInNamespaceState,
    resourceKey: string,
    args: LinkedInRequestJsonArgs,
  ): LinkedInJsonResponse {
    if (args.method === "POST" && args.path.includes("post")) {
      const nextId = `urn:li:share:${state.nextPostId}`;
      state.nextPostId += 1;
      const created = {
        id: nextId,
        ...(isRecord(args.body) ? args.body : {}),
      };
      state.posts.unshift(created);
      state.resources.set(resourceKey, created);
      return {
        status: 201,
        data: created,
        headers: {},
      };
    }

    if (args.method === "DELETE") {
      return {
        status: 200,
        data: {
          deleted: true,
          path: args.path,
        },
        headers: {},
      };
    }

    const response = {
      ok: true,
      method: args.method,
      path: args.path,
      ...(args.body !== undefined ? { body: args.body } : {}),
    };
    state.resources.set(resourceKey, response);
    return {
      status: 200,
      data: response,
      headers: {},
    };
  }
}

export class FakeLinkedInClientStore {
  private readonly engine: InMemoryLinkedInEngine;

  readonly createClient: CreateLinkedInClient;

  constructor(options?: { callLog?: ProviderSdkCallLog }) {
    this.engine = new InMemoryLinkedInEngine(options);
    this.createClient = (accessToken: string, namespace?: string): LinkedInClient => {
      return {
        getProfile: async () =>
          this.engine.getProfile({
            accessToken,
            ...(namespace ? { namespace } : {}),
          }),
        requestJson: async (args) =>
          this.engine.requestJson({
            accessToken,
            ...(namespace ? { namespace } : {}),
            ...args,
          }),
      };
    };
  }

  reset(namespace?: string): void {
    this.engine.reset(namespace);
  }

  seed(namespace: string, seedData: Record<string, unknown>): void {
    this.engine.seed(namespace, seedData);
  }
}

export const createFakeLinkedInClientStore = (options?: {
  callLog?: ProviderSdkCallLog;
}): FakeLinkedInClientStore => {
  return new FakeLinkedInClientStore(options);
};
