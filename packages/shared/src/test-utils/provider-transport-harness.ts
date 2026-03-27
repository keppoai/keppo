type MockedProviderId = "google" | "stripe" | "github" | "slack" | "notion" | "reddit" | "x";

export type ProviderTransportRequestRecord = {
  method: string;
  url: string;
  pathname: string;
  search: string;
};

const ALLOWLIST_BY_PROVIDER: Record<MockedProviderId, string[]> = {
  google: ["gmail.googleapis.com:443"],
  stripe: ["api.stripe.com:443"],
  github: ["api.github.com:443"],
  slack: ["slack.com:443"],
  notion: ["api.notion.com:443"],
  reddit: ["oauth.reddit.com:443"],
  x: ["api.x.com:443"],
};

const requestUrl = (input: string | URL | Request): URL => {
  if (typeof input === "string") {
    return new URL(input);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(input.url);
};

const buildUnhandledRouteResponse = (
  provider: MockedProviderId,
  method: string,
  url: URL,
): Response => {
  return new Response(
    JSON.stringify({
      error: `Unhandled ${provider} mock route: ${method} ${url.toString()}`,
    }),
    { status: 404 },
  );
};

const routeProviderRequest = (provider: MockedProviderId, method: string, url: URL): Response => {
  const path = decodeURIComponent(url.pathname);

  if (provider === "google") {
    if (path.endsWith("/users/me/messages") && url.searchParams.get("q") === "is:unread") {
      return new Response(JSON.stringify({ messages: [{ id: "msg_1" }] }), { status: 200 });
    }
    if (path.endsWith("/users/me/messages/msg_1")) {
      return new Response(
        JSON.stringify({
          id: "msg_1",
          threadId: "thr_1",
          snippet: "hello",
          payload: {
            headers: [
              { name: "From", value: "support@example.com" },
              { name: "To", value: "automation@example.com" },
              { name: "Subject", value: "Hello" },
            ],
            parts: [],
          },
        }),
        { status: 200 },
      );
    }
    if (path.endsWith("/users/me/messages/send")) {
      return new Response(JSON.stringify({ id: "msg_sent_1" }), { status: 200 });
    }
    if (path.endsWith("/users/me/threads/thr_1/modify")) {
      return new Response(JSON.stringify({ id: "thr_1", modified: true }), { status: 200 });
    }
    return buildUnhandledRouteResponse(provider, method, url);
  }

  if (provider === "stripe") {
    if (method === "GET" && path.includes("/customers/")) {
      return new Response(
        JSON.stringify({ id: "cus_123", subscriptions: [{ id: "sub_123", status: "active" }] }),
        { status: 200 },
      );
    }
    if (method === "GET" && (path.endsWith("/charges") || path.endsWith("/list/charges"))) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "ch_123", amount: 10 },
            { id: "ch_cus_100", amount: 10 },
          ],
        }),
        {
          status: 200,
        },
      );
    }
    if (method === "POST" && (path.endsWith("/refunds") || path.endsWith("/write/refunds"))) {
      return new Response(
        JSON.stringify({ id: "re_123", status: "succeeded", amount: 10, currency: "usd" }),
        { status: 200 },
      );
    }
    return buildUnhandledRouteResponse(provider, method, url);
  }

  if (provider === "github") {
    if (method === "GET" && (path.includes("/issues") || path.endsWith("/list/issues"))) {
      return new Response(JSON.stringify([{ number: 1, title: "Issue 1" }]), {
        status: 200,
      });
    }
    if (
      method === "POST" &&
      (path.includes("/issues/1/comments") || path.endsWith("/write/issues/comment"))
    ) {
      return new Response(JSON.stringify({ id: "comment_1" }), { status: 200 });
    }
    return buildUnhandledRouteResponse(provider, method, url);
  }

  if (provider === "slack") {
    if (path.includes("conversations.list")) {
      return new Response(
        JSON.stringify({ ok: true, channels: [{ id: "C123", name: "support" }] }),
        { status: 200 },
      );
    }
    if (method === "POST" && path.endsWith("/chat.postMessage")) {
      return new Response(JSON.stringify({ ok: true, ts: "1710000000.000001", channel: "C123" }), {
        status: 200,
      });
    }
    return buildUnhandledRouteResponse(provider, method, url);
  }

  if (provider === "notion") {
    if (method === "POST" && path.endsWith("/v1/search")) {
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
    if (method === "POST" && path.endsWith("/v1/pages")) {
      return new Response(JSON.stringify({ id: "page_123" }), { status: 200 });
    }
    return buildUnhandledRouteResponse(provider, method, url);
  }

  if (provider === "reddit") {
    if (method === "GET" && path.endsWith("/search")) {
      return new Response(
        JSON.stringify({
          data: {
            children: [
              {
                data: {
                  id: "t3_1",
                  title: "Contract post",
                  permalink: "/r/support/comments/t3_1/contract_post/",
                  selftext: "body",
                  subreddit: "support",
                  score: 1,
                  num_comments: 0,
                  author: "tester",
                  created_utc: 1700000000,
                },
              },
            ],
          },
        }),
        { status: 200 },
      );
    }
    if (method === "POST" && path.endsWith("/submit")) {
      return new Response(JSON.stringify({ json: { data: { id: "t3_new" } } }), { status: 200 });
    }
    return buildUnhandledRouteResponse(provider, method, url);
  }

  if (provider === "x") {
    if (method === "GET" && path.endsWith("/2/tweets/search/recent")) {
      return new Response(JSON.stringify({ data: [{ id: "1", text: "hello" }] }), {
        status: 200,
      });
    }
    if (method === "POST" && path.endsWith("/2/tweets")) {
      return new Response(JSON.stringify({ data: { id: "2", text: "created" } }), {
        status: 200,
      });
    }
    return buildUnhandledRouteResponse(provider, method, url);
  }

  return buildUnhandledRouteResponse(provider, method, url);
};

export const createProviderTransportHarness = (provider: MockedProviderId) => {
  const records: ProviderTransportRequestRecord[] = [];
  const previousFetch = globalThis.fetch;
  const previousAllowlist = process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST;

  return {
    install(): void {
      process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST = ALLOWLIST_BY_PROVIDER[provider].join(",");
      globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        records.push({
          method,
          url: url.toString(),
          pathname: url.pathname,
          search: url.search,
        });
        return routeProviderRequest(provider, method, url);
      };
    },
    restore(): void {
      globalThis.fetch = previousFetch;
      if (previousAllowlist === undefined) {
        delete process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST;
      } else {
        process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST = previousAllowlist;
      }
    },
    listRequests(): ProviderTransportRequestRecord[] {
      return [...records];
    },
    resetRequests(): void {
      records.length = 0;
    },
  };
};
