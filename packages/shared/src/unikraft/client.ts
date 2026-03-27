import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import {
  createUnikraftApiResponseSchema,
  unikraftClientConfigSchema,
  unikraftCreateInstanceParamsSchema,
  unikraftInstanceEnvelopeSchema,
  unikraftInstanceLogSchema,
  unikraftInstanceSchema,
  type UnikraftClientConfig,
  type UnikraftCreateInstanceParams,
  type UnikraftInstance,
  type UnikraftInstanceLog,
} from "./types.js";

const DEFAULT_WAIT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_WAIT_TIMEOUT_MS = 60_000;

type FetchLike = typeof fetch;
type UnikraftHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

const emptyResponseSchema = z.object({}).passthrough();
const listInstancesDataSchema = z.union([
  z.array(unikraftInstanceSchema),
  unikraftInstanceEnvelopeSchema,
]);
const instanceDataSchema = z.union([unikraftInstanceSchema, unikraftInstanceEnvelopeSchema]);
const logsDataSchema = z.union([
  z.object({ log: unikraftInstanceLogSchema }).passthrough(),
  z.object({ logs: unikraftInstanceLogSchema }).passthrough(),
  unikraftInstanceLogSchema,
]);

type ListInstancesData = z.infer<typeof listInstancesDataSchema>;

export class UnikraftCloudClientError extends Error {
  readonly status: number;
  readonly responseBody: string | null;

  constructor(message: string, options: { status: number; responseBody?: string | null }) {
    super(message);
    this.name = "UnikraftCloudClientError";
    this.status = options.status;
    this.responseBody = options.responseBody ?? null;
  }
}

const decodeJson = <TSchema extends z.ZodTypeAny>(
  raw: string,
  schema: TSchema,
  message: string,
): z.infer<TSchema> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(message);
  }
  return schema.parse(parsed);
};

const normalizeMetroHost = (metro: string): string => {
  const normalized = metro.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error("Unikraft metro must be a non-empty string.");
  }
  return normalized;
};

const toBaseUrl = (metro: string): string => {
  return `https://api.${normalizeMetroHost(metro)}.unikraft.cloud`;
};

const extractInstance = (data: unknown): UnikraftInstance => {
  const directInstance = unikraftInstanceSchema.safeParse(data);
  if (directInstance.success) {
    return directInstance.data;
  }
  const envelope = unikraftInstanceEnvelopeSchema.parse(data);
  const direct = envelope.instance;
  if (direct) {
    return direct;
  }
  const first = envelope.instances?.[0];
  if (!first) {
    throw new Error("Unikraft API response did not include an instance record.");
  }
  return first;
};

const extractInstances = (data: ListInstancesData): UnikraftInstance[] => {
  if (Array.isArray(data)) {
    return data;
  }
  if (data.instances) {
    return data.instances;
  }
  return data.instance ? [data.instance] : [];
};

const extractLogs = (data: unknown): UnikraftInstanceLog => {
  const envelope = logsDataSchema.parse(data);
  if ("log" in envelope) {
    return unikraftInstanceLogSchema.parse(envelope.log);
  }
  if ("logs" in envelope) {
    return unikraftInstanceLogSchema.parse(envelope.logs);
  }
  return unikraftInstanceLogSchema.parse(data);
};

export class UnikraftCloudClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchFn: FetchLike;

  constructor(config: UnikraftClientConfig, fetchFn: FetchLike = fetch) {
    const normalizedConfig = unikraftClientConfigSchema.parse(config);
    this.baseUrl = toBaseUrl(normalizedConfig.metro);
    this.token = normalizedConfig.token;
    this.fetchFn = fetchFn;
  }

  async listInstances(): Promise<UnikraftInstance[]> {
    const response = await this.request("/v1/instances", {
      method: "GET",
      responseSchema: createUnikraftApiResponseSchema(listInstancesDataSchema),
      errorContext: "Failed to list Unikraft instances.",
    });
    return extractInstances(response.data);
  }

  async createInstance(params: UnikraftCreateInstanceParams): Promise<UnikraftInstance> {
    const body = unikraftCreateInstanceParamsSchema.parse(params);
    const response = await this.request("/v1/instances", {
      method: "POST",
      body,
      responseSchema: createUnikraftApiResponseSchema(instanceDataSchema),
      errorContext: "Failed to create Unikraft instance.",
    });
    return extractInstance(response.data);
  }

  async getInstance(uuid: string): Promise<UnikraftInstance> {
    const response = await this.request(`/v1/instances/${encodeURIComponent(uuid)}`, {
      method: "GET",
      responseSchema: createUnikraftApiResponseSchema(instanceDataSchema),
      errorContext: `Failed to fetch Unikraft instance ${uuid}.`,
    });
    return extractInstance(response.data);
  }

  async startInstance(uuid: string): Promise<UnikraftInstance> {
    const response = await this.request(`/v1/instances/${encodeURIComponent(uuid)}/start`, {
      method: "PUT",
      responseSchema: createUnikraftApiResponseSchema(instanceDataSchema),
      errorContext: `Failed to start Unikraft instance ${uuid}.`,
    });
    return extractInstance(response.data);
  }

  async stopInstance(
    uuid: string,
    options: { drainTimeoutMs?: number } = {},
  ): Promise<UnikraftInstance> {
    const search = new URLSearchParams();
    if (typeof options.drainTimeoutMs === "number" && options.drainTimeoutMs > 0) {
      search.set("drain_timeout_ms", String(Math.ceil(options.drainTimeoutMs)));
    }
    const response = await this.request(
      `/v1/instances/${encodeURIComponent(uuid)}/stop${search.size > 0 ? `?${search}` : ""}`,
      {
        method: "PUT",
        responseSchema: createUnikraftApiResponseSchema(instanceDataSchema),
        errorContext: `Failed to stop Unikraft instance ${uuid}.`,
      },
    );
    return extractInstance(response.data);
  }

  async deleteInstance(uuid: string): Promise<void> {
    await this.request(`/v1/instances/${encodeURIComponent(uuid)}`, {
      method: "DELETE",
      responseSchema: createUnikraftApiResponseSchema(emptyResponseSchema),
      errorContext: `Failed to delete Unikraft instance ${uuid}.`,
    });
  }

  async getInstanceLogs(
    uuid: string,
    options: { offset?: number; limit?: number } = {},
  ): Promise<UnikraftInstanceLog> {
    const search = new URLSearchParams();
    if (typeof options.offset === "number") {
      search.set("offset", String(options.offset));
    }
    if (typeof options.limit === "number") {
      search.set("limit", String(options.limit));
    }
    const response = await this.request(
      `/v1/instances/${encodeURIComponent(uuid)}/log${search.size > 0 ? `?${search}` : ""}`,
      {
        method: "GET",
        responseSchema: createUnikraftApiResponseSchema(logsDataSchema),
        errorContext: `Failed to fetch Unikraft logs for ${uuid}.`,
      },
    );
    return extractLogs(response.data);
  }

  async waitInstance(
    uuid: string,
    targetState: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<UnikraftInstance> {
    const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
    const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? DEFAULT_WAIT_POLL_INTERVAL_MS);
    const startedAt = Date.now();
    const expectedState = targetState.trim().toLowerCase();

    while (Date.now() - startedAt < timeoutMs) {
      const instance = await this.getInstance(uuid);
      const currentState = instance.state?.trim().toLowerCase();
      if (currentState === expectedState) {
        return instance;
      }
      await sleep(pollIntervalMs);
    }

    throw new Error(`Timed out waiting for Unikraft instance ${uuid} to reach ${targetState}.`);
  }

  private async request<TSchema extends z.ZodTypeAny>(
    pathname: string,
    options: {
      method: UnikraftHttpMethod;
      responseSchema: TSchema;
      errorContext: string;
      body?: unknown;
    },
  ): Promise<z.infer<TSchema>> {
    const response = await this.fetchFn(`${this.baseUrl}${pathname}`, {
      method: options.method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

    const rawBody = await response.text();
    if (!response.ok) {
      const detail = rawBody.trim();
      throw new UnikraftCloudClientError(
        detail.length > 0 ? `${options.errorContext} ${detail}` : options.errorContext,
        {
          status: response.status,
          responseBody: detail,
        },
      );
    }

    return decodeJson(rawBody, options.responseSchema, options.errorContext);
  }
}
