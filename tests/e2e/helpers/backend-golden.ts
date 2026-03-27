import { expect } from "@playwright/test";
import { KeppoStore } from "@keppo/shared/store";
import type { DbSchema } from "@keppo/shared/types";
import { readE2EStackRuntime } from "../infra/stack-manager";

type ScenarioName =
  | "auth_login_roundtrip"
  | "create_workspace"
  | "connect_google_oauth"
  | "cel_rule_management"
  | "pending_to_approved_execution"
  | "pending_to_rejected"
  | "tool_auto_approve_path";

const SCENARIO_TABLES: Record<ScenarioName, Array<keyof DbSchema>> = {
  auth_login_roundtrip: ["retention_policies", "workspaces", "workspace_credentials"],
  create_workspace: ["workspaces", "workspace_credentials", "audit_events"],
  connect_google_oauth: [
    "integrations",
    "integration_accounts",
    "integration_credentials",
    "audit_events",
  ],
  cel_rule_management: ["cel_rules"],
  pending_to_approved_execution: ["tool_calls", "actions", "approvals", "audit_events"],
  pending_to_rejected: ["tool_calls", "actions", "approvals", "audit_events"],
  tool_auto_approve_path: [
    "tool_auto_approvals",
    "tool_calls",
    "actions",
    "approvals",
    "audit_events",
  ],
};

const REDACTED_KEYS = new Set([
  "hashed_secret",
  "access_token_enc",
  "refresh_token_enc",
  "normalized_payload_enc",
  "blob_enc",
]);

const ID_PATTERN =
  /^(?:org|usr|workspace|cred|hcred|int|iacc|iacct|icred|run|tcall|act|appr|cel|taa|pol|pdec|audit|blob|ret|poll|nep|nev|hint|susp|authfail|credip|aflag)_[a-z0-9]+$/i;

const isIsoLike = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value);

const createIdNormalizer = () => {
  const seen = new Map<string, string>();
  const counters = new Map<string, number>();

  return (value: string): string => {
    const existing = seen.get(value);
    if (existing) {
      return existing;
    }
    const [prefix] = value.split("_");
    const bucket = prefix?.toUpperCase() ?? "ID";
    const next = (counters.get(bucket) ?? 0) + 1;
    counters.set(bucket, next);
    const placeholder = `${bucket}_${next}`;
    seen.set(value, placeholder);
    return placeholder;
  };
};

const stableSortArray = (items: unknown[]): unknown[] => {
  return [...items].sort((a, b) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  });
};

const normalizeValue = (
  value: unknown,
  key: string | null,
  normalizeId: (id: string) => string,
): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    if (key && REDACTED_KEYS.has(key)) {
      return "<redacted>";
    }
    if (key && key.endsWith("_at") && isIsoLike(value)) {
      return "<timestamp>";
    }
    if ((key === "id" || key?.endsWith("_id")) && ID_PATTERN.test(value)) {
      if (key === "id" && value.toLowerCase().startsWith("audit_")) {
        return "AUDIT_ID";
      }
      return normalizeId(value);
    }
    if (isIsoLike(value)) {
      return "<timestamp>";
    }
    return value;
  }

  if (Array.isArray(value)) {
    let normalizedItems = value.map((item) => normalizeValue(item, key, normalizeId));
    if (key === "audit_events") {
      normalizedItems = normalizedItems.filter((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return true;
        }
        return (item as { event_type?: unknown }).event_type !== "notification.sent";
      });
    }
    return stableSortArray(normalizedItems);
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const sortedKeys = Object.keys(objectValue).sort();
    const normalized: Record<string, unknown> = {};
    for (const objectKey of sortedKeys) {
      normalized[objectKey] = normalizeValue(objectValue[objectKey], objectKey, normalizeId);
    }
    return normalized;
  }

  if (typeof value === "number") {
    if (key?.endsWith("_ms")) {
      return "<duration_ms>";
    }
    return value;
  }

  return value;
};

export const expectBackendGolden = async (scenario: ScenarioName): Promise<void> => {
  const runtime = await readE2EStackRuntime();
  const store = new KeppoStore(runtime.convexUrl, process.env.KEPPO_CONVEX_ADMIN_KEY);
  const snapshot = await store.getDbSnapshot();
  const normalizeId = createIdNormalizer();

  const tables = SCENARIO_TABLES[scenario];
  const projected: Record<string, unknown> = {};
  for (const table of tables) {
    projected[table] = normalizeValue(snapshot[table], table, normalizeId);
  }

  expect(JSON.stringify(projected, null, 2)).toMatchSnapshot(`${scenario}.backend.json`);
};
