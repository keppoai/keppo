import { createServer } from "node:http";

type QueueTopic = "approved-action";

type QueueMessage = {
  messageId: string;
  topic: QueueTopic;
  attempt: number;
  maxAttempts: number;
  enqueuedAt: string;
  visibleAtMs: number;
  namespace: string | null;
  payload: Record<string, unknown>;
};

type DeadLetterMessage = QueueMessage & {
  deadLetteredAt: string;
  lastError: string;
};

type DeliveryRecord = {
  messageId: string;
  topic: QueueTopic;
  attempt: number;
  status: "acked" | "retry" | "dead_letter";
  at: string;
  namespace: string | null;
  actionId: string | null;
  detail?: string;
};

type FailureRule = {
  id: string;
  topic: QueueTopic | null;
  actionId: string | null;
  namespace: string | null;
  remaining: number;
  statusCode: number;
};

let logicalNowMs = Date.now();
let sequence = 0;

const queue: QueueMessage[] = [];
const deadLetters: DeadLetterMessage[] = [];
const deliveries: DeliveryRecord[] = [];
const failureRules: FailureRule[] = [];

const port = Number.parseInt(process.env.PORT ?? "9910", 10);
const consumerUrl = process.env.KEPPO_LOCAL_QUEUE_CONSUMER_URL ?? "";
const retryDelayMs = Number.parseInt(process.env.KEPPO_LOCAL_QUEUE_RETRY_DELAY_MS ?? "600", 10);
const consumerAuthHeader = process.env.KEPPO_LOCAL_QUEUE_CONSUMER_AUTH_HEADER ?? "";

if (!consumerUrl) {
  throw new Error("Missing KEPPO_LOCAL_QUEUE_CONSUMER_URL for local queue broker.");
}

const nowIso = (): string => new Date(logicalNowMs).toISOString();

const normalizeNamespace = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getHeaderValue = (
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string | null => {
  const value = headers[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.find((entry) => typeof entry === "string" && entry.trim().length > 0) ?? null;
  }
  return null;
};

const resolveNamespaceFromRequest = (
  req: {
    headers: Record<string, string | string[] | undefined>;
  },
  payload?: Record<string, unknown>,
): string | null => {
  const fromHeader =
    normalizeNamespace(getHeaderValue(req.headers, "x-keppo-e2e-namespace")) ??
    normalizeNamespace(getHeaderValue(req.headers, "x-e2e-namespace"));
  if (fromHeader) {
    return fromHeader;
  }
  const metadata =
    payload && typeof payload.metadata === "object" && payload.metadata !== null
      ? (payload.metadata as Record<string, unknown>)
      : null;
  return normalizeNamespace(metadata?.e2e_namespace);
};

const json = (
  res: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body: string) => void;
  },
  statusCode: number,
  payload: Record<string, unknown>,
): void => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
};

const readBody = async (req: {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
}): Promise<unknown> => {
  const chunks: Uint8Array[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    req.on("end", () => resolve());
    req.on("error", (error: Error) => reject(error));
  });
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw) as unknown;
};

const findMatchingRule = (message: QueueMessage): FailureRule | null => {
  const actionIdValue = message.payload.actionId;
  const actionId = typeof actionIdValue === "string" ? actionIdValue : null;
  const rule = failureRules.find((entry) => {
    if (entry.remaining <= 0) {
      return false;
    }
    if (entry.topic !== null && entry.topic !== message.topic) {
      return false;
    }
    if (entry.actionId !== null && entry.actionId !== actionId) {
      return false;
    }
    if (entry.namespace !== null && entry.namespace !== message.namespace) {
      return false;
    }
    return true;
  });
  return rule ?? null;
};

const applyRetry = (message: QueueMessage, errorDetail: string): void => {
  const nextAttempt = message.attempt + 1;
  const actionIdValue = message.payload.actionId;
  const actionId = typeof actionIdValue === "string" ? actionIdValue : null;

  if (nextAttempt >= message.maxAttempts) {
    const index = queue.findIndex((entry) => entry.messageId === message.messageId);
    if (index >= 0) {
      queue.splice(index, 1);
    }
    deadLetters.push({
      ...message,
      attempt: nextAttempt,
      deadLetteredAt: nowIso(),
      lastError: errorDetail,
    });
    deliveries.push({
      messageId: message.messageId,
      topic: message.topic,
      attempt: message.attempt,
      status: "dead_letter",
      at: nowIso(),
      namespace: message.namespace,
      actionId,
      detail: errorDetail,
    });
    return;
  }

  message.attempt = nextAttempt;
  message.visibleAtMs = logicalNowMs + Math.max(100, retryDelayMs * nextAttempt);
  deliveries.push({
    messageId: message.messageId,
    topic: message.topic,
    attempt: message.attempt - 1,
    status: "retry",
    at: nowIso(),
    namespace: message.namespace,
    actionId,
    detail: errorDetail,
  });
};

const drainQueue = async (): Promise<{
  attempted: number;
  acked: number;
  retried: number;
  deadLettered: number;
  pending: number;
}> => {
  const due = queue
    .filter((message) => message.visibleAtMs <= logicalNowMs)
    .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
  let attempted = 0;
  let acked = 0;
  const retriesBefore = deliveries.filter((entry) => entry.status === "retry").length;
  const deadLettersBefore = deliveries.filter((entry) => entry.status === "dead_letter").length;

  for (const message of due) {
    attempted += 1;
    const matchingRule = findMatchingRule(message);
    if (matchingRule) {
      matchingRule.remaining -= 1;
      applyRetry(message, `injected_failure_${matchingRule.statusCode}`);
      continue;
    }

    const envelope = {
      messageId: message.messageId,
      topic: message.topic,
      attempt: message.attempt,
      maxAttempts: message.maxAttempts,
      enqueuedAt: message.enqueuedAt,
      namespace: message.namespace,
      payload: message.payload,
    };

    try {
      const response = await fetch(consumerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(consumerAuthHeader ? { authorization: consumerAuthHeader } : {}),
        },
        body: JSON.stringify(envelope),
      });
      if (!response.ok) {
        const text = await response.text();
        applyRetry(message, `consumer_${response.status}:${text}`);
        continue;
      }

      const index = queue.findIndex((entry) => entry.messageId === message.messageId);
      if (index >= 0) {
        queue.splice(index, 1);
      }
      const actionIdValue = message.payload.actionId;
      const actionId = typeof actionIdValue === "string" ? actionIdValue : null;
      deliveries.push({
        messageId: message.messageId,
        topic: message.topic,
        attempt: message.attempt,
        status: "acked",
        at: nowIso(),
        namespace: message.namespace,
        actionId,
      });
      acked += 1;
    } catch (error) {
      applyRetry(message, error instanceof Error ? error.message : "consumer_request_failed");
    }
  }

  const retriesAfter = deliveries.filter((entry) => entry.status === "retry").length;
  const deadLettersAfter = deliveries.filter((entry) => entry.status === "dead_letter").length;

  return {
    attempted,
    acked,
    retried: retriesAfter - retriesBefore,
    deadLettered: deadLettersAfter - deadLettersBefore,
    pending: queue.length,
  };
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, now: nowIso() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/reset") {
    const namespace = normalizeNamespace(url.searchParams.get("namespace"));
    if (!namespace) {
      queue.splice(0, queue.length);
      deadLetters.splice(0, deadLetters.length);
      deliveries.splice(0, deliveries.length);
      failureRules.splice(0, failureRules.length);
      logicalNowMs = Date.now();
      json(res, 200, { ok: true, reset: "all", namespace: null });
      return;
    }
    const purgeByNamespace = <T extends { namespace: string | null }>(records: T[]): number => {
      let removed = 0;
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (records[index]?.namespace === namespace) {
          records.splice(index, 1);
          removed += 1;
        }
      }
      return removed;
    };
    const removedPending = purgeByNamespace(queue);
    const removedDeadLetters = purgeByNamespace(deadLetters);
    const removedDeliveries = purgeByNamespace(deliveries);
    const removedRules = purgeByNamespace(failureRules);
    json(res, 200, {
      ok: true,
      reset: "namespace",
      namespace,
      removedPending,
      removedDeadLetters,
      removedDeliveries,
      removedRules,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/enqueue") {
    try {
      const body = (await readBody(req)) as {
        topic?: unknown;
        maxAttempts?: unknown;
        payload?: unknown;
      };
      if (body.topic !== "approved-action") {
        json(res, 400, { ok: false, error: "unsupported_topic" });
        return;
      }
      if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
        json(res, 400, { ok: false, error: "invalid_payload" });
        return;
      }
      const maxAttempts =
        typeof body.maxAttempts === "number" &&
        Number.isInteger(body.maxAttempts) &&
        body.maxAttempts > 0
          ? body.maxAttempts
          : 5;

      sequence += 1;
      const messageId = `msg_${sequence.toString(36)}`;
      const payload = body.payload as Record<string, unknown>;
      const namespace = resolveNamespaceFromRequest(req, payload);
      queue.push({
        messageId,
        topic: "approved-action",
        attempt: 0,
        maxAttempts,
        enqueuedAt: nowIso(),
        visibleAtMs: logicalNowMs,
        namespace,
        payload,
      });
      json(res, 200, { ok: true, messageId, namespace });
      return;
    } catch (error) {
      json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "invalid_request",
      });
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/advance") {
    try {
      const body = (await readBody(req)) as { ms?: unknown };
      const ms =
        typeof body.ms === "number" && Number.isFinite(body.ms)
          ? Math.max(0, Math.floor(body.ms))
          : 0;
      logicalNowMs += ms;
      json(res, 200, { ok: true, now: nowIso() });
      return;
    } catch (error) {
      json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "invalid_request",
      });
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/drain") {
    const result = await drainQueue();
    json(res, 200, {
      ok: true,
      now: nowIso(),
      ...result,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/inject-failure") {
    try {
      const body = (await readBody(req)) as {
        topic?: unknown;
        actionId?: unknown;
        count?: unknown;
        statusCode?: unknown;
        namespace?: unknown;
      };
      const count =
        typeof body.count === "number" && Number.isInteger(body.count) && body.count > 0
          ? body.count
          : 1;
      const statusCode =
        typeof body.statusCode === "number" &&
        Number.isInteger(body.statusCode) &&
        body.statusCode > 0
          ? body.statusCode
          : 500;
      const topic = body.topic === "approved-action" ? ("approved-action" as const) : null;
      const actionId =
        typeof body.actionId === "string" && body.actionId.length > 0 ? body.actionId : null;
      const namespace = normalizeNamespace(body.namespace);
      const rule: FailureRule = {
        id: `rule_${randomId()}`,
        topic,
        actionId,
        namespace,
        remaining: count,
        statusCode,
      };
      failureRules.push(rule);
      json(res, 200, { ok: true, ruleId: rule.id, namespace });
      return;
    } catch (error) {
      json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "invalid_request",
      });
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/state") {
    const namespace = normalizeNamespace(url.searchParams.get("namespace"));
    const selectedQueue = namespace
      ? queue.filter((entry) => entry.namespace === namespace)
      : queue;
    const selectedDeadLetters = namespace
      ? deadLetters.filter((entry) => entry.namespace === namespace)
      : deadLetters;
    const selectedDeliveries = namespace
      ? deliveries.filter((entry) => entry.namespace === namespace)
      : deliveries;
    json(res, 200, {
      ok: true,
      now: nowIso(),
      namespace,
      pending: selectedQueue.map((message) => ({
        messageId: message.messageId,
        topic: message.topic,
        attempt: message.attempt,
        maxAttempts: message.maxAttempts,
        enqueuedAt: message.enqueuedAt,
        visibleAt: new Date(message.visibleAtMs).toISOString(),
        namespace: message.namespace,
        actionId: typeof message.payload.actionId === "string" ? message.payload.actionId : null,
      })),
      deadLetters: selectedDeadLetters.map((message) => ({
        messageId: message.messageId,
        topic: message.topic,
        attempt: message.attempt,
        maxAttempts: message.maxAttempts,
        enqueuedAt: message.enqueuedAt,
        deadLetteredAt: message.deadLetteredAt,
        namespace: message.namespace,
        actionId: typeof message.payload.actionId === "string" ? message.payload.actionId : null,
        lastError: message.lastError,
      })),
      deliveries: selectedDeliveries.slice(-200),
    });
    return;
  }

  json(res, 404, { ok: false, error: "not_found" });
});

const randomId = (): string => Math.random().toString(16).slice(2, 10);

const host = process.env.HOST?.trim() || "127.0.0.1";

server.listen(port, host, () => {
  process.stdout.write(
    `[local-queue-broker] listening on http://127.0.0.1:${port} consumer=${consumerUrl}\n`,
  );
});
