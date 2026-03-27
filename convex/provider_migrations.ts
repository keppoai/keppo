import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { canonicalizeProvider, canonicalizeStoredProvider, type ProviderId } from "./provider_ids";
import { providerValidator } from "./validators";

type ProviderBackfillTable = "integrations" | "workspace_integrations" | "audit_events";
type ProviderBackfillField = "provider" | "integration_provider";
type ProviderBackfillProviderTable = "integrations" | "workspace_integrations";
type DbContext = QueryCtx | MutationCtx;

type ProviderBackfillChange = {
  table: ProviderBackfillTable;
  document_id: string;
  field: ProviderBackfillField;
  before: string;
  after: ProviderId;
};

type ProviderBackfillInvalidEntry = {
  table: ProviderBackfillTable;
  document_id: string;
  field: ProviderBackfillField;
  value: string;
  reason: string;
};

type ProviderBackfillScanResult = {
  all_changes: Array<ProviderBackfillChange>;
  all_invalid_entries: Array<ProviderBackfillInvalidEntry>;
  changes: Array<ProviderBackfillChange>;
  invalid_entries: Array<ProviderBackfillInvalidEntry>;
  total_changes: number;
  total_invalid_entries: number;
  changes_by_table: Record<ProviderBackfillTable, number>;
  invalid_by_table: Record<ProviderBackfillTable, number>;
};

const providerBackfillTableValidator = v.union(
  v.literal("integrations"),
  v.literal("workspace_integrations"),
  v.literal("audit_events"),
);

const providerBackfillFieldValidator = v.union(
  v.literal("provider"),
  v.literal("integration_provider"),
);

const providerBackfillChangeValidator = v.object({
  table: providerBackfillTableValidator,
  document_id: v.string(),
  field: providerBackfillFieldValidator,
  before: v.string(),
  after: providerValidator,
});

const providerBackfillInvalidEntryValidator = v.object({
  table: providerBackfillTableValidator,
  document_id: v.string(),
  field: providerBackfillFieldValidator,
  value: v.string(),
  reason: v.string(),
});

const providerBackfillSummaryValidator = v.object({
  total_changes: v.number(),
  total_invalid_entries: v.number(),
  changes_by_table: v.object({
    integrations: v.number(),
    workspace_integrations: v.number(),
    audit_events: v.number(),
  }),
  invalid_by_table: v.object({
    integrations: v.number(),
    workspace_integrations: v.number(),
    audit_events: v.number(),
  }),
  sample_changes: v.array(providerBackfillChangeValidator),
  sample_invalid_entries: v.array(providerBackfillInvalidEntryValidator),
});

const applyBackfillResultValidator = v.object({
  dry_run: v.boolean(),
  blocked_by_invalid_entries: v.boolean(),
  total_changes: v.number(),
  total_invalid_entries: v.number(),
  applied_changes: v.number(),
  changes_by_table: v.object({
    integrations: v.number(),
    workspace_integrations: v.number(),
    audit_events: v.number(),
  }),
  invalid_by_table: v.object({
    integrations: v.number(),
    workspace_integrations: v.number(),
    audit_events: v.number(),
  }),
  sample_changes: v.array(providerBackfillChangeValidator),
  sample_invalid_entries: v.array(providerBackfillInvalidEntryValidator),
});

const rollbackResultValidator = v.object({
  rolled_back: v.number(),
  skipped_missing_documents: v.number(),
});

const providerBackfillChangesExportValidator = v.object({
  changes: v.array(providerBackfillChangeValidator),
  invalid_entries: v.array(providerBackfillInvalidEntryValidator),
});

const defaultSampleLimit = 100;
const SCAN_PAGE_SIZE = 200;
const SCAN_WARNING_THRESHOLD = 1_000;

const normalizeSampleLimit = (value: number | undefined): number => {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return defaultSampleLimit;
  }
  return Math.max(1, Math.min(500, Math.floor(value!)));
};

const resolveStoredProviderValue = (
  value: string,
): { status: "canonical" | "alias" | "invalid"; canonical: ProviderId | null } => {
  try {
    return {
      status: "canonical",
      canonical: canonicalizeProvider(value),
    };
  } catch {
    const canonical = canonicalizeStoredProvider(value);
    if (!canonical) {
      return {
        status: "invalid",
        canonical: null,
      };
    }
    return {
      status: "alias",
      canonical,
    };
  }
};

const toJsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const scanProviderBackfill = async (
  ctx: DbContext,
  sampleLimit: number,
): Promise<ProviderBackfillScanResult> => {
  const changes: Array<ProviderBackfillChange> = [];
  const invalid_entries: Array<ProviderBackfillInvalidEntry> = [];
  const allChanges: Array<ProviderBackfillChange> = [];
  const allInvalidEntries: Array<ProviderBackfillInvalidEntry> = [];
  const changesByTable: Record<ProviderBackfillTable, number> = {
    integrations: 0,
    workspace_integrations: 0,
    audit_events: 0,
  };
  const invalidByTable: Record<ProviderBackfillTable, number> = {
    integrations: 0,
    workspace_integrations: 0,
    audit_events: 0,
  };

  const pushChange = (entry: ProviderBackfillChange): void => {
    allChanges.push(entry);
    changesByTable[entry.table] += 1;
    if (changes.length < sampleLimit) {
      changes.push(entry);
    }
  };

  const pushInvalid = (entry: ProviderBackfillInvalidEntry): void => {
    allInvalidEntries.push(entry);
    invalidByTable[entry.table] += 1;
    if (invalid_entries.length < sampleLimit) {
      invalid_entries.push(entry);
    }
  };

  let integrationCursor: string | null = null;
  let integrationsScanned = 0;
  while (true) {
    const page = await ctx.db.query("integrations").paginate({
      cursor: integrationCursor,
      numItems: SCAN_PAGE_SIZE,
    });
    for (const integration of page.page) {
      integrationsScanned += 1;
      const resolved = resolveStoredProviderValue(integration.provider);
      if (resolved.status === "invalid") {
        pushInvalid({
          table: "integrations",
          document_id: integration.id,
          field: "provider",
          value: integration.provider,
          reason: "unknown_provider_value",
        });
        continue;
      }

      if (
        resolved.status === "alias" &&
        resolved.canonical &&
        resolved.canonical !== integration.provider
      ) {
        pushChange({
          table: "integrations",
          document_id: integration.id,
          field: "provider",
          before: integration.provider,
          after: resolved.canonical,
        });
      }
    }
    if (page.isDone) {
      break;
    }
    integrationCursor = page.continueCursor;
  }
  if (integrationsScanned > SCAN_WARNING_THRESHOLD) {
    console.warn("provider_migrations.scan.large_table", {
      table: "integrations",
      scanned: integrationsScanned,
      warning_threshold: SCAN_WARNING_THRESHOLD,
    });
  }

  let workspaceCursor: string | null = null;
  let workspaceIntegrationsScanned = 0;
  while (true) {
    const page = await ctx.db.query("workspace_integrations").paginate({
      cursor: workspaceCursor,
      numItems: SCAN_PAGE_SIZE,
    });
    for (const integration of page.page) {
      workspaceIntegrationsScanned += 1;
      const resolved = resolveStoredProviderValue(integration.provider);
      if (resolved.status === "invalid") {
        pushInvalid({
          table: "workspace_integrations",
          document_id: integration.id,
          field: "provider",
          value: integration.provider,
          reason: "unknown_provider_value",
        });
        continue;
      }

      if (
        resolved.status === "alias" &&
        resolved.canonical &&
        resolved.canonical !== integration.provider
      ) {
        pushChange({
          table: "workspace_integrations",
          document_id: integration.id,
          field: "provider",
          before: integration.provider,
          after: resolved.canonical,
        });
      }
    }
    if (page.isDone) {
      break;
    }
    workspaceCursor = page.continueCursor;
  }
  if (workspaceIntegrationsScanned > SCAN_WARNING_THRESHOLD) {
    console.warn("provider_migrations.scan.large_table", {
      table: "workspace_integrations",
      scanned: workspaceIntegrationsScanned,
      warning_threshold: SCAN_WARNING_THRESHOLD,
    });
  }

  let auditCursor: string | null = null;
  let auditEventsScanned = 0;
  while (true) {
    const page = await ctx.db.query("audit_events").paginate({
      cursor: auditCursor,
      numItems: SCAN_PAGE_SIZE,
    });
    for (const event of page.page) {
      auditEventsScanned += 1;
      const payload = toJsonRecord(event.payload);
      if (!payload) {
        continue;
      }
      for (const field of ["provider", "integration_provider"] as const) {
        const value = payload[field];
        if (typeof value !== "string") {
          continue;
        }
        const resolved = resolveStoredProviderValue(value);
        if (resolved.status === "invalid") {
          pushInvalid({
            table: "audit_events",
            document_id: event.id,
            field,
            value,
            reason: "unknown_provider_value",
          });
          continue;
        }
        if (resolved.status === "alias" && resolved.canonical && resolved.canonical !== value) {
          pushChange({
            table: "audit_events",
            document_id: event.id,
            field,
            before: value,
            after: resolved.canonical,
          });
        }
      }
    }
    if (page.isDone) {
      break;
    }
    auditCursor = page.continueCursor;
  }
  if (auditEventsScanned > SCAN_WARNING_THRESHOLD) {
    console.warn("provider_migrations.scan.large_table", {
      table: "audit_events",
      scanned: auditEventsScanned,
      warning_threshold: SCAN_WARNING_THRESHOLD,
    });
  }

  return {
    all_changes: allChanges,
    all_invalid_entries: allInvalidEntries,
    changes,
    invalid_entries,
    total_changes: allChanges.length,
    total_invalid_entries: allInvalidEntries.length,
    changes_by_table: changesByTable,
    invalid_by_table: invalidByTable,
  };
};

const setProviderByCustomId = async (
  ctx: MutationCtx,
  table: ProviderBackfillProviderTable,
  documentId: string,
  provider: ProviderId,
): Promise<boolean> => {
  if (table === "integrations") {
    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_custom_id", (q) => q.eq("id", documentId))
      .unique();
    if (!integration) {
      return false;
    }
    await ctx.db.patch(integration._id, { provider });
    return true;
  }

  const workspaceIntegration = await ctx.db
    .query("workspace_integrations")
    .withIndex("by_custom_id", (q) => q.eq("id", documentId))
    .unique();
  if (!workspaceIntegration) {
    return false;
  }
  await ctx.db.patch(workspaceIntegration._id, { provider });
  return true;
};

const applyBackfillChange = async (
  ctx: MutationCtx,
  change: ProviderBackfillChange,
): Promise<boolean> => {
  if (change.table === "integrations" || change.table === "workspace_integrations") {
    return setProviderByCustomId(ctx, change.table, change.document_id, change.after);
  }

  const event = await ctx.db
    .query("audit_events")
    .withIndex("by_custom_id", (q) => q.eq("id", change.document_id))
    .unique();
  const payload = event ? toJsonRecord(event.payload) : null;
  if (!event || !payload) {
    return false;
  }

  await ctx.db.patch(event._id, {
    payload: {
      ...payload,
      [change.field]: change.after,
    },
  });
  return true;
};

const rollbackBackfillChange = async (
  ctx: MutationCtx,
  change: ProviderBackfillChange,
): Promise<boolean> => {
  if (change.table === "integrations" || change.table === "workspace_integrations") {
    const rollbackProvider = canonicalizeStoredProvider(change.before);
    if (!rollbackProvider) {
      return false;
    }
    return setProviderByCustomId(ctx, change.table, change.document_id, rollbackProvider);
  }

  const event = await ctx.db
    .query("audit_events")
    .withIndex("by_custom_id", (q) => q.eq("id", change.document_id))
    .unique();
  const payload = event ? toJsonRecord(event.payload) : null;
  if (!event || !payload) {
    return false;
  }

  await ctx.db.patch(event._id, {
    payload: {
      ...payload,
      [change.field]: change.before,
    },
  });
  return true;
};

export const previewCanonicalProviderBackfill = internalQuery({
  args: {
    sampleLimit: v.optional(v.number()),
  },
  returns: providerBackfillSummaryValidator,
  handler: async (ctx, args) => {
    const scan = await scanProviderBackfill(ctx, normalizeSampleLimit(args.sampleLimit));
    return {
      total_changes: scan.total_changes,
      total_invalid_entries: scan.total_invalid_entries,
      changes_by_table: scan.changes_by_table,
      invalid_by_table: scan.invalid_by_table,
      sample_changes: scan.changes,
      sample_invalid_entries: scan.invalid_entries,
    };
  },
});

export const listCanonicalProviderBackfillChanges = internalQuery({
  args: {},
  returns: providerBackfillChangesExportValidator,
  handler: async (ctx) => {
    const scan = await scanProviderBackfill(ctx, Number.MAX_SAFE_INTEGER);
    return {
      changes: scan.all_changes,
      invalid_entries: scan.all_invalid_entries,
    };
  },
});

export const applyCanonicalProviderBackfill = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    sampleLimit: v.optional(v.number()),
  },
  returns: applyBackfillResultValidator,
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const scan = await scanProviderBackfill(ctx, normalizeSampleLimit(args.sampleLimit));

    if (dryRun || scan.total_invalid_entries > 0) {
      return {
        dry_run: dryRun,
        blocked_by_invalid_entries: scan.total_invalid_entries > 0,
        total_changes: scan.total_changes,
        total_invalid_entries: scan.total_invalid_entries,
        applied_changes: 0,
        changes_by_table: scan.changes_by_table,
        invalid_by_table: scan.invalid_by_table,
        sample_changes: scan.changes,
        sample_invalid_entries: scan.invalid_entries,
      };
    }

    let appliedChanges = 0;
    for (const change of scan.all_changes) {
      const applied = await applyBackfillChange(ctx, change);
      if (applied) {
        appliedChanges += 1;
      }
    }

    return {
      dry_run: false,
      blocked_by_invalid_entries: false,
      total_changes: scan.total_changes,
      total_invalid_entries: scan.total_invalid_entries,
      applied_changes: appliedChanges,
      changes_by_table: scan.changes_by_table,
      invalid_by_table: scan.invalid_by_table,
      sample_changes: scan.changes,
      sample_invalid_entries: scan.invalid_entries,
    };
  },
});

export const rollbackCanonicalProviderBackfill = internalMutation({
  args: {
    entries: v.array(providerBackfillChangeValidator),
  },
  returns: rollbackResultValidator,
  handler: async (ctx, args) => {
    let rolledBack = 0;
    let skipped = 0;
    for (const entry of args.entries) {
      const restored = await rollbackBackfillChange(ctx, entry);
      if (restored) {
        rolledBack += 1;
      } else {
        skipped += 1;
      }
    }
    return {
      rolled_back: rolledBack,
      skipped_missing_documents: skipped,
    };
  },
});

export const validateCanonicalProviderStorage = internalQuery({
  args: {
    sampleLimit: v.optional(v.number()),
  },
  returns: providerBackfillSummaryValidator,
  handler: async (ctx, args) => {
    const scan = await scanProviderBackfill(ctx, normalizeSampleLimit(args.sampleLimit));
    return {
      total_changes: scan.total_changes,
      total_invalid_entries: scan.total_invalid_entries,
      changes_by_table: scan.changes_by_table,
      invalid_by_table: scan.invalid_by_table,
      sample_changes: scan.changes,
      sample_invalid_entries: scan.invalid_entries,
    };
  },
});
