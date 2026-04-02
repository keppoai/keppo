import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import {
  FakeGatewayRequestLogger,
  resolveNamespaceFromRequest,
} from "./fake-gateway-request-logger";
import { createProviderRegistry, mapProviderRegistry } from "../providers/registry";
import { BaseProviderFake } from "../providers/base-fake";
import type { ProviderErrorEnvelope } from "../providers/contract/provider-events";

const parsePort = (value: string | undefined): number => {
  const parsed = Number(value ?? 9901);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return parsed;
};

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const FORM_KEY_SEGMENT_PATTERN = /([^[\]]+)|\[(.*?)\]/g;

const isArrayIndexSegment = (segment: string): boolean => /^\d+$/.test(segment);

const parseFormEncodedKeySegments = (rawKey: string): string[] => {
  const segments: string[] = [];
  const matches = rawKey.matchAll(FORM_KEY_SEGMENT_PATTERN);
  for (const match of matches) {
    const key = match[1];
    if (typeof key === "string") {
      segments.push(key);
      continue;
    }
    const bracket = match[2];
    segments.push(typeof bracket === "string" ? bracket : "");
  }
  return segments;
};

const assignFormEncodedValue = (
  target: Record<string, unknown>,
  segments: string[],
  value: string,
): void => {
  let cursor: Record<string, unknown> | unknown[] = target;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? "";
    const isLastSegment = index === segments.length - 1;
    const nextSegment = segments[index + 1] ?? "";

    if (Array.isArray(cursor)) {
      const arrayIndex = segment === "" ? cursor.length : Number(segment);
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0) {
        return;
      }
      if (isLastSegment) {
        cursor[arrayIndex] = value;
        return;
      }
      const existing = cursor[arrayIndex];
      if (!existing || typeof existing !== "object") {
        cursor[arrayIndex] = nextSegment === "" || isArrayIndexSegment(nextSegment) ? [] : {};
      }
      cursor = cursor[arrayIndex] as Record<string, unknown> | unknown[];
      continue;
    }

    if (segment === "") {
      return;
    }

    if (isLastSegment) {
      const existing = cursor[segment];
      if (typeof existing === "undefined") {
        cursor[segment] = value;
        return;
      }
      if (Array.isArray(existing)) {
        existing.push(value);
        return;
      }
      cursor[segment] = [existing, value];
      return;
    }

    const existing = cursor[segment];
    if (!existing || typeof existing !== "object") {
      cursor[segment] = nextSegment === "" || isArrayIndexSegment(nextSegment) ? [] : {};
    }
    cursor = cursor[segment] as Record<string, unknown> | unknown[];
  }
};

const parseFormEncodedBody = (rawBody: string): Record<string, unknown> => {
  const parsed: Record<string, unknown> = {};
  const params = new URLSearchParams(rawBody);
  for (const [key, value] of params.entries()) {
    const segments = parseFormEncodedKeySegments(key);
    if (segments.length === 0) {
      continue;
    }
    assignFormEncodedValue(parsed, segments, value);
  }
  return parsed;
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
    return parseFormEncodedBody(rawBody);
  }
  return rawBody;
};

const normalizeQuery = (url: URL): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    normalized[key] = value;
  }
  return normalized;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const extractNotionTitleFromCreatePayload = (payload: Record<string, unknown>): string => {
  if (typeof payload.title === "string" && payload.title.trim().length > 0) {
    return payload.title;
  }

  const properties = asRecord(payload.properties);
  const titleProperty = asRecord(properties.title);
  const titleArray = Array.isArray(titleProperty.title) ? titleProperty.title : [];
  const first = titleArray[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return "Untitled";
  }

  const firstRecord = first as Record<string, unknown>;
  const text = asRecord(firstRecord.text);
  if (typeof text.content === "string" && text.content.trim().length > 0) {
    return text.content;
  }

  return typeof firstRecord.plain_text === "string" && firstRecord.plain_text.trim().length > 0
    ? firstRecord.plain_text
    : "Untitled";
};

const extractNotionContentFromCreatePayload = (payload: Record<string, unknown>): string => {
  if (typeof payload.content === "string") {
    return payload.content;
  }

  const children = Array.isArray(payload.children) ? payload.children : [];
  const paragraph = children.find((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    return (entry as Record<string, unknown>).type === "paragraph";
  }) as Record<string, unknown> | undefined;

  if (!paragraph) {
    return "";
  }

  const paragraphBody = asRecord(paragraph.paragraph);
  const richText = Array.isArray(paragraphBody.rich_text) ? paragraphBody.rich_text : [];
  return richText
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return "";
      }
      const text = asRecord((entry as Record<string, unknown>).text);
      if (typeof text.content === "string") {
        return text.content;
      }
      return "";
    })
    .join("");
};

const extractNotionTitleFromUpdatePayload = (payload: Record<string, unknown>): string | null => {
  if (typeof payload.title === "string" && payload.title.trim().length > 0) {
    return payload.title.trim();
  }

  const properties = asRecord(payload.properties);
  const titleProperty = asRecord(properties.title);
  const titleArray = Array.isArray(titleProperty.title) ? titleProperty.title : [];
  const first = titleArray[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return null;
  }
  const firstRecord = first as Record<string, unknown>;
  const text = asRecord(firstRecord.text);
  if (typeof text.content === "string" && text.content.trim().length > 0) {
    return text.content.trim();
  }
  if (typeof firstRecord.plain_text === "string" && firstRecord.plain_text.trim().length > 0) {
    return firstRecord.plain_text.trim();
  }
  return null;
};

const extractNotionParentPageIdFromUpdatePayload = (
  payload: Record<string, unknown>,
): string | undefined => {
  if (typeof payload.parentPageId === "string" && payload.parentPageId.trim().length > 0) {
    return payload.parentPageId.trim();
  }
  const parent = asRecord(payload.parent);
  if (typeof parent.page_id === "string" && parent.page_id.trim().length > 0) {
    return parent.page_id.trim();
  }
  return undefined;
};

const extractNotionContentFromAppendPayload = (payload: Record<string, unknown>): string => {
  if (typeof payload.content === "string") {
    return payload.content;
  }

  const children = Array.isArray(payload.children) ? payload.children : [];
  const firstChild = children[0];
  if (!firstChild || typeof firstChild !== "object" || Array.isArray(firstChild)) {
    return "";
  }
  return extractNotionContentFromCreatePayload({
    children: [firstChild],
  });
};

const extractNotionCommentFromPayload = (payload: Record<string, unknown>): string => {
  if (typeof payload.content === "string") {
    return payload.content;
  }
  const richText = Array.isArray(payload.rich_text) ? payload.rich_text : [];
  return richText
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return "";
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.plain_text === "string") {
        return record.plain_text;
      }
      const text = asRecord(record.text);
      return typeof text.content === "string" ? text.content : "";
    })
    .join("")
    .trim();
};

const extractNotionCommentPageIdFromPayload = (
  payload: Record<string, unknown>,
  query: Record<string, string>,
): string => {
  if (typeof payload.pageId === "string" && payload.pageId.trim().length > 0) {
    return payload.pageId.trim();
  }
  const parent = asRecord(payload.parent);
  if (typeof parent.page_id === "string" && parent.page_id.trim().length > 0) {
    return parent.page_id.trim();
  }
  return query.block_id ?? query.page_id ?? "";
};

const extractNotionDatabasePropertyNames = (payload: Record<string, unknown>): string[] => {
  if (Array.isArray(payload.propertyNames)) {
    return payload.propertyNames
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);
  }
  const properties = asRecord(payload.properties);
  return Object.keys(properties)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const extractNotionDatabaseParentPageId = (
  payload: Record<string, unknown>,
): string | undefined => {
  if (typeof payload.parentPageId === "string" && payload.parentPageId.trim().length > 0) {
    return payload.parentPageId.trim();
  }
  const parent = asRecord(payload.parent);
  if (typeof parent.page_id === "string" && parent.page_id.trim().length > 0) {
    return parent.page_id.trim();
  }
  return undefined;
};

const extractNotionContentFromBlockUpdatePayload = (payload: Record<string, unknown>): string => {
  if (typeof payload.content === "string") {
    return payload.content;
  }
  const paragraph = asRecord(payload.paragraph);
  const richText = Array.isArray(paragraph.rich_text) ? paragraph.rich_text : [];
  return richText
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return "";
      }
      const text = asRecord((entry as Record<string, unknown>).text);
      return typeof text.content === "string" ? text.content : "";
    })
    .join("")
    .trim();
};

const extractNotionMarkdownFromPayload = (payload: Record<string, unknown>): string => {
  if (typeof payload.markdown === "string") {
    return payload.markdown;
  }
  if (typeof payload.content === "string") {
    return payload.content;
  }
  return extractNotionContentFromCreatePayload(payload);
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

const toEnvelope = (code: string, message: string): ProviderErrorEnvelope => ({
  error: {
    code,
    message,
  },
});

const parseProviderPath = (pathname: string): { providerId: string; remainder: string } | null => {
  if (pathname.startsWith("/v1/")) {
    return {
      providerId: "stripe",
      remainder: pathname,
    };
  }
  const [_, providerId, ...rest] = pathname.split("/");
  if (!providerId) {
    return null;
  }
  return {
    providerId,
    remainder: `/${rest.join("/")}`,
  };
};

const resolveNamespace = (
  headers: Headers,
  query: Record<string, string>,
  body: unknown,
): string => {
  const bodyNamespace =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).namespace
      : null;
  const namespace =
    (typeof bodyNamespace === "string" ? bodyNamespace : null) ?? query.namespace ?? undefined;
  return resolveNamespaceFromRequest(headers, namespace);
};

const mapErrorToStatus = (error: unknown): { status: number; code: string; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "rate_limited") {
    return { status: 429, code: "rate_limited", message: "Provider request throttled" };
  }
  if (message === "gateway_timeout") {
    return { status: 504, code: "timeout", message: "Provider gateway timeout" };
  }
  if (message.includes("missing_access_token")) {
    return { status: 401, code: "missing_access_token", message: "Missing bearer token" };
  }
  if (
    message.includes("invalid_access_token") ||
    message.includes("expired_access_token") ||
    message.includes("invalid_refresh_token")
  ) {
    return { status: 401, code: "invalid_token", message };
  }
  if (
    message.includes("subreddit_not_found") ||
    message.includes("post_not_found") ||
    message === "not_found" ||
    message.includes("not_found")
  ) {
    return { status: 404, code: "not_found", message };
  }
  if (message.includes("unsupported_resource") || message.includes("unsupported_")) {
    return { status: 404, code: "unsupported_resource", message };
  }
  if (message.includes("text_too_long")) {
    return { status: 400, code: "text_too_long", message };
  }
  if (message.includes("invalid_") || message.includes("missing_")) {
    return { status: 400, code: "invalid_request", message };
  }
  return { status: 500, code: "provider_error", message };
};

const parseDelayMs = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(180_000, Math.floor(value)));
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(180_000, Math.floor(parsed)));
    }
  }
  return 0;
};

type OpenAiFakeResponse = {
  id: string;
  object: "response";
  created_at: number;
  status: "completed";
  error: null;
  incomplete_details: null;
  instructions: null;
  metadata: null;
  model: string;
  output: Array<Record<string, unknown>>;
  output_text: string;
  parallel_tool_calls: boolean;
  temperature: number;
  tool_choice: "auto";
  tools: [];
  top_p: number;
};

const openAiScriptStepBySession = new Map<string, number>();

const resolveOpenAiSessionKey = (req: IncomingMessage): string => {
  const headerCandidates = [
    req.headers["session_id"],
    req.headers["x-client-request-id"],
    req.headers["chatgpt-account-id"],
  ];
  for (const candidate of headerCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const nextOpenAiScriptStep = (sessionKey: string): number => {
  const next = (openAiScriptStepBySession.get(sessionKey) ?? 0) + 1;
  openAiScriptStepBySession.set(sessionKey, next);
  return next;
};

const buildOpenAiResponse = (params: {
  id: string;
  model?: string;
  output: Array<Record<string, unknown>>;
  outputText?: string;
}): OpenAiFakeResponse => ({
  id: params.id,
  object: "response",
  created_at: Math.floor(Date.now() / 1000),
  status: "completed",
  error: null,
  incomplete_details: null,
  instructions: null,
  metadata: null,
  model: params.model ?? "gpt-5.4",
  output: params.output,
  output_text: params.outputText ?? "",
  parallel_tool_calls: false,
  temperature: 1,
  tool_choice: "auto",
  tools: [],
  top_p: 1,
});

const sendSseResponse = (res: ServerResponse, response: OpenAiFakeResponse): void => {
  const createdEvent = {
    type: "response.created",
    sequence_number: 1,
    response: {
      ...response,
      status: "in_progress",
    },
  };
  const inProgressEvent = {
    type: "response.in_progress",
    sequence_number: 2,
    response: {
      ...response,
      status: "in_progress",
    },
  };
  const outputItemEvents = response.output.flatMap((item, outputIndex) => {
    const itemId = typeof item.id === "string" ? item.id : `item_${outputIndex}`;
    const inProgressItem = {
      ...item,
      id: itemId,
      status:
        item.type === "message" ? "in_progress" : item.status === "failed" ? "failed" : "calling",
      content: item.type === "message" ? [] : item.content,
    };
    const doneItem = {
      ...item,
      id: itemId,
      status:
        typeof item.status === "string"
          ? item.status
          : item.type === "message"
            ? "completed"
            : "completed",
    };
    return [
      {
        type: "response.output_item.added",
        sequence_number: 3 + outputIndex * 2,
        output_index: outputIndex,
        item: inProgressItem,
      },
      {
        type: "response.output_item.done",
        sequence_number: 4 + outputIndex * 2,
        output_index: outputIndex,
        item: doneItem,
      },
    ];
  });
  const completedEvent = {
    type: "response.completed",
    sequence_number: 3 + outputItemEvents.length,
    response,
  };
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(`event: response.created\ndata: ${JSON.stringify(createdEvent)}\n\n`);
  res.write(`event: response.in_progress\ndata: ${JSON.stringify(inProgressEvent)}\n\n`);
  for (const event of outputItemEvents) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  res.write(`event: response.completed\ndata: ${JSON.stringify(completedEvent)}\n\n`);
  res.end();
};

const buildOpenAiSearchToolsResponse = (sessionKey: string, step: number): OpenAiFakeResponse =>
  buildOpenAiResponse({
    id: `resp_${sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_")}_${step}`,
    output: [
      {
        id: `fc_${step}`,
        type: "function_call",
        call_id: `call_search_tools_${step}`,
        name: "mcp__keppo__search_tools",
        arguments: JSON.stringify({
          query: "gmail send email message",
          limit: 20,
        }),
        status: "completed",
      },
    ],
  });

const buildOpenAiRecordOutcomeResponse = (sessionKey: string, step: number): OpenAiFakeResponse =>
  buildOpenAiResponse({
    id: `resp_${sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_")}_${step}`,
    output: [
      {
        id: `fc_${step}`,
        type: "function_call",
        call_id: `call_record_outcome_${step}`,
        name: "mcp__keppo__record_outcome",
        arguments: JSON.stringify({
          success: true,
          summary: "Located the Gmail send-email tool and recorded the automation outcome.",
        }),
        status: "completed",
      },
    ],
  });

const buildOpenAiFinalMessageResponse = (sessionKey: string, step: number): OpenAiFakeResponse => {
  const text = "Finished the automation run after recording the final outcome.";
  return buildOpenAiResponse({
    id: `resp_${sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_")}_${step}`,
    output: [
      {
        id: `msg_${step}`,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text,
            annotations: [],
          },
        ],
      },
    ],
    outputText: text,
  });
};

const buildOpenAiScriptResponse = (sessionKey: string, step: number): OpenAiFakeResponse => {
  switch (step) {
    case 1:
      return buildOpenAiSearchToolsResponse(sessionKey, step);
    case 2:
      return buildOpenAiRecordOutcomeResponse(sessionKey, step);
    default:
      return buildOpenAiFinalMessageResponse(sessionKey, step);
  }
};

const summarizeOpenAiRequestBody = (body: unknown): Record<string, unknown> => {
  const payload = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const record = payload as Record<string, unknown>;
  const tools = Array.isArray(record.tools) ? record.tools : [];
  const input = Array.isArray(record.input) ? record.input : [];
  return {
    model: record.model ?? null,
    stream: record.stream ?? null,
    previous_response_id: record.previous_response_id ?? null,
    input_count: input.length,
    input_roles: input
      .map((item) => {
        const entry = item && typeof item === "object" && !Array.isArray(item) ? item : {};
        const entryRecord = entry as Record<string, unknown>;
        return {
          type: entryRecord.type ?? null,
          role: entryRecord.role ?? null,
        };
      })
      .slice(0, 8),
    tools: tools.map((tool) => {
      const item = tool && typeof tool === "object" && !Array.isArray(tool) ? tool : {};
      const toolRecord = item as Record<string, unknown>;
      return {
        type: toolRecord.type ?? null,
        name: toolRecord.name ?? null,
        server_label: toolRecord.server_label ?? null,
        connector_id: toolRecord.connector_id ?? null,
      };
    }),
  };
};

const start = async (): Promise<void> => {
  const port = parsePort(process.env.PORT);
  const baseUrl = `http://127.0.0.1:${port}`;
  const listenHost = "0.0.0.0";
  const registry = createProviderRegistry(baseUrl);
  const providers = mapProviderRegistry(registry);
  const requestLogger = new FakeGatewayRequestLogger();

  const server = createServer((req, res) => {
    void (async () => {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", baseUrl);
      const query = normalizeQuery(url);
      const rawBody = await readBody(req);
      const body = parseBody(rawBody, req.headers["content-type"]);
      const namespace = resolveNamespace(
        new Headers(req.headers as Record<string, string>),
        query,
        body,
      );

      if (method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, now: new Date().toISOString() });
        return;
      }

      if (
        method === "GET" &&
        (url.pathname === "/responses" || url.pathname === "/openai/v1/responses")
      ) {
        sendJson(res, 404, toEnvelope("not_found", "WebSocket transport is not available."));
        return;
      }

      if (
        method === "POST" &&
        (url.pathname === "/responses" || url.pathname === "/openai/v1/responses")
      ) {
        const sessionKey = resolveOpenAiSessionKey(req);
        const step = nextOpenAiScriptStep(sessionKey);
        const responsePayload = buildOpenAiScriptResponse(sessionKey, step);
        requestLogger.capture({
          id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          at: new Date().toISOString(),
          namespace,
          provider: "openai",
          method,
          path: url.pathname,
          query,
          body,
          statusCode: 200,
        });
        console.log(
          `[fake-openai] path=${url.pathname} session=${sessionKey} step=${step} request=${JSON.stringify(
            summarizeOpenAiRequestBody(body),
          )} response=${JSON.stringify(responsePayload.output)}`,
        );
        sendSseResponse(res, responsePayload);
        return;
      }

      if (method === "POST" && url.pathname === "/__reset") {
        const payload =
          body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
        const providerId = typeof payload.providerId === "string" ? payload.providerId : null;
        const ns = typeof payload.namespace === "string" ? payload.namespace : undefined;

        if (providerId) {
          const provider = providers.get(providerId);
          if (!provider) {
            sendJson(res, 404, toEnvelope("unknown_provider", `Unknown provider: ${providerId}`));
            return;
          }
          provider.fake.reset(ns);
        } else {
          for (const provider of providers.values()) {
            provider.fake.reset(ns);
          }
        }

        openAiScriptStepBySession.clear();
        requestLogger.reset(ns);
        sendJson(res, 200, { ok: true, namespace: ns ?? null, providerId: providerId ?? null });
        return;
      }

      if (method === "POST" && url.pathname === "/__seed") {
        const payload =
          body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
        const providerId = typeof payload.providerId === "string" ? payload.providerId : "";
        const provider = providers.get(providerId);
        if (!provider) {
          sendJson(res, 404, toEnvelope("unknown_provider", `Unknown provider: ${providerId}`));
          return;
        }
        const ns = typeof payload.namespace === "string" ? payload.namespace : namespace;
        const seed =
          payload.seed && typeof payload.seed === "object" && !Array.isArray(payload.seed)
            ? (payload.seed as Record<string, unknown>)
            : {};
        provider.fake.seed(ns, seed);
        sendJson(res, 200, { ok: true, providerId, namespace: ns });
        return;
      }

      if (
        method === "GET" &&
        (url.pathname === "/__provider-events" || url.pathname === "/__events")
      ) {
        const providerId = query.providerId;
        const ns = query.namespace;
        const filteredEvents = providerId
          ? providers.get(providerId)?.fake instanceof BaseProviderFake
            ? (providers.get(providerId)?.fake as BaseProviderFake).getEvents(ns)
            : []
          : registry
              .flatMap((entry) =>
                entry.fake instanceof BaseProviderFake
                  ? (entry.fake as BaseProviderFake).getEvents(ns)
                  : [],
              )
              .concat(requestLogger.list(ns));

        sendJson(res, 200, { events: filteredEvents });
        return;
      }

      if (
        method === "GET" &&
        (url.pathname === "/__sdk-calls" || url.pathname === "/__sdk-call-log")
      ) {
        const providerId = query.providerId;
        const ns = query.namespace;
        const allCalls = providerId
          ? (providers.get(providerId)?.fake.getSdkCalls?.(ns) ?? [])
          : registry.flatMap((entry) => entry.fake.getSdkCalls?.(ns) ?? []);
        const sinceRaw = Number(query.since);
        const since =
          Number.isInteger(sinceRaw) && Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0;
        const calls = since > 0 ? allCalls.slice(since) : allCalls;

        sendJson(res, 200, { calls, total: allCalls.length, since });
        return;
      }

      if (method === "GET" && url.pathname === "/__assert-no-foreign-events") {
        const targetNamespace = query.namespace ?? namespace;
        try {
          requestLogger.assertNoCrossNamespaceLeak(targetNamespace);
          sendJson(res, 200, { ok: true, namespace: targetNamespace });
        } catch (error) {
          sendJson(
            res,
            409,
            toEnvelope(
              "namespace_event_leak",
              error instanceof Error ? error.message : "Unknown namespace event leak",
            ),
          );
        }
        return;
      }

      const customToolPath = url.pathname.match(/^\/tools\/([^/]+)\/(read|write)$/);
      if (method === "POST" && customToolPath) {
        const rawToolName = customToolPath[1] ?? "";
        const mode = customToolPath[2] === "write" ? "write" : "read";
        const parsedBody = asRecord(body);
        const readInput = asRecord(parsedBody.input);
        const delayMs = Math.max(
          parseDelayMs(query.delay_ms),
          parseDelayMs(parsedBody.delay_ms),
          mode === "read" ? parseDelayMs(readInput.delay_ms) : 0,
        );
        if (delayMs > 0) {
          await sleep(delayMs);
        }
        requestLogger.capture({
          id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          at: new Date().toISOString(),
          namespace,
          provider: "custom",
          method,
          path: url.pathname,
          query,
          body,
          statusCode: 200,
        });
        sendJson(res, 200, {
          ok: true,
          tool: decodeURIComponent(rawToolName),
          mode,
          delay_ms: delayMs,
          namespace,
          echo: parsedBody,
        });
        return;
      }

      const parsed = parseProviderPath(url.pathname);
      if (!parsed) {
        sendJson(res, 404, toEnvelope("not_found", `Unknown route: ${method} ${url.pathname}`));
        return;
      }

      const provider = providers.get(parsed.providerId);
      if (!provider) {
        sendJson(
          res,
          404,
          toEnvelope("unknown_provider", `Unknown provider: ${parsed.providerId}`),
        );
        return;
      }

      const fake = provider.fake;
      const fakeWithInternals = fake as BaseProviderFake;
      const eventBase = {
        id: fakeWithInternals.nextGatewayEventId(),
        at: fakeWithInternals.gatewayNowIso(),
        namespace,
        provider: provider.canonicalProviderId,
        method,
        path: url.pathname,
        query,
        body,
      };

      const resolveAccessToken = (): string | null => {
        const auth = req.headers.authorization;
        if (!auth) {
          return null;
        }
        const normalized = auth.toLowerCase();
        if (normalized.startsWith("bearer ")) {
          return auth.slice("bearer ".length).trim() || null;
        }
        if (normalized.startsWith("token ")) {
          return auth.slice("token ".length).trim() || null;
        }
        return null;
      };

      try {
        if (
          method === "GET" &&
          (parsed.remainder === "/oauth/authorize" || parsed.remainder === "/authorize")
        ) {
          const redirectUri = query.redirect_uri;
          const state = query.state ?? "";
          if (!redirectUri) {
            sendJson(res, 400, toEnvelope("invalid_request", "Missing redirect_uri"));
            return;
          }
          const redirectUrl = fake.getAuthorizationUrl({
            namespace,
            redirectUri,
            state,
            scope: query.scope,
            returnTo: query.return_to,
          });
          requestLogger.capture({ ...eventBase, statusCode: 302 });
          fake.captureEvent({ ...eventBase, statusCode: 302 });
          sendRedirect(res, redirectUrl.toString());
          return;
        }

        if (
          method === "GET" &&
          (parsed.remainder === "/oauth/callback" || parsed.remainder === "/callback")
        ) {
          const redirectUri = query.redirect_uri;
          if (!redirectUri) {
            sendJson(res, 400, toEnvelope("invalid_request", "Missing redirect_uri"));
            return;
          }
          const code = fakeWithInternals.createAuthorizationCode({
            namespace,
            redirectUri,
            state: query.state ?? "",
            scope: query.scope,
            returnTo: query.return_to,
          });
          const to = new URL(redirectUri);
          to.searchParams.set("code", code);
          if (query.state) {
            to.searchParams.set("state", query.state);
          }
          if (query.return_to) {
            to.searchParams.set("return_to", query.return_to);
          }
          requestLogger.capture({ ...eventBase, statusCode: 302 });
          fake.captureEvent({ ...eventBase, statusCode: 302 });
          sendRedirect(res, to.toString());
          return;
        }

        if (method === "POST" && parsed.remainder === "/oauth/token") {
          const payload =
            body && typeof body === "object" && !Array.isArray(body)
              ? (body as Record<string, unknown>)
              : {};
          const grantType = String(payload.grant_type ?? "authorization_code");
          const token = fake.exchangeCodeForTokens({
            namespace,
            grantType: grantType === "refresh_token" ? "refresh_token" : "authorization_code",
            code: String(payload.code ?? ""),
            refreshToken:
              typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
            redirectUri:
              typeof payload.redirect_uri === "string" ? payload.redirect_uri : undefined,
          });
          requestLogger.capture({ ...eventBase, statusCode: 200 });
          fake.captureEvent({ ...eventBase, statusCode: 200 });
          sendJson(res, 200, token);
          return;
        }

        if (
          method === "GET" &&
          (parsed.remainder === "/v1/profile" || parsed.remainder === "/v1/users/me/profile")
        ) {
          const token = resolveAccessToken();
          fakeWithInternals.assertAccessToken(namespace, token);
          const profile = await fake.getProfile(namespace);
          requestLogger.capture({ ...eventBase, statusCode: 200 });
          fake.captureEvent({ ...eventBase, statusCode: 200 });
          sendJson(res, 200, profile);
          return;
        }

        const isGmailMessagesList =
          method === "GET" && parsed.remainder === "/v1/users/me/messages";
        const isGmailMessageRead =
          method === "GET" &&
          parsed.remainder.startsWith("/v1/users/me/messages/") &&
          parsed.remainder !== "/v1/users/me/messages/send" &&
          !parsed.remainder.includes("/attachments/");
        const isGmailMessageSend =
          method === "POST" && parsed.remainder === "/v1/users/me/messages/send";
        const isGmailMessageTrash =
          method === "POST" &&
          parsed.remainder.startsWith("/v1/users/me/messages/") &&
          parsed.remainder.endsWith("/trash");
        const isGmailMessageUntrash =
          method === "POST" &&
          parsed.remainder.startsWith("/v1/users/me/messages/") &&
          parsed.remainder.endsWith("/untrash");
        const isGmailAttachmentRead =
          method === "GET" &&
          /^\/v1\/users\/me\/messages\/[^/]+\/attachments\/[^/]+$/.test(parsed.remainder);
        const isGmailMessagesBatchModify =
          method === "POST" && parsed.remainder === "/v1/users/me/messages/batchModify";
        const isGmailThreadRead =
          method === "GET" &&
          parsed.remainder.startsWith("/v1/users/me/threads/") &&
          !parsed.remainder.endsWith("/modify");
        const isGmailThreadModify =
          method === "POST" &&
          parsed.remainder.startsWith("/v1/users/me/threads/") &&
          parsed.remainder.endsWith("/modify");
        const isGmailThreadTrash =
          method === "POST" &&
          parsed.remainder.startsWith("/v1/users/me/threads/") &&
          parsed.remainder.endsWith("/trash");
        const isGmailThreadUntrash =
          method === "POST" &&
          parsed.remainder.startsWith("/v1/users/me/threads/") &&
          parsed.remainder.endsWith("/untrash");
        const isGmailLabelsList = method === "GET" && parsed.remainder === "/v1/users/me/labels";
        const isGmailLabelRead =
          method === "GET" &&
          parsed.remainder.startsWith("/v1/users/me/labels/") &&
          parsed.remainder !== "/v1/users/me/labels";
        const isGmailLabelUpdate =
          (method === "PUT" || method === "PATCH") &&
          parsed.remainder.startsWith("/v1/users/me/labels/") &&
          parsed.remainder !== "/v1/users/me/labels";
        const isGmailLabelDelete =
          method === "DELETE" &&
          parsed.remainder.startsWith("/v1/users/me/labels/") &&
          parsed.remainder !== "/v1/users/me/labels";
        const isGmailLabelsCreate = method === "POST" && parsed.remainder === "/v1/users/me/labels";
        const isGmailDraftsList = method === "GET" && parsed.remainder === "/v1/users/me/drafts";
        const isGmailDraftRead =
          method === "GET" &&
          parsed.remainder.startsWith("/v1/users/me/drafts/") &&
          parsed.remainder !== "/v1/users/me/drafts/send";
        const isGmailDraftCreate = method === "POST" && parsed.remainder === "/v1/users/me/drafts";
        const isGmailDraftUpdate =
          (method === "PUT" || method === "PATCH") &&
          parsed.remainder.startsWith("/v1/users/me/drafts/") &&
          parsed.remainder !== "/v1/users/me/drafts/send";
        const isGmailDraftDelete =
          method === "DELETE" &&
          parsed.remainder.startsWith("/v1/users/me/drafts/") &&
          parsed.remainder !== "/v1/users/me/drafts/send";
        const isGmailDraftSend =
          method === "POST" && parsed.remainder === "/v1/users/me/drafts/send";
        const isGmailHistoryList = method === "GET" && parsed.remainder === "/v1/users/me/history";
        const isGmailFiltersList =
          method === "GET" && parsed.remainder === "/v1/users/me/settings/filters";
        const isGmailFilterRead =
          method === "GET" &&
          parsed.remainder.startsWith("/v1/users/me/settings/filters/") &&
          parsed.remainder !== "/v1/users/me/settings/filters";
        const isGmailFilterCreate =
          method === "POST" && parsed.remainder === "/v1/users/me/settings/filters";
        const isGmailFilterDelete =
          method === "DELETE" && parsed.remainder.startsWith("/v1/users/me/settings/filters/");
        const isGmailSendAsList =
          method === "GET" && parsed.remainder === "/v1/users/me/settings/sendAs";
        const isGmailSendAsRead =
          method === "GET" &&
          parsed.remainder.startsWith("/v1/users/me/settings/sendAs/") &&
          parsed.remainder !== "/v1/users/me/settings/sendAs";
        const isGmailSendAsUpdate =
          (method === "PUT" || method === "PATCH") &&
          parsed.remainder.startsWith("/v1/users/me/settings/sendAs/") &&
          parsed.remainder !== "/v1/users/me/settings/sendAs";
        const isGmailVacationGet =
          method === "GET" && parsed.remainder === "/v1/users/me/settings/vacation";
        const isGmailVacationUpdate =
          (method === "PUT" || method === "PATCH") &&
          parsed.remainder === "/v1/users/me/settings/vacation";
        const isGmailWatch = method === "POST" && parsed.remainder === "/v1/users/me/watch";
        const isGmailStop = method === "POST" && parsed.remainder === "/v1/users/me/stop";

        if (
          isGmailMessagesList ||
          isGmailMessageRead ||
          isGmailMessageSend ||
          isGmailMessageTrash ||
          isGmailMessageUntrash ||
          isGmailAttachmentRead ||
          isGmailMessagesBatchModify ||
          isGmailThreadRead ||
          isGmailThreadModify ||
          isGmailThreadTrash ||
          isGmailThreadUntrash ||
          isGmailLabelsList ||
          isGmailLabelRead ||
          isGmailLabelUpdate ||
          isGmailLabelDelete ||
          isGmailLabelsCreate ||
          isGmailDraftsList ||
          isGmailDraftRead ||
          isGmailDraftCreate ||
          isGmailDraftUpdate ||
          isGmailDraftDelete ||
          isGmailDraftSend ||
          isGmailHistoryList ||
          isGmailFiltersList ||
          isGmailFilterRead ||
          isGmailFilterCreate ||
          isGmailFilterDelete ||
          isGmailSendAsList ||
          isGmailSendAsRead ||
          isGmailSendAsUpdate ||
          isGmailVacationGet ||
          isGmailVacationUpdate ||
          isGmailWatch ||
          isGmailStop
        ) {
          const token = resolveAccessToken();
          fakeWithInternals.assertAccessToken(namespace, token);

          if (isGmailMessagesList) {
            const payload = await fake.listResources({
              namespace,
              resource: "messages",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailMessageRead) {
            const id = parsed.remainder.replace("/v1/users/me/messages/", "");
            const payload = await fake.readResource({
              namespace,
              resource: `messages/${id}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailAttachmentRead) {
            const attachmentMatch = parsed.remainder.match(
              /^\/v1\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/,
            );
            const messageId = decodeURIComponent(attachmentMatch?.[1] ?? "");
            const attachmentId = decodeURIComponent(attachmentMatch?.[2] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `messages/${messageId}/attachments/${attachmentId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailThreadRead) {
            const id = parsed.remainder.replace("/v1/users/me/threads/", "");
            const payload = await fake.readResource({
              namespace,
              resource: `threads/${id}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailLabelRead) {
            const id = parsed.remainder.replace("/v1/users/me/labels/", "");
            const payload = await fake.readResource({
              namespace,
              resource: `labels/${id}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailMessageSend) {
            const payload = await fake.writeResource({
              namespace,
              resource: "messages/send",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailMessageTrash || isGmailMessageUntrash) {
            const operation = isGmailMessageTrash ? "trash" : "untrash";
            const messageId = parsed.remainder
              .replace("/v1/users/me/messages/", "")
              .replace(`/${operation}`, "");
            const payload = await fake.writeResource({
              namespace,
              resource: `messages/${messageId}/${operation}`,
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailMessagesBatchModify) {
            const payload = await fake.writeResource({
              namespace,
              resource: "messages/batchModify",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailThreadModify) {
            const resource = parsed.remainder
              .replace("/v1/users/me/", "")
              .replace("/threads/", "threads/");
            const payload = await fake.writeResource({
              namespace,
              resource,
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailThreadTrash || isGmailThreadUntrash) {
            const operation = isGmailThreadTrash ? "trash" : "untrash";
            const threadId = parsed.remainder
              .replace("/v1/users/me/threads/", "")
              .replace(`/${operation}`, "");
            const payload = await fake.writeResource({
              namespace,
              resource: `threads/${threadId}/${operation}`,
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailLabelsList) {
            const payload = await fake.listResources({
              namespace,
              resource: "labels",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailLabelsCreate) {
            const payload = await fake.writeResource({
              namespace,
              resource: "labels",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailLabelUpdate) {
            const labelId = decodeURIComponent(
              parsed.remainder.replace("/v1/users/me/labels/", ""),
            );
            const payload = await fake.writeResource({
              namespace,
              resource: `labels/${labelId}`,
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailLabelDelete) {
            const labelId = decodeURIComponent(
              parsed.remainder.replace("/v1/users/me/labels/", ""),
            );
            const payload = await fake.writeResource({
              namespace,
              resource: `labels/${labelId}/delete`,
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailFiltersList) {
            const payload = await fake.listResources({
              namespace,
              resource: "settings/filters",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailFilterRead) {
            const filterId = decodeURIComponent(
              parsed.remainder.replace("/v1/users/me/settings/filters/", ""),
            );
            const payload = await fake.readResource({
              namespace,
              resource: `settings/filters/${filterId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailFilterCreate) {
            const payload = await fake.writeResource({
              namespace,
              resource: "settings/filters",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailFilterDelete) {
            const filterId = parsed.remainder.replace("/v1/users/me/settings/filters/", "");
            const payload = await fake.writeResource({
              namespace,
              resource: `settings/filters/${filterId}`,
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailSendAsList) {
            const payload = await fake.listResources({
              namespace,
              resource: "settings/sendAs",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailSendAsRead) {
            const sendAsEmail = decodeURIComponent(
              parsed.remainder.replace("/v1/users/me/settings/sendAs/", ""),
            );
            const payload = await fake.readResource({
              namespace,
              resource: `settings/sendAs/${sendAsEmail}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailSendAsUpdate) {
            const sendAsEmail = decodeURIComponent(
              parsed.remainder.replace("/v1/users/me/settings/sendAs/", ""),
            );
            const payload = await fake.writeResource({
              namespace,
              resource: `settings/sendAs/${sendAsEmail}`,
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailVacationGet) {
            const payload = await fake.readResource({
              namespace,
              resource: "settings/vacation",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailVacationUpdate) {
            const payload = await fake.writeResource({
              namespace,
              resource: "settings/vacation",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailDraftsList) {
            const payload = await fake.listResources({
              namespace,
              resource: "drafts",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailDraftDelete) {
            const id = parsed.remainder.replace("/v1/users/me/drafts/", "");
            const payload = await fake.writeResource({
              namespace,
              resource: `drafts/${id}/delete`,
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailDraftRead) {
            const id = parsed.remainder.replace("/v1/users/me/drafts/", "");
            const payload = await fake.readResource({
              namespace,
              resource: `drafts/${id}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailDraftCreate) {
            const payload = await fake.writeResource({
              namespace,
              resource: "drafts",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailDraftUpdate) {
            const id = parsed.remainder.replace("/v1/users/me/drafts/", "");
            const payload = await fake.writeResource({
              namespace,
              resource: `drafts/${id}`,
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailDraftSend) {
            const payload = await fake.writeResource({
              namespace,
              resource: "drafts/send",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailHistoryList) {
            const payload = await fake.listResources({
              namespace,
              resource: "history",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailWatch) {
            const payload = await fake.writeResource({
              namespace,
              resource: "watch",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (isGmailStop) {
            const payload = await fake.writeResource({
              namespace,
              resource: "stop",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }
        }

        if (parsed.providerId === "stripe") {
          const token = resolveAccessToken();
          const isStripeSecretKey =
            typeof token === "string" && token.trim().toLowerCase().startsWith("sk_");
          if (!isStripeSecretKey) {
            fakeWithInternals.assertAccessToken(namespace, token);
          }

          if (method === "GET" && parsed.remainder === "/v1/customers/search") {
            const payload = await fake.listResources({
              namespace,
              resource: "customers/search",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const customerReadMatch = parsed.remainder.match(/^\/v1\/customers\/([^/]+)$/);
          if (method === "GET" && customerReadMatch) {
            const customerId = decodeURIComponent(customerReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `customers/${customerId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && customerReadMatch) {
            const customerId = decodeURIComponent(customerReadMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "customers/update",
              body: {
                ...source,
                customer: source.customer ?? customerId,
                customerId: source.customerId ?? customerId,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const customerTaxIdsMatch = parsed.remainder.match(/^\/v1\/customers\/([^/]+)\/tax_ids$/);
          if (method === "GET" && customerTaxIdsMatch) {
            const customerId = decodeURIComponent(customerTaxIdsMatch[1] ?? "");
            const payload = await fake.listResources({
              namespace,
              resource: "customer_tax_ids",
              query: {
                ...query,
                customer: query.customer ?? customerId,
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && customerTaxIdsMatch) {
            const customerId = decodeURIComponent(customerTaxIdsMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "customer_tax_ids",
              body: {
                ...source,
                customer: source.customer ?? source.customerId ?? customerId,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const customerTaxIdDeleteMatch = parsed.remainder.match(
            /^\/v1\/customers\/([^/]+)\/tax_ids\/([^/]+)$/,
          );
          if (method === "DELETE" && customerTaxIdDeleteMatch) {
            const customerId = decodeURIComponent(customerTaxIdDeleteMatch[1] ?? "");
            const taxId = decodeURIComponent(customerTaxIdDeleteMatch[2] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "customer_tax_ids/delete",
              body: {
                ...source,
                customer: source.customer ?? source.customerId ?? customerId,
                tax_id: source.tax_id ?? source.taxId ?? taxId,
                taxId: source.taxId ?? taxId,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const customerDiscountDeleteMatch = parsed.remainder.match(
            /^\/v1\/customers\/([^/]+)\/discount$/,
          );
          if (method === "DELETE" && customerDiscountDeleteMatch) {
            const customerId = decodeURIComponent(customerDiscountDeleteMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "customers/discount/delete",
              body: {
                ...source,
                customer: source.customer ?? source.customerId ?? customerId,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/charges") {
            const payload = await fake.listResources({
              namespace,
              resource: "charges",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (
            (method === "GET" || method === "POST") &&
            parsed.remainder === "/v1/charges/search"
          ) {
            const source = asRecord(body);
            const payload = await fake.listResources({
              namespace,
              resource: "charges/search",
              query: {
                ...query,
                query: query.query ?? (typeof source.query === "string" ? source.query : ""),
                limit: query.limit ?? (typeof source.limit === "string" ? source.limit : "20"),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const chargeReadMatch = parsed.remainder.match(/^\/v1\/charges\/([^/]+)$/);
          if (method === "GET" && chargeReadMatch) {
            const chargeId = decodeURIComponent(chargeReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `charges/${chargeId}`,
              query: {
                ...query,
                customer: query.customer ?? "cus_100",
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && chargeReadMatch) {
            const chargeId = decodeURIComponent(chargeReadMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "charges/update",
              body: {
                ...source,
                charge: source.charge ?? source.chargeId ?? chargeId,
                chargeId: source.chargeId ?? chargeId,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/invoices") {
            const payload = await fake.listResources({
              namespace,
              resource: "invoices",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/invoices") {
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "invoices/create",
              body: {
                ...source,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (
            (method === "GET" || method === "POST") &&
            parsed.remainder === "/v1/invoices/search"
          ) {
            const source = asRecord(body);
            const payload = await fake.listResources({
              namespace,
              resource: "invoices/search",
              query: {
                ...query,
                query: query.query ?? (typeof source.query === "string" ? source.query : ""),
                limit: query.limit ?? (typeof source.limit === "string" ? source.limit : "20"),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const invoiceReadMatch = parsed.remainder.match(/^\/v1\/invoices\/([^/]+)$/);
          if (method === "GET" && invoiceReadMatch) {
            const invoiceId = decodeURIComponent(invoiceReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `invoices/${invoiceId}`,
              query: {
                ...query,
                customer: query.customer ?? "cus_100",
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/invoices/create_preview") {
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "invoices/preview",
              body: {
                ...source,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const invoiceWriteMatch = parsed.remainder.match(
            /^\/v1\/invoices\/([^/]+)\/(send|void|pay|finalize|mark_uncollectible)$/,
          );
          if (method === "POST" && invoiceWriteMatch) {
            const invoiceId = decodeURIComponent(invoiceWriteMatch[1] ?? "");
            const operation = String(invoiceWriteMatch[2] ?? "send");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource:
                operation === "mark_uncollectible"
                  ? "invoices/mark_uncollectible"
                  : `invoices/${operation}`,
              body: {
                ...source,
                invoice: source.invoice ?? invoiceId,
                invoiceId: source.invoiceId ?? invoiceId,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/refunds") {
            const payload = await fake.writeResource({
              namespace,
              resource: "refunds",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/refunds") {
            const payload = await fake.listResources({
              namespace,
              resource: "refunds",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const refundReadMatch = parsed.remainder.match(/^\/v1\/refunds\/([^/]+)$/);
          if (method === "GET" && refundReadMatch) {
            const refundId = decodeURIComponent(refundReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `refunds/${refundId}`,
              query: {
                ...query,
                customer: query.customer ?? "cus_100",
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const refundCancelMatch = parsed.remainder.match(/^\/v1\/refunds\/([^/]+)\/cancel$/);
          if (method === "POST" && refundCancelMatch) {
            const refundId = decodeURIComponent(refundCancelMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "refunds/cancel",
              body: {
                ...source,
                refund: source.refund ?? refundId,
                refundId: source.refundId ?? refundId,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const refundUpdateMatch = parsed.remainder.match(/^\/v1\/refunds\/([^/]+)$/);
          if (method === "POST" && refundUpdateMatch) {
            const refundId = decodeURIComponent(refundUpdateMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "refunds/update",
              body: {
                ...source,
                refund: source.refund ?? refundId,
                refundId: source.refundId ?? refundId,
                customer: source.customer ?? source.customerId ?? "cus_100",
                metadata:
                  source.metadata && typeof source.metadata === "object" ? source.metadata : {},
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/payment_methods") {
            const payload = await fake.listResources({
              namespace,
              resource: "payment_methods",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const paymentMethodDetachMatch = parsed.remainder.match(
            /^\/v1\/payment_methods\/([^/]+)\/detach$/,
          );
          if (method === "POST" && paymentMethodDetachMatch) {
            const paymentMethodId = decodeURIComponent(paymentMethodDetachMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "payment_methods/detach",
              body: {
                ...source,
                payment_method: source.payment_method ?? paymentMethodId,
                paymentMethodId: source.paymentMethodId ?? paymentMethodId,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/payment_intents") {
            const payload = await fake.listResources({
              namespace,
              resource: "payment_intents",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (
            (method === "GET" || method === "POST") &&
            parsed.remainder === "/v1/payment_intents/search"
          ) {
            const source = asRecord(body);
            const payload = await fake.listResources({
              namespace,
              resource: "payment_intents/search",
              query: {
                ...query,
                query: query.query ?? (typeof source.query === "string" ? source.query : ""),
                limit: query.limit ?? (typeof source.limit === "string" ? source.limit : "20"),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const paymentIntentReadMatch = parsed.remainder.match(/^\/v1\/payment_intents\/([^/]+)$/);
          if (method === "GET" && paymentIntentReadMatch) {
            const paymentIntentId = decodeURIComponent(paymentIntentReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `payment_intents/${paymentIntentId}`,
              query: {
                ...query,
                customer: query.customer ?? "cus_100",
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/checkout/sessions") {
            const payload = await fake.writeResource({
              namespace,
              resource: "checkout/sessions",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const checkoutSessionReadMatch = parsed.remainder.match(
            /^\/v1\/checkout\/sessions\/([^/]+)$/,
          );
          if (method === "GET" && checkoutSessionReadMatch) {
            const checkoutSessionId = decodeURIComponent(checkoutSessionReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `checkout/sessions/${checkoutSessionId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/setup_intents") {
            const payload = await fake.writeResource({
              namespace,
              resource: "setup_intents",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/events") {
            const payload = await fake.listResources({
              namespace,
              resource: "events",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const eventReadMatch = parsed.remainder.match(/^\/v1\/events\/([^/]+)$/);
          if (method === "GET" && eventReadMatch) {
            const eventId = decodeURIComponent(eventReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `events/${eventId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (
            (method === "GET" || method === "POST") &&
            parsed.remainder === "/v1/subscriptions/search"
          ) {
            const source = asRecord(body);
            const payload = await fake.listResources({
              namespace,
              resource: "subscriptions/search",
              query: {
                ...query,
                query: query.query ?? (typeof source.query === "string" ? source.query : ""),
                limit: query.limit ?? (typeof source.limit === "string" ? source.limit : "20"),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/subscriptions") {
            const source = asRecord(body);
            const sourceItems = Array.isArray(source.items) ? source.items : [];
            const firstItem =
              sourceItems.length > 0 &&
              sourceItems[0] &&
              typeof sourceItems[0] === "object" &&
              !Array.isArray(sourceItems[0])
                ? (sourceItems[0] as Record<string, unknown>)
                : {};
            const payload = await fake.writeResource({
              namespace,
              resource: "subscriptions/create",
              body: {
                ...source,
                customer: source.customer ?? source.customerId ?? "cus_100",
                priceId:
                  source.priceId ??
                  (typeof firstItem.price === "string" ? firstItem.price : undefined),
                quantity:
                  source.quantity ??
                  (typeof firstItem.quantity === "number" ? firstItem.quantity : undefined),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/subscription_items") {
            const payload = await fake.listResources({
              namespace,
              resource: "subscription_items",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/subscription_items") {
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "subscription_items",
              body: {
                ...source,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const subscriptionItemMatch = parsed.remainder.match(
            /^\/v1\/subscription_items\/([^/]+)$/,
          );
          const subscriptionItemUsageRecordsMatch = parsed.remainder.match(
            /^\/v1\/subscription_items\/([^/]+)\/usage_records$/,
          );
          if (method === "POST" && subscriptionItemUsageRecordsMatch) {
            const subscriptionItemId = decodeURIComponent(
              subscriptionItemUsageRecordsMatch[1] ?? "",
            );
            const source = asRecord(body);
            const quantity = Number(source.quantity ?? 0);
            const timestamp = Number(source.timestamp ?? Math.floor(Date.now() / 1000));
            const payload = {
              id: `mbur_${subscriptionItemId}_${Math.random().toString(16).slice(2, 10)}`,
              object: "usage_record",
              livemode: false,
              quantity: Number.isFinite(quantity) ? quantity : 0,
              subscription_item: subscriptionItemId,
              timestamp: Number.isFinite(timestamp) ? Math.floor(timestamp) : 0,
            };
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && subscriptionItemMatch) {
            const subscriptionItemId = decodeURIComponent(subscriptionItemMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "subscription_items/update",
              body: {
                ...source,
                subscription_item:
                  source.subscription_item ?? source.subscriptionItemId ?? subscriptionItemId,
                subscriptionItemId: source.subscriptionItemId ?? subscriptionItemId,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "DELETE" && subscriptionItemMatch) {
            const subscriptionItemId = decodeURIComponent(subscriptionItemMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "subscription_items/delete",
              body: {
                ...source,
                subscription_item:
                  source.subscription_item ?? source.subscriptionItemId ?? subscriptionItemId,
                subscriptionItemId: source.subscriptionItemId ?? subscriptionItemId,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/subscription_schedules") {
            const payload = await fake.listResources({
              namespace,
              resource: "subscription_schedules",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const subscriptionScheduleReadMatch = parsed.remainder.match(
            /^\/v1\/subscription_schedules\/([^/]+)$/,
          );
          if (method === "GET" && subscriptionScheduleReadMatch) {
            const subscriptionScheduleId = decodeURIComponent(
              subscriptionScheduleReadMatch[1] ?? "",
            );
            const payload = await fake.readResource({
              namespace,
              resource: `subscription_schedules/${subscriptionScheduleId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && subscriptionScheduleReadMatch) {
            const subscriptionScheduleId = decodeURIComponent(
              subscriptionScheduleReadMatch[1] ?? "",
            );
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "subscription_schedules/update",
              body: {
                ...source,
                subscription_schedule:
                  source.subscription_schedule ??
                  source.subscriptionScheduleId ??
                  subscriptionScheduleId,
                subscriptionScheduleId: source.subscriptionScheduleId ?? subscriptionScheduleId,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const subscriptionScheduleCancelMatch = parsed.remainder.match(
            /^\/v1\/subscription_schedules\/([^/]+)\/cancel$/,
          );
          if (method === "POST" && subscriptionScheduleCancelMatch) {
            const subscriptionScheduleId = decodeURIComponent(
              subscriptionScheduleCancelMatch[1] ?? "",
            );
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "subscription_schedules/cancel",
              body: {
                ...source,
                subscription_schedule:
                  source.subscription_schedule ??
                  source.subscriptionScheduleId ??
                  subscriptionScheduleId,
                subscriptionScheduleId: source.subscriptionScheduleId ?? subscriptionScheduleId,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const subscriptionMatch = parsed.remainder.match(/^\/v1\/subscriptions\/([^/]+)$/);
          if (method === "GET" && subscriptionMatch) {
            const subscriptionId = decodeURIComponent(subscriptionMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `subscriptions/${subscriptionId}`,
              query: {
                ...query,
                customer: query.customer ?? "cus_100",
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if ((method === "POST" || method === "DELETE") && subscriptionMatch) {
            const subscriptionId = decodeURIComponent(subscriptionMatch[1] ?? "");
            const source = asRecord(body);
            const sourceItems = Array.isArray(source.items) ? source.items : [];
            const firstItem =
              sourceItems.length > 0 &&
              sourceItems[0] &&
              typeof sourceItems[0] === "object" &&
              !Array.isArray(sourceItems[0])
                ? (sourceItems[0] as Record<string, unknown>)
                : {};
            const isCancelPayload =
              method === "DELETE" ||
              (typeof source.cancel_at_period_end !== "undefined" &&
                typeof source.items === "undefined" &&
                typeof source.metadata === "undefined");
            const payload = await fake.writeResource({
              namespace,
              resource: isCancelPayload ? "subscriptions/cancel" : "subscriptions/update",
              body: {
                ...source,
                subscription: source.subscription ?? subscriptionId,
                subscriptionId: source.subscriptionId ?? subscriptionId,
                priceId:
                  source.priceId ??
                  (typeof firstItem.price === "string" ? firstItem.price : undefined),
                quantity:
                  source.quantity ??
                  (typeof firstItem.quantity === "number" ? firstItem.quantity : undefined),
                cancel_at_period_end:
                  method === "DELETE"
                    ? "false"
                    : String(source.cancel_at_period_end ?? source.atPeriodEnd ?? "false"),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const subscriptionResumeMatch = parsed.remainder.match(
            /^\/v1\/subscriptions\/([^/]+)\/resume$/,
          );
          if (method === "POST" && subscriptionResumeMatch) {
            const subscriptionId = decodeURIComponent(subscriptionResumeMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "subscriptions/resume",
              body: {
                ...source,
                subscription: source.subscription ?? subscriptionId,
                subscriptionId: source.subscriptionId ?? subscriptionId,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const subscriptionDiscountDeleteMatch = parsed.remainder.match(
            /^\/v1\/subscriptions\/([^/]+)\/discount$/,
          );
          if (method === "DELETE" && subscriptionDiscountDeleteMatch) {
            const subscriptionId = decodeURIComponent(subscriptionDiscountDeleteMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "subscriptions/discount/delete",
              body: {
                ...source,
                subscription: source.subscription ?? source.subscriptionId ?? subscriptionId,
                subscriptionId: source.subscriptionId ?? subscriptionId,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/coupons") {
            const payload = await fake.listResources({
              namespace,
              resource: "coupons",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/coupons") {
            const payload = await fake.writeResource({
              namespace,
              resource: "coupons/create",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const couponReadMatch = parsed.remainder.match(/^\/v1\/coupons\/([^/]+)$/);
          if (method === "GET" && couponReadMatch) {
            const couponId = decodeURIComponent(couponReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `coupons/${couponId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/promotion_codes") {
            const payload = await fake.listResources({
              namespace,
              resource: "promotion_codes",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/promotion_codes") {
            const payload = await fake.writeResource({
              namespace,
              resource: "promotion_codes/create",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const promotionCodeReadMatch = parsed.remainder.match(/^\/v1\/promotion_codes\/([^/]+)$/);
          if (method === "GET" && promotionCodeReadMatch) {
            const promotionCodeId = decodeURIComponent(promotionCodeReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `promotion_codes/${promotionCodeId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/products") {
            const payload = await fake.listResources({
              namespace,
              resource: "products",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const productReadMatch = parsed.remainder.match(/^\/v1\/products\/([^/]+)$/);
          if (method === "GET" && productReadMatch) {
            const productId = decodeURIComponent(productReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `products/${productId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/prices") {
            const payload = await fake.listResources({
              namespace,
              resource: "prices",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const priceReadMatch = parsed.remainder.match(/^\/v1\/prices\/([^/]+)$/);
          if (method === "GET" && priceReadMatch) {
            const priceId = decodeURIComponent(priceReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `prices/${priceId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/invoiceitems") {
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "invoice_items",
              body: {
                ...source,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const invoiceItemDeleteMatch = parsed.remainder.match(/^\/v1\/invoiceitems\/([^/]+)$/);
          if (method === "DELETE" && invoiceItemDeleteMatch) {
            const invoiceItemId = decodeURIComponent(invoiceItemDeleteMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "invoice_items/delete",
              body: {
                ...source,
                invoiceItemId: source.invoiceItemId ?? source.invoice_item ?? invoiceItemId,
                invoice_item: source.invoice_item ?? invoiceItemId,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/credit_notes") {
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "credit_notes",
              body: {
                ...source,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (
            (method === "GET" || method === "POST") &&
            parsed.remainder === "/v1/credit_notes/preview"
          ) {
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "credit_notes/preview",
              body: {
                ...source,
                invoice:
                  source.invoice ??
                  source.invoiceId ??
                  query.invoice ??
                  query.invoiceId ??
                  "in_cus_100_1",
                amount: Number(source.amount ?? query.amount ?? 0),
                reason:
                  source.reason ??
                  query.reason ??
                  (typeof source.reason === "string" ? source.reason : undefined),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/credit_notes") {
            const payload = await fake.listResources({
              namespace,
              resource: "credit_notes",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const creditNoteReadMatch = parsed.remainder.match(/^\/v1\/credit_notes\/([^/]+)$/);
          if (method === "GET" && creditNoteReadMatch) {
            const creditNoteId = decodeURIComponent(creditNoteReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `credit_notes/${creditNoteId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const creditNoteVoidMatch = parsed.remainder.match(/^\/v1\/credit_notes\/([^/]+)\/void$/);
          if (method === "POST" && creditNoteVoidMatch) {
            const creditNoteId = decodeURIComponent(creditNoteVoidMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "credit_notes/void",
              body: {
                ...source,
                credit_note: source.credit_note ?? source.creditNoteId ?? creditNoteId,
                creditNoteId: source.creditNoteId ?? creditNoteId,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/disputes") {
            const payload = await fake.listResources({
              namespace,
              resource: "disputes",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const disputeReadMatch = parsed.remainder.match(/^\/v1\/disputes\/([^/]+)$/);
          if (method === "GET" && disputeReadMatch) {
            const disputeId = decodeURIComponent(disputeReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `disputes/${disputeId}`,
              query: {
                ...query,
                customer: query.customer ?? "cus_100",
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && disputeReadMatch) {
            const disputeId = decodeURIComponent(disputeReadMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "disputes/update",
              body: {
                ...source,
                dispute: source.dispute ?? disputeId,
                disputeId: source.disputeId ?? disputeId,
                customer: source.customer ?? source.customerId ?? "cus_100",
                evidenceSummary:
                  source.evidenceSummary ??
                  (typeof source.evidence === "object" && source.evidence
                    ? (source.evidence as Record<string, unknown>).uncategorized_text
                    : source.evidence),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const disputeCloseMatch = parsed.remainder.match(/^\/v1\/disputes\/([^/]+)\/close$/);
          if (method === "POST" && disputeCloseMatch) {
            const disputeId = decodeURIComponent(disputeCloseMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "disputes/close",
              body: {
                ...source,
                dispute: source.dispute ?? disputeId,
                disputeId: source.disputeId ?? disputeId,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/billing_portal/sessions") {
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "billing_portal/sessions",
              body: {
                ...source,
                customer: source.customer ?? source.customerId ?? "cus_100",
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/balance_transactions") {
            const payload = await fake.listResources({
              namespace,
              resource: "balance_transactions/global",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const globalBalanceReadMatch = parsed.remainder.match(
            /^\/v1\/balance_transactions\/([^/]+)$/,
          );
          if (method === "GET" && globalBalanceReadMatch) {
            const balanceTransactionId = decodeURIComponent(globalBalanceReadMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `balance_transactions/${balanceTransactionId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const balanceMatch = parsed.remainder.match(
            /^\/v1\/customers\/([^/]+)\/balance_transactions$/,
          );
          if (method === "GET" && balanceMatch) {
            const customerId = decodeURIComponent(balanceMatch[1] ?? "");
            const payload = await fake.listResources({
              namespace,
              resource: "balance_transactions",
              query: {
                ...query,
                customer: query.customer ?? customerId,
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && balanceMatch) {
            const customerId = decodeURIComponent(balanceMatch[1] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "customers/balance",
              body: {
                ...source,
                customer: source.customer ?? customerId,
                customerId: source.customerId ?? customerId,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }
        }

        if (parsed.providerId === "github") {
          const token = resolveAccessToken();
          fakeWithInternals.assertAccessToken(namespace, token);

          const branchesMatch = parsed.remainder.match(/^\/v1\/repos\/([^/]+)\/([^/]+)\/branches$/);
          if (method === "GET" && branchesMatch) {
            const owner = decodeURIComponent(branchesMatch[1] ?? "");
            const repo = decodeURIComponent(branchesMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const rawPayload = await fake.listResources({
              namespace,
              resource: "branches",
              query: {
                ...query,
                repo: repoKey,
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const fileContentsMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/,
          );
          if (method === "GET" && fileContentsMatch) {
            const owner = decodeURIComponent(fileContentsMatch[1] ?? "");
            const repo = decodeURIComponent(fileContentsMatch[2] ?? "");
            const path = decodeURIComponent(fileContentsMatch[3] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const payload = await fake.readResource({
              namespace,
              resource: `contents/${path}`,
              query: {
                ...query,
                repo: repoKey,
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "PUT" && fileContentsMatch) {
            const owner = decodeURIComponent(fileContentsMatch[1] ?? "");
            const repo = decodeURIComponent(fileContentsMatch[2] ?? "");
            const path = decodeURIComponent(fileContentsMatch[3] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "contents/upsert",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                path: source.path ?? path,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const repoLabelsMatch = parsed.remainder.match(/^\/v1\/repos\/([^/]+)\/([^/]+)\/labels$/);
          if (method === "GET" && repoLabelsMatch) {
            const owner = decodeURIComponent(repoLabelsMatch[1] ?? "");
            const repo = decodeURIComponent(repoLabelsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const rawPayload = await fake.listResources({
              namespace,
              resource: "labels",
              query: {
                ...query,
                repo: repoKey,
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && repoLabelsMatch) {
            const owner = decodeURIComponent(repoLabelsMatch[1] ?? "");
            const repo = decodeURIComponent(repoLabelsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "labels/create",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const issuesMatch = parsed.remainder.match(/^\/v1\/repos\/([^/]+)\/([^/]+)\/issues$/);
          if (method === "GET" && issuesMatch) {
            const owner = decodeURIComponent(issuesMatch[1] ?? "");
            const repo = decodeURIComponent(issuesMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const rawPayload = await fake.listResources({
              namespace,
              resource: "issues",
              query: {
                ...query,
                repo: repoKey,
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const issueMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([^/]+)$/,
          );
          if (method === "GET" && issueMatch) {
            const owner = decodeURIComponent(issueMatch[1] ?? "");
            const repo = decodeURIComponent(issueMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const issueNumber = Number(decodeURIComponent(issueMatch[3] ?? "0"));
            const payload = await fake.readResource({
              namespace,
              resource: `issues/${issueNumber}`,
              query: {
                ...query,
                repo: repoKey,
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const issueEventsMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/events$/,
          );
          if (method === "GET" && issueEventsMatch) {
            const owner = decodeURIComponent(issueEventsMatch[1] ?? "");
            const repo = decodeURIComponent(issueEventsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const issue = Number(decodeURIComponent(issueEventsMatch[3] ?? "0"));
            const rawPayload = await fake.listResources({
              namespace,
              resource: "issues/events",
              query: {
                ...query,
                repo: repoKey,
                issue_number: String(issue),
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const issueTimelineMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/timeline$/,
          );
          if (method === "GET" && issueTimelineMatch) {
            const owner = decodeURIComponent(issueTimelineMatch[1] ?? "");
            const repo = decodeURIComponent(issueTimelineMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const issue = Number(decodeURIComponent(issueTimelineMatch[3] ?? "0"));
            const rawPayload = await fake.listResources({
              namespace,
              resource: "issues/timeline",
              query: {
                ...query,
                repo: repoKey,
                issue_number: String(issue),
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const issueLockMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/lock$/,
          );
          if ((method === "PUT" || method === "DELETE") && issueLockMatch) {
            const owner = decodeURIComponent(issueLockMatch[1] ?? "");
            const repo = decodeURIComponent(issueLockMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const issue = Number(decodeURIComponent(issueLockMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: method === "PUT" ? "issues/lock" : "issues/unlock",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                issue: Number(source.issue ?? source.issue_number ?? issue),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && issuesMatch) {
            const owner = decodeURIComponent(issuesMatch[1] ?? "");
            const repo = decodeURIComponent(issuesMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "issues/create",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "PATCH" && issueMatch) {
            const owner = decodeURIComponent(issueMatch[1] ?? "");
            const repo = decodeURIComponent(issueMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const issueNumber = Number(decodeURIComponent(issueMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "issues/update",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                issue: Number(source.issue ?? source.issue_number ?? issueNumber),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const commentMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/comments$/,
          );
          if (method === "POST" && commentMatch) {
            const owner = decodeURIComponent(commentMatch[1] ?? "");
            const repo = decodeURIComponent(commentMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const issue = Number(decodeURIComponent(commentMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "issues/comment",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                issue: Number(source.issue ?? issue),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && commentMatch) {
            const owner = decodeURIComponent(commentMatch[1] ?? "");
            const repo = decodeURIComponent(commentMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const issue = Number(decodeURIComponent(commentMatch[3] ?? "0"));
            const rawPayload = await fake.listResources({
              namespace,
              resource: "issues/comments",
              query: {
                ...query,
                repo: repoKey,
                issue_number: String(issue),
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const issueReactionsMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/reactions$/,
          );
          if (method === "POST" && issueReactionsMatch) {
            const owner = decodeURIComponent(issueReactionsMatch[1] ?? "");
            const repo = decodeURIComponent(issueReactionsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const issue = Number(decodeURIComponent(issueReactionsMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "reactions/create",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                issue: Number(source.issue ?? source.issue_number ?? issue),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const commitsMatch = parsed.remainder.match(/^\/v1\/repos\/([^/]+)\/([^/]+)\/commits$/);
          if (method === "GET" && commitsMatch) {
            const owner = decodeURIComponent(commitsMatch[1] ?? "");
            const repo = decodeURIComponent(commitsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const rawPayload = await fake.listResources({
              namespace,
              resource: "commits",
              query: {
                ...query,
                repo: repoKey,
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const compareMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/compare\/(.+)$/,
          );
          if (method === "GET" && compareMatch) {
            const owner = decodeURIComponent(compareMatch[1] ?? "");
            const repo = decodeURIComponent(compareMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const basehead = decodeURIComponent(compareMatch[3] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `compare/${basehead}`,
              query: {
                ...query,
                repo: repoKey,
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const commitStatusMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/commits\/([^/]+)\/status$/,
          );
          if (method === "GET" && commitStatusMatch) {
            const owner = decodeURIComponent(commitStatusMatch[1] ?? "");
            const repo = decodeURIComponent(commitStatusMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const ref = decodeURIComponent(commitStatusMatch[3] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `commit-status/${ref}`,
              query: {
                ...query,
                repo: repoKey,
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const checkRunsMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/commits\/([^/]+)\/check-runs$/,
          );
          if (method === "GET" && checkRunsMatch) {
            const owner = decodeURIComponent(checkRunsMatch[1] ?? "");
            const repo = decodeURIComponent(checkRunsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const ref = decodeURIComponent(checkRunsMatch[3] ?? "");
            const payload = await fake.listResources({
              namespace,
              resource: "checks",
              query: {
                ...query,
                repo: repoKey,
                ref,
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const pullsMatch = parsed.remainder.match(/^\/v1\/repos\/([^/]+)\/([^/]+)\/pulls$/);
          if (method === "GET" && pullsMatch) {
            const owner = decodeURIComponent(pullsMatch[1] ?? "");
            const repo = decodeURIComponent(pullsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const rawPayload = await fake.listResources({
              namespace,
              resource: "pulls",
              query: {
                ...query,
                repo: repoKey,
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && pullsMatch) {
            const owner = decodeURIComponent(pullsMatch[1] ?? "");
            const repo = decodeURIComponent(pullsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "pulls/create",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const pullMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/([^/]+)$/,
          );
          if (method === "GET" && pullMatch) {
            const owner = decodeURIComponent(pullMatch[1] ?? "");
            const repo = decodeURIComponent(pullMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const pullNumber = Number(decodeURIComponent(pullMatch[3] ?? "0"));
            const payload = await fake.readResource({
              namespace,
              resource: `pulls/${pullNumber}`,
              query: {
                ...query,
                repo: repoKey,
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "PATCH" && pullMatch) {
            const owner = decodeURIComponent(pullMatch[1] ?? "");
            const repo = decodeURIComponent(pullMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const pullNumber = Number(decodeURIComponent(pullMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "pulls/update",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                pullNumber: Number(source.pullNumber ?? source.pull_number ?? pullNumber),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const updateBranchMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/update-branch$/,
          );
          if (method === "PUT" && updateBranchMatch) {
            const owner = decodeURIComponent(updateBranchMatch[1] ?? "");
            const repo = decodeURIComponent(updateBranchMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const pullNumber = Number(decodeURIComponent(updateBranchMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "pulls/update-branch",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                pullNumber: Number(source.pullNumber ?? source.pull_number ?? pullNumber),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const pullFilesMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/files$/,
          );
          if (method === "GET" && pullFilesMatch) {
            const owner = decodeURIComponent(pullFilesMatch[1] ?? "");
            const repo = decodeURIComponent(pullFilesMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const pullNumber = Number(decodeURIComponent(pullFilesMatch[3] ?? "0"));
            const rawPayload = await fake.listResources({
              namespace,
              resource: "pulls/files",
              query: {
                ...query,
                repo: repoKey,
                pull_number: String(pullNumber),
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const pullCommitsMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/commits$/,
          );
          if (method === "GET" && pullCommitsMatch) {
            const owner = decodeURIComponent(pullCommitsMatch[1] ?? "");
            const repo = decodeURIComponent(pullCommitsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const pullNumber = Number(decodeURIComponent(pullCommitsMatch[3] ?? "0"));
            const rawPayload = await fake.listResources({
              namespace,
              resource: "pulls/commits",
              query: {
                ...query,
                repo: repoKey,
                pull_number: String(pullNumber),
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const pullReviewsMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/reviews$/,
          );
          if (method === "GET" && pullReviewsMatch) {
            const owner = decodeURIComponent(pullReviewsMatch[1] ?? "");
            const repo = decodeURIComponent(pullReviewsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const pullNumber = Number(decodeURIComponent(pullReviewsMatch[3] ?? "0"));
            const rawPayload = await fake.listResources({
              namespace,
              resource: "pulls/reviews",
              query: {
                ...query,
                repo: repoKey,
                pull_number: String(pullNumber),
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && pullReviewsMatch) {
            const owner = decodeURIComponent(pullReviewsMatch[1] ?? "");
            const repo = decodeURIComponent(pullReviewsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const pullNumber = Number(decodeURIComponent(pullReviewsMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "pulls/reviews/create",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                pullNumber: Number(source.pullNumber ?? source.pull_number ?? pullNumber),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const pullReviewDismissMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/reviews\/([^/]+)\/dismissals$/,
          );
          if (method === "PUT" && pullReviewDismissMatch) {
            const owner = decodeURIComponent(pullReviewDismissMatch[1] ?? "");
            const repo = decodeURIComponent(pullReviewDismissMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const pullNumber = Number(decodeURIComponent(pullReviewDismissMatch[3] ?? "0"));
            const reviewId = Number(decodeURIComponent(pullReviewDismissMatch[4] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "pulls/reviews/dismiss",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                pullNumber: Number(source.pullNumber ?? source.pull_number ?? pullNumber),
                reviewId: Number(source.reviewId ?? source.review_id ?? reviewId),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const pullRequestedReviewersMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/requested_reviewers$/,
          );
          if (method === "POST" && pullRequestedReviewersMatch) {
            const owner = decodeURIComponent(pullRequestedReviewersMatch[1] ?? "");
            const repo = decodeURIComponent(pullRequestedReviewersMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const pullNumber = Number(decodeURIComponent(pullRequestedReviewersMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "pulls/reviewers/request",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                pullNumber: Number(source.pullNumber ?? source.pull_number ?? pullNumber),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "DELETE" && pullRequestedReviewersMatch) {
            const owner = decodeURIComponent(pullRequestedReviewersMatch[1] ?? "");
            const repo = decodeURIComponent(pullRequestedReviewersMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const pullNumber = Number(decodeURIComponent(pullRequestedReviewersMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "pulls/reviewers/remove",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                pullNumber: Number(source.pullNumber ?? source.pull_number ?? pullNumber),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const pullCommentMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/comments$/,
          );
          if (method === "POST" && pullCommentMatch) {
            const owner = decodeURIComponent(pullCommentMatch[1] ?? "");
            const repo = decodeURIComponent(pullCommentMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const pullNumber = Number(decodeURIComponent(pullCommentMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "pulls/comments/create",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                pullNumber: Number(source.pullNumber ?? source.pull_number ?? pullNumber),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const pullMergeMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/pulls\/([^/]+)\/merge$/,
          );
          if (method === "PUT" && pullMergeMatch) {
            const owner = decodeURIComponent(pullMergeMatch[1] ?? "");
            const repo = decodeURIComponent(pullMergeMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const pullNumber = Number(decodeURIComponent(pullMergeMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "pulls/merge",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                pullNumber: Number(source.pullNumber ?? source.pull_number ?? pullNumber),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const labelsMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/labels$/,
          );
          if (method === "POST" && labelsMatch) {
            const owner = decodeURIComponent(labelsMatch[1] ?? "");
            const repo = decodeURIComponent(labelsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const issue = Number(decodeURIComponent(labelsMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "issues/labels/add",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                issue: Number(source.issue ?? source.issue_number ?? issue),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const removeLabelMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/labels\/([^/]+)$/,
          );
          if (method === "DELETE" && removeLabelMatch) {
            const owner = decodeURIComponent(removeLabelMatch[1] ?? "");
            const repo = decodeURIComponent(removeLabelMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const issue = Number(decodeURIComponent(removeLabelMatch[3] ?? "0"));
            const label = decodeURIComponent(removeLabelMatch[4] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "issues/labels/remove",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                issue: Number(source.issue ?? source.issue_number ?? issue),
                label: source.label ?? label,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const assigneesMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/assignees$/,
          );
          if (method === "POST" && assigneesMatch) {
            const owner = decodeURIComponent(assigneesMatch[1] ?? "");
            const repo = decodeURIComponent(assigneesMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const issue = Number(decodeURIComponent(assigneesMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "issues/assignees/add",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                issue: Number(source.issue ?? source.issue_number ?? issue),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "DELETE" && assigneesMatch) {
            const owner = decodeURIComponent(assigneesMatch[1] ?? "");
            const repo = decodeURIComponent(assigneesMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const issue = Number(decodeURIComponent(assigneesMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "issues/assignees/remove",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                issue: Number(source.issue ?? source.issue_number ?? issue),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const issueCommentByIdMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/comments\/([^/]+)$/,
          );
          if (method === "PATCH" && issueCommentByIdMatch) {
            const owner = decodeURIComponent(issueCommentByIdMatch[1] ?? "");
            const repo = decodeURIComponent(issueCommentByIdMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const commentId = Number(decodeURIComponent(issueCommentByIdMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "issues/comments/update",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                commentId: Number(source.commentId ?? source.comment_id ?? commentId),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "DELETE" && issueCommentByIdMatch) {
            const owner = decodeURIComponent(issueCommentByIdMatch[1] ?? "");
            const repo = decodeURIComponent(issueCommentByIdMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const commentId = Number(decodeURIComponent(issueCommentByIdMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "issues/comments/delete",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                commentId: Number(source.commentId ?? source.comment_id ?? commentId),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const deleteReactionMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/issues\/([^/]+)\/reactions\/([^/]+)$/,
          );
          if (method === "DELETE" && deleteReactionMatch) {
            const owner = decodeURIComponent(deleteReactionMatch[1] ?? "");
            const repo = decodeURIComponent(deleteReactionMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const issue = Number(decodeURIComponent(deleteReactionMatch[3] ?? "0"));
            const reactionId = Number(decodeURIComponent(deleteReactionMatch[4] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "reactions/delete",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                issue: Number(source.issue ?? source.issue_number ?? issue),
                reactionId: Number(source.reactionId ?? source.reaction_id ?? reactionId),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const workflowRunsMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/actions\/runs$/,
          );
          if (method === "GET" && workflowRunsMatch) {
            const owner = decodeURIComponent(workflowRunsMatch[1] ?? "");
            const repo = decodeURIComponent(workflowRunsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const payload = await fake.listResources({
              namespace,
              resource: "actions/runs",
              query: {
                ...query,
                repo: repoKey,
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const workflowRunMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/([^/]+)$/,
          );
          if (method === "GET" && workflowRunMatch) {
            const owner = decodeURIComponent(workflowRunMatch[1] ?? "");
            const repo = decodeURIComponent(workflowRunMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const runId = Number(decodeURIComponent(workflowRunMatch[3] ?? "0"));
            const payload = await fake.readResource({
              namespace,
              resource: `actions/runs/${runId}`,
              query: {
                ...query,
                repo: repoKey,
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const workflowJobLogsMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/actions\/jobs\/([^/]+)\/logs$/,
          );
          if (method === "GET" && workflowJobLogsMatch) {
            const owner = decodeURIComponent(workflowJobLogsMatch[1] ?? "");
            const repo = decodeURIComponent(workflowJobLogsMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const jobId = Number(decodeURIComponent(workflowJobLogsMatch[3] ?? "0"));
            const payload = await fake.readResource({
              namespace,
              resource: `actions/jobs/${jobId}/logs`,
              query: {
                ...query,
                repo: repoKey,
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const workflowDispatchMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/actions\/workflows\/([^/]+)\/dispatches$/,
          );
          if (method === "POST" && workflowDispatchMatch) {
            const owner = decodeURIComponent(workflowDispatchMatch[1] ?? "");
            const repo = decodeURIComponent(workflowDispatchMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const workflowId = decodeURIComponent(workflowDispatchMatch[3] ?? "");
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "actions/workflows/dispatch",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                workflowId: source.workflowId ?? source.workflow_id ?? workflowId,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const workflowCancelMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/([^/]+)\/cancel$/,
          );
          if (method === "POST" && workflowCancelMatch) {
            const owner = decodeURIComponent(workflowCancelMatch[1] ?? "");
            const repo = decodeURIComponent(workflowCancelMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const runId = Number(decodeURIComponent(workflowCancelMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "actions/runs/cancel",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                runId: Number(source.runId ?? source.run_id ?? runId),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const workflowRerunMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/([^/]+)\/rerun$/,
          );
          if (method === "POST" && workflowRerunMatch) {
            const owner = decodeURIComponent(workflowRerunMatch[1] ?? "");
            const repo = decodeURIComponent(workflowRerunMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const runId = Number(decodeURIComponent(workflowRerunMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "actions/runs/rerun",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                runId: Number(source.runId ?? source.run_id ?? runId),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const workflowRerunFailedMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/([^/]+)\/rerun-failed-jobs$/,
          );
          if (method === "POST" && workflowRerunFailedMatch) {
            const owner = decodeURIComponent(workflowRerunFailedMatch[1] ?? "");
            const repo = decodeURIComponent(workflowRerunFailedMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const runId = Number(decodeURIComponent(workflowRerunFailedMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "actions/runs/rerun-failed",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                runId: Number(source.runId ?? source.run_id ?? runId),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const releasesMatch = parsed.remainder.match(/^\/v1\/repos\/([^/]+)\/([^/]+)\/releases$/);
          if (method === "GET" && releasesMatch) {
            const owner = decodeURIComponent(releasesMatch[1] ?? "");
            const repo = decodeURIComponent(releasesMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const rawPayload = await fake.listResources({
              namespace,
              resource: "releases",
              query: {
                ...query,
                repo: repoKey,
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && releasesMatch) {
            const owner = decodeURIComponent(releasesMatch[1] ?? "");
            const repo = decodeURIComponent(releasesMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "releases/create",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const releaseByIdMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/releases\/([^/]+)$/,
          );
          if (method === "PATCH" && releaseByIdMatch) {
            const owner = decodeURIComponent(releaseByIdMatch[1] ?? "");
            const repo = decodeURIComponent(releaseByIdMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const releaseId = Number(decodeURIComponent(releaseByIdMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "releases/update",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                releaseId: Number(source.releaseId ?? source.release_id ?? releaseId),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (
            method === "GET" &&
            parsed.remainder.match(/^\/v1\/repos\/[^/]+\/[^/]+\/releases\/latest$/)
          ) {
            const latestMatch = parsed.remainder.match(
              /^\/v1\/repos\/([^/]+)\/([^/]+)\/releases\/latest$/,
            );
            const owner = decodeURIComponent(latestMatch?.[1] ?? "");
            const repo = decodeURIComponent(latestMatch?.[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const payload = await fake.readResource({
              namespace,
              resource: "releases/latest",
              query: {
                ...query,
                repo: repoKey,
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const releaseNotesMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/releases\/generate-notes$/,
          );
          if (method === "POST" && releaseNotesMatch) {
            const owner = decodeURIComponent(releaseNotesMatch[1] ?? "");
            const repo = decodeURIComponent(releaseNotesMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "releases/notes",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const milestonesMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/milestones$/,
          );
          if (method === "GET" && milestonesMatch) {
            const owner = decodeURIComponent(milestonesMatch[1] ?? "");
            const repo = decodeURIComponent(milestonesMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const rawPayload = await fake.listResources({
              namespace,
              resource: "milestones",
              query: {
                ...query,
                repo: repoKey,
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && milestonesMatch) {
            const owner = decodeURIComponent(milestonesMatch[1] ?? "");
            const repo = decodeURIComponent(milestonesMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "milestones/create",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const milestoneByNumberMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/milestones\/([^/]+)$/,
          );
          if (method === "PATCH" && milestoneByNumberMatch) {
            const owner = decodeURIComponent(milestoneByNumberMatch[1] ?? "");
            const repo = decodeURIComponent(milestoneByNumberMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const milestoneNumber = Number(decodeURIComponent(milestoneByNumberMatch[3] ?? "0"));
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "milestones/update",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
                milestone: Number(source.milestone ?? source.milestone_number ?? milestoneNumber),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/search/issues") {
            const payload = await fake.listResources({
              namespace,
              resource: "search/issues",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const dispatchMatch = parsed.remainder.match(
            /^\/v1\/repos\/([^/]+)\/([^/]+)\/dispatches$/,
          );
          if (method === "POST" && dispatchMatch) {
            const owner = decodeURIComponent(dispatchMatch[1] ?? "");
            const repo = decodeURIComponent(dispatchMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "repos/dispatch",
              body: {
                ...source,
                repo: source.repo ?? repoKey,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/search/code") {
            const payload = await fake.listResources({
              namespace,
              resource: "search/code",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/search/repositories") {
            const payload = await fake.listResources({
              namespace,
              resource: "search/repositories",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/notifications") {
            const payload = await fake.listResources({
              namespace,
              resource: "notifications",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "PUT" && parsed.remainder === "/v1/notifications") {
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "notifications/read",
              body: {
                ...source,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const orgReposMatch = parsed.remainder.match(/^\/v1\/orgs\/([^/]+)\/repos$/);
          if (method === "GET" && orgReposMatch) {
            const org = decodeURIComponent(orgReposMatch[1] ?? "");
            const rawPayload = await fake.listResources({
              namespace,
              resource: "org/repos",
              query: {
                ...query,
                org,
              },
            });
            const payload =
              rawPayload &&
              typeof rawPayload === "object" &&
              Array.isArray((rawPayload as { items?: unknown[] }).items)
                ? (rawPayload as { items: unknown[] }).items
                : rawPayload;
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const repoMatch = parsed.remainder.match(/^\/v1\/repos\/([^/]+)\/([^/]+)$/);
          if (method === "GET" && repoMatch) {
            const owner = decodeURIComponent(repoMatch[1] ?? "");
            const repo = decodeURIComponent(repoMatch[2] ?? "");
            const repoKey = owner === repo ? owner : `${owner}/${repo}`;
            const payload = await fake.readResource({
              namespace,
              resource: `repos/${repoKey}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }
        }

        if (parsed.providerId === "slack") {
          const token = resolveAccessToken();
          fakeWithInternals.assertAccessToken(namespace, token);
          const source = asRecord(body);

          if (method === "POST" && parsed.remainder === "/v1/conversations.list") {
            const payload = await fake.listResources({
              namespace,
              resource: "channels",
              query: {
                ...query,
                ...(typeof source.limit === "string"
                  ? { limit: source.limit }
                  : typeof source.limit === "number"
                    ? { limit: String(source.limit) }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.history") {
            const payload = await fake.listResources({
              namespace,
              resource: "channels/history",
              query: {
                ...query,
                ...(typeof source.channel === "string" ? { channel: source.channel } : {}),
                ...(typeof source.limit === "string"
                  ? { limit: source.limit }
                  : typeof source.limit === "number"
                    ? { limit: String(source.limit) }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.replies") {
            const payload = await fake.listResources({
              namespace,
              resource: "threads/replies",
              query: {
                ...query,
                ...(typeof source.channel === "string" ? { channel: source.channel } : {}),
                ...(typeof source.ts === "string" ? { threadTs: source.ts } : {}),
                ...(typeof source.limit === "string"
                  ? { limit: source.limit }
                  : typeof source.limit === "number"
                    ? { limit: String(source.limit) }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/reactions.get") {
            const payload = await fake.readResource({
              namespace,
              resource: "reactions",
              query: {
                ...query,
                ...(typeof source.channel === "string" ? { channel: source.channel } : {}),
                ...(typeof source.timestamp === "string" ? { ts: source.timestamp } : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/users.list") {
            const payload = await fake.listResources({
              namespace,
              resource: "users",
              query: {
                ...query,
                ...(typeof source.limit === "string"
                  ? { limit: source.limit }
                  : typeof source.limit === "number"
                    ? { limit: String(source.limit) }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/users.info") {
            const userId = typeof source.user === "string" ? source.user : "";
            const payload = await fake.readResource({
              namespace,
              resource: `users/${userId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.info") {
            const channel = typeof source.channel === "string" ? source.channel : "";
            const payload = await fake.readResource({
              namespace,
              resource: `channels/${channel}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/search.messages") {
            const payload = await fake.listResources({
              namespace,
              resource: "search/messages",
              query: {
                ...query,
                ...(typeof source.query === "string" ? { query: source.query } : {}),
                ...(typeof source.count === "string"
                  ? { limit: source.count }
                  : typeof source.count === "number"
                    ? { limit: String(source.count) }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.members") {
            const payload = await fake.listResources({
              namespace,
              resource: "channels/members",
              query: {
                ...query,
                ...(typeof source.channel === "string" ? { channel: source.channel } : {}),
                ...(typeof source.limit === "string"
                  ? { limit: source.limit }
                  : typeof source.limit === "number"
                    ? { limit: String(source.limit) }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/chat.scheduledMessages.list") {
            const payload = await fake.listResources({
              namespace,
              resource: "scheduled/messages",
              query: {
                ...query,
                ...(typeof source.channel === "string" ? { channel: source.channel } : {}),
                ...(typeof source.limit === "string"
                  ? { limit: source.limit }
                  : typeof source.limit === "number"
                    ? { limit: String(source.limit) }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/bookmarks.list") {
            const payload = await fake.listResources({
              namespace,
              resource: "bookmarks",
              query: {
                ...query,
                ...(typeof source.channel_id === "string"
                  ? { channel_id: source.channel_id }
                  : typeof source.channel === "string"
                    ? { channel_id: source.channel }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/reminders.list") {
            const payload = await fake.listResources({
              namespace,
              resource: "reminders",
              query: {
                ...query,
                ...(typeof source.user === "string" ? { user: source.user } : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/usergroups.list") {
            const payload = await fake.listResources({
              namespace,
              resource: "usergroups",
              query: {
                ...query,
                ...(typeof source.include_disabled === "boolean"
                  ? { include_disabled: String(source.include_disabled) }
                  : typeof source.include_disabled === "string"
                    ? { include_disabled: source.include_disabled }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/usergroups.users.list") {
            const payload = await fake.listResources({
              namespace,
              resource: "usergroups/users",
              query: {
                ...query,
                ...(typeof source.usergroup === "string" ? { usergroup: source.usergroup } : {}),
                ...(typeof source.include_disabled === "boolean"
                  ? { include_disabled: String(source.include_disabled) }
                  : typeof source.include_disabled === "string"
                    ? { include_disabled: source.include_disabled }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/reactions.list") {
            const payload = await fake.listResources({
              namespace,
              resource: "reactions/list",
              query: {
                ...query,
                ...(typeof source.user === "string" ? { user: source.user } : {}),
                ...(typeof source.count === "number"
                  ? { count: String(source.count) }
                  : typeof source.count === "string"
                    ? { count: source.count }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/pins.list") {
            const payload = await fake.listResources({
              namespace,
              resource: "pins",
              query: {
                ...query,
                ...(typeof source.channel === "string" ? { channel: source.channel } : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/files.list") {
            const payload = await fake.listResources({
              namespace,
              resource: "files",
              query: {
                ...query,
                ...(typeof source.channel === "string" ? { channel: source.channel } : {}),
                ...(typeof source.user === "string" ? { user: source.user } : {}),
                ...(typeof source.count === "string"
                  ? { limit: source.count }
                  : typeof source.count === "number"
                    ? { limit: String(source.count) }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/search.files") {
            const payload = await fake.listResources({
              namespace,
              resource: "search/files",
              query: {
                ...query,
                ...(typeof source.query === "string" ? { query: source.query } : {}),
                ...(typeof source.count === "string"
                  ? { limit: source.count }
                  : typeof source.count === "number"
                    ? { limit: String(source.count) }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (
            (method === "POST" || method === "GET") &&
            parsed.remainder === "/v1/chat.getPermalink"
          ) {
            const channel =
              typeof source.channel === "string"
                ? source.channel
                : typeof query.channel === "string"
                  ? query.channel
                  : "";
            const payload = await fake.readResource({
              namespace,
              resource: `channels/${channel}/permalink`,
              query: {
                ...query,
                ...(typeof source.message_ts === "string"
                  ? { ts: source.message_ts }
                  : typeof query.message_ts === "string"
                    ? { ts: query.message_ts }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if ((method === "POST" || method === "GET") && parsed.remainder === "/v1/files.info") {
            const fileId =
              typeof source.file === "string"
                ? source.file
                : typeof query.file === "string"
                  ? query.file
                  : "";
            const payload = await fake.readResource({
              namespace,
              resource: `files/${fileId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (
            (method === "POST" || method === "GET") &&
            parsed.remainder === "/v1/users.profile.get"
          ) {
            const userId =
              typeof source.user === "string"
                ? source.user
                : typeof query.user === "string"
                  ? query.user
                  : "";
            const payload = await fake.readResource({
              namespace,
              resource: `users/${userId}/profile`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (
            (method === "POST" || method === "GET") &&
            parsed.remainder === "/v1/users.getPresence"
          ) {
            const userId =
              typeof source.user === "string"
                ? source.user
                : typeof query.user === "string"
                  ? query.user
                  : "";
            const payload = await fake.readResource({
              namespace,
              resource: `users/${userId}/presence`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/chat.postMessage") {
            const payload = await fake.writeResource({
              namespace,
              resource: "chat.postMessage",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/chat.update") {
            const payload = await fake.writeResource({
              namespace,
              resource: "chat.update",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/chat.delete") {
            const payload = await fake.writeResource({
              namespace,
              resource: "chat.delete",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.create") {
            const payload = await fake.writeResource({
              namespace,
              resource: "conversations.create",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.invite") {
            const payload = await fake.writeResource({
              namespace,
              resource: "conversations.invite",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.join") {
            const payload = await fake.writeResource({
              namespace,
              resource: "conversations.join",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.mark") {
            const payload = await fake.writeResource({
              namespace,
              resource: "conversations.mark",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.archive") {
            const payload = await fake.writeResource({
              namespace,
              resource: "conversations.archive",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.unarchive") {
            const payload = await fake.writeResource({
              namespace,
              resource: "conversations.unarchive",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.setPurpose") {
            const payload = await fake.writeResource({
              namespace,
              resource: "conversations.setPurpose",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.setTopic") {
            const payload = await fake.writeResource({
              namespace,
              resource: "conversations.setTopic",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.open") {
            const payload = await fake.writeResource({
              namespace,
              resource: "conversations.open",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.rename") {
            const payload = await fake.writeResource({
              namespace,
              resource: "conversations.rename",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.kick") {
            const payload = await fake.writeResource({
              namespace,
              resource: "conversations.kick",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.leave") {
            const payload = await fake.writeResource({
              namespace,
              resource: "conversations.leave",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/conversations.close") {
            const payload = await fake.writeResource({
              namespace,
              resource: "conversations.close",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/chat.scheduleMessage") {
            const payload = await fake.writeResource({
              namespace,
              resource: "chat.scheduleMessage",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/chat.deleteScheduledMessage") {
            const payload = await fake.writeResource({
              namespace,
              resource: "chat.deleteScheduledMessage",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/reactions.add") {
            const payload = await fake.writeResource({
              namespace,
              resource: "reactions.add",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/reactions.remove") {
            const payload = await fake.writeResource({
              namespace,
              resource: "reactions.remove",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/chat.postEphemeral") {
            const payload = await fake.writeResource({
              namespace,
              resource: "chat.postEphemeral",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/bookmarks.add") {
            const payload = await fake.writeResource({
              namespace,
              resource: "bookmarks.add",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/bookmarks.edit") {
            const payload = await fake.writeResource({
              namespace,
              resource: "bookmarks.edit",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/bookmarks.remove") {
            const payload = await fake.writeResource({
              namespace,
              resource: "bookmarks.remove",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/reminders.add") {
            const payload = await fake.writeResource({
              namespace,
              resource: "reminders.add",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/reminders.delete") {
            const payload = await fake.writeResource({
              namespace,
              resource: "reminders.delete",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/chat.meMessage") {
            const payload = await fake.writeResource({
              namespace,
              resource: "chat.meMessage",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/pins.add") {
            const payload = await fake.writeResource({
              namespace,
              resource: "pins.add",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/pins.remove") {
            const payload = await fake.writeResource({
              namespace,
              resource: "pins.remove",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (
            method === "POST" &&
            (parsed.remainder === "/v1/files.uploadV2" || parsed.remainder === "/v1/files.upload")
          ) {
            const payload = await fake.writeResource({
              namespace,
              resource: "files.uploadV2",
              body: {
                channel_id:
                  typeof source.channel_id === "string"
                    ? source.channel_id
                    : typeof source.channel === "string"
                      ? source.channel
                      : "C001",
                file_uploads: [
                  {
                    filename: typeof source.filename === "string" ? source.filename : "upload.txt",
                    content: typeof source.content === "string" ? source.content : "upload body",
                  },
                ],
                ...(typeof source.title === "string" ? { title: source.title } : {}),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/files.delete") {
            const payload = await fake.writeResource({
              namespace,
              resource: "files.delete",
              body,
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }
        }

        if (parsed.providerId === "notion") {
          const token = resolveAccessToken();
          fakeWithInternals.assertAccessToken(namespace, token);

          if (method === "POST" && parsed.remainder === "/v1/search") {
            const source = asRecord(body);
            const payload = await fake.listResources({
              namespace,
              resource: "pages",
              query: {
                ...query,
                ...(typeof source.query === "string" ? { query: source.query } : {}),
                ...(typeof source.page_size === "number"
                  ? { limit: String(source.page_size) }
                  : typeof source.page_size === "string"
                    ? { limit: source.page_size }
                    : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/pages") {
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "pages",
              body: {
                title: extractNotionTitleFromCreatePayload(source),
                content: extractNotionContentFromCreatePayload(source),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const pageMoveMatch = parsed.remainder.match(/^\/v1\/pages\/([^/]+)\/move$/);
          const pageMarkdownMatch = parsed.remainder.match(/^\/v1\/pages\/([^/]+)\/markdown$/);
          const pageMatch = parsed.remainder.match(/^\/v1\/pages\/([^/]+)$/);
          const pagePropertyMatch = parsed.remainder.match(
            /^\/v1\/pages\/([^/]+)\/properties\/([^/]+)$/,
          );
          if (method === "POST" && pageMoveMatch) {
            const source = asRecord(body);
            const pageId = decodeURIComponent(pageMoveMatch[1] ?? "");
            const parent = asRecord(source.parent);
            const parentPageId =
              typeof source.parentPageId === "string"
                ? source.parentPageId
                : typeof source.parent_page_id === "string"
                  ? source.parent_page_id
                  : typeof parent.page_id === "string"
                    ? parent.page_id
                    : "";
            const payload = await fake.writeResource({
              namespace,
              resource: "pages/move",
              body: {
                pageId,
                parentPageId,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }
          if (method === "GET" && pageMarkdownMatch) {
            const pageId = decodeURIComponent(pageMarkdownMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `pages/${pageId}/markdown`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }
          if (method === "PATCH" && pageMarkdownMatch) {
            const source = asRecord(body);
            const pageId = decodeURIComponent(pageMarkdownMatch[1] ?? "");
            const payload = await fake.writeResource({
              namespace,
              resource: "pages/markdown/update",
              body: {
                pageId,
                markdown: extractNotionMarkdownFromPayload(source),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }
          if (method === "GET" && pagePropertyMatch) {
            const pageId = decodeURIComponent(pagePropertyMatch[1] ?? "");
            const propertyId = decodeURIComponent(pagePropertyMatch[2] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `pages/${pageId}/properties/${propertyId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }
          if (method === "GET" && pageMatch) {
            const pageId = decodeURIComponent(pageMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `pages/${pageId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "PATCH" && pageMatch) {
            const source = asRecord(body);
            const pageId = decodeURIComponent(pageMatch[1] ?? "");
            const updatedTitle = extractNotionTitleFromUpdatePayload(source);
            const parentPageId = extractNotionParentPageIdFromUpdatePayload(source);
            const payload = await fake.writeResource({
              namespace,
              resource: "pages/update",
              body: {
                pageId,
                ...(updatedTitle ? { title: updatedTitle } : {}),
                ...(typeof source.archived === "boolean" ? { archived: source.archived } : {}),
                ...(parentPageId ? { parentPageId } : {}),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/databases") {
            const source = asRecord(body);
            const parentPageId = extractNotionDatabaseParentPageId(source);
            const payload = await fake.writeResource({
              namespace,
              resource: "databases",
              body: {
                title: extractNotionTitleFromCreatePayload(source),
                propertyNames: extractNotionDatabasePropertyNames(source),
                ...(parentPageId ? { parentPageId } : {}),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const databaseQueryMatch = parsed.remainder.match(/^\/v1\/databases\/([^/]+)\/query$/);
          if (method === "POST" && databaseQueryMatch) {
            const source = asRecord(body);
            const databaseId = decodeURIComponent(databaseQueryMatch[1] ?? "");
            const payload = await fake.listResources({
              namespace,
              resource: "database.query",
              query: {
                ...query,
                databaseId,
                ...(typeof source.page_size === "number"
                  ? { limit: String(source.page_size) }
                  : typeof source.page_size === "string"
                    ? { limit: source.page_size }
                    : {}),
                ...(source.filter &&
                typeof source.filter === "object" &&
                !Array.isArray(source.filter)
                  ? (() => {
                      const filter = source.filter as Record<string, unknown>;
                      const richText =
                        filter.rich_text &&
                        typeof filter.rich_text === "object" &&
                        !Array.isArray(filter.rich_text)
                          ? (filter.rich_text as Record<string, unknown>)
                          : null;
                      return typeof richText?.contains === "string"
                        ? { query: richText.contains }
                        : {};
                    })()
                  : {}),
                ...(typeof source.query === "string" ? { query: source.query } : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const databaseMatch = parsed.remainder.match(/^\/v1\/databases\/([^/]+)$/);
          if (method === "PATCH" && databaseMatch) {
            const source = asRecord(body);
            const databaseId = decodeURIComponent(databaseMatch[1] ?? "");
            const updatedTitle = extractNotionTitleFromUpdatePayload(source);
            const propertyNames = extractNotionDatabasePropertyNames(source);
            const payload = await fake.writeResource({
              namespace,
              resource: "databases/update",
              body: {
                databaseId,
                ...(updatedTitle ? { title: updatedTitle } : {}),
                ...(propertyNames.length > 0 ? { propertyNames } : {}),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }
          if (method === "GET" && databaseMatch) {
            const databaseId = decodeURIComponent(databaseMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `databases/${databaseId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const blockChildrenMatch = parsed.remainder.match(/^\/v1\/blocks\/([^/]+)\/children$/);
          const blockMatch = parsed.remainder.match(/^\/v1\/blocks\/([^/]+)$/);
          if (method === "GET" && blockMatch) {
            const blockId = decodeURIComponent(blockMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `blocks/${blockId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "PATCH" && blockMatch) {
            const source = asRecord(body);
            const blockId = decodeURIComponent(blockMatch[1] ?? "");
            const payload = await fake.writeResource({
              namespace,
              resource: "blocks/update",
              body: {
                blockId,
                content: extractNotionContentFromBlockUpdatePayload(source),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "DELETE" && blockMatch) {
            const blockId = decodeURIComponent(blockMatch[1] ?? "");
            const payload = await fake.writeResource({
              namespace,
              resource: "blocks/delete",
              body: { blockId },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }
          if (method === "GET" && blockChildrenMatch) {
            const blockId = decodeURIComponent(blockChildrenMatch[1] ?? "");
            const payload = await fake.listResources({
              namespace,
              resource: "blocks/children",
              query: {
                ...query,
                blockId,
                ...(typeof query.page_size === "string" ? { limit: query.page_size } : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "PATCH" && blockChildrenMatch) {
            const source = asRecord(body);
            const blockId = decodeURIComponent(blockChildrenMatch[1] ?? "");
            const payload = await fake.writeResource({
              namespace,
              resource: "blocks/children/append",
              body: {
                blockId,
                content: extractNotionContentFromAppendPayload(source),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/comments") {
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "comments",
              body: {
                pageId: extractNotionCommentPageIdFromPayload(source, query),
                content: extractNotionCommentFromPayload(source),
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/comments") {
            const payload = await fake.listResources({
              namespace,
              resource: "comments",
              query: {
                ...query,
                pageId: query.block_id ?? query.page_id ?? "",
                ...(typeof query.page_size === "string" ? { limit: query.page_size } : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const commentMatch = parsed.remainder.match(/^\/v1\/comments\/([^/]+)$/);
          if (method === "GET" && commentMatch) {
            const commentId = decodeURIComponent(commentMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `comments/${commentId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/users") {
            const payload = await fake.listResources({
              namespace,
              resource: "users",
              query: {
                ...query,
                ...(typeof query.page_size === "string" ? { limit: query.page_size } : {}),
              },
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          if (method === "GET" && parsed.remainder === "/v1/users/me") {
            const payload = await fake.readResource({
              namespace,
              resource: "users/me",
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }

          const userMatch = parsed.remainder.match(/^\/v1\/users\/([^/]+)$/);
          if (method === "GET" && userMatch) {
            const userId = decodeURIComponent(userMatch[1] ?? "");
            const payload = await fake.readResource({
              namespace,
              resource: `users/${userId}`,
              query,
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }
        }

        if (parsed.providerId === "reddit") {
          const token = resolveAccessToken();
          fakeWithInternals.assertAccessToken(namespace, token);

          const searchMatch = parsed.remainder.match(/^\/v1\/r\/([^/]+)\/search$/);
          if (method === "GET" && searchMatch) {
            const subreddit = decodeURIComponent(searchMatch[1] ?? "");
            const payload = await fake.listResources({
              namespace,
              resource: "posts",
              query: {
                ...query,
                subreddit,
                q: query.q ?? "",
                ...(typeof query.after === "string" ? { after: query.after } : {}),
              },
            });
            const posts = Array.isArray((payload as { posts?: unknown[] }).posts)
              ? ((payload as { posts: unknown[] }).posts as Record<string, unknown>[])
              : [];
            const nextCursor =
              typeof (payload as { next_cursor?: unknown }).next_cursor === "string"
                ? String((payload as { next_cursor?: unknown }).next_cursor)
                : null;
            const listingPayload = {
              data: {
                children: posts.map((post) => ({ kind: "t3", data: post })),
                after: nextCursor,
                before: null,
                dist: posts.length,
              },
            };
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, listingPayload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/api/submit") {
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "posts",
              body: {
                subreddit: source.sr ?? source.subreddit,
                title: source.title,
                body: source.text ?? source.body,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, payload);
            return;
          }
        }

        if (parsed.providerId === "x") {
          const token = resolveAccessToken();
          fakeWithInternals.assertAccessToken(namespace, token);

          if (method === "GET" && parsed.remainder === "/v1/2/tweets/search/recent") {
            const payload = await fake.listResources({
              namespace,
              resource: "posts",
              query: {
                ...query,
                q: query.query ?? query.q ?? "",
                ...(typeof query.max_results === "string" ? { limit: query.max_results } : {}),
                ...(typeof query.next_token === "string" ? { after: query.next_token } : {}),
              },
            });
            const posts = Array.isArray((payload as { data?: unknown[] }).data)
              ? ((payload as { data: unknown[] }).data as Record<string, unknown>[])
              : [];
            const nextCursor =
              typeof (payload as { next_cursor?: unknown }).next_cursor === "string"
                ? String((payload as { next_cursor?: unknown }).next_cursor)
                : null;
            const searchPayload = {
              data: posts,
              meta: {
                result_count: posts.length,
                ...(nextCursor ? { next_token: nextCursor } : {}),
              },
            };
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, searchPayload);
            return;
          }

          if (method === "POST" && parsed.remainder === "/v1/2/tweets") {
            const source = asRecord(body);
            const payload = await fake.writeResource({
              namespace,
              resource: "posts",
              body: {
                text: source.text ?? source.body,
              },
              headers: new Headers(req.headers as Record<string, string>),
            });
            const normalized =
              payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
            const created = asRecord((normalized as { data?: unknown }).data ?? normalized);
            requestLogger.capture({ ...eventBase, statusCode: 200 });
            fake.captureEvent({ ...eventBase, statusCode: 200 });
            sendJson(res, 200, { data: created });
            return;
          }
        }

        if (method === "GET" && parsed.remainder.startsWith("/v1/list/")) {
          const token = resolveAccessToken();
          fakeWithInternals.assertAccessToken(namespace, token);
          const payload = await fake.listResources({
            namespace,
            resource: parsed.remainder.replace("/v1/list/", ""),
            query,
          });
          requestLogger.capture({ ...eventBase, statusCode: 200 });
          fake.captureEvent({ ...eventBase, statusCode: 200 });
          sendJson(res, 200, payload);
          return;
        }

        if (method === "GET" && parsed.remainder.startsWith("/v1/read/")) {
          const token = resolveAccessToken();
          fakeWithInternals.assertAccessToken(namespace, token);
          const payload = await fake.readResource({
            namespace,
            resource: parsed.remainder.replace("/v1/read/", ""),
            query,
          });
          requestLogger.capture({ ...eventBase, statusCode: 200 });
          fake.captureEvent({ ...eventBase, statusCode: 200 });
          sendJson(res, 200, payload);
          return;
        }

        if (method === "POST" && parsed.remainder.startsWith("/v1/write/")) {
          const token = resolveAccessToken();
          fakeWithInternals.assertAccessToken(namespace, token);
          const payload = await fake.writeResource({
            namespace,
            resource: parsed.remainder.replace("/v1/write/", ""),
            body,
            headers: new Headers(req.headers as Record<string, string>),
          });
          requestLogger.capture({ ...eventBase, statusCode: 200 });
          fake.captureEvent({ ...eventBase, statusCode: 200 });
          sendJson(res, 200, payload);
          return;
        }

        sendJson(
          res,
          404,
          toEnvelope("not_found", `Unknown fake provider route: ${method} ${url.pathname}`),
        );
      } catch (error) {
        const mapped = mapErrorToStatus(error);
        requestLogger.capture({ ...eventBase, statusCode: mapped.status });
        fake.captureEvent({ ...eventBase, statusCode: mapped.status });
        sendJson(res, mapped.status, toEnvelope(mapped.code, mapped.message));
      }
    })().catch((error) => {
      sendJson(
        res,
        500,
        toEnvelope(
          "gateway_error",
          error instanceof Error ? error.message : "Unknown gateway error",
        ),
      );
    });
  });

  // Dockerized automation runners reach the host via the gateway IP, not host loopback.
  // Binding all interfaces keeps local `127.0.0.1` callers working while allowing sandbox traffic.
  server.listen(port, listenHost, () => {
    process.stdout.write(`fake-gateway listening on ${baseUrl}\n`);
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
};

void start();
