export type HealthSubsystem = {
  name: string;
  status: "up" | "down";
  critical: boolean;
  responseTimeMs: number;
  [key: string]: NonNullable<unknown> | null;
};

export type DeepHealthResponse = {
  ok: boolean;
  status: string;
  checkedAt: string;
  responseTimeMs: number;
  subsystems: HealthSubsystem[];
};

export type DeadLetterEntry = {
  id: string;
  sourceTable: string;
  sourceId: string;
  failureReason: string;
  retryCount: number;
  maxRetries: number;
  lastAttemptAt: string;
  createdAt: string;
};

export type DlqListResponse = {
  ok: boolean;
  pending: DeadLetterEntry[];
};

export type FeatureFlagEntry = {
  id: string;
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type FeatureFlagListResponse = {
  ok: boolean;
  flags: FeatureFlagEntry[];
};

export type AuditErrorEntry = {
  id: string;
  actor_type: string;
  actor_id: string;
  event_type: string;
  payload: Record<string, NonNullable<unknown>>;
  created_at: string;
};

export type AuditErrorListResponse = {
  ok: boolean;
  errors: AuditErrorEntry[];
};

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const parseDeepHealth = (payload: unknown): DeepHealthResponse => {
  if (!isRecord(payload) || !Array.isArray(payload.subsystems)) {
    throw new Error("Invalid /health/deep response");
  }

  const subsystems = payload.subsystems
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item): HealthSubsystem => {
      const status: HealthSubsystem["status"] = item.status === "down" ? "down" : "up";
      return {
        ...item,
        name: String(item.name ?? "unknown"),
        status,
        critical: Boolean(item.critical),
        responseTimeMs: Number(item.responseTimeMs ?? 0),
      };
    });

  return {
    ok: Boolean(payload.ok),
    status: String(payload.status ?? "unknown"),
    checkedAt: String(payload.checkedAt ?? ""),
    responseTimeMs: Number(payload.responseTimeMs ?? 0),
    subsystems,
  };
};

export const parseDlqList = (payload: unknown): DlqListResponse => {
  if (!isRecord(payload) || !Array.isArray(payload.pending)) {
    throw new Error("Invalid /health/dlq response");
  }

  return {
    ok: Boolean(payload.ok),
    pending: payload.pending
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry) => ({
        id: String(entry.id ?? ""),
        sourceTable: String(entry.sourceTable ?? ""),
        sourceId: String(entry.sourceId ?? ""),
        failureReason: String(entry.failureReason ?? ""),
        retryCount: Number(entry.retryCount ?? 0),
        maxRetries: Number(entry.maxRetries ?? 0),
        lastAttemptAt: String(entry.lastAttemptAt ?? ""),
        createdAt: String(entry.createdAt ?? ""),
      })),
  };
};

export const parseFeatureFlags = (payload: unknown): FeatureFlagListResponse => {
  if (!isRecord(payload) || !Array.isArray(payload.flags)) {
    throw new Error("Invalid /health/flags response");
  }

  return {
    ok: Boolean(payload.ok),
    flags: payload.flags
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry) => ({
        id: String(entry.id ?? ""),
        key: String(entry.key ?? ""),
        label: String(entry.label ?? entry.key ?? ""),
        description: String(entry.description ?? ""),
        enabled: Boolean(entry.enabled),
        created_at: String(entry.created_at ?? ""),
        updated_at: String(entry.updated_at ?? ""),
      })),
  };
};

export const parseAuditErrors = (payload: unknown): AuditErrorListResponse => {
  if (!isRecord(payload) || !Array.isArray(payload.errors)) {
    throw new Error("Invalid /health/audit-errors response");
  }

  return {
    ok: Boolean(payload.ok),
    errors: payload.errors
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry) => ({
        id: String(entry.id ?? ""),
        actor_type: String(entry.actor_type ?? ""),
        actor_id: String(entry.actor_id ?? ""),
        event_type: String(entry.event_type ?? ""),
        payload: isRecord(entry.payload)
          ? (entry.payload as Record<string, NonNullable<unknown>>)
          : {},
        created_at: String(entry.created_at ?? ""),
      })),
  };
};
