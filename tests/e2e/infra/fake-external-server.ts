import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type FakeExternalEvent = {
  id: string;
  at: string;
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
};

type FakeMessage = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
  unread: boolean;
};

type FakeExternalState = {
  events: FakeExternalEvent[];
  eventCount: number;
  sentCount: number;
  messages: FakeMessage[];
};

const toBase64Url = (value: string): string =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const nowIso = (): string => new Date().toISOString();

const seedMessages = (): FakeMessage[] => [
  {
    id: "msg_seed_1",
    threadId: "thr_seed_1",
    from: "support@example.com",
    to: "automation@example.com",
    subject: "Welcome to Keppo",
    snippet: "Welcome to Keppo and thanks for signing up.",
    body: "Welcome to Keppo and thanks for signing up.",
    unread: true,
  },
  {
    id: "msg_seed_2",
    threadId: "thr_seed_2",
    from: "billing@example.com",
    to: "automation@example.com",
    subject: "Invoice Ready",
    snippet: "Your invoice is attached.",
    body: "Your invoice is attached.",
    unread: false,
  },
];

const initialState = (): FakeExternalState => ({
  events: [],
  eventCount: 0,
  sentCount: 0,
  messages: seedMessages(),
});

const state: FakeExternalState = initialState();

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const parseBody = (rawBody: string, contentType: string | undefined): unknown => {
  if (!rawBody) {
    return null;
  }

  if (contentType?.includes("application/json")) {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return rawBody;
    }
  }

  if (contentType?.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  }

  return rawBody;
};

const sendJson = (res: ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
  });
  res.end(body);
};

const sendRedirect = (res: ServerResponse, to: string): void => {
  res.writeHead(302, { location: to });
  res.end();
};

const logEvent = (
  method: string,
  path: string,
  query: Record<string, string>,
  body: unknown,
): void => {
  state.eventCount += 1;
  state.events.push({
    id: `evt_${state.eventCount.toString().padStart(4, "0")}`,
    at: nowIso(),
    method,
    path,
    query,
    body,
  });
};

const normalizeQuery = (url: URL): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    result[key] = value;
  }
  return result;
};

const parsePort = (value: string | undefined): number => {
  const parsed = Number(value ?? 9901);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return parsed;
};

const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const requestOrigin = `http://${req.headers.host ?? "127.0.0.1"}`;
  const path = url.pathname;
  const query = normalizeQuery(url);
  const rawBody = await readBody(req);
  const body = parseBody(rawBody, req.headers["content-type"]);
  const isControlRoute = path === "/health" || path === "/__events" || path === "/__reset";

  if (!isControlRoute) {
    logEvent(method, path, query, body);
  }

  if (method === "GET" && path === "/health") {
    sendJson(res, 200, { ok: true, now: nowIso() });
    return;
  }

  if (method === "POST" && path === "/__reset") {
    const reset = initialState();
    state.events = reset.events;
    state.eventCount = reset.eventCount;
    state.sentCount = reset.sentCount;
    state.messages = reset.messages;
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && path === "/__events") {
    sendJson(res, 200, { events: state.events });
    return;
  }

  if (method === "GET" && path === "/gmail/oauth/authorize") {
    const callback = new URL("/gmail/oauth/callback", requestOrigin);
    if (query.redirect_uri) {
      callback.searchParams.set("redirect_uri", query.redirect_uri);
    }
    if (query.state) {
      callback.searchParams.set("state", query.state);
    }
    if (query.scope) {
      callback.searchParams.set("scope", query.scope);
    }
    if (query.return_to) {
      callback.searchParams.set("return_to", query.return_to);
    }
    sendRedirect(res, callback.toString());
    return;
  }

  if (method === "GET" && path === "/gmail/oauth/callback") {
    if (!query.redirect_uri) {
      sendJson(res, 400, { error: "Missing redirect_uri" });
      return;
    }
    const redirectUri = new URL(query.redirect_uri);
    redirectUri.searchParams.set("code", "fake_gmail_code");
    if (query.state) {
      redirectUri.searchParams.set("state", query.state);
    }
    if (query.return_to) {
      redirectUri.searchParams.set("return_to", query.return_to);
    }
    if (query.scope) {
      redirectUri.searchParams.set("scope", query.scope);
    }
    sendRedirect(res, redirectUri.toString());
    return;
  }

  if (method === "POST" && path === "/gmail/oauth/token") {
    sendJson(res, 200, {
      access_token: "fake_gmail_access_token",
      refresh_token: "fake_gmail_refresh_token",
      expires_in: 3600,
      scope:
        "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
    });
    return;
  }

  if (method === "GET" && path === "/gmail/v1/users/me/profile") {
    sendJson(res, 200, {
      emailAddress: "automation@example.com",
      messagesTotal: state.messages.length,
      threadsTotal: state.messages.length,
    });
    return;
  }

  if (method === "GET" && path === "/gmail/v1/users/me/messages") {
    const maxResults = Number(query.maxResults ?? "20");
    const limit = Number.isFinite(maxResults)
      ? Math.max(1, Math.min(50, Math.floor(maxResults)))
      : 20;
    const needle = (query.q ?? "").toLowerCase();
    const filtered = state.messages.filter((message) => {
      if (!needle) {
        return true;
      }
      if (needle === "is:unread") {
        return message.unread;
      }
      return (
        message.subject.toLowerCase().includes(needle) ||
        message.snippet.toLowerCase().includes(needle) ||
        message.from.toLowerCase().includes(needle)
      );
    });

    sendJson(res, 200, {
      messages: filtered.slice(0, limit).map((message) => ({ id: message.id })),
    });
    return;
  }

  if (method === "GET" && path.startsWith("/gmail/v1/users/me/messages/")) {
    const messageId = decodeURIComponent(path.replace("/gmail/v1/users/me/messages/", ""));
    const message = state.messages.find((entry) => entry.id === messageId);
    if (!message) {
      sendJson(res, 404, { error: "Message not found" });
      return;
    }
    sendJson(res, 200, {
      id: message.id,
      threadId: message.threadId,
      snippet: message.snippet,
      payload: {
        headers: [
          { name: "From", value: message.from },
          { name: "To", value: message.to },
          { name: "Subject", value: message.subject },
        ],
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: toBase64Url(message.body),
            },
          },
        ],
      },
    });
    return;
  }

  if (method === "POST" && path === "/gmail/v1/users/me/messages/send") {
    state.sentCount += 1;
    const newId = `msg_sent_${state.sentCount}`;
    sendJson(res, 200, { id: newId });
    return;
  }

  if (
    method === "POST" &&
    path.startsWith("/gmail/v1/users/me/threads/") &&
    path.endsWith("/modify")
  ) {
    const threadId = decodeURIComponent(
      path.replace("/gmail/v1/users/me/threads/", "").replace("/modify", ""),
    );
    sendJson(res, 200, { id: threadId, modified: true });
    return;
  }

  sendJson(res, 502, {
    error: `Unknown fake external route: ${method} ${path}`,
    query,
  });
};

const start = async (): Promise<void> => {
  const port = parsePort(process.env.PORT);
  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Unknown fake external server error",
      });
    });
  });

  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`fake-external listening on http://127.0.0.1:${port}\n`);
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
};

void start();
