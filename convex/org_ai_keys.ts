import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { nowIso, randomIdFor, requireOrgMember, type Role } from "./_auth";
import { auditActionIdField } from "./audit_shared";
import {
  AI_KEY_CREDENTIAL_KIND,
  AI_KEY_MODE,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  USER_ROLES,
  type AuditActorType,
  type AuditEventType,
  type AiKeyCredentialKind,
  type AiKeyMode,
  type AiModelProvider,
} from "./domain_constants";
import {
  aiKeyCredentialKindValidator,
  aiKeyModeValidator,
  aiModelProviderValidator,
  requireBoundedString,
} from "./validators";
import { isBundledRuntimeEnabledForOrg } from "./ai_credits";

const ORG_AI_KEY_SCAN_BUDGET = 32;
const TEST_ONLY_DECRYPT_FLAG = "KEPPO_ENABLE_TEST_ONLY_DECRYPT";
const AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG =
  "KEPPO_FEATURE_AUTOMATION_SUBSCRIPTION_AUTH" as const;
const AUTOMATION_SUBSCRIPTION_AUTH_DEFAULT = false;

const isAutomationSubscriptionAuthEnabled = async (
  ctx: QueryCtx | MutationCtx,
): Promise<boolean> => {
  const row = await ctx.db
    .query("feature_flags")
    .withIndex("by_key", (q) => q.eq("key", AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG))
    .unique();
  return row?.enabled ?? AUTOMATION_SUBSCRIPTION_AUTH_DEFAULT;
};

const ensureAutomationSubscriptionAuthEnabled = async (
  ctx: QueryCtx | MutationCtx,
  keyMode: AiKeyMode,
): Promise<void> => {
  if (keyMode !== "subscription_token") {
    return;
  }
  if (!(await isAutomationSubscriptionAuthEnabled(ctx))) {
    throw new Error("Automation subscription auth is disabled.");
  }
};

const ensureSelfManagedAiKeysAllowed = async (
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<void> => {
  if (await isBundledRuntimeEnabledForOrg(ctx, orgId)) {
    throw new Error(
      "Hosted bundled runtime manages AI credentials automatically. Open Billing to add credits instead of saving a self-managed key.",
    );
  }
};

const orgAiKeyPublicValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  provider: aiModelProviderValidator,
  key_mode: aiKeyModeValidator,
  credential_kind: aiKeyCredentialKindValidator,
  key_hint: v.string(),
  key_version: v.number(),
  is_active: v.boolean(),
  subject_email: v.union(v.string(), v.null()),
  account_id: v.union(v.string(), v.null()),
  token_expires_at: v.union(v.string(), v.null()),
  last_refreshed_at: v.union(v.string(), v.null()),
  last_validated_at: v.union(v.string(), v.null()),
  created_by: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
});

const orgAiKeyPrivateValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  provider: aiModelProviderValidator,
  key_mode: aiKeyModeValidator,
  encrypted_key: v.string(),
  credential_kind: aiKeyCredentialKindValidator,
  key_hint: v.string(),
  key_version: v.number(),
  is_active: v.boolean(),
  subject_email: v.union(v.string(), v.null()),
  account_id: v.union(v.string(), v.null()),
  token_expires_at: v.union(v.string(), v.null()),
  last_refreshed_at: v.union(v.string(), v.null()),
  last_validated_at: v.union(v.string(), v.null()),
  created_by: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
});

const toHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const fromHex = (value: string): Uint8Array => {
  if (value.length % 2 !== 0) {
    throw new Error("InvalidHex");
  }
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    out[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
  }
  return out;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
};

const resolveEncryptionSecret = (): string => {
  const explicit = process.env.KEPPO_MASTER_KEY_INTEGRATION?.trim();
  if (explicit) {
    return explicit;
  }
  const fallback = process.env.KEPPO_MASTER_KEY?.trim();
  if (fallback) {
    return fallback;
  }
  throw new Error("Missing encryption key for org_ai_keys");
};

const isExplicitTestOnlyDecryptAllowed = (): boolean => {
  const explicitFlag = process.env[TEST_ONLY_DECRYPT_FLAG]?.trim().toLowerCase() === "true";
  const localOrTestRuntime =
    process.env.NODE_ENV === "test" ||
    process.env.KEPPO_E2E_MODE === "true" ||
    (process.env.CONVEX_DEPLOYMENT?.startsWith("local:") ?? false);
  return explicitFlag && localOrTestRuntime;
};

const deriveAesKey = async (): Promise<CryptoKey> => {
  const secret = resolveEncryptionSecret();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
};

const encryptKeyValue = async (rawKey: string): Promise<string> => {
  const key = await deriveAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(rawKey),
  );
  return `keppo-v1.${toHex(iv)}.${toHex(new Uint8Array(encrypted))}`;
};

const keyHint = (value: string): string => {
  const trimmed = value.trim();
  const lastFour = trimmed.slice(-4);
  return `...${lastFour}`;
};

const keyHintFromOauth = (params: { email?: string | null; accountId?: string | null }): string => {
  const email = params.email?.trim();
  if (email) {
    return email;
  }
  const accountId = params.accountId?.trim();
  if (accountId) {
    return `acct:${accountId.slice(0, 8)}`;
  }
  return "OpenAI OAuth";
};

const ensureSameOrgMembership = async (
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  allowedRoles: readonly Role[] = USER_ROLES,
) => {
  const auth = await requireOrgMember(ctx, allowedRoles);
  if (auth.orgId !== orgId) {
    throw new Error("Forbidden");
  }
  return auth;
};

const newestByTimestamp = <T extends { updated_at: string; created_at: string }>(
  rows: T[],
): T | null => {
  if (rows.length === 0) {
    return null;
  }
  return [...rows].sort((a, b) => {
    const aTs = a.updated_at || a.created_at;
    const bTs = b.updated_at || b.created_at;
    return bTs.localeCompare(aTs);
  })[0]!;
};

const toPublicKey = (row: {
  id: string;
  org_id: string;
  provider: AiModelProvider;
  key_mode: AiKeyMode;
  credential_kind?: AiKeyCredentialKind;
  key_hint: string;
  key_version: number;
  is_active: boolean;
  subject_email?: string | null;
  account_id?: string | null;
  token_expires_at?: string | null;
  last_refreshed_at?: string | null;
  last_validated_at?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}) => ({
  id: row.id,
  org_id: row.org_id,
  provider: row.provider,
  key_mode: row.key_mode,
  credential_kind: row.credential_kind ?? AI_KEY_CREDENTIAL_KIND.secret,
  key_hint: row.key_hint,
  key_version: row.key_version,
  is_active: row.is_active,
  subject_email: row.subject_email ?? null,
  account_id: row.account_id ?? null,
  token_expires_at: row.token_expires_at ?? null,
  last_refreshed_at: row.last_refreshed_at ?? null,
  last_validated_at: row.last_validated_at ?? null,
  created_by: row.created_by,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const toPrivateKey = (row: {
  id: string;
  org_id: string;
  provider: AiModelProvider;
  key_mode: AiKeyMode;
  encrypted_key: string;
  credential_kind?: AiKeyCredentialKind;
  key_hint: string;
  key_version: number;
  is_active: boolean;
  subject_email?: string | null;
  account_id?: string | null;
  token_expires_at?: string | null;
  last_refreshed_at?: string | null;
  last_validated_at?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}) => ({
  id: row.id,
  org_id: row.org_id,
  provider: row.provider,
  key_mode: row.key_mode,
  encrypted_key: row.encrypted_key,
  credential_kind: row.credential_kind ?? AI_KEY_CREDENTIAL_KIND.secret,
  key_hint: row.key_hint,
  key_version: row.key_version,
  is_active: row.is_active,
  subject_email: row.subject_email ?? null,
  account_id: row.account_id ?? null,
  token_expires_at: row.token_expires_at ?? null,
  last_refreshed_at: row.last_refreshed_at ?? null,
  last_validated_at: row.last_validated_at ?? null,
  created_by: row.created_by,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const orgAiKeyDeletedAuditPayload = (row: {
  id: string;
  provider: AiModelProvider;
  key_mode: AiKeyMode;
  credential_kind?: AiKeyCredentialKind;
  key_hint: string;
  key_version: number;
  is_active: boolean;
  subject_email?: string | null;
  account_id?: string | null;
  token_expires_at?: string | null;
  last_refreshed_at?: string | null;
  last_validated_at?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}) => ({
  key_id: row.id,
  provider: row.provider,
  key_mode: row.key_mode,
  credential_kind: row.credential_kind ?? AI_KEY_CREDENTIAL_KIND.secret,
  key_hint: row.key_hint,
  key_version: row.key_version,
  is_active: row.is_active,
  subject_email: row.subject_email ?? null,
  account_id: row.account_id ?? null,
  token_expires_at: row.token_expires_at ?? null,
  last_refreshed_at: row.last_refreshed_at ?? null,
  last_validated_at: row.last_validated_at ?? null,
  created_by: row.created_by,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const insertAudit = async (
  ctx: MutationCtx,
  params: {
    orgId: string;
    userId: string;
    eventType: AuditEventType;
    payload: Record<string, unknown>;
  },
) => {
  await ctx.db.insert("audit_events", {
    id: randomIdFor("audit"),
    org_id: params.orgId,
    ...auditActionIdField(params.payload),
    actor_type: AUDIT_ACTOR_TYPE.user,
    actor_id: params.userId,
    event_type: params.eventType,
    payload: params.payload,
    created_at: nowIso(),
  });
};

const upsertSecretOrgAiKeyRecord = async (
  ctx: MutationCtx,
  params: {
    orgId: string;
    provider: AiModelProvider;
    keyMode: AiKeyMode;
    rawKey: string;
    actorId: string;
    actorType: AuditActorType;
  },
) => {
  const rows = await ctx.db
    .query("org_ai_keys")
    .withIndex("by_org_provider_mode", (q) =>
      q.eq("org_id", params.orgId).eq("provider", params.provider).eq("key_mode", params.keyMode),
    )
    .take(ORG_AI_KEY_SCAN_BUDGET);

  const now = nowIso();
  const encryptedKey = await encryptKeyValue(params.rawKey);
  const hint = keyHint(params.rawKey);
  const latest = newestByTimestamp(rows);

  if (latest) {
    await ctx.db.patch(latest._id, {
      encrypted_key: encryptedKey,
      credential_kind: AI_KEY_CREDENTIAL_KIND.secret,
      key_hint: hint,
      key_version: latest.key_version + 1,
      is_active: true,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: now,
      updated_at: now,
    });

    for (const row of rows) {
      if (row._id === latest._id || !row.is_active) {
        continue;
      }
      await ctx.db.patch(row._id, {
        is_active: false,
        updated_at: now,
      });
    }

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: params.orgId,
      actor_type: params.actorType,
      actor_id: params.actorId,
      event_type: AUDIT_EVENT_TYPES.orgAiKeyUpdated,
      payload: {
        key_id: latest.id,
        provider: params.provider,
        key_mode: params.keyMode,
        key_hint: hint,
      },
      created_at: now,
    });

    const updated = await ctx.db
      .query("org_ai_keys")
      .withIndex("by_custom_id", (q) => q.eq("id", latest.id))
      .unique();
    if (!updated) {
      throw new Error("AiKeyUpdateFailed");
    }
    return toPublicKey(updated);
  }

  const id = randomIdFor("oaik");
  await ctx.db.insert("org_ai_keys", {
    id,
    org_id: params.orgId,
    provider: params.provider,
    key_mode: params.keyMode,
    encrypted_key: encryptedKey,
    credential_kind: AI_KEY_CREDENTIAL_KIND.secret,
    key_hint: hint,
    key_version: 1,
    is_active: true,
    subject_email: null,
    account_id: null,
    token_expires_at: null,
    last_refreshed_at: null,
    last_validated_at: now,
    created_by: params.actorId,
    created_at: now,
    updated_at: now,
  });

  await ctx.db.insert("audit_events", {
    id: randomIdFor("audit"),
    org_id: params.orgId,
    actor_type: params.actorType,
    actor_id: params.actorId,
    event_type: AUDIT_EVENT_TYPES.orgAiKeyCreated,
    payload: {
      key_id: id,
      provider: params.provider,
      key_mode: params.keyMode,
      key_hint: hint,
    },
    created_at: now,
  });

  const created = await ctx.db
    .query("org_ai_keys")
    .withIndex("by_custom_id", (q) => q.eq("id", id))
    .unique();
  if (!created) {
    throw new Error("AiKeyCreateFailed");
  }
  return toPublicKey(created);
};

export const listOrgAiKeys = query({
  args: {
    org_id: v.string(),
  },
  returns: v.array(orgAiKeyPublicValidator),
  handler: async (ctx, args) => {
    await ensureSameOrgMembership(ctx, args.org_id);
    const rows = await ctx.db
      .query("org_ai_keys")
      .withIndex("by_org", (q) => q.eq("org_id", args.org_id))
      .take(ORG_AI_KEY_SCAN_BUDGET);
    return rows
      .map((row) => toPublicKey(row))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },
});

export const getOrgAiKey = internalQuery({
  args: {
    org_id: v.string(),
    provider: aiModelProviderValidator,
    key_mode: aiKeyModeValidator,
  },
  returns: v.union(orgAiKeyPrivateValidator, v.null()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("org_ai_keys")
      .withIndex("by_org_provider_mode", (q) =>
        q.eq("org_id", args.org_id).eq("provider", args.provider).eq("key_mode", args.key_mode),
      )
      .take(ORG_AI_KEY_SCAN_BUDGET);
    const active = rows.filter((row) => row.is_active);
    const target = newestByTimestamp(active) ?? newestByTimestamp(rows);
    if (!target) {
      return null;
    }
    return toPrivateKey(target);
  },
});

export const upsertOrgAiKey = mutation({
  args: {
    org_id: v.string(),
    provider: aiModelProviderValidator,
    key_mode: aiKeyModeValidator,
    raw_key: v.string(),
  },
  returns: orgAiKeyPublicValidator,
  handler: async (ctx, args) => {
    const auth = await ensureSameOrgMembership(ctx, args.org_id, ["owner", "admin"]);
    if (args.key_mode === AI_KEY_MODE.bundled) {
      throw new Error("Bundled AI keys are managed automatically by billing.");
    }
    await ensureSelfManagedAiKeysAllowed(ctx, args.org_id);
    await ensureAutomationSubscriptionAuthEnabled(ctx, args.key_mode);
    const rawKey = requireBoundedString(args.raw_key, {
      field: "AI key",
      maxLength: 8_192,
    });
    if (rawKey.length < 8) {
      throw new Error("InvalidAiKey");
    }
    return await upsertSecretOrgAiKeyRecord(ctx, {
      orgId: args.org_id,
      provider: args.provider,
      keyMode: args.key_mode,
      rawKey,
      actorId: auth.userId,
      actorType: AUDIT_ACTOR_TYPE.user,
    });
  },
});

export const upsertBundledOrgAiKey = internalMutation({
  args: {
    org_id: v.string(),
    provider: aiModelProviderValidator,
    raw_key: v.string(),
    created_by: v.optional(v.string()),
  },
  returns: orgAiKeyPublicValidator,
  handler: async (ctx, args) => {
    const rawKey = requireBoundedString(args.raw_key, {
      field: "Bundled AI key",
      maxLength: 8_192,
    });
    if (rawKey.length < 8) {
      throw new Error("InvalidAiKey");
    }
    return await upsertSecretOrgAiKeyRecord(ctx, {
      orgId: args.org_id,
      provider: args.provider,
      keyMode: AI_KEY_MODE.bundled,
      rawKey,
      actorId: args.created_by?.trim() || "billing",
      actorType: AUDIT_ACTOR_TYPE.system,
    });
  },
});

export const deactivateBundledOrgAiKeys = internalMutation({
  args: {
    org_id: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("org_ai_keys")
      .withIndex("by_org_mode", (q) =>
        q.eq("org_id", args.org_id).eq("key_mode", AI_KEY_MODE.bundled),
      )
      .take(ORG_AI_KEY_SCAN_BUDGET);
    if (rows.length === 0) {
      return null;
    }
    const now = nowIso();
    let deactivatedCount = 0;
    for (const row of rows) {
      if (!row.is_active) {
        continue;
      }
      await ctx.db.patch(row._id, {
        is_active: false,
        updated_at: now,
      });
      deactivatedCount += 1;
    }
    if (deactivatedCount === 0) {
      return null;
    }
    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: args.org_id,
      actor_type: AUDIT_ACTOR_TYPE.system,
      actor_id: "billing",
      event_type: AUDIT_EVENT_TYPES.orgAiKeyDeleted,
      payload: {
        key_mode: AI_KEY_MODE.bundled,
      },
      created_at: now,
    });
    return null;
  },
});

const openAiOauthCredentialsValidator = v.object({
  access_token: v.string(),
  refresh_token: v.string(),
  expires_at: v.string(),
  scopes: v.array(v.string()),
  email: v.union(v.string(), v.null()),
  account_id: v.union(v.string(), v.null()),
  id_token: v.union(v.string(), v.null()),
  token_type: v.union(v.string(), v.null()),
  last_refresh: v.union(v.string(), v.null()),
});

export const upsertOpenAiOauthKey = internalMutation({
  args: {
    org_id: v.string(),
    user_id: v.string(),
    credentials: openAiOauthCredentialsValidator,
  },
  returns: orgAiKeyPublicValidator,
  handler: async (ctx, args) => {
    await ensureAutomationSubscriptionAuthEnabled(ctx, "subscription_token");
    await ensureSelfManagedAiKeysAllowed(ctx, args.org_id);
    const rawKey = JSON.stringify({
      version: 1,
      provider: "openai",
      kind: "oauth",
      credentials: args.credentials,
    });
    const rows = await ctx.db
      .query("org_ai_keys")
      .withIndex("by_org_provider_mode", (q) =>
        q.eq("org_id", args.org_id).eq("provider", "openai").eq("key_mode", "subscription_token"),
      )
      .take(ORG_AI_KEY_SCAN_BUDGET);

    const now = nowIso();
    const encryptedKey = await encryptKeyValue(rawKey);
    const hint = keyHintFromOauth({
      email: args.credentials.email,
      accountId: args.credentials.account_id,
    });
    const latest = newestByTimestamp(rows);

    if (latest) {
      await ctx.db.patch(latest._id, {
        encrypted_key: encryptedKey,
        credential_kind: AI_KEY_CREDENTIAL_KIND.openaiOauth,
        key_hint: hint,
        key_version: latest.key_version + 1,
        is_active: true,
        subject_email: args.credentials.email,
        account_id: args.credentials.account_id,
        token_expires_at: args.credentials.expires_at,
        last_refreshed_at: args.credentials.last_refresh ?? now,
        last_validated_at: now,
        updated_at: now,
      });

      for (const row of rows) {
        if (row._id === latest._id || !row.is_active) {
          continue;
        }
        await ctx.db.patch(row._id, {
          is_active: false,
          updated_at: now,
        });
      }

      await insertAudit(ctx, {
        orgId: args.org_id,
        userId: args.user_id,
        eventType: AUDIT_EVENT_TYPES.orgAiKeyUpdated,
        payload: {
          key_id: latest.id,
          provider: "openai",
          key_mode: "subscription_token",
          key_hint: hint,
          credential_kind: AI_KEY_CREDENTIAL_KIND.openaiOauth,
        },
      });

      const updated = await ctx.db
        .query("org_ai_keys")
        .withIndex("by_custom_id", (q) => q.eq("id", latest.id))
        .unique();
      if (!updated) {
        throw new Error("AiKeyUpdateFailed");
      }
      return toPublicKey(updated);
    }

    const id = randomIdFor("oaik");
    await ctx.db.insert("org_ai_keys", {
      id,
      org_id: args.org_id,
      provider: "openai",
      key_mode: "subscription_token",
      encrypted_key: encryptedKey,
      credential_kind: AI_KEY_CREDENTIAL_KIND.openaiOauth,
      key_hint: hint,
      key_version: 1,
      is_active: true,
      subject_email: args.credentials.email,
      account_id: args.credentials.account_id,
      token_expires_at: args.credentials.expires_at,
      last_refreshed_at: args.credentials.last_refresh ?? now,
      last_validated_at: now,
      created_by: args.user_id,
      created_at: now,
      updated_at: now,
    });

    await insertAudit(ctx, {
      orgId: args.org_id,
      userId: args.user_id,
      eventType: AUDIT_EVENT_TYPES.orgAiKeyCreated,
      payload: {
        key_id: id,
        provider: "openai",
        key_mode: "subscription_token",
        key_hint: hint,
        credential_kind: AI_KEY_CREDENTIAL_KIND.openaiOauth,
      },
    });

    const created = await ctx.db
      .query("org_ai_keys")
      .withIndex("by_custom_id", (q) => q.eq("id", id))
      .unique();
    if (!created) {
      throw new Error("AiKeyCreateFailed");
    }
    return toPublicKey(created);
  },
});

export const deleteOrgAiKey = mutation({
  args: {
    key_id: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("org_ai_keys")
      .withIndex("by_custom_id", (q) => q.eq("id", args.key_id))
      .unique();
    if (!key) {
      throw new Error("AiKeyNotFound");
    }
    if (key.key_mode === AI_KEY_MODE.bundled) {
      throw new Error("Bundled AI keys are managed automatically by billing.");
    }
    const auth = await ensureSameOrgMembership(ctx, key.org_id, ["owner", "admin"]);

    await insertAudit(ctx, {
      orgId: key.org_id,
      userId: auth.userId,
      eventType: AUDIT_EVENT_TYPES.orgAiKeyDeleted,
      payload: orgAiKeyDeletedAuditPayload(key),
    });

    await ctx.db.delete(key._id);
    return null;
  },
});

export const _decryptForTestsOnly = internalQuery({
  args: {
    encrypted_key: v.string(),
  },
  returns: v.string(),
  handler: async (_ctx, args) => {
    if (!isExplicitTestOnlyDecryptAllowed()) {
      throw new Error("Forbidden");
    }
    console.warn("org_ai_keys.test_only_decrypt_invoked", {
      explicit_flag: TEST_ONLY_DECRYPT_FLAG,
      node_env: process.env.NODE_ENV ?? null,
      convex_deployment: process.env.CONVEX_DEPLOYMENT ?? null,
      e2e_mode: process.env.KEPPO_E2E_MODE ?? null,
    });
    const parts = args.encrypted_key.split(".");
    if (parts.length !== 3 || parts[0] !== "keppo-v1") {
      throw new Error("InvalidCiphertext");
    }
    const iv = fromHex(parts[1] ?? "");
    const cipher = fromHex(parts[2] ?? "");
    const secret = resolveEncryptionSecret();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
      "decrypt",
    ]);
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(toArrayBuffer(iv)) },
      key,
      toArrayBuffer(cipher),
    );
    return new TextDecoder().decode(clear);
  },
});
